<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProcurementDocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                    => $this->id,
            'type'                  => $this->type,
            'number'                => $this->number,
            'partner_id'            => $this->partner_id,
            'partner_name'          => $this->whenLoaded('partner', fn () => $this->partner?->name),
            'status'                => $this->status,
            'doc_date'              => optional($this->doc_date)->toDateString(),
            'due_date'              => optional($this->due_date)->toDateString(),
            'requested_by'          => $this->requested_by,
            'subtotal'              => Money::toRiyal($this->subtotal),
            'tax_amount'            => Money::toRiyal($this->tax_amount),
            'total'                 => Money::toRiyal($this->total),
            'tax_inclusive'         => (bool) $this->tax_inclusive,
            'notes'                 => $this->notes,
            'source_document_id'    => $this->source_document_id,
            // رقم المستند المصدر ونوعه — ليكون التتبّع رابطاً مقروءاً لا معرّفاً خاماً.
            'source_number'         => $this->whenLoaded('sourceDocument', fn () => $this->sourceDocument?->number),
            'source_type'           => $this->whenLoaded('sourceDocument', fn () => $this->sourceDocument?->type),
            'converted_purchase_id' => $this->converted_purchase_id,
            'supplier_ids'          => $this->whenLoaded('invitations', fn () => $this->invitations->pluck('partner_id')),
            'lines'                 => ProcurementLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
