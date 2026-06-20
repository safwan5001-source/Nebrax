<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PurchaseResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                  => $this->id,
            'number'              => $this->number,
            'partner_id'          => $this->partner_id,
            'payment_type'        => $this->payment_type,
            'status'              => $this->status,
            'payment_status'      => $this->payment_status,
            'purchase_date'       => optional($this->purchase_date)->toDateString(),
            'supplier_invoice_no' => $this->supplier_invoice_no,
            'subtotal'            => Money::toRiyal($this->subtotal),
            'tax_amount'          => Money::toRiyal($this->tax_amount),
            'total'               => Money::toRiyal($this->total),
            'paid_amount'         => Money::toRiyal($this->paid_amount),
            'remaining'           => Money::toRiyal($this->remaining()),
            'lines'               => InvoiceLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
