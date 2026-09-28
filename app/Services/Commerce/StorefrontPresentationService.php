<?php

namespace App\Services\Commerce;

use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * STORE-BACKEND-1 — قراءة/حفظ مسودة المظهر ونشرها.
 *
 * المستأجر من `TenantContext` فقط. `{id}` محدِّد صفّ. أجنبي/مفقود → null
 * (404 في المتحكّم). حفظ المسودة لا يمسّ المنشورة. النشر نسخة داخل الصف
 * تحت `lockForUpdate`.
 *
 * CUST-H1-1: الواجهة والاستجابة القديمتان محفوظتان حرفياً — الإضافة
 * الوحيدة داخلياً هي التزامن الذرّي مع نسخة العمل المتوافقة
 * (`compatibility_working_version_id`) والتشويك (fork) قبل تعديل نسخة
 * منشورة نشطة؛ أنظر `applyDraftSave()`.
 */
final class StorefrontPresentationService
{
    public function __construct(
        private readonly StorefrontPresentationNormalizer $normalizer,
        private readonly StorefrontPresentationVersionBackfillService $backfill,
    ) {}

    /**
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    public function showForCurrentTenant(string $storefrontId): ?array
    {
        $storefront = $this->ownedStorefront($storefrontId);
        if ($storefront === null) {
            return null;
        }

        $row = StorefrontPresentation::query()
            ->where('storefront_id', $storefront->id)
            ->first();

        // لا رأس بعد → افتراضات افتراضية بلا كتابة (سلوك STORE-BACKEND-1
        // الأصلي، محفوظ حرفياً). رأسٌ قائم بلا نسخة عمل متوافقة بعد (لم
        // تُهاجَر/لم تُلمَس منذ CUST-H1-1) → نضمنها الآن تحت قفل قبل إعادة
        // حالة قابلة للتعديل (§21).
        if ($row !== null && $row->compatibility_working_version_id === null) {
            $row = DB::transaction(function () use ($storefront) {
                $locked = StorefrontPresentation::query()
                    ->where('storefront_id', $storefront->id)
                    ->lockForUpdate()
                    ->first();

                if ($locked !== null && $locked->compatibility_working_version_id === null) {
                    $this->backfill->ensureCompatibilityWorkingVersion($locked);
                }

                return $locked;
            });
        }

        return $this->present($storefront, $row);
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    public function saveDraftForCurrentTenant(string $storefrontId, array $config, int $expectedRevision): ?array
    {
        $normalized = $this->normalizer->normalize($config);
        $this->assertStoredSize($normalized);

        try {
            return DB::transaction(function () use ($storefrontId, $normalized, $expectedRevision) {
                $storefront = $this->lockOwnedStorefront($storefrontId);
                if ($storefront === null) {
                    return null;
                }

                $row = StorefrontPresentation::query()
                    ->where('storefront_id', $storefront->id)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->first();

                return $this->applyDraftSave($storefront, $row, $normalized, $expectedRevision);
            });
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }

            return $this->retryDraftSaveAfterConflict($storefrontId, $normalized, $expectedRevision);
        }
    }

    /**
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    public function publishForCurrentTenant(string $storefrontId, ?int $expectedRevision): ?array
    {
        return DB::transaction(function () use ($storefrontId, $expectedRevision) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $row = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if ($row === null || (int) $row->draft_revision === 0) {
                throw new NothingToPublishException;
            }

            if ($row->tenant_id !== $storefront->tenant_id) {
                return null;
            }

            if ($expectedRevision !== null && $expectedRevision !== (int) $row->draft_revision) {
                throw new StaleDraftRevisionException;
            }

            $normalized = $this->normalizer->normalize($row->draft_config ?? null, (int) $row->schema_version);
            $this->assertStoredSize($normalized);

            $published = is_array($row->published_config) ? $row->published_config : null;
            if (
                $row->published_revision !== null
                && (int) $row->draft_revision === (int) $row->published_revision
                && $this->sameDocument($published, $normalized)
            ) {
                return $this->present($storefront, $row);
            }

            $row->forceFill([
                'draft_config' => $normalized,
                'published_config' => $normalized,
                'published_revision' => (int) $row->draft_revision,
                'published_at' => now(),
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
            ])->save();

            return $this->present($storefront, $row->fresh());
        });
    }

    /**
     * لقطة منشورة فقط — لا يقرأ `draft_config`.
     *
     * @return array<string, mixed>|null
     */
    public function publishedSnapshotForStorefront(string $storefrontId): ?array
    {
        $row = StorefrontPresentation::query()
            ->where('storefront_id', $storefrontId)
            ->whereNotNull('published_config')
            ->first(['published_config', 'schema_version']);

        if ($row === null || ! is_array($row->published_config)) {
            return null;
        }

        return $this->normalizer->normalize($row->published_config, (int) $row->schema_version);
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }
     */
    private function applyDraftSave(
        Storefront $storefront,
        ?StorefrontPresentation $row,
        array $normalized,
        int $expectedRevision,
    ): array {
        $current = $row === null ? 0 : (int) $row->draft_revision;
        if ($expectedRevision !== $current) {
            throw new StaleDraftRevisionException;
        }

        if ($row === null) {
            // رأسٌ لأول مرة على الإطلاق — لا نسخة CUST-H1 بعد؛ ستُنشأ
            // كسولاً لاحقاً عند أول GET/PUT/إنشاء نسخة يجدها موجودة
            // (`ensureCompatibilityWorkingVersion`). سلوك ما قبل CUST-H1
            // محفوظ حرفياً هنا.
            $row = StorefrontPresentation::create([
                'storefront_id' => $storefront->id,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'draft_config' => $normalized,
                'draft_revision' => 1,
            ]);

            return $this->present($storefront, $row->fresh());
        }

        if ($row->tenant_id !== $storefront->tenant_id) {
            throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
        }

        // CUST-H1-1 §14/§15/§21: رأسٌ قائم — نقفل/نضمن نسخة العمل المتوافقة،
        // نرفض فشلاً آمناً مخططاً أحدث، ونُشوّك (fork) قبل التعديل إن كانت
        // نسخة العمل هي ذاتها المنشورة النشطة حالياً (لا تعديل مباشر على
        // نسخة منشورة أبداً).
        $compat = $this->lockCompatibilityWorkingVersion($row);

        if ((int) $compat->schema_version > StorefrontPresentationNormalizer::VERSION) {
            throw new ForwardSchemaVersionException;
        }

        if ($row->active_version_id !== null && $row->active_version_id === $compat->id) {
            $compat = $this->forkCompatibilityVersion($row, $compat);
        }

        $newRevision = $current + 1;

        $row->forceFill([
            'draft_config' => $normalized,
            'draft_revision' => $newRevision,
            'schema_version' => StorefrontPresentationNormalizer::VERSION,
            'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
        ])->save();

        $compat->forceFill([
            'config' => $normalized,
            'schema_version' => StorefrontPresentationNormalizer::VERSION,
            'revision' => $newRevision,
        ])->save();

        return $this->present($storefront, $row->fresh());
    }

