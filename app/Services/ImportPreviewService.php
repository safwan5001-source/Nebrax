<?php

namespace App\Services;

use App\Models\ImportPreview;
use App\Support\ImportPreviewException;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * معاينة الاستيراد **أحادية الاستعمال** يحفظها الخادم (IMP-H1-S3b، القاعدة 5 و10 و11 و12).
 *
 * كانت المعاينة والتنفيذ طلبَين مستقلَّين لا يربطهما شيء: ما اعتمده المستخدم في المعاينة ليس بالضرورة ما يُنفَّذ (ملفٌ
 * أو خياراتٌ أو مطابقةٌ مختلفة). الآن:
 *   - `issue()` عند المعاينة تحفظ سجلاً يربط (المستأجر · الفرع · المستخدم · المجال · بصمة الملف · بصمة أرشيف الصور ·
 *     الخيارات القانونية) ببصمة HMAC لها كلّها، وتُرجع المعرّف والبصمة والانقضاء.
 *   - إنشاء التشغيلة التنفيذية يُثبت أن ما يُرفَع الآن يطابق المعاينة حرفياً (`assertConsumable`) ثم **يُنفقها** بتحديثٍ
 *     شرطيّ ذرّي (`consume`) داخل معاملة إنشاء التشغيلة نفسها: معاينةٌ واحدة ⇒ تشغيلةٌ واحدة على الأكثر، فلا تكرار تحت
 *     التزامن ولا إعادة استعمال.
 *
 * البصمة HMAC بمفتاح التطبيق: لا يستطيع عميلٌ اختلاقها لملفٍ أو خياراتٍ لم تُعاين. لا تُغني عن السجل (الإنفاق أحادي
 * الاستعمال والانقضاء في القاعدة)، بل تجعل التحقق قابلاً للعرض والمقارنة.
 */
class ImportPreviewService
{
    public const HASH_VERSION = 1;

    public function __construct(
        private readonly ImportDomainRegistry $domains,
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
    ) {}

    /**
     * هل المعاينة ملزمة لإنشاء التشغيلات الآن؟ `imports.preview_required_from` = لحظة البدء (ISO-8601) أو `null` = غير ملزمة بعد
     * (العقد القديم مسموح). تُضبط في شريحة التفعيل **بتعديل قيمة افتراضية في الكود** (بعد نشر الواجهة التي ترسلها) لا بمتغيّر بيئة
     * — فلا قرار تشغيلي خارج المستودع.
     */
    public function requiredNow(): bool
    {
        $from = config('imports.preview_required_from');

        return is_string($from) && $from !== '' && now('UTC')->greaterThanOrEqualTo($from);
    }

    /**
     * يحفظ المعاينة ويُرجع ما تحتاجه الواجهة لإرفاقه بإنشاء التشغيلة.
     *
     * @param  array<string, mixed>  $rawOptions  الخيارات كما وردت في طلب المعاينة (تُحوَّل إلى القانونية هنا).
     * @return array{id: string, hash: string, expires_at: string}
     */
    public function issue(string $domain, UploadedFile $file, ?UploadedFile $archive, array $rawOptions, ?string $userId): array
    {
        $fileSha = $this->sha($file, 'الملف');
        $archiveSha = $archive === null ? null : $this->sha($archive, 'أرشيف الصور');
        $options = $this->domains->for($domain)->canonicalOptions($rawOptions);
        $branchId = $this->branch->id();
        $tenantId = $this->requireTenant();

        // `expires_at` يُخزَّن بتوقيت UTC (كل مقارنة هنا بـ`now('UTC')`)؛ لا يُقرأ عبر cast `datetime` لأنه يفسّر النصّ المخزَّن
        // بمنطقة التطبيق (إن لم تكن UTC لبدت المعاينة منتهيةً فوراً أو صالحةً بعد انتهائها).
        $expiresAt = now('UTC')->addMinutes($this->ttlMinutes());

        $preview = ImportPreview::create([
            'tenant_id' => $tenantId,
            'branch_id' => $branchId,
            'user_id' => $userId,
            'domain' => $domain,
            'file_sha256' => $fileSha,
            'archive_sha256' => $archiveSha,
            'options' => $options,
            'preview_hash' => $this->hash($tenantId, $branchId, $domain, $fileSha, $archiveSha, $options),
            'expires_at' => $expiresAt,
        ]);

        return [
            'id' => $preview->id,
            'hash' => $preview->preview_hash,
            'expires_at' => $expiresAt->toIso8601String(),
        ];
    }

