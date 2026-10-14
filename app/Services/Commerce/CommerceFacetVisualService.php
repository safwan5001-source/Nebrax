<?php

namespace App\Services\Commerce;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceFacetVisual;
use App\Models\StorefrontMedia;
use App\Support\Commerce\CommerceFacetVisualNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * AWJ-VD-H1 / VD-1b (§3.2, §3.8-a, §3.8-d) — the only writer of `commerce_facet_visuals`, and the decorator that adds
 * `visual` / `visual_version` / `visual_preview` to the admin facet list.
 *
 * **Write contract (D-17).** `expected_version` is the integer token the client last read:
 *
 * | stored row | expected_version | result |
 * |---|---|---|
 * | none | null / absent | create, version 1 |
 * | none | a number | 409 (deleted or never existed) |
 * | present | null / absent | 428 (never overwrite a version the client has not seen) |
 * | present | equal | update, version + 1; `visual: null` empties the document (tombstone) |
 * | present | different | 409 with `current_version` |
 * | concurrent creates | null / null | the unique index rejects the second → 409, never 500 |
 *
 * The API never deletes a row, so a version number is never reused for the same owner (no ABA); rows go only with
 * their facet / value (cascade), whose ids are never reused.
 *
 * **Media lock (D-16).** Inside one transaction: the visual row is locked, then every referenced `storefront_media`
 * row **in id order**, and readiness is re-checked **after** the lock. `StorefrontMediaService::delete()` locks the
 * same media row and re-scans references after its lock, so one of the two always sees the other: deleting first
 * makes the save fail (422 `media_not_found`); saving first makes the delete fail (409 `media_in_use`).
 */
final class CommerceFacetVisualService
{
    private const PREVIEW_FILES = ['thumb_160' => 'thumb-160.webp', 'thumb_320' => 'thumb-320.webp'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StorefrontMediaService $media,
    ) {}

    /**
     * @return array{visual: array<string, mixed>|null, version: int}|null null = facet not found for this tenant
     */
    public function saveForFacet(string $facetId, mixed $visual, mixed $expectedVersion): ?array
    {
        return $this->save($facetId, null, $visual, $expectedVersion);
    }

    /**
     * @return array{visual: array<string, mixed>|null, version: int}|null null = facet or value not found
     */
    public function saveForValue(string $facetId, string $valueId, mixed $visual, mixed $expectedVersion): ?array
    {
        return $this->save($facetId, $valueId, $visual, $expectedVersion);
    }

    /**
     * Adds `visual`, `visual_version` and `visual_preview` to every facet and value of the admin list. Two queries
     * (visual rows, then the media they reference) — no N+1. Previews are short-lived signed links to the library's
     * thumbnail variants (never the original), generated **only** for media referenced by these identities, so a
     * `products.view` reader gets thumbnails without becoming a library reader.
     *
     * @param  list<array<string, mixed>>  $facets
     * @return list<array<string, mixed>>
     */
    public function decorate(array $facets): array
    {
        $rows = CommerceFacetVisual::query()->get();
        $byFacet = [];
        $byValue = [];
        foreach ($rows as $row) {
            if ($row->commerce_facet_value_id === null) {
                $byFacet[$row->commerce_facet_id] = $row;
            } else {
                $byValue[$row->commerce_facet_value_id] = $row;
            }
        }

        $mediaIds = [];
        foreach ($rows as $row) {
            $id = $this->imageMediaId($row);
            if ($id !== null) {
                $mediaIds[$id] = true;
            }
        }
        $media = $mediaIds === []
            ? collect()
            : StorefrontMedia::query()->whereIn('id', array_keys($mediaIds))->get()->keyBy('id');

        $present = function (?CommerceFacetVisual $row) use ($media): array {
            if ($row === null) {
                return ['visual' => null, 'visual_version' => null, 'visual_preview' => null];
            }

            return [
                'visual' => $row->isEmpty() ? null : $row->visual,
                'visual_version' => (int) $row->version,
                'visual_preview' => $this->preview($row, $media),
            ];
        };

        return array_map(function (array $facet) use ($byFacet, $byValue, $present): array {
            $facet += $present($byFacet[$facet['id']] ?? null);
            $facet['values'] = array_map(
                static fn (array $value): array => $value + $present($byValue[$value['id']] ?? null),
                $facet['values'] ?? [],
            );

            return $facet;
        }, $facets);
    }

