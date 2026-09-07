<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SupplierRefundResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                  => $this->id,
            'number'              => $this->number,
            'branch_id'           => $this->branch_id,
            'partner_id'          => $this->partner_id,
            'partner_name'        => $this->whenLoaded('partner', fn () => $this->partner?->name),
            'refund_date'         => $this->refund_date?->toDateString(),
            'amount'              => Money::toRiyal($this->amount),
            'method'              => $this->method,
            'payment_method_id'   => $this->payment_method_id,
            'payment_method_name' => $this->payment_method_name,
            'cash_account_id'     => $this->cash_account_id,
            'reference'           => $this->reference,
            'notes'               => $this->notes,
            'status'              => $this->status,
            'journal_entry_id'    => $this->journal_entry_id,
            'reversal_entry_id'   => $this->reversal_entry_id,
            'posted_at'           => $this->posted_at?->toIso8601String(),
            'reversed_at'         => $this->reversed_at?->toIso8601String(),
            'created_at'          => $this->created_at?->toIso8601String(),
            'allocations'         => $this->whenLoaded('allocations', fn () => $this->allocations->map(fn ($allocation) => [
                'id'                 => $allocation->id,
                'purchase_return_id' => $allocation->purchase_return_id,
                'purchase_return_number' => $allocation->relationLoaded('purchaseReturn')
                    ? $allocation->purchaseReturn?->number
                    : null,
                'amount'             => Money::toRiyal($allocation->amount),
            ])->all()),
        ];
    }
}
