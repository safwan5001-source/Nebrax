<?php

namespace App\Http\Controllers\Api;

use App\Models\CustomerIdentity;
use App\Models\WholesaleMembership;
use App\Services\Commerce\WholesaleMembershipService;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * H6 Batch E — the buyer's side of wholesale membership on the Host-resolved channel. Authentication is
 * established by the route middleware; the buyer can only *apply* and *read their own status*. There is no
 * buyer-facing way to change a status — decisions are staff-only ({@see CommerceStaffWholesaleMembershipController}).
 *
 * The membership payload is deliberately minimal: status + two timestamps. Never the deciding user, the
 * staff note, other buyers, or any tenant/channel identifier.
 */
class StorefrontWholesaleController extends PublicApiController
{
    public function apply(Request $request, WholesaleMembershipService $memberships, StorefrontContext $context): JsonResponse
    {
        /** @var CustomerIdentity $identity */
        $identity = $request->user();

        $membership = $memberships->apply($identity, $context->salesChannelId());

        return PublicApiResponse::success($request, ['membership' => $this->payload($membership)], $membership->wasRecentlyCreated ? 201 : 200);
    }

    public function membership(Request $request, WholesaleMembershipService $memberships, StorefrontContext $context): JsonResponse
    {
        /** @var CustomerIdentity $identity */
        $identity = $request->user();

        $membership = $memberships->find($identity->id, $context->salesChannelId());

        return PublicApiResponse::success($request, ['membership' => $membership === null ? null : $this->payload($membership)]);
    }

    /** Protected-capability probe: reachable only through EnsureApprovedWholesaleBuyer. */
    public function access(Request $request): JsonResponse
    {
        return PublicApiResponse::success($request, ['access' => true]);
    }

    /** @return array{status:string,applied_at:?string,decided_at:?string} */
    private function payload(WholesaleMembership $membership): array
    {
        return [
            'status' => $membership->status,
            'applied_at' => $membership->applied_at?->toIso8601String(),
            'decided_at' => $membership->decided_at?->toIso8601String(),
        ];
    }
}
