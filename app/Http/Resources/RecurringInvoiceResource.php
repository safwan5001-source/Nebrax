<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RecurringInvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'title'           => $this->title,
            'partner_id'      => $this->partner_id,
            'payment_type'    => $this->payment_type,
            'frequency'       => $this->frequency,
            'start_date'      => optional($this->start_date)->toDateString(),
            'next_run_date'   => optional($this->next_run_date)->toDateString(),
            'end_date'        => optional($this->end_date)->toDateString(),
            'active'          => $this->active,
            'generated_count' => $this->generated_count,
            'subtotal'        => Money::toRiyal($this->subtotal),
            'tax_amount'      => Money::toRiyal($this->tax_amount),
            'total'           => Money::toRiyal($this->total),
            'notes'           => $this->notes,
            'lines'           => RecurringInvoiceLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
