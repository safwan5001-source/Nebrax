<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceFacetVisual;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\StorefrontMedia;
use App\Services\Commerce\StorefrontFacetVisualProjector;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaService;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use App\Support\Commerce\CommerceFacetVisualNormalizer;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AWJ-VD-H1 / VD-1c (§3.8-c, D-03/D-15, owner decisions D2/D4) — public delivery of facet and value images.
 *
 * `GET /store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` exists only in the host-resolved group
 * (`ResolveStorefrontDomain`): channel visibility needs the storefront's sales channel, which legacy routes cannot
 * prove (D2). The media id is part of the URL, so replacing an image changes the URL and the old one is a 404.
 *
 * Every guard runs, in this order, **before** `If-None-Match` — a 304 is never answered for something that is no
 * longer authorized:
 *  1. well-formed ids and a file from {@see StorefrontFacetVisualProjector::FILES} (no original, no other name);
 *  2. the visual row exists in this storefront's tenant (`TenantScope`);
 *  3. its owner is active (the facet, and the value for a value row);
 *  4. its owner is visible on **this** storefront's channel: an active product published on the channel is assigned
 *     to the value (value image) or to any active value of the facet (facet image) — the candidate rule of
 *     `StorefrontProductController::index()`;
 *  5. the document references this very media id (`image` for a value, `self.image` for a facet), so the route never
 *     becomes a reader of the tenant's library;
 *  6. the media belongs to the tenant (`TenantScope`), is active and ready, and has this file.
 *
 * Out of D4's scope: a request whose Host resolves no storefront is refused by `ResolveStorefrontDomain`, and a rate
 * limited one by its middleware, before this controller runs; those responses come from the shared renderer. Neither
 * carries data, and the storefront proxy turns every non-200/304 into `no-store`.
 *
 * Success: `private, no-store` + a content ETag + `nosniff` (the only shared-cacheable layer is the storefront proxy,
 * ≤ 300 s, AMEND-16). Any failure is one uniform, non-revealing 404 carrying `Cache-Control: no-store` (D4) — built
 * here, not by the shared public error renderer, which is unchanged.
 */
class StorefrontFacetVisualMediaController extends PublicApiController
{
    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/';

    public function show(Request $request, StorefrontMediaService $service): Response|StreamedResponse
    {
        $visualId = (string) $request->route('visualId');
        $mediaId = (string) $request->route('mediaId');
        $file = (string) $request->route('file');

        $context = app(StorefrontContext::class);
        if (! $context->hasStorefront()
            || preg_match(self::UUID, $visualId) !== 1
            || preg_match(self::UUID, $mediaId) !== 1
            || ! in_array($file, StorefrontFacetVisualProjector::FILES, true)) {
            $this->notFound($request);
        }

        $visual = CommerceFacetVisual::query()->find($visualId);
        if ($visual === null
            || ! $this->ownerIsVisible($visual, $context->salesChannelId())
            || $this->referencedMediaId($visual) !== $mediaId) {
            $this->notFound($request);
        }

        $media = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->find($mediaId);
        if ($media === null || ! $media->isReady() || $media->variantByFile($file) === null) {
            $this->notFound($request);
        }

        // Content-derived: the original is immutable, the ladder is regenerated with the same settings. The media id
        // is part of it so a replaced image never shares a validator with the old one, even for identical bytes.
        $etag = substr(hash('sha256', $media->sha256.':'.$media->id.':'.$file), 0, 32);
        $headers = [
            'Cache-Control' => 'private, no-store',
            'ETag' => '"'.$etag.'"',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($this->matches($request, $etag)) {
            return response('', 304, $headers);
        }

        try {
            $body = $service->readVariant($media, $file);
        } catch (StorefrontMediaException) {
            $this->notFound($request);
        }

        $format = str_ends_with($file, '.webp')
            ? StorefrontMediaVariantGenerator::FORMAT_WEBP
            : StorefrontMediaVariantGenerator::FORMAT_JPG;

        return response()->stream(function () use ($body): void {
            while (! $body->eof()) {
                echo $body->read(8192);
            }
        }, 200, $headers + ['Content-Type' => StorefrontMediaVariantGenerator::mimeForFormat($format)]);
    }

    /** The catch-all under `media/facet-visuals/`: any other shape gets the same 404, `no-store` included. */
    public function missing(Request $request): never
    {
        $this->notFound($request);
    }

    private function ownerIsVisible(CommerceFacetVisual $visual, string $channelId): bool
    {
        $facetActive = CommerceFacet::query()
            ->whereKey($visual->commerce_facet_id)
            ->where('is_active', true)
            ->exists();
        if (! $facetActive) {
            return false;
        }

        $values = CommerceFacetValue::query()
            ->where('commerce_facet_id', $visual->commerce_facet_id)
            ->where('is_active', true);
        if ($visual->commerce_facet_value_id !== null) {
            $values->whereKey($visual->commerce_facet_value_id);
        }

        $visibleProducts = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $channelId)
                ->where('is_published', true)
                ->select('product_id'))
            ->select('products.id');

        return DB::table('commerce_product_facet_values as cpfv')
            ->where('cpfv.tenant_id', app(TenantContext::class)->id())
            ->whereIn('cpfv.commerce_facet_value_id', $values->select('id'))
            ->whereIn('cpfv.product_id', $visibleProducts)
            ->exists();
    }

    private function referencedMediaId(CommerceFacetVisual $visual): ?string
    {
        // The same normalization as the projection, so a source emitted in meta and this check always agree.
        $id = $visual->commerce_facet_value_id === null
            ? (CommerceFacetVisualNormalizer::normalizeFacet($visual->visual)['self']['image']['mediaId'] ?? null)
            : (CommerceFacetVisualNormalizer::normalizeValue($visual->visual)['image']['mediaId'] ?? null);

        return is_string($id) ? $id : null;
    }

    private function matches(Request $request, string $etag): bool
    {
        $header = (string) $request->header('If-None-Match', '');
        if ($header === '') {
            return false;
        }
        foreach (explode(',', $header) as $candidate) {
            if (trim(trim($candidate), '"') === $etag || trim($candidate) === '*') {
                return true;
            }
        }

        return false;
    }

    /** One body and one header set for every failure; nothing tells which guard refused or whether a row exists. */
    private function notFound(Request $request): never
    {
        $response = PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الوسائط غير موجودة.', 404);
        $response->headers->set('Cache-Control', 'no-store');

        throw new HttpResponseException($response);
    }
}
