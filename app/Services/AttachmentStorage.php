<?php

namespace App\Services;

use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

/**
 * مرفقات المستندات والموظفين: كتابة دائمة على R2 (خلف علم) أو القرص المحلي (السلوك القديم).
 *
 * غلافٌ رقيق على `R2StorageService` القائم كما هو (Q4): المفتاح يُشتقّ من `TenantContext`
 * وحده، والقراءة والحذف يتبعان عمود `disk` للصف لا العلم (BC-1/BC-2). القاعدة الحاكمة:
 * **`put` يرمي دائماً** — `->store()` يُعيد `false` بصمت على القرص المحلي، وهو ما كان يُنتج
 * صفاً يشير إلى لا شيء. لا يوجد هنا مسار يُرجع نجاحاً دون ملفّ مكتوب فعلاً.
 *
 * الملفات الخاصة تبقى خلف فحص صلاحيات Laravel (D-g): لا presigned ولا 302 ولا CDN.
 */
final class AttachmentStorage
{
    public const DOMAIN_EXPENSE = 'expense-attachments';
    public const DOMAIN_PAYMENT = 'payment-attachments';
    public const DOMAIN_PURCHASE = 'purchase-attachments';
    public const DOMAIN_INVOICE_NOTE = 'invoice-note-attachments';
    public const DOMAIN_EMPLOYEE = 'employee-attachments';
    public const DOMAIN_EMPLOYEE_PHOTO = 'employee-photo';

    private const DOMAINS = [
        self::DOMAIN_EXPENSE, self::DOMAIN_PAYMENT, self::DOMAIN_PURCHASE,
        self::DOMAIN_INVOICE_NOTE, self::DOMAIN_EMPLOYEE, self::DOMAIN_EMPLOYEE_PHOTO,
    ];

