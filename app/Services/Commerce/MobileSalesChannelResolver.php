<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Mobile Sales Channel Foundation — turns an already-existing
 *  `SalesChannel::TYPE_MOBILE` row into a safely resolvable Commerce
 *  channel, decoupled from `Storefront`/host resolution entirely.
 * ═══════════════════════════════════════════════════════════════
 *
 *  Context: `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
 *  §1.5/§1.4/§9.7/§10.1 — `SalesChannel::TYPE_MOBILE` already exists in the
 *  schema but nothing resolves it: `Storefront::booted()` hard-rejects any
 *  non-`web` channel by design (a mobile channel deliberately never gets a
 *  `Storefront` row — that invariant is correct and untouched here), and the
 *  production resolution middleware (`ResolveStorefrontDomain`) only ever
 *  looks for `type=web`. This class is the missing resolution primitive —
 *  nothing else in this PR changes.
 *
 *  **What this deliberately is NOT:**
 *  - Not a route, not middleware, not wired into any HTTP request yet. How a
 *    mobile client's request is authenticated and turned into a trusted
 *    `$tenantId` (store token, app-bundled config, …) is an explicit open
 *    decision (architecture doc §10.2), not settled by this PR. This class
 *    takes that `$tenantId` as an already-trusted input — establishing that
 *    trust is the next PR's job (`ResolveCommerceChannel` middleware).
 *  - Not a Catalog/Cart/Checkout API. It resolves a channel, nothing else.
 *  - Not a change to `CommerceProductPublicationService` or any pricing
 *    logic — publication/pricing stay `web`-only exactly as today; teaching
 *    them mobile-awareness is separate, reviewed work (architecture doc
 *    §9.7), deliberately deferred so this PR does not duplicate or fork
 *    that logic.
 *
 *  **Fail-closed contract**, mirroring `ResolveStorefrontDomain`'s pattern:
 *  the channel lookup is scoped by an explicit `tenant_id` clause (not the
 *  `TenantScope` global scope, since no tenant context is established yet
 *  when the search runs — same reasoning `ResolveStorefrontDomain` documents
 *  for its own pre-context `StorefrontDomain` lookup), and any mismatch
 *  (unknown id, wrong tenant, wrong type, inactive) is a single
 *  non-revealing failure — no distinction leaked between "does not exist"
 *  and "belongs to someone else".
 */
final class MobileSalesChannelResolver
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly StorefrontContext $storefrontContext,
    ) {}

    /**
     * Resolve and establish context for a mobile sales channel.
     *
     * @param  string  $tenantId  Already-trusted tenant id (not client-supplied — see class docblock).
     * @param  string  $channelId  The `SalesChannel` id to resolve as this request's mobile channel.
     *
     * @throws \Symfony\Component\HttpKernel\Exception\NotFoundHttpException Fail-closed on any mismatch.
     */
    public function resolve(string $tenantId, string $channelId): SalesChannel
    {
        $this->tenantContext->forget();
        $this->storefrontContext->forget();

        if ($tenantId === '' || $channelId === '') {
            abort(404, 'تعذّر تحديد قناة جوال صالحة.');
        }

        $channel = SalesChannel::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($channelId)
            ->where('type', SalesChannel::TYPE_MOBILE)
            ->where('is_active', true)
            ->first();

        if ($channel === null) {
            abort(404, 'تعذّر تحديد قناة جوال صالحة.');
        }

        $this->tenantContext->set($tenantId);

        // لا `Storefront` لقناة الجوال أبداً (`Storefront::booted()` يرفضها
        // بنيوياً) — `storefrontId` يبقى غير مضبوط عمداً، تماماً كما يسمح
        // تصميم `StorefrontContext` أصلاً للمسار المتوارَث بلا Storefront.
        $this->storefrontContext->set($tenantId, $channel->id);

        return $channel;
    }
}
