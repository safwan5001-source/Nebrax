<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CreditNoteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                  => $this->id,
            'number'              => $this->number,
            'type'                => $this->type,
            'partner_id'          => $this->partner_id,
            'refund_type'         => $this->refund_type,
            'status'              => $this->status,
            'note_date'           => optional($this->note_date)->toDateString(),
            'subtotal'            => Money::toRiyal($this->subtotal),
            'tax_amount'          => Money::toRiyal($this->tax_amount),
            'total'               => Money::toRiyal($this->total),
            'reason'              => $this->reason,
            'original_invoice_id' => $this->original_invoice_id,
            'print_template_revision_id' => $this->print_template_revision_id,
            'print_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('printTemplateRevision')),
            'pdf_template_revision_id' => $this->pdf_template_revision_id,
            'pdf_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('pdfTemplateRevision')),
            'thermal_template_revision_id' => $this->thermal_template_revision_id,
            'thermal_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('thermalTemplateRevision')),
            'lines'               => CreditNoteLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