    /**
     * يتحقّق أن ما يُرفَع الآن يطابق المعاينة **قبل** أي تخزين ملف. لا يكتب شيئاً (القراءة بلا قفل؛ الحَكَم النهائي هو
     * الإنفاق الشرطي داخل معاملة الإنشاء).
     *
     * @param  array<string, mixed>  $canonical  خيارات الإنشاء بعد التحويل القانوني.
     */
    public function assertConsumable(
        string $previewId,
        string $previewHash,
        ?string $userId,
        string $domain,
        string $fileSha,
        ?string $archiveSha,
        array $canonical,
    ): ImportPreview {
        $preview = ImportPreview::query()->whereKey($previewId)->first();
        if ($preview === null || ! hash_equals((string) $preview->preview_hash, $previewHash)) {
            // معرّفٌ مجهول أو من مستأجر آخر أو بصمةٌ لا تخصّه: رسالةٌ واحدة لا تفرّق بينها.
            throw new ImportPreviewException('preview_invalid', 'المعاينة غير صالحة. أعد فحص الملف قبل التنفيذ.');
        }
        if ($preview->consumed_at !== null) {
            throw new ImportPreviewException('preview_consumed', 'استُعملت هذه المعاينة لتشغيلة أخرى. أعد فحص الملف.');
        }
        // الانقضاء يُحسَم في القاعدة بنفس ساعة الكتابة (UTC) لا بقراءة السمة (انظر `issue()`).
        $live = ImportPreview::query()->whereKey($previewId)->where('expires_at', '>', now('UTC'))->exists();
        if (! $live) {
            throw new ImportPreviewException('preview_expired', 'انتهت صلاحية المعاينة. أعد فحص الملف قبل التنفيذ.');
        }

        $tenantId = $this->requireTenant();
        $expected = $this->hash($tenantId, $this->branch->id(), $domain, $fileSha, $archiveSha, $canonical);
        if (
            $preview->domain !== $domain
            || $preview->user_id !== $userId
            || $preview->branch_id !== $this->branch->id()
            || ! hash_equals($expected, (string) $preview->preview_hash)
        ) {
            // الملف أو الخيارات أو المطابقة أو الفرع أو المستخدم تغيّر منذ المعاينة.
            throw new ImportPreviewException('preview_mismatch', 'الملف أو الخيارات تغيّرت عمّا عاينته. أعد فحص الملف قبل التنفيذ.');
        }

        return $preview;
    }

    /**
     * ينفق المعاينة بتحديثٍ شرطيّ واحد — يُستدعى **داخل** معاملة إنشاء التشغيلة. طلبان متزامنان على المعاينة نفسها:
     * الثاني ينتظر قفل الصفّ ثم يجد `consumed_at` مضبوطاً فيُحدَّث صفرُ صفّ ⇒ يُرفض.
     */
    public function consume(ImportPreview $preview, string $jobId): void
    {
        $updated = ImportPreview::query()
            ->whereKey($preview->id)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now('UTC'))
            ->update(['consumed_at' => now('UTC'), 'consumed_job_id' => $jobId, 'updated_at' => now('UTC')]);

        if ($updated !== 1) {
            throw new ImportPreviewException('preview_consumed', 'استُعملت هذه المعاينة أو انتهت صلاحيتها. أعد فحص الملف.');
        }
    }

    /**
     * @param  array<string, mixed>  $canonical
     */
    public function hash(string $tenantId, ?string $branchId, string $domain, string $fileSha, ?string $archiveSha, array $canonical): string
    {
        $payload = json_encode([
            'v' => self::HASH_VERSION,
            'tenant' => $tenantId,
            'branch' => $branchId,
            'domain' => $domain,
            'file' => $fileSha,
            'archive' => $archiveSha,
            'options' => $canonical,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);

        return hash_hmac('sha256', $payload, $this->key());
    }

    /** تقليم المعاينات المنتهية/المنفَقة القديمة — يُستدعى من `imports:prune`. */
    public function pruneStale(): int
    {
        return ImportPreview::query()->withoutGlobalScopes()
            ->where(fn ($q) => $q->where('expires_at', '<', now('UTC')->subDay())->orWhere('consumed_at', '<', now('UTC')->subDays(7)))
            ->delete();
    }

    private function ttlMinutes(): int
    {
        return max(1, (int) config('imports.preview_ttl_minutes', 60));
    }

    private function sha(UploadedFile $file, string $label): string
    {
        $sha = hash_file('sha256', $file->getRealPath());
        if ($sha === false) {
            throw new RuntimeException("تعذّر حساب بصمة {$label}.");
        }

        return $sha;
    }

    private function requireTenant(): string
    {
        $id = $this->tenant->id();
        if ($id === null) {
            throw new RuntimeException('لا مؤسسة نشطة لهذه المعاينة.');
        }

        return (string) $id;
    }

    private function key(): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new RuntimeException('مفتاح التطبيق غير مضبوط؛ لا يمكن توقيع المعاينة.');
        }

        return $key;
    }
}
