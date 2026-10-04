<?php

namespace App\Http\Resources;

use App\Services\DeliveryFinancialRoleGate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** نسخة تكوين منصة توصيل. تجاوزات الفروع المعروضة محصورة بفروع المستخدم المسموحة. */
class DeliveryPlatformVersionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // مرة واحدة لكل طلب: `toArray()` يُستدعى لكل نسخة، و`allowedBranchIds()` استعلام.
        if (! $request->attributes->has('dlv.allowed_branch_ids')) {
            $request->attributes->set('dlv.allowed_branch_ids', $request->user()?->allowedBranchIds());
        }
        $allowed = $request->attributes->get('dlv.allowed_branch_ids');

        return [
            'id' => $this->id,
            'version_number' => $this->version_number,
            'collection_mode' => $this->collection_mode,
            'external_reference_policy' => $this->external_reference_policy,
            'display_name' => $this->display_name,
            'display_name_en' => $this->display_name_en,
            'logo_asset_key' => $this->logo_asset_key,
            'is_active' => $this->is_active,
            'selling_role' => $this->selling_role,
            'invoice_responsibility' => $this->invoice_responsibility,
            'collection_role' => $this->collection_role,
            'merchant_vat_status_at_supply' => $this->merchant_vat_status_at_supply,
            'financial_evidence_ref' => $this->financial_evidence_ref,
            'financial_verified_at' => $this->financial_verified_at?->format('Y-m-d\\TH:i:s.uP'),
            'financial_gate' => app(DeliveryFinancialRoleGate::class)->evaluate($this->resource),
            'change_reason' => $this->change_reason,
            'created_by' => $this->created_by,
            // ميكروثانية كاملة: إعادة تمريرها إلى `resolve?at=` تعيد النسخة نفسها لا الأقدم.
            'effective_from' => $this->effective_from?->format('Y-m-d\\TH:i:s.uP'),
            'branch_overrides' => $this->overrides
                ->filter(fn ($row) => $allowed === null || in_array($row->branch_id, $allowed, true))
                ->map(fn ($row) => [
                    'branch_id' => $row->branch_id,
                    'collection_mode' => $row->collection_mode,
                    'external_reference_policy' => $row->external_reference_policy,
                ])
                ->sortBy('branch_id')
                ->values(),
        ];
    }
}
