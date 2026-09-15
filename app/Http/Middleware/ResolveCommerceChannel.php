<?php

namespace App\Http\Middleware;

use App\Models\SalesChannel;
use App\Services\Commerce\MobileSalesChannelResolver;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Commerce API V1 — mobile channel resolution (PR-1)
 * ═══════════════════════════════════════════════════════════════
 *
 *  Context: `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
 *  §5 + `App\Services\Commerce\MobileSalesChannelResolver`'s own docblock,
 *  which names this middleware as its intended caller.
 *
 *  **Store-token decision (PR-1):** the trusted `$tenantId` this middleware
 *  hands to `MobileSalesChannelResolver` comes from `TenantContext`, already
 *  set by `AuthenticateApiClient` earlier in the `/commerce/v1` middleware
 *  chain — i.e. the existing `ApiClient` + Sanctum bearer-token mechanism
 *  (`app/Http/Middleware/AuthenticateApiClient.php`, already used by
 *  `/api/v1`) *is* the mobile store token. `ApiClient`'s own docblock already
 *  lists "تطبيق جوّال" (mobile app) among its anticipated client types. No
 *  new auth system, no new schema: reusing the identical mechanism `/api/v1`
 *  integrations already use, scoped to this tenant's mobile channel instead
 *  of a generic resource scope (PR-1 needs no `PublicApiScope` case yet —
 *  there is no protected resource to gate besides "a valid, active client of
 *  this tenant").
 *
 *  **Never trusts a client-supplied channel id.** The mobile `SalesChannel`
 *  is looked up **only** from the already-authenticated tenant (no request
 *  header/param/body is read here at all): the single active
 *  `type=mobile` channel for that tenant, mirroring exactly how
 *  `ResolveStorefrontTenant` resolves the single active `type=web` channel
 *  for a tenant with no explicit channel id from the client either. If none
 *  exists or it is inactive, this fails closed (404, non-revealing) —
 *  identical in spirit to every other resolver in this codebase
 *  (`ResolveStorefrontDomain`, `MobileSalesChannelResolver` itself).
 *
 *  Delegates the actual validation + `TenantContext`/`StorefrontContext`
 *  establishment to `MobileSalesChannelResolver::resolve()` unmodified —
 *  this middleware only supplies its two trusted inputs.
 */
class ResolveCommerceChannel
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly MobileSalesChannelResolver $resolver,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = $this->tenantContext->id();

        if ($tenantId === null) {
            abort(404, 'تعذّر تحديد قناة جوال صالحة.');
        }

        $channel = SalesChannel::query()
            ->where('tenant_id', $tenantId)
            ->where('type', SalesChannel::TYPE_MOBILE)
            ->where('is_active', true)
            ->orderBy('created_at')
            ->first();

        if ($channel === null) {
            abort(404, 'تعذّر تحديد قناة جوال صالحة لهذا المستأجر.');
        }

        $this->resolver->resolve($tenantId, $channel->id);

        return $next($request);
    }
}
