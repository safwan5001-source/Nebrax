<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Services\Commerce\WholesaleMembershipService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * H6 Batch E — the reusable authorization gate for every protected wholesale capability (later batches:
 * prices, cart, checkout). Authentication is already proven by the middleware before it; this checks
 * *eligibility* only: an `approved` membership for (host-resolved channel, this identity).
 *
 * The membership is read fresh on EVERY request (no cache, no token claim), so rejecting or suspending a
 * buyer takes effect on their existing sessions immediately. Pending / rejected / suspended / absent all
 * return the same 403 — the buyer reads their own status from the membership endpoint, never from a gate.
 */
class EnsureApprovedWholesaleBuyer
{
    public function __construct(
        private StorefrontContext $context,
        private WholesaleMembershipService $memberships,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $identity = $request->user();

        if (! $identity instanceof CustomerIdentity
            || ! $this->context->isEstablished()
            || ! $this->memberships->isApproved($identity->id, $this->context->salesChannelId())
        ) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::FORBIDDEN, 'هذه الخاصية متاحة لمشتري الجملة المعتمدين فقط.', 403,
            );
        }

        return $next($request);
    }
}
