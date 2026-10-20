<?php

namespace App\Services\Commerce;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetVisual;
use App\Models\StorefrontMedia;
use App\Support\EdgeScheme;
use App\Support\Commerce\CommerceFacetVisualNormalizer;
use Illuminate\Support\Facades\URL;

/**
 * AWJ-VD-H1 / VD-1c (§3.8-b, owner decisions D1/D2) — the public `visual` of `storefront.v1` `meta.facets[]` and of
 * their `values[]`.
 *
 * D1: the stored documents are emitted **normalized, not resolved** — `{self?, defaults?}` for a facet, the value's
 * own document for a value. Inheritance and precedence (D-08) are resolved by the storefront with the VD-1a resolver,
 * because two levels of that chain (the section's explicit values above the value, the section template below the
 * facet defaults) belong to the section (VD-4a) and are unknown here.
 *
 * Every image reference is enriched with `sources`: the generated files of the guarded route
 * `store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` that exist for this media. An image whose media is not
 * active and ready is removed, so the storefront falls back (icon, then text) without a request that would 404.
 * Never an original, never the admin signed preview.
 *
 * Only what is visible on this channel gets a visual: a value with `count > 0`, a facet with at least one such value
 * (a selected value listed at count 0 gets `null`).
 *
 * D2: without a storefront context (legacy `{tenantSlug}` routes) channel visibility cannot be proven, so every
 * `visual` is `null` and no image URL is emitted.
 *
 * Two bounded queries per response (visual rows of the listed facets and values, then their media); the facet and
 * value models come from `CatalogFacetFilter`, already loaded for the counts.
 */
final class StorefrontFacetVisualProjector
{
    /** The only files the public route serves (§3.8-c), widths ascending, WebP before JPEG. */
    public const FILES = [
        'thumb-160.webp', 'thumb-160.jpg',
        'thumb-320.webp', 'thumb-320.jpg',
        '480w.webp', '480w.jpg',
        '768w.webp', '768w.jpg',
    ];

    public const ROUTE = 'storefront.v1.media.facet_visual.show';

    /**
     * @param  list<array<string, mixed>>  $facets  `CatalogFacetFilter::meta()['facets']`
     * @param  array<string, CommerceFacet>  $models  active facets with their active values, keyed by facet key
     * @return list<array<string, mixed>>
     */
    public function project(array $facets, array $models, bool $hasStorefront): array
    {
        if (! $hasStorefront || $facets === []) {
            return $this->withoutVisuals($facets);
        }

        $facetIds = [];
        $valueIds = [];
        $valueIdBySlug = [];
        foreach ($facets as $facet) {
            $model = $models[$facet['key']] ?? null;
            if ($model === null) {
                continue;
            }
            $facetIds[] = $model->id;
            $bySlug = $model->values->pluck('id', 'slug')->all();
            foreach ($facet['values'] as $value) {
                if (isset($bySlug[$value['slug']])) {
                    $valueIdBySlug[$facet['key']][$value['slug']] = $bySlug[$value['slug']];
                    $valueIds[] = $bySlug[$value['slug']];
                }
            }
        }

        $rows = $facetIds === [] ? collect() : CommerceFacetVisual::query()
            ->whereIn('commerce_facet_id', $facetIds)
            ->where(fn ($q) => $q->whereNull('commerce_facet_value_id')->orWhereIn('commerce_facet_value_id', $valueIds))
            ->get(['id', 'commerce_facet_id', 'commerce_facet_value_id', 'visual']);

        $byFacet = [];
        $byValue = [];
        $documents = [];
        $mediaIds = [];
        foreach ($rows as $row) {
            $isFacet = $row->commerce_facet_value_id === null;
            $document = $isFacet
                ? CommerceFacetVisualNormalizer::normalizeFacet($row->visual)
                : CommerceFacetVisualNormalizer::normalizeValue($row->visual);
            $documents[$row->id] = $document;
            $mediaId = $isFacet ? ($document['self']['image']['mediaId'] ?? null) : ($document['image']['mediaId'] ?? null);
            if (is_string($mediaId)) {
                $mediaIds[$mediaId] = true;
            }
            if ($isFacet) {
                $byFacet[$row->commerce_facet_id] = $row->id;
            } else {
                $byValue[$row->commerce_facet_value_id] = $row->id;
            }
        }

        $media = $mediaIds === [] ? collect() : StorefrontMedia::query()
            ->where('state', StorefrontMedia::STATE_ACTIVE)
            ->where('variants_state', StorefrontMedia::VARIANTS_READY)
            ->whereIn('id', array_keys($mediaIds))
            ->get(['id', 'variants', 'variants_state', 'state'])
            ->keyBy('id');

        $public = function (?string $visualId, bool $isFacet) use ($documents, $media): ?array {
            if ($visualId === null || ($documents[$visualId] ?? []) === []) {
                return null;
            }
            $document = $documents[$visualId];
            if ($isFacet) {
                if (isset($document['self']['image'])) {
                    $image = $this->withSources($document['self']['image'], $visualId, $media);
                    if ($image === null) {
                        unset($document['self']['image']);
                    } else {
                        $document['self']['image'] = $image;
                    }
                    if ($document['self'] === []) {
                        unset($document['self']);
                    }
                }
            } elseif (isset($document['image'])) {
                $image = $this->withSources($document['image'], $visualId, $media);
                if ($image === null) {
                    unset($document['image']);
                } else {
                    $document['image'] = $image;
                }
            }

            return $document === [] ? null : $document;
        };

        // Visibility on this channel: `meta()` counts over the channel-gated, active-only base query, so `count > 0`
        // proves an active product published on this channel carries the value (and, for the facet, one of its active
        // values) — the route's own guard. A value listed only because it is selected (`count === 0`) proves nothing,
        // so it gets no visual, and a facet with no counted value gets none either. Conservative by construction:
        // meta never emits what the route would refuse.
        return array_map(function (array $facet) use ($models, $byFacet, $byValue, $valueIdBySlug, $public): array {
            $model = $models[$facet['key']] ?? null;
            $visible = array_filter($facet['values'], static fn (array $value): bool => $value['count'] > 0) !== [];
            $facet['visual'] = $model === null || ! $visible ? null : $public($byFacet[$model->id] ?? null, true);
            $facet['values'] = array_map(function (array $value) use ($facet, $byValue, $valueIdBySlug, $public): array {
                $valueId = $valueIdBySlug[$facet['key']][$value['slug']] ?? null;
                $value['visual'] = $valueId === null || $value['count'] <= 0 ? null : $public($byValue[$valueId] ?? null, false);

                return $value;
            }, $facet['values']);

            return $facet;
        }, $facets);
    }

