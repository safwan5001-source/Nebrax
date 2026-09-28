<?php

namespace App\Services\Commerce;

use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * CUST-H1-1 — يهاجر صفوف `storefront_presentations` القائمة إلى نسخ
 * `storefront_presentation_versions` (الحالات B/C/D). مرجع الحالات الكامل:
 * `docs/plans/store/CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md` §7.
 *
 * لا سياق مستأجر HTTP هنا (يعمل من هجرة أو أمر Artisan) — يتجاوز
 * `TenantScope` صراحةً ويمرّر `tenant_id` صراحةً لكل صفّ.
 *
 * **الحالة A** (لا صفّ) ليست مسؤولية هذه الخدمة إطلاقاً — لا تُنشئ رأساً
 * لمتاجر بلا صفّ؛ ذلك متروك للإنشاء الكسول عند أول نسخة
 * (`StorefrontPresentationVersionService::ensureHead()`).
 *
 * **آمنة لإعادة التشغيل**: تتجاوز أي صفّ له بالفعل `active_version_id` أو
 * `compatibility_working_version_id` (هُوجر سلفاً) — لا تكرار نسخ عند تكرار
 * الاستدعاء.
 *
 * **لا تعيد تطبيع المستندات**: تنسخ `draft_config`/`published_config`
 * و`schema_version` القائمين حرفياً إلى صفّ النسخة الجديد — فلا تُعاد كتابة
 * اللقطة العامة المنشورة بأي شكل، ويبقى وسم `schema_version` القديم كما هو
 * (الترقية الفعلية للمخطط الحالي تحدث فقط عند أول حفظ صريح على النسخة
 * — §11).
 */
final class StorefrontPresentationVersionBackfillService
{
    public const DEFAULT_MIGRATION_NAME = 'التصميم الحالي';

    public const DEFAULT_MIGRATION_DRAFT_NAME = 'التصميم الحالي (مسودة)';

    /** يهاجر كل الصفوف غير المهاجرة بعد. يُعيد عدد الصفوف التي هوجرت فعلاً. */
    public function backfillAll(): int
    {
        $count = 0;

        StorefrontPresentation::withoutGlobalScopes()
            ->whereNull('active_version_id')
            ->whereNull('compatibility_working_version_id')
            ->orderBy('id')
            ->chunkById(100, function ($rows) use (&$count) {
                foreach ($rows as $row) {
                    if ($this->backfillPresentation($row)) {
                        $count++;
                    }
                }
            });

        return $count;
    }

    /**
     * يهاجر صفاً واحداً تحت قفل صفّي مستقلّ. يُعيد `true` إن أنشأ نسخاً فعلاً،
     * أو `false` إن كان مهاجَراً بالفعل (إعادة تشغيل آمنة/لا تكرار).
     */
    public function backfillPresentation(StorefrontPresentation $row): bool
    {
        return DB::transaction(function () use ($row) {
            /** @var StorefrontPresentation|null $locked */
            $locked = StorefrontPresentation::withoutGlobalScopes()
                ->whereKey($row->id)
                ->lockForUpdate()
                ->first();

            if ($locked === null) {
                return false;
            }

            return $this->applyMigrationCasesWithinTransaction($locked);
        });
    }

    /**
     * ينفّذ منطق الحالات B/C/D لصفّ **مقفول بالفعل** ضمن معاملة مفتوحة
     * بالفعل من المستدعي (بلا فتح قفل/معاملة جديدة هنا) — يستعمله كلٌّ من
     * `backfillPresentation()` أعلاه و`StorefrontPresentationVersionService`
     * حين يحتاج ضمان وجود نسخة العمل المتوافقة أثناء معاملة GET/PUT القديمة
     * وهو ماسكٌ القفل بالفعل بنفس ترتيب Storefront → head → Version.
     *
     * يُعيد `true` إن أنشأ نسخاً فعلاً، `false` إن كان مهاجَراً بالفعل.
     */
    public function applyMigrationCasesWithinTransaction(StorefrontPresentation $locked): bool
    {
        if ($locked->active_version_id !== null || $locked->compatibility_working_version_id !== null) {
            return false;
        }

        $tenantId = $locked->tenant_id;
        $storefrontId = $locked->storefront_id;
        $schemaVersion = (int) $locked->schema_version;
        $draftRevision = max(1, (int) $locked->draft_revision);
        $hasPublished = is_array($locked->published_config);

        if (! $hasPublished) {
            $draftVersion = $this->createVersion(
                $tenantId,
                $storefrontId,
                self::DEFAULT_MIGRATION_NAME,
                $schemaVersion,
                $locked->draft_config ?? [],
                $draftRevision,
                null,
            );

            $locked->forceFill(['compatibility_working_version_id' => $draftVersion->id])->save();

            return true;
        }

        if ($this->sameDocument($locked->draft_config, $locked->published_config)) {
            $version = $this->createVersion(
                $tenantId,
                $storefrontId,
                self::DEFAULT_MIGRATION_NAME,
                $schemaVersion,
                $locked->published_config,
                $draftRevision,
                $locked->published_at,
            );

            $locked->forceFill([
                'active_version_id' => $version->id,
                'compatibility_working_version_id' => $version->id,
            ])->save();

            return true;
        }

        $publishedVersion = $this->createVersion(
            $tenantId,
            $storefrontId,
            self::DEFAULT_MIGRATION_NAME,
            $schemaVersion,
            $locked->published_config,
            1,
            $locked->published_at,
        );

        $draftVersion = $this->createVersion(
            $tenantId,
            $storefrontId,
            self::DEFAULT_MIGRATION_DRAFT_NAME,
            $schemaVersion,
            $locked->draft_config ?? [],
            $draftRevision,
            null,
        );

        $locked->forceFill([
            'active_version_id' => $publishedVersion->id,
            'compatibility_working_version_id' => $draftVersion->id,
        ])->save();

        return true;
    }

