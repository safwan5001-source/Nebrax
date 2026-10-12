<?php

namespace App\Services\Commerce;

use App\Models\StorefrontPresentationVersion;
use App\Models\StorefrontPresentationVersionRevision;
use App\Support\Commerce\StorefrontPresentationNormalizer;

/**
 * CUST-H5-3 — يسجّل لقطات المراجعات المحفوظة لنسخة مظهر. **مصدر الحقيقة الوحيد** لاتفاقية السجلّ.
 *
 * الاتفاقية (مجمَّدة، `docs/plans/store/CUST-H5-3-IMPLEMENTATION-REPORT.md`):
 *  1. **لقطة بعد الحفظ:** بعد كل حفظ ناجح يُسجَّل المستند المُطبَّع المُخزَّن بمراجعة النسخة الجديدة.
 *  2. **خط أساس كسول:** إن لم يكن للنسخة أي صف (نسخة سبقت هذه الميزة أو لم تُحفظ بعد) سُجِّل أولاً مستندها **قبل** هذا الحفظ
 *     بمراجعته السابقة — فيصير «ما كانت عليه قبل أول تغيير» قابلاً للاسترداد. لا تعديل على مسارات الإنشاء/الاستيراد.
 *  3. **لا فجوات ولا مكرّرات:** فريد `(version_id, version_revision)`؛ وحفظٌ لم يغيّر المستند (نفس `config_hash` لآخر صف)
 *     لا يُسجَّل لأنه لا معلومة فيه. المراجعات التي لا يتغيّر فيها المحتوى (إعادة تسمية/جدولة) لا تُسجَّل أصلاً.
 *  4. **احتفاظ محدود:** آخر `MAX_REVISIONS_PER_VERSION` صفاً وبسقف `MAX_BYTES_PER_VERSION` للنسخة الواحدة (أيّهما أقرب)؛
 *     الأقدم يسقط أولاً، والأحدث (الحالي) لا يُحذف أبداً. لا يمسّ هذا الحذفُ صفَّ النسخة ولا لقطة النشر.
 *
 * يُستدعى **داخل معاملة الحفظ نفسها** بعد كتابة النسخة وتحت قفلها (Storefront ← head ← Version)، فتتبع اللقطة الحفظ ذرّياً:
 * فشل التسجيل يُلغي الحفظ كاملاً، ولا لقطة بلا حفظ ولا حفظ بلا لقطة.
 */
final class StorefrontPresentationRevisionRecorder
{
    /** آخر هذا العدد من المراجعات لكل نسخة. قياس H5-0: المستند المُطبَّع الافتراضي ≈ 1.5 كيلوبايت، والسقف الصلب 1.5 ميغابايت. */
    public const MAX_REVISIONS_PER_VERSION = 30;

    /** سقف الحجم الكلي للسجلّ لنسخة واحدة (بايت): يحمي من مستندات ضخمة متتالية قرب الحد الأقصى للمستند. */
    public const MAX_BYTES_PER_VERSION = 16 * 1024 * 1024;

    /**
     * @param  array<string, mixed>|null  $priorConfig  مستند النسخة قبل هذا الحفظ (كما كان مخزَّناً).
     */
    public function recordSave(
        StorefrontPresentationVersion $version,
        ?array $priorConfig,
        ?int $priorRevision,
        ?int $priorSchemaVersion,
    ): void {
        $hasRows = StorefrontPresentationVersionRevision::query()
            ->where('version_id', $version->id)
            ->exists();

        if (! $hasRows && $priorConfig !== null && $priorRevision !== null) {
            $this->insert(
                $version,
                $priorRevision,
                $priorSchemaVersion ?? StorefrontPresentationNormalizer::VERSION,
                $priorConfig,
            );
        }

        $config = (array) $version->config;
        $latestHash = StorefrontPresentationVersionRevision::query()
            ->where('version_id', $version->id)
            ->orderByDesc('version_revision')
            ->value('config_hash');

        if ($latestHash !== self::hashOf($config)) {
            $this->insert($version, (int) $version->revision, (int) $version->schema_version, $config);
        }

        $this->prune($version);
    }

    /** بصمة كانونية للمستند: نفس الترميز لكل من التسجيل والمقارنة بالنسخة الحالية. @param array<string, mixed> $config */
    public static function hashOf(array $config): string
    {
        return hash('sha256', self::encode($config));
    }

    /** @param array<string, mixed> $config */
    private static function encode(array $config): string
    {
        return json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** @param array<string, mixed> $config */
    private function insert(StorefrontPresentationVersion $version, int $revision, int $schemaVersion, array $config): void
    {
        // فريد (النسخة، المراجعة): لا ازدواج تحت إعادة المحاولة، ولا انهيار حفظ ناجح إن تباعد عدّاد قديم (مسار الواجهة القديمة).
        $exists = StorefrontPresentationVersionRevision::query()
            ->where('version_id', $version->id)
            ->where('version_revision', $revision)
            ->exists();
        if ($exists) {
            return;
        }

        $encoded = self::encode($config);

        // الملكية من صف النسخة المقفول نفسه — لا من أي مدخل.
        StorefrontPresentationVersionRevision::create([
            'tenant_id' => $version->tenant_id,
            'storefront_id' => $version->storefront_id,
            'version_id' => $version->id,
            'version_revision' => $revision,
            'schema_version' => $schemaVersion,
            'config' => $config,
            'config_hash' => hash('sha256', $encoded),
            'size_bytes' => strlen($encoded),
        ]);
    }

    private function prune(StorefrontPresentationVersion $version): void
    {
        $rows = StorefrontPresentationVersionRevision::query()
            ->where('version_id', $version->id)
            ->orderByDesc('version_revision')
            ->get(['id', 'size_bytes']);

        $bytes = 0;
        $drop = [];
        foreach ($rows as $index => $row) {
            $bytes += (int) $row->size_bytes;
            // الأحدث (الفهرس 0) لا يُحذف أبداً مهما بلغ حجمه.
            if ($index > 0 && ($index >= self::MAX_REVISIONS_PER_VERSION || $bytes > self::MAX_BYTES_PER_VERSION)) {
                $drop[] = $row->id;
            }
        }

        if ($drop !== []) {
            // استعلام جماعي مقصود (لا أحداث نموذج): الحذف الوحيد المشروع غير المتتالي لهذه اللقطات الثابتة.
            StorefrontPresentationVersionRevision::query()->whereIn('id', $drop)->delete();
        }
    }
}
