<?php

namespace App\Services\Commerce;

use App\Models\Storefront;
use App\Models\StorefrontPresentation;
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
 */
final class StorefrontPresentationService
{
    public function __construct(private readonly StorefrontPresentationNormalizer $normalizer) {}

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
            $row = StorefrontPresentation::create([
                'storefront_id' => $storefront->id,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'draft_config' => $normalized,
                'draft_revision' => 1,
            ]);
        } else {
            if ($row->tenant_id !== $storefront->tenant_id) {
                throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
            }
            $row->forceFill([
                'draft_config' => $normalized,
                'draft_revision' => $current + 1,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
            ])->save();
        }

        return $this->present($storefront, $row->fresh());
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
