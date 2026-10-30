<?php

namespace App\Http\Controllers\Api;

use App\Models\SalesChannel;
use App\Models\WholesaleMembership;
use App\Services\Commerce\WholesaleMembershipException;
use App\Services\Commerce\WholesaleMembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * H6 Batch E — staff review of wholesale membership applications. Routes carry `commerce.wholesale.manage`
 * (owner/admin via `*` only — never in MATRIX, never granted to a stored role by migration) plus
 * `EnsureApplicationActive:commerce.storefront`; the deployment flag `commerce.wholesale_buyer_enabled`
 * (default off) makes them a uniform 404 until separately authorized.
 *
 * Tenant scope is TenantScope on every query (another tenant's channel/membership is a plain 404). A
 * decision's state machine, row lock, actor and timestamp live in {@see WholesaleMembershipService}.
 * Buyers cannot reach this controller: it sits behind the staff `auth:sanctum` + tenant chain.
 */
class CommerceStaffWholesaleMembershipController extends ApiController
{
    public function index(Request $request, string $channelId): JsonResponse
    {
        abort_unless((bool) config('commerce.wholesale_buyer_enabled'), 404);

        $data = $request->validate([
            'status' => ['sometimes', 'string', Rule::in(WholesaleMembership::STATUSES)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $channel = SalesChannel::query()->whereKey($channelId)->where('wholesale_membership_enabled', true)->first();
        abort_if($channel === null, 404, 'القناة غير موجودة.');

        $query = WholesaleMembership::query()
            ->where('sales_channel_id', $channel->id)
            ->with(['identity:id,display_name,email,phone', 'decidedBy:id,name'])
            ->orderByDesc('applied_at')
            ->orderBy('id');

        if (isset($data['status'])) {
            $query->where('status', $data['status']);
        }

        $page = $query->paginate((int) ($data['per_page'] ?? 25));

        return response()->json([
            'data' => $page->getCollection()->map(fn (WholesaleMembership $m): array => $this->serialize($m))->all(),
            'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function transition(Request $request, string $id, string $action, WholesaleMembershipService $memberships): JsonResponse
    {
        abort_unless((bool) config('commerce.wholesale_buyer_enabled'), 404);

        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:500']]);

        try {
            $membership = $memberships->transition($id, $action, $request->user(), $data['note'] ?? null);
        } catch (WholesaleMembershipException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }

        return response()->json(['data' => $this->serialize($membership->load(['identity:id,display_name,email,phone', 'decidedBy:id,name']))]);
    }

    /** Staff view: identity contact + decision facts. Never password material or tokens. */
    private function serialize(WholesaleMembership $m): array
    {
        return [
            'id' => $m->id,
            'sales_channel_id' => $m->sales_channel_id,
            'status' => $m->status,
            'applied_at' => $m->applied_at?->toIso8601String(),
            'decided_at' => $m->decided_at?->toIso8601String(),
            'decided_by' => $m->decidedBy === null ? null : ['id' => $m->decidedBy->id, 'name' => $m->decidedBy->name],
            'decision_note' => $m->decision_note,
            'customer' => [
                'id' => $m->identity?->id,
                'display_name' => $m->identity?->display_name,
                'email' => $m->identity?->email,
                'phone' => $m->identity?->phone,
            ],
        ];
    }
}