    private const IMAGE_MIME_BY_EXTENSION = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
        'webp' => 'image/webp', 'gif' => 'image/gif',
    ];

    public function __construct(
        private readonly R2StorageService $r2,
        private readonly TenantContext $tenantContext,
    ) {}

    /** علم الكتابة الجديدة فقط. false (الافتراضي) = القرص المحلي كما كان. */
    public function r2Enabled(): bool
    {
        return (bool) config('attachments.r2.enabled', false);
    }

    /** القرص الذي ستُكتب عليه الملفات الجديدة الآن (يُسجَّل في عمود `disk` للصف). */
    public function writeDisk(): string
    {
        return $this->r2Enabled() ? 'r2' : 'local';
    }

    /** معرّف تجميع لمفتاح الملفات حين لا يكون الأب مُنشأً بعد (إنشاء ذرّي). */
    public function newResourceId(): string
    {
        return (string) Str::uuid();
    }

    /**
     * يكتب ملفاً واحداً ويُعيد وصف الصف الجاهز للإدراج. **يرمي** عند أي فشل.
     *
     * @param string $localDir المجلد الكامل على القرص المحلي (السلوك القديم) — يُهمَل حين يكون R2 مفعّلاً.
     * @return array{disk:string,path:string,original_name:string,mime_type:?string,size:int}
     */
    public function put(string $domain, string $resourceId, UploadedFile $file, string $localDir): array
    {
        if (! in_array($domain, self::DOMAINS, true)) {
            throw new AttachmentStorageException("Unknown attachment domain: {$domain}.");
        }
        if (! $file->isValid() || $file->getRealPath() === false) {
            throw new AttachmentStorageException('Uploaded file is not valid.');
        }

        $mime = $file->getMimeType();
        $size = (int) $file->getSize();
        $disk = $this->writeDisk();

        if ($disk === 'r2') {
            $path = $this->putR2($domain, $resourceId, $file, $mime);
        } else {
            // `store()` يُعيد false بصمت (throw=false على القرص المحلي) وقد يرمي عند تعذّر إنشاء المجلد؛
            // الحالتان فشلٌ صريح هنا — لا صفّ يُبنى على كتابة غير مؤكَّدة.
            try {
                $path = $file->store($localDir, 'local');
            } catch (Throwable $e) {
                throw new AttachmentStorageException('Local attachment write failed.', 0, $e);
            }
            if (! is_string($path) || $path === '') {
                throw new AttachmentStorageException('Local attachment write failed.');
            }
        }

        return [
            'disk' => $disk,
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $mime,
            'size' => $size,
        ];
    }

    /**
     * يكتب مجموعة ملفات كلَّها أو لا شيء: عند فشل الملف N تُحذف الملفات 1..N-1 ثم يُعاد الرمي.
     *
     * @param array<int,UploadedFile> $files
     * @return array<int,array{disk:string,path:string,original_name:string,mime_type:?string,size:int}>
     */
    public function putMany(string $domain, string $resourceId, array $files, string $localDir): array
    {
        $stored = [];
        try {
            foreach ($files as $file) {
                $stored[] = $this->put($domain, $resourceId, $file, $localDir);
            }
        } catch (Throwable $e) {
            $this->discard($stored);
            throw $e;
        }

        return $stored;
    }

    /**
     * تعويضٌ بعد فشل لاحق (تراجع المعاملة): يحذف ما كُتب. لا يرمي أبداً؛ أي فشل حذف يُسجَّل
     * بمفتاح الكائن ليُنظَّف يدوياً (R2StorageService لا يعرض سرداً، فاليتيم لا يُكتشف آلياً).
     *
     * @param array<int,array{disk:string,path:string}> $stored
     */
    public function discard(array $stored): void
    {
        foreach ($stored as $item) {
            try {
                $this->delete($item['disk'], $item['path']);
            } catch (Throwable $e) {
                report($e);
                logger()->warning('attachment compensation delete failed', [
                    'disk' => $item['disk'], 'path' => $item['path'],
                ]);
            }
        }
    }

    public function exists(string $disk, string $path): bool
    {
        if ($disk === 'r2') {
            $parts = $this->r2Parts($path);
            if ($parts === null) {
                return false;
            }
            try {
                return $this->r2->exists(...$parts);
            } catch (AwsException $e) {
                throw new AttachmentStorageException('R2 head failed.', 0, $e);
            }
        }

        return Storage::disk($disk)->exists($path);
    }

    /** حذف صارم: يرمي عند فشل R2. الحذف المحلي لملف مفقود لا يُعدّ خطأً. */
    public function delete(string $disk, string $path): void
    {
        if ($disk === 'r2') {
            $parts = $this->r2Parts($path);
            if ($parts === null) {
                throw new AttachmentStorageException('R2 object key does not belong to the active tenant.');
            }
            try {
                $this->r2->delete(...$parts);
            } catch (\RuntimeException|AwsException $e) {
                throw new AttachmentStorageException('R2 delete failed.', 0, $e);
            }

            return;
        }

        Storage::disk($disk)->delete($path);
    }

    /** تنزيل خلف فحص الصلاحيات في المتحكّم. 404 إن غاب الملف. */
    public function download(string $disk, string $path, string $name, ?string $mime): StreamedResponse
    {
        $headers = [
            'Content-Type' => $mime ?? 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($disk === 'r2') {
            return response()->streamDownload($this->r2Stream($path), $name, $headers);
        }

        $local = Storage::disk($disk);
        if (! $local->exists($path)) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        return $local->download($path, $name, $headers);
    }

    /** عرض مضمَّن (صورة الموظف) — صور فقط، النوع من الامتداد المخزَّن بيد الخادم. */
    public function inlineImage(string $disk, string $path): StreamedResponse
    {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $headers = [
            'Content-Type' => self::IMAGE_MIME_BY_EXTENSION[$extension] ?? 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($disk === 'r2') {
            return response()->stream($this->r2Stream($path), 200, $headers);
        }

        $local = Storage::disk($disk);
        if (! $local->exists($path)) {
            abort(404, 'لا صورة لهذا الموظف.');
        }

        return $local->response($path, null, $headers);
    }

    /** @return \Closure():void */
    private function r2Stream(string $path): \Closure
    {
        $parts = $this->r2Parts($path);
        if ($parts === null) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        try {
            $body = $this->r2->get(...$parts);
        } catch (\RuntimeException|AwsException $e) {
            if ($e instanceof AwsException && ($e->getStatusCode() === 404 || $e->getAwsErrorCode() === 'NoSuchKey')) {
                abort(404, 'ملف المرفق غير موجود.');
            }
            throw new AttachmentStorageException('R2 read failed.', 0, $e);
        }

        return static function () use ($body): void {
            while (! $body->eof()) {
                echo $body->read(65536);
                flush();
            }
        };
    }

    private function putR2(string $domain, string $resourceId, UploadedFile $file, ?string $mime): string
    {
        $extension = strtolower((string) ($file->guessExtension() ?: $file->getClientOriginalExtension()));
        $extension = preg_match('/\A[a-z0-9]{1,8}\z/', $extension) === 1 ? $extension : 'bin';
        $filename = Str::uuid().'.'.$extension;

        // بايتات لا stream: `R2StorageService::put` يفحص `is_readable($body)` على المورد وهو يرمي
        // TypeError في PHP 8 (مسار stream لم يُستهلك قط). Q4 يمنع تعديل الخدمة، والحدّ 20MB
        // ضمن memory_limit=256M، والكتابة متسلسلة فلا تتراكم الملفات في الذاكرة.
        $bytes = file_get_contents((string) $file->getRealPath());
        if ($bytes === false) {
            throw new AttachmentStorageException('Uploaded file is not readable.');
        }

        try {
            return $this->r2->put($domain, $resourceId, $filename, $bytes, $mime);
        } catch (\RuntimeException|AwsException $e) {
            throw new AttachmentStorageException('R2 write failed.', 0, $e);
        }
    }

    /**
     * يفكّ `tenant/{tenant}/{domain}/{resource}/{file}` ويشترط أن المستأجر هو النشط وأن النطاق
     * معروف. مسارٌ لمستأجر آخر **لا يُحلّ** (A-07) — `R2StorageService` يعيد اشتقاق المفتاح من
     * `TenantContext` على أي حال، فهذا حاجزٌ ثانٍ لا الوحيد.
     *
     * @return array{0:string,1:string,2:string}|null
     */
    private function r2Parts(string $path): ?array
    {
        $segments = explode('/', $path);
        if (count($segments) !== 5 || $segments[0] !== 'tenant') {
            return null;
        }
        if ($segments[1] !== (string) $this->tenantContext->id()) {
            return null;
        }
        if (! in_array($segments[2], self::DOMAINS, true)) {
            return null;
        }

        return [$segments[2], $segments[3], $segments[4]];
    }
}
