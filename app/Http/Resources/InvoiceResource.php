<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'branch_id'      => $this->branch_id,
            'warehouse_id'   => $this->warehouse_id,
            'price_list_id'  => $this->price_list_id,
            'price_list'     => $this->whenLoaded('priceList', fn () => $this->priceList ? [
                'id' => $this->priceList->id,
                'name' => $this->priceList->name,
                'is_active' => (bool) $this->priceList->is_active,
            ] : null),
            'number'         => $this->number,
            'partner_id'     => $this->partner_id,
            'payment_type'   => $this->payment_type,
            'zatca_document_type' => $this->zatca_document_type,
            'status'         => $this->status,
            'payment_status' => $this->payment_status,
            // «مدفوع بالفعل» وتفاصيله — نيّة السداد كما حُفظت على المسوّدة.
            // حالة السداد الفعلية بعد الترحيل تبقى `payment_status`/`paid_amount`
            // وحدها (يشتقّها سندُ القبض)، فلا مصدرَ حقيقة ثانياً.
            'is_paid'           => (bool) $this->is_paid,
            'payment_method'    => $this->payment_method,
            'payment_reference' => $this->payment_reference,
            'cash_account_id'   => $this->cash_account_id,
            'invoice_date'   => optional($this->invoice_date)->toDateString(),
            'due_date'       => optional($this->due_date)->toDateString(),
            'notes'          => $this->notes,
            'cost_center_id' => $this->cost_center_id,
            'classification_id' => $this->classification_id,
            'classification' => $this->whenLoaded('classification', fn () => $this->classification ? [
                'id' => $this->classification->id,
                'name' => $this->classification->name,
                'scope' => $this->classification->scope,
            ] : null),
            'cost_center' => $this->whenLoaded('costCenter', fn () => $this->costCenter ? [
                'id'   => $this->costCenter->id,
                'code' => $this->costCenter->code,
                'name' => $this->costCenter->name,
            ] : null),
            'salesperson_id' => $this->salesperson_id,
            // لقطة مرجع الطباعة عند الترحيل؛ null للمسوّدات والبيانات التاريخية.
            'print_template_revision_id' => $this->print_template_revision_id,
            'print_template_revision' => $this->whenLoaded('printTemplateRevision', fn () => [
                'id' => $this->printTemplateRevision->id,
                'version' => $this->printTemplateRevision->version,
                'definition' => $this->printTemplateRevision->definition,
                'document_types' => $this->printTemplateRevision->document_types,
            ]),
            'pdf_template_revision_id' => $this->pdf_template_revision_id,
            'pdf_template_revision' => $this->whenLoaded('pdfTemplateRevision', fn () => [
                'id' => $this->pdfTemplateRevision->id,
                'version' => $this->pdfTemplateRevision->version,
                'definition' => $this->pdfTemplateRevision->definition,
                'document_types' => $this->pdfTemplateRevision->document_types,
            ]),
            'thermal_template_revision_id' => $this->thermal_template_revision_id,
            'thermal_template_revision' => $this->whenLoaded('thermalTemplateRevision', fn () => [
                'id' => $this->thermalTemplateRevision->id,
                'version' => $this->thermalTemplateRevision->version,
                'definition' => $this->thermalTemplateRevision->definition,
                'document_types' => $this->thermalTemplateRevision->document_types,
            ]),
            'subtotal'       => Money::toRiyal($this->subtotal),
            'discount'       => Money::toRiyal($this->discount),
            'shipping'       => Money::toRiyal($this->shipping),
            'adjustment'     => Money::toRiyal($this->adjustment),
            'tax_inclusive'  => (bool) $this->tax_inclusive,
            'tax_amount'     => Money::toRiyal($this->tax_amount),
            'total'          => Money::toRiyal($this->total),
            'paid_amount'    => Money::toRiyal($this->paid_amount),
            'remaining'      => Money::toRiyal($this->remaining()),
            'lines'          => InvoiceLineResource::collection($this->whenLoaded('lines')),
            'delivery_note_sources' => $this->whenLoaded('deliveryNoteAllocations', fn () => $this->deliveryNoteAllocations
                ->map(fn ($allocation) => [
                    'allocation_id' => $allocation->id,
                    'delivery_note_id' => $allocation->delivery_note_id,
                    'number' => $allocation->deliveryNote?->number ?? $allocation->delivery_note_number_snapshot,
                    'status' => $allocation->deliveryNote?->status ?? $allocation->delivery_note_status_snapshot,
                    'delivery_date' => $allocation->deliveryNote?->delivery_date?->toDateString(),
                    'line_count' => $allocation->relationLoaded('lineLinks') ? $allocation->lineLinks->count() : null,
                ])->values()),
            'zatca'          => [
                'qr'   => $this->zatca_qr,
                'hash' => $this->zatca_hash,
                'uuid' => $this->zatca_uuid,
                'icv'  => $this->zatca_icv,
                'document_type' => $this->zatca_document_type,
                'submission_type' => $this->zatca_document_type === 'standard' ? 'clearance' : 'reporting',
            ],
        ];
    }
}