    /**
     * Workspace-only projection. The public projection remains unchanged;
     * editor images are rewritten to the existing tenant-scoped signed media
     * route because the admin origin cannot resolve storefront-host routes.
     * The source path is generated by this projector, then parsed only to
     * carry its already-authorized media/file pair into the workspace route.
     *
     * @param  list<array<string, mixed>>  $facets
     * @param  array<string, CommerceFacet>  $models
     * @return list<array<string, mixed>>
     */
    public function projectWorkspace(array $facets, array $models, string $tenantId): array
    {
        $projected = $this->project($facets, $models, true);
        $rewrite = function (?array $visual) use ($tenantId): ?array {
            if ($visual === null) return null;
            foreach (['image', 'self'] as $container) {
                if ($container === 'self') {
                    if (! is_array($visual['self'] ?? null)) continue;
                    $visual['self'] = $this->rewriteWorkspaceImage($visual['self'], $tenantId);
                } else {
                    $visual = $this->rewriteWorkspaceImage($visual, $tenantId);
                }
            }
            return $visual;
        };

        return array_map(function (array $facet) use ($rewrite): array {
            $facet['visual'] = $rewrite(is_array($facet['visual'] ?? null) ? $facet['visual'] : null);
            $facet['values'] = array_map(function (array $value) use ($rewrite): array {
                $value['visual'] = $rewrite(is_array($value['visual'] ?? null) ? $value['visual'] : null);
                return $value;
            }, $facet['values'] ?? []);
            return $facet;
        }, $projected);
    }

    /** @param array<string, mixed> $visual @return array<string, mixed> */
    private function rewriteWorkspaceImage(array $visual, string $tenantId): array
    {
        if (is_array($visual['self'] ?? null)) {
            $visual['self'] = $this->rewriteWorkspaceImage($visual['self'], $tenantId);
            return $visual;
        }
        if (! is_array($visual['image'] ?? null) || ! is_array($visual['image']['sources'] ?? null)) return $visual;
        $visual['image']['sources'] = array_map(function (array $source) use ($tenantId): array {
            $src = (string) ($source['src'] ?? '');
            if (preg_match('#/facet-visuals/[^/]+/([^/]+)/([^/?]+)$#', parse_url($src, PHP_URL_PATH) ?: $src, $match) === 1) {
                $source['src'] = EdgeScheme::forBrowser(URL::temporarySignedRoute(
                    'commerce.workspace.storefront-media.file',
                    now()->addMinutes(20),
                    ['media' => $match[1], 'file' => $match[2], 'tenant' => $tenantId],
                ));
            }
            return $source;
        }, $visual['image']['sources']);
        return $visual;
    }

    /**
     * @param  list<array<string, mixed>>  $facets
     * @return list<array<string, mixed>>
     */
    private function withoutVisuals(array $facets): array
    {
        return array_map(static function (array $facet): array {
            $facet['visual'] = null;
            $facet['values'] = array_map(static fn (array $value): array => $value + ['visual' => null], $facet['values']);

            return $facet;
        }, $facets);
    }

    /**
     * @param  array<string, mixed>  $image
     * @param  \Illuminate\Support\Collection<string, StorefrontMedia>  $media
     * @return array<string, mixed>|null  `null` when the media is not usable or has none of the public files
     */
    private function withSources(array $image, string $visualId, $media): ?array
    {
        $asset = $media->get($image['mediaId'] ?? '');
        if ($asset === null) {
            return null;
        }

        $sources = [];
        foreach (self::FILES as $file) {
            $variant = $asset->variantByFile($file);
            if ($variant === null) {
                continue;
            }
            $sources[] = [
                'width' => (int) ($variant['width'] ?? 0),
                'format' => str_ends_with($file, '.webp') ? 'webp' : 'jpg',
                'src' => route(self::ROUTE, ['visualId' => $visualId, 'mediaId' => $asset->id, 'file' => $file], false),
            ];
        }

        return $sources === [] ? null : $image + ['sources' => $sources];
    }
}