    /**
     * يضمن وجود نسخة العمل المتوافقة **مقفولةً** ضمن معاملة مفتوحة
     * بالفعل من المستدعي (الرأس `$row` مقفول بالفعل بنفس المعاملة).
     */
    private function lockCompatibilityWorkingVersion(StorefrontPresentation $row): StorefrontPresentationVersion
    {
        $version = $this->backfill->ensureCompatibilityWorkingVersion($row);

        return StorefrontPresentationVersion::query()->whereKey($version->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * يُشوّك نسخة عمل مسودة جديدة من النسخة المنشورة النشطة قبل تعديلها عبر
     * الواجهة القديمة — يحافظ على استمرارية المراجعة (§15): يبدأ الفرع
     * بمراجعة المسودة القديمة الحالية (حداً أدنى 1) بدل الصفر، فلا يرى عميل
     * قديم غير معدَّل تعارضاً وهمياً أو انعكاس مراجعة.
     */
    private function forkCompatibilityVersion(StorefrontPresentation $row, StorefrontPresentationVersion $active): StorefrontPresentationVersion
    {
        $fork = StorefrontPresentationVersion::create([
            'tenant_id' => $row->tenant_id,
            'storefront_id' => $row->storefront_id,
            'name' => $active->name,
            'schema_version' => $active->schema_version,
            'config' => $active->config,
            'revision' => max(1, (int) $row->draft_revision),
        ]);

        $row->forceFill(['compatibility_working_version_id' => $fork->id])->save();

        return $fork;
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    private function retryDraftSaveAfterConflict(string $storefrontId, array $normalized, int $expectedRevision): ?array
    {
        return DB::transaction(function () use ($storefrontId, $normalized, $expectedRevision) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $row = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            return $this->applyDraftSave($storefront, $row, $normalized, $expectedRevision);
        });
    }

    private function ownedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return $storefront;
    }

    private function lockOwnedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()
            ->whereKey($storefrontId)
            ->lockForUpdate()
            ->first();

        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return $storefront;
    }

    /**
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }
     */
    private function present(Storefront $storefront, ?StorefrontPresentation $row): array
    {
        $draft = $this->normalizer->defaultConfig();
        $draftRevision = 0;
        $published = null;
        $publishedRevision = null;
        $publishedAt = null;
        $schemaVersion = StorefrontPresentationNormalizer::VERSION;

        if ($row !== null) {
            $schemaVersion = StorefrontPresentationNormalizer::VERSION;
            $draft = $this->normalizer->normalize($row->draft_config ?? null, (int) $row->schema_version);
            $draftRevision = (int) $row->draft_revision;
            if (is_array($row->published_config)) {
                $published = $this->normalizer->normalize($row->published_config, (int) $row->schema_version);
                $publishedRevision = $row->published_revision !== null ? (int) $row->published_revision : null;
                $publishedAt = $row->published_at?->toJSON();
            }
        }

        return [
            'storefront_id' => $storefront->id,
            'schema_version' => $schemaVersion,
            'draft' => $draft,
            'draft_revision' => $draftRevision,
            'published' => $published,
            'published_revision' => $publishedRevision,
            'published_at' => $publishedAt,
        ];
    }

    /** @param  array<string, mixed>  $config */
    private function assertStoredSize(array $config): void
    {
        if ($this->normalizer->encodedSize($config) > StorefrontPresentationNormalizer::MAX_DOCUMENT_BYTES) {
            throw new PresentationDocumentTooLargeException;
        }
    }

    private function sameDocument(?array $left, array $right): bool
    {
        if ($left === null) {
            return false;
        }

        return json_encode($left, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            === json_encode($right, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;

        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }
}