    /**
     * يضمن وجود نسخة العمل المتوافقة للرأس **المقفول بالفعل** ضمن معاملة
     * مفتوحة من المستدعي، ويُعيدها **مقفولةً هي الأخرى**. تُستعمل من مسارات
     * GET/PUT القديمة ومن إنشاء نسخة جديدة بلا `source_version_id` (§21/§19).
     *
     * **حارس تحوّل/عبور:** أثناء نافذة نشر متدرّج قصيرة بعد هذه الهجرة، عميل
     * قديم (إصدار تطبيق سابق على CUST-H1-1 لا يعرف أعمدة النسخ إطلاقاً) قد
     * يكتب مباشرة إلى `draft_config` على الرأس. منذ هذا الالتزام فصاعداً كل
     * مسار كتابة جديد يُزامن الرأس ونسخة العمل ذرّياً معاً، فانجراف كهذا
     * مستحيل تحت تشغيل عادي — لذا أي انجراف مكتشَف هنا لا يمكن إلا أن يكون
     * من كاتبٍ قديم، فيُصحَّح فوراً بدل أن يبقى دائماً (الرأس، وهو كل ما
     * يعرفه الكاتب القديم، هو مصدر الحقيقة عند التصحيح).
     */
    public function ensureCompatibilityWorkingVersion(StorefrontPresentation $lockedHead): StorefrontPresentationVersion
    {
        if ($lockedHead->compatibility_working_version_id === null) {
            $this->applyMigrationCasesWithinTransaction($lockedHead);
            $lockedHead->refresh();
        }

        $versionId = $lockedHead->compatibility_working_version_id;
        $version = $versionId !== null
            ? StorefrontPresentationVersion::withoutGlobalScopes()->whereKey($versionId)->lockForUpdate()->first()
            : null;

        if ($version === null) {
            throw new RuntimeException('تعذّر إنشاء نسخة العمل المتوافقة.');
        }

        return $this->reconcileWithLegacyHead($lockedHead, $version);
    }

    private function reconcileWithLegacyHead(StorefrontPresentation $lockedHead, StorefrontPresentationVersion $version): StorefrontPresentationVersion
    {
        $sameConfig = $this->sameDocument($version->config, $lockedHead->draft_config ?? []);
        $sameRevision = (int) $version->revision === (int) $lockedHead->draft_revision;

        if ($sameConfig && $sameRevision) {
            return $version;
        }

        $version->forceFill([
            'config' => $lockedHead->draft_config ?? [],
            'schema_version' => (int) $lockedHead->draft_schema_version,
            'revision' => (int) $lockedHead->draft_revision,
        ])->save();

        return $version->fresh();
    }

    /** @param  array<string, mixed>  $config */
    private function createVersion(
        string $tenantId,
        string $storefrontId,
        string $name,
        int $schemaVersion,
        array $config,
        int $revision,
        mixed $lastPublishedAt,
    ): StorefrontPresentationVersion {
        return StorefrontPresentationVersion::create([
            'tenant_id' => $tenantId,
            'storefront_id' => $storefrontId,
            'name' => $name,
            'schema_version' => $schemaVersion,
            'config' => $config,
            'revision' => $revision,
            'last_published_at' => $lastPublishedAt,
        ]);
    }

    /** @param  array<string, mixed>|null  $left  @param  array<string, mixed>|null  $right */
    private function sameDocument(?array $left, ?array $right): bool
    {
        if ($left === null || $right === null) {
            return false;
        }

        return json_encode($left, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            === json_encode($right, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
