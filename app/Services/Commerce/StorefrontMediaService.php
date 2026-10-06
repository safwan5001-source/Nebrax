<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Throwable;

/**
 * CUST-HV V2a — مكتبة وسائط المُخصِّص: رفع، سلّم المتغيّرات الأساسي، إعادة
 * المحاولة، الحذف الآمن، والروابط الموقَّعة لمعاينة مساحة العمل.
 *
 * العقد: docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.
 *
 * - **التخزين R2 فقط** عبر `R2StorageService` (نطاق `storefront-media`)؛ لا
 *   تراجع إلى قرص `DocumentStorageService` الزائل أبداً. العلم مغلق افتراضياً.
 * - **المستأجر من `TenantContext` فقط**؛ لا يُمرَّر مفتاح/بادئة من المستدعي.
 * - **نشر المتغيّرات ليس هنا**: هذه الخدمة لا تُنشئ ولا تتحقق من أي قراءة عامة
 *   (بوابة المراجع المنشورة V2c). هنا فقط ما يخصّ مساحة العمل الموثَّقة.
 */
class StorefrontMediaService
{
    private const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    public function __construct(
        private readonly R2StorageService $r2,
        private readonly StorefrontMediaVariantGenerator $variants,
        private readonly StorefrontMediaReferenceScanner $references,
        private readonly TenantContext $tenant,
    ) {}

    public function uploadsEnabled(): bool
    {
        return (bool) config('storefront_media.r2.enabled', false);
    }

    /**
     * @return array{media:StorefrontMedia,deduplicated:bool}
     *
     * @throws StorefrontMediaException
     */
    public function upload(UploadedFile $file, ?string $uploadedBy): array
    {
        if (! $this->uploadsEnabled()) {
            throw StorefrontMediaException::storageNotEnabled();
        }

        $path = $file->getRealPath();
        if (! is_string($path) || $path === '' || ! is_readable($path)) {
            throw new StorefrontMediaException('image_unreadable', 'تعذّرت قراءة الملف المرفوع.');
        }

        $meta = $this->inspect($path, (int) $file->getSize());
        $sha256 = hash_file('sha256', $path);

        // نفس البايتات داخل المستأجر = نفس الأصل (V0 §7.2) — لا نسخة ثانية.
        $existing = StorefrontMedia::query()
            ->where('sha256', $sha256)
            ->where('state', StorefrontMedia::STATE_ACTIVE)
            ->orderBy('created_at')
            ->first();
        if ($existing !== null) {
            return ['media' => $existing, 'deduplicated' => true];
        }

        $this->assertQuota($meta['size']);

        $media = new StorefrontMedia([
            'original_name' => $this->safeName($file->getClientOriginalName()),
            'mime' => $meta['mime'],
            'size' => $meta['size'],
            'sha256' => $sha256,
            'width' => $meta['width'],
            'height' => $meta['height'],
            'storage_key' => 'original.'.$meta['extension'],
            'uploaded_by' => $uploadedBy,
        ]);
        $media->id = (string) Str::uuid();
        $media->save();

        try {
            // بايتات لا مجرى: الأصل ≤ 5MB، ومسار المجرى في `R2StorageService::put`
            // يستدعي `is_readable()` على مورد (TypeError) — عيبٌ قائم خارج نطاق V2a
            // ومُوثَّق في تقريره، فلا نمرّ به ولا نعدّل الخدمة المشتركة هنا.
            $bytes = file_get_contents($path);
            if ($bytes === false) {
                throw new StorefrontMediaException('image_unreadable', 'تعذّرت قراءة الملف المرفوع.');
            }
            $this->r2->put(StorefrontMedia::R2_DOMAIN, $media->id, $media->storage_key, $bytes, $meta['mime']);
            unset($bytes);
        } catch (Throwable $e) {
            // لا أصل بلا ملف: لا صفّ يتيم ولا ملف يتيم.
            $media->delete();
            $this->report($e);
            throw $e instanceof StorefrontMediaException ? $e : StorefrontMediaException::storageUnavailable();
        }

        $this->generateVariants($media, $path);

        return ['media' => $media->refresh(), 'deduplicated' => false];
    }

