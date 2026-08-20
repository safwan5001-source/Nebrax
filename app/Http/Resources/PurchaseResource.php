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
            'branch_id'           => $this->branch_id,
            'warehouse_id'        => $this->warehouse_id,
            'number'              => $this->number,
            'partner_id'          => $this->partner_id,
            'cost_center_id'      => $this->cost_center_id,
            'payment_type'        => $this->payment_type,
            'status'              => $this->status,
            'payment_status'      => $this->payment_status,
            'purchase_date'       => optional($this->purchase_date)->toDateString(),
            'supplier_invoice_no' => $this->supplier_invoice_no,
            'subtotal'            => Money::toRiyal($this->subtotal),
            'tax_amount'          => Money::toRiyal($this->tax_amount),
            'discount'            => Money::toRiyal($this->discount),
            'shipping'            => Money::toRiyal($this->shipping),
            'adjustment'          => Money::toRiyal($this->adjustment),
            'total'               => Money::toRiyal($this->total),
            'tax_inclusive'       => (bool) $this->tax_inclusive,
            'paid_amount'         => Money::toRiyal($this->paid_amount),
            'paid_on_post'        => Money::toRiyal($this->paid_on_post),
            'payment_method'      => $this->payment_method,
            'received_status'     => $this->received_status,
            'received_date'       => optional($this->received_date)->toDateString(),
            'due_date'            => optional($this->due_date)->toDateString(),
            'print_template_revision_id' => $this->print_template_revision_id,
            'print_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('printTemplateRevision')),
            'pdf_template_revision_id' => $this->pdf_template_revision_id,
            'pdf_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('pdfTemplateRevision')),
            'thermal_template_revision_id' => $this->thermal_template_revision_id,
            'thermal_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('thermalTemplateRevision')),
            'remaining'           => Money::toRiyal($this->remaining()),
            'lines'               => InvoiceLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
