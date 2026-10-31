<?php

namespace App\Http\Controllers\Api;

use App\Models\CustomerPartnerLink;
use App\Models\PriceList;
use App\Services\Commerce\WholesalePartnerLinkAdminException;
use App\Services\Commerce\WholesalePartnerLinkAdminService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * H6 Batch M — staff linking of an approved wholesale buyer to a tenant-owned customer partner.
 * Routes carry `commerce.wholesale.manage` AND `customer_access.manage` (the permission the single writer
 * `CustomerPartnerLinkService` itself enforces) + `EnsureApplicationActive:commerce.storefront`; the deployment flag
 * `commerce.wholesale_buyer_enabled` (default off) makes them a uniform 404. Buyers never reach this controller; no client
 * ever sends a tenant, a price list, or a "linked by" actor — the server derives all of them.
 */
class CommerceStaffWholesalePartnerLinkController extends ApiController
{
    public function __construct(private readonly WholesalePartnerLinkAdminService $service) {}

    public function eligiblePartners(Request $request): JsonResponse
    {
        $this->gate();
        $data = $request->validate(['q' => ['sometimes', 'nullable', 'string', 'max:100'], 'limit' => ['sometimes', 'integer', 'min:1', 'max:50']]);

        $partners = $this->service->eligiblePartners($data['q'] ?? null, (int) ($data['limit'] ?? 20));

        return response()->json(['data' => $partners->map(fn ($p): array => [
            'id' => $p->id, 'code' => $p->code, 'name' => $p->name, 'name_en' => $p->name_en,
            'phone' => $p->phone, 'email' => $p->email, 'has_price_list' => $p->default_price_list_id !== null,
        ])->all()]);
    }

    public function show(string $id): JsonResponse
    {
        $this->gate();

        return $this->respond(fn () => $this->payload($this->service->show($id)));
    }

    public function link(Request $request, string $id): JsonResponse
    {
        $this->gate();
        $data = $request->validate(['partner_id' => ['required', 'uuid']]);

        return $this->respond(function () use ($request, $id, $data): array {
            $this->service->link($id, $data['partner_id'], $request->user());

            return $this->payload($this->service->show($id));
        });
    }

    public function unlink(Request $request, string $id): JsonResponse
    {
        $this->gate();

        return $this->respond(function () use ($request, $id): array {
            $this->service->unlink($id, $request->user());

            return $this->payload($this->service->show($id));
        });
    }

    private function gate(): void
    {
        abort_unless((bool) config('commerce.wholesale_buyer_enabled'), 404);
    }

    private function respond(callable $fn): JsonResponse
    {
        try {
            return response()->json(['data' => $fn()]);
        } catch (WholesalePartnerLinkAdminException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }
    }

    /** @param array<string, mixed> $r */
    private function payload(array $r): array
    {
        $list = fn (?PriceList $l): ?array => $l === null ? null : ['id' => $l->id, 'name' => $l->name, 'is_active' => (bool) $l->is_active];

        return [
            'active' => $r['active'] === null ? null : $this->linkRow($r['active']),
            'history' => $r['history']->map(fn (CustomerPartnerLink $l): array => $this->linkRow($l))->values()->all(),
            // staff-facing explanation of what the pricing authority will use for this buyer right now
            'effective_price_list' => [
                'source' => $r['effective']['source'],
                'price_list' => $list($r['effective']['price_list']),
                'partner_list' => $list($r['effective']['partner_list']),
                'channel_list' => $list($r['effective']['channel_list']),
            ],
        ];
    }

    private function linkRow(CustomerPartnerLink $l): array
    {
        return [
            'id' => $l->id,
            'status' => $l->status,
            'link_method' => $l->link_method,
            'partner' => $l->partner === null ? null : ['id' => $l->partner->id, 'code' => $l->partner->code, 'name' => $l->partner->name],
            'linked_at' => $l->linked_at?->toIso8601String(),
            'linked_by' => $l->linkedBy === null ? null : ['id' => $l->linkedBy->id, 'name' => $l->linkedBy->name],
            'revoked_at' => $l->revoked_at?->toIso8601String(),
            'revoked_by' => $l->revokedBy === null ? null : ['id' => $l->revokedBy->id, 'name' => $l->revokedBy->name],
        ];
    }
}