    /** @return array{visual: array<string, mixed>|null, version: int}|null */
    private function save(string $facetId, ?string $valueId, mixed $visual, mixed $expectedVersion): ?array
    {
        $kind = $valueId === null ? 'facet' : 'value';
        $normalized = $this->validated($visual, $kind);
        $mediaIds = $this->mediaIdsOf($normalized, $kind);

        try {
            return DB::transaction(function () use ($facetId, $valueId, $normalized, $expectedVersion, $mediaIds, $kind) {
                $facet = CommerceFacet::query()->whereKey($facetId)->first();
                if ($facet === null) {
                    return null;
                }
                if ($valueId !== null) {
                    $value = CommerceFacetValue::query()
                        ->whereKey($valueId)
                        ->where('commerce_facet_id', $facet->id)
                        ->first();
                    if ($value === null) {
                        return null;
                    }
                }

                $row = CommerceFacetVisual::query()
                    ->where('commerce_facet_id', $facet->id)
                    ->when(
                        $valueId === null,
                        static fn ($q) => $q->whereNull('commerce_facet_value_id'),
                        static fn ($q) => $q->where('commerce_facet_value_id', $valueId),
                    )
                    ->lockForUpdate()
                    ->first();

                if ($row === null && $expectedVersion !== null) {
                    throw CommerceFacetVisualException::versionConflict(null);
                }
                if ($row !== null && $expectedVersion === null) {
                    throw CommerceFacetVisualException::preconditionRequired();
                }
                if ($row !== null && (int) $row->version !== $expectedVersion) {
                    throw CommerceFacetVisualException::versionConflict((int) $row->version);
                }

                $this->lockUsableMedia($mediaIds, $kind);

                if ($row === null) {
                    $row = CommerceFacetVisual::create([
                        'tenant_id' => $this->tenantId(),
                        'commerce_facet_id' => $facet->id,
                        'commerce_facet_value_id' => $valueId,
                        'schema_version' => 1,
                        'visual' => $normalized,
                        'version' => 1,
                    ]);
                } else {
                    $row->forceFill(['visual' => $normalized, 'version' => (int) $row->version + 1])->save();
                }

                return ['visual' => $normalized === [] ? null : $normalized, 'version' => (int) $row->version];
            });
        } catch (QueryException $e) {
            if ($this->isUniqueViolation($e)) {
                // A concurrent create won the unique index: report the row that now exists.
                throw CommerceFacetVisualException::versionConflict($this->currentVersion($facetId, $valueId));
            }
            if ($this->isForeignKeyViolation($e)) {
                // The facet or value was deleted between the lookup and the insert.
                return null;
            }

            throw $e;
        }
    }

    /**
     * Strict on write (D-11): any invalid field is a 422 with field errors; `null` empties the document.
     *
     * @param  'facet'|'value'  $kind
     * @return array<string, mixed>
     */
    private function validated(mixed $visual, string $kind): array
    {
        if ($visual === null) {
            return [];
        }

        $errors = CommerceFacetVisualNormalizer::errors($visual, $kind);
        if ($errors !== []) {
            $fields = [];
            foreach ($errors as ['field' => $field, 'code' => $code]) {
                $fields[$field === 'visual' ? 'visual' : 'visual.'.$field][] = $code;
            }

            throw CommerceFacetVisualException::invalid($fields);
        }

        return $kind === 'facet'
            ? CommerceFacetVisualNormalizer::normalizeFacet($visual)
            : CommerceFacetVisualNormalizer::normalizeValue($visual);
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @param  'facet'|'value'  $kind
     * @return array<string, string> field => mediaId
     */
    private function mediaIdsOf(array $normalized, string $kind): array
    {
        $id = $kind === 'facet'
            ? ($normalized['self']['image']['mediaId'] ?? null)
            : ($normalized['image']['mediaId'] ?? null);

        return is_string($id) ? [($kind === 'facet' ? 'visual.self.image.mediaId' : 'visual.image.mediaId') => $id] : [];
    }

    /**
     * D-16 — lock the referenced media rows in id order, then re-check them after the lock. Foreign, deleted or purged
     * media is `media_not_found` (TenantScope hides foreign rows, so a foreign id is indistinguishable from a missing
     * one); media whose variants are still pending or failed is `media_not_ready`.
     *
     * @param  array<string, string>  $mediaIds  field => mediaId
     * @param  'facet'|'value'  $kind
     */
    private function lockUsableMedia(array $mediaIds, string $kind): void
    {
        if ($mediaIds === []) {
            return;
        }

        $ids = array_values(array_unique($mediaIds));
        sort($ids);
        $locked = StorefrontMedia::query()
            ->whereIn('id', $ids)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        $errors = [];
        foreach ($mediaIds as $field => $id) {
            $media = $locked->get($id);
            if ($media === null || ! $media->isActive()) {
                $errors[$field][] = 'media_not_found';
            } elseif (! $media->isReady()) {
                $errors[$field][] = 'media_not_ready';
            }
        }
        if ($errors !== []) {
            throw CommerceFacetVisualException::invalid($errors);
        }
    }

    /** @param \Illuminate\Support\Collection<string, StorefrontMedia> $media */
    private function preview(CommerceFacetVisual $row, $media): ?array
    {
        $id = $this->imageMediaId($row);
        $asset = $id === null ? null : $media->get($id);
        if ($asset === null || ! $asset->isActive() || ! $asset->isReady()) {
            return null;
        }

        $out = [];
        foreach (self::PREVIEW_FILES as $key => $file) {
            $out[$key] = $this->media->signedUrl($asset, $file);
        }

        return $out;
    }

    private function imageMediaId(CommerceFacetVisual $row): ?string
    {
        $visual = is_array($row->visual) ? $row->visual : [];
        $id = $row->commerce_facet_value_id === null
            ? ($visual['self']['image']['mediaId'] ?? null)
            : ($visual['image']['mediaId'] ?? null);

        return is_string($id) ? $id : null;
    }

    private function currentVersion(string $facetId, ?string $valueId): ?int
    {
        $version = CommerceFacetVisual::query()
            ->where('commerce_facet_id', $facetId)
            ->when(
                $valueId === null,
                static fn ($q) => $q->whereNull('commerce_facet_value_id'),
                static fn ($q) => $q->where('commerce_facet_value_id', $valueId),
            )
            ->value('version');

        return $version === null ? null : (int) $version;
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;

        return $sqlState === '23505'
            || ($driverCode === 19 && str_contains(strtolower($e->getMessage()), 'unique'))
            || str_contains(strtolower($e->getMessage()), 'unique constraint');
    }

    private function isForeignKeyViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;

        return $sqlState === '23503' || str_contains(strtolower($e->getMessage()), 'foreign key constraint');
    }

    private function tenantId(): string
    {
        $tenantId = $this->tenant->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }
}
