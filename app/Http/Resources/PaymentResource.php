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
            'number'       => $this->number,
            'partner_id'   => $this->partner_id,
            'direction'    => $this->direction,
            'method'       => $this->method,
            'reference'    => $this->reference,
            'cash_account_id' => $this->cash_account_id,
            'status'       => $this->status,
            'payment_date' => optional($this->payment_date)->toDateString(),
            'amount'       => Money::toRiyal($this->amount),
            'notes'        => $this->notes,
            'print_template_revision_id' => $this->print_template_revision_id,
            'print_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('printTemplateRevision')),
            'pdf_template_revision_id' => $this->pdf_template_revision_id,
            'pdf_template_revision' => new PrintTemplateRevisionResource($this->whenLoaded('pdfTemplateRevision')),
            // تخصيصات السند: ما غطّاه من فواتير/مشتريات (نصّ المستند + مبلغ بالريال).
            'allocations'  => $this->whenLoaded('allocations', fn () => $this->allocations->map(fn ($a) => [
                'label'  => optional($a->allocatable)->number ?? '—',
                'amount' => Money::toRiyal($a->amount),
            ])->values()),
        ];
    }
}