    /**
     * إعادة توليد المتغيّرات من الأصل المخزَّن (لحالة `failed` — أو `pending`
     * عالقة بعد انقطاع). idempotent: `ready` يعود كما هو.
     *
     * @throws StorefrontMediaException
     */
    public function retry(StorefrontMedia $media): StorefrontMedia
    {
        if (! $media->isActive()) {
            throw new StorefrontMediaException('media_not_active', 'الوسيط محذوف.', 409);
        }
        if ($media->isReady()) {
            return $media;
        }
        if (! $this->uploadsEnabled()) {
            throw StorefrontMediaException::storageNotEnabled();
        }

        $temp = tempnam(sys_get_temp_dir(), 'sfm');
        if ($temp === false) {
            throw StorefrontMediaException::storageUnavailable();
        }

        try {
            $body = $this->r2->get(StorefrontMedia::R2_DOMAIN, $media->id, $media->storage_key);
            file_put_contents($temp, (string) $body);
            $this->generateVariants($media, $temp);
        } catch (Throwable $e) {
            $this->report($e);
            throw $e instanceof StorefrontMediaException ? $e : StorefrontMediaException::storageUnavailable();
        } finally {
            @unlink($temp);
        }

        return $media->refresh();
    }

    /**
     * حذفٌ ناعم لأصلٍ غير مُشار إليه فقط. المُشار إليه → 409 بقائمة الاستخدام
     * (يشمل المسودة وكل نسخة والمجدولة والمنشورة).
     *
     * @throws StorefrontMediaException
     */
    public function delete(StorefrontMedia $media): void
    {
        $usage = $this->references->referencesFor([$media->id])[$media->id] ?? [];
        if ($usage !== []) {
            throw new StorefrontMediaException(
                'media_in_use',
                'لا يمكن حذف وسيطٍ مستخدمٍ في التصميم. أزله من أماكن استخدامه أولاً.',
                409,
                ['usage' => $usage],
            );
        }

        $media->forceFill([
            'state' => StorefrontMedia::STATE_DELETED,
            'deleted_at' => now(),
            'purge_after' => now()->addDays((int) config('storefront_media.purge_after_days', 30)),
        ])->save();
    }

    /** رابط موقَّع قصير الأجل لمتغيّرٍ بعينه (قراءة مساحة العمل). */
    public function signedUrl(StorefrontMedia $media, string $file): ?string
    {
        if (! $media->isReady() || $media->variantByFile($file) === null) {
            return null;
        }
        $tenantId = $this->tenant->id();
        if ($tenantId === null) {
            return null;
        }

        return URL::temporarySignedRoute(
            'commerce.workspace.storefront-media.file',
            now()->addMinutes((int) config('storefront_media.signed_url_minutes', 20)),
            ['media' => $media->id, 'tenant' => $tenantId, 'file' => $file],
        );
    }

    /**
     * @return mixed مجرى البايتات من R2
     *
     * @throws StorefrontMediaException
     */
    public function readVariant(StorefrontMedia $media, string $file)
    {
        try {
            return $this->r2->get(StorefrontMedia::R2_DOMAIN, $media->id, $file);
        } catch (Throwable $e) {
            $this->report($e);
            throw StorefrontMediaException::storageUnavailable();
        }
    }

    // ───────────────────────────── internals ─────────────────────────────

