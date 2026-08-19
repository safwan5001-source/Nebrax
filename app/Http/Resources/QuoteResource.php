<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class QuoteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                   => $this->id,
            'branch_id'            => $this->branch_id,
            'number'               => $this->number,
            'partner_id'           => $this->partner_id,
            'status'               => $this->status,
            'quote_date'           => optional($this->quote_date)->toDateString(),
            'valid_until'          => optional($this->valid_until)->toDateString(),
            'subtotal'             => Money::toRiyal($this->subtotal),
            'tax_amount'           => Money::toRiyal($this->tax_amount),
            'total'                => Money::toRiyal($this->total),
            'tax_inclusive'        => (bool) $this->tax_inclusive,
            'notes'                => $this->notes,
            'converted_invoice_id' => $this->converted_invoice_id,
            'print_issued_at'      => optional($this->print_issued_at)?->toIso8601String(),
            'print_template_revision_id' => $this->print_template_revision_id,
            'print_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('printTemplateRevision')),
            'pdf_template_revision_id' => $this->pdf_template_revision_id,
            'pdf_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('pdfTemplateRevision')),
            'thermal_template_revision_id' => $this->thermal_template_revision_id,
            'thermal_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('thermalTemplateRevision')),
            'revised_from_id'       => $this->revised_from_id,
            'revised_from_number'   => $this->whenLoaded('revisedFrom', fn () => $this->revisedFrom?->number),
            'lines'                => QuoteLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
