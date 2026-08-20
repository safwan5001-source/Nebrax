<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'branch_id'    => $this->branch_id,
            'number'       => $this->number,
            'partner_id'   => $this->partner_id,
            'partner_name' => $this->whenLoaded('partner', fn () => $this->partner?->name),
            'direction'    => $this->direction,
            'method'       => $this->method,
            'payment_method_id' => $this->payment_method_id,
            'payment_method_name' => $this->payment_method_name,
            'reference'    => $this->reference,
            'payment_details' => $this->payment_details,
            'collector_employee_id' => $this->collector_employee_id,
            'collector_employee_name' => $this->whenLoaded('collectorEmployee', fn () => $this->collectorEmployee?->name),
            'cash_account_id' => $this->cash_account_id,
            'cash_account_code' => $this->whenLoaded('cashAccount', fn () => $this->cashAccount?->code),
            'cash_account_name' => $this->whenLoaded('cashAccount', fn () => $this->cashAccount?->name),
            'journal_entry_id' => $this->journal_entry_id,
            'status'       => $this->status,
            'payment_date' => optional($this->payment_date)->toDateString(),
            'amount'       => Money::toRiyal($this->amount),
            'notes'        => $this->notes,
            'print_template_revision_id' => $this->print_template_revision_id,
            'print_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('printTemplateRevision')),
            'pdf_template_revision_id' => $this->pdf_template_revision_id,
            'pdf_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('pdfTemplateRevision')),
            'thermal_template_revision_id' => $this->thermal_template_revision_id,
            'thermal_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('thermalTemplateRevision')),
            // تخصيصات السند: ما غطّاه من فواتير/مشتريات (نصّ المستند + مبلغ بالريال).
            'attachments' => $this->whenLoaded('attachments', fn () => $this->attachments->map(fn ($attachment) => [
                'id'            => $attachment->id,
                'original_name' => $attachment->original_name,
                'mime_type'     => $attachment->mime_type,
                'size'          => $attachment->size,
            ])->values()),
            'allocations'  => $this->whenLoaded('allocations', fn () => $this->allocations->map(fn ($a) => [
                'id'               => $a->id,
                'allocatable_id'   => $a->allocatable_id,
                'allocatable_type' => $a->allocatable_type,
                'label'            => optional($a->allocatable)->number ?? '—',
                'amount'           => Money::toRiyal($a->amount),
            ])->values()),
        ];
    }
}