    /**
     * @return array{mime:string,extension:string,width:int,height:int,size:int}
     *
     * @throws StorefrontMediaException
     */
    private function inspect(string $path, int $size): array
    {
        if ($size <= 0 || $size > (int) config('storefront_media.max_bytes')) {
            throw new StorefrontMediaException('file_too_large', 'حجم الصورة يتجاوز الحد المسموح (5 ميغابايت).');
        }

        // الامتداد/نوع العميل لا يُعتمد: نسبر البايتات.
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
        if (! isset(self::ALLOWED[$mime])) {
            throw new StorefrontMediaException('unsupported_type', 'الصيغة غير مدعومة. المسموح: JPG وPNG وWebP.');
        }
        if ($this->isAnimated($path, $mime)) {
            throw new StorefrontMediaException('animated_not_supported', 'الصور المتحركة غير مدعومة.');
        }
        // فكّ GD متسامحٌ مع الملف المبتور (يعيد صورةً رماديةً جزئية بلا خطأ):
        // نرفض ما لا ينتهي بعلامة نهايته بدل نشر صورةٍ نصفها مفقود.
        if (! $this->hasCompleteTail($path, $mime)) {
            throw new StorefrontMediaException('image_unreadable', 'الملف ناقص أو تالف (لم يكتمل رفعه). أعد تصديره ثم ارفعه.');
        }

        $dimensions = @getimagesize($path);
        if (! is_array($dimensions) || ($dimensions[0] ?? 0) < 1 || ($dimensions[1] ?? 0) < 1) {
            throw new StorefrontMediaException('image_unreadable', 'تعذّرت قراءة أبعاد الصورة. قد يكون الملف تالفاً.');
        }
        [$width, $height] = [(int) $dimensions[0], (int) $dimensions[1]];

        if (min($width, $height) < (int) config('storefront_media.min_short_edge')) {
            throw new StorefrontMediaException('dimension_too_small', 'الصورة صغيرة جداً. الحد الأدنى 320 بكسل على الضلع الأقصر.');
        }
        if (max($width, $height) > (int) config('storefront_media.max_edge')) {
            throw new StorefrontMediaException('dimension_too_large', 'الصورة كبيرة جداً. الحد الأقصى 8192 بكسل لأي ضلع.');
        }
        if ($width * $height > (int) config('storefront_media.max_pixels')) {
            throw new StorefrontMediaException('pixel_limit', 'دقة الصورة أعلى من المسموح (40 ميغابكسل).');
        }
        $this->assertDecodable($width, $height, $mime === 'image/jpeg' ? StorefrontMediaOrientation::read($path) : 1);

        return [
            'mime' => $mime,
            'extension' => self::ALLOWED[$mime],
            'width' => $width,
            'height' => $height,
            'size' => $size,
        ];
    }

    /**
     * حارس كلفة الفكّ (N-1). ذاكرة GD خارج `memory_limit` في PHP، فلا يُقاس بها —
     * بل بميزانية لكل طلب مُعايَرة على RSS المقيس (انظر `config/storefront_media.php`).
     * الصورة المُدوَّرة بالاتجاه تكلّف نسخةً إضافية، فتُحتسب بعاملٍ أعلى.
     */
    public function assertDecodable(int $width, int $height, int $orientation): void
    {
        $rotated = in_array($orientation, [3, 4, 5, 6, 7, 8], true);
        $buffers = (float) config($rotated ? 'storefront_media.decode_buffers_rotated' : 'storefront_media.decode_buffers_plain');
        $estimate = (int) ceil($width * $height * 4 * $buffers) + (int) config('storefront_media.decode_overhead_bytes');

        if ($estimate > (int) config('storefront_media.decode_budget_bytes')) {
            throw new StorefrontMediaException(
                'image_too_large_for_processing',
                'دقة الصورة أعلى مما يتسع له المعالج حالياً. صغّرها ثم أعد الرفع.',
            );
        }
    }

    /** JPEG ينتهي بـEOI (FFD9، مع هامش حشوٍ)، PNG بـIEND، WebP بطول RIFF مطابق. */
    private function hasCompleteTail(string $path, string $mime): bool
    {
        $size = (int) filesize($path);
        $handle = fopen($path, 'rb');
        if ($handle === false || $size < 16) {
            return false;
        }

        try {
            if ($mime === 'image/webp') {
                $head = (string) fread($handle, 12);

                return strlen($head) === 12
                    && substr($head, 0, 4) === 'RIFF'
                    && (unpack('V', substr($head, 4, 4))[1] + 8) <= $size;
            }

            fseek($handle, max(0, $size - 64));
            $tail = (string) fread($handle, 64);

            return $mime === 'image/png'
                ? str_contains($tail, 'IEND')
                : str_contains($tail, "\xFF\xD9");
        } finally {
            fclose($handle);
        }
    }

    private function isAnimated(string $path, string $mime): bool
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }

        try {
            if ($mime === 'image/webp') {
                $head = (string) fread($handle, 32);

                // VP8X: بتّ الحركة (0x02) في بايت الرايات.
                return substr($head, 12, 4) === 'VP8X' && (ord($head[20] ?? "\0") & 0x02) === 0x02;
            }

            if ($mime === 'image/png') {
                fseek($handle, 8);
                while (! feof($handle)) {
                    $header = (string) fread($handle, 8);
                    if (strlen($header) < 8) {
                        return false;
                    }
                    $length = unpack('N', substr($header, 0, 4))[1];
                    $type = substr($header, 4, 4);
                    if ($type === 'acTL') {
                        return true;
                    }
                    if ($type === 'IDAT' || $type === 'IEND') {
                        return false;
                    }
                    fseek($handle, $length + 4, SEEK_CUR);
                }
            }
        } finally {
            fclose($handle);
        }

        return false;
    }

    /** @throws StorefrontMediaException */
    private function assertQuota(int $incomingBytes): void
    {
        $count = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->count();
        if ($count >= (int) config('storefront_media.max_assets_per_tenant')) {
            throw new StorefrontMediaException('library_full', 'اكتملت سعة مكتبة الوسائط. احذف وسائط غير مستخدمة ثم أعد المحاولة.');
        }

        $bytes = (int) StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->sum('size');
        if ($bytes + $incomingBytes > (int) config('storefront_media.max_bytes_per_tenant')) {
            throw new StorefrontMediaException('library_quota_exceeded', 'تجاوزت مساحة مكتبة الوسائط المسموحة. احذف وسائط غير مستخدمة.');
        }
    }

    /**
     * يولّد السلّم ويخزّنه ويحدّث الصفّ. أي فشل يُنظّف ما كُتب ويترك الصفّ
     * `failed` برمزٍ قابلٍ للترجمة — الأصل يبقى ظاهراً وقابلاً لإعادة المحاولة.
     */
    private function generateVariants(StorefrontMedia $media, string $sourcePath): void
    {
        $stored = [];

        try {
            $result = $this->variants->generate($sourcePath, function (string $file, string $bytes, string $mime) use ($media, &$stored): void {
                $this->r2->put(StorefrontMedia::R2_DOMAIN, $media->id, $file, $bytes, $mime);
                $stored[] = $file;
            });

            $media->forceFill([
                'width' => $result['width'],
                'height' => $result['height'],
                'avg_luminance' => $result['avg_luminance'],
                'dominant_colour' => $result['dominant_colour'],
                'variants' => $result['variants'],
                'variants_state' => StorefrontMedia::VARIANTS_READY,
                'variants_error' => null,
            ])->save();
        } catch (Throwable $e) {
            foreach ($stored as $file) {
                try {
                    $this->r2->delete(StorefrontMedia::R2_DOMAIN, $media->id, $file);
                } catch (Throwable) {
                    // أفضل جهد: المصالِح (V2c) يزيل ما تبقّى بالبادئة.
                }
            }

            $media->forceFill([
                'variants' => null,
                'variants_state' => StorefrontMedia::VARIANTS_FAILED,
                'variants_error' => $this->failureCode($e),
            ])->save();
            $this->report($e);
        }
    }

    /** رمزٌ ثابت تترجمه الواجهة؛ لا نص استثناءٍ يخرج أبداً. */
    private function failureCode(Throwable $e): string
    {
        return match (true) {
            $e instanceof StorefrontMediaException => $e->errorCode,
            $e instanceof \Intervention\Image\Interfaces\ExceptionInterface => 'image_unreadable',
            $e instanceof AwsException, $e instanceof \RuntimeException => 'storage_unavailable',
            default => 'processing_failed',
        };
    }

    private function safeName(string $name): string
    {
        $name = trim(preg_replace('/[\x00-\x1F\x7F]+/u', '', $name) ?? '');
        $name = basename(str_replace('\\', '/', $name));

        return mb_substr($name !== '' ? $name : 'image', 0, 255);
    }

    private function report(Throwable $e): void
    {
        // لا نسرّب رسالة الاستثناء (قد تحوي دلواً/مفتاحاً) إلا في السجلّ الداخلي.
        if (! $e instanceof StorefrontMediaException) {
            report($e);
        }
    }
}
