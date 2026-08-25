<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ExpenseResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'number'         => $this->number,
            'account_id'     => $this->account_id,
            'account_code'   => $this->whenLoaded('account', fn () => $this->account->code),
            'account_name'   => $this->whenLoaded('account', fn () => $this->account->name),
            'category_id'    => $this->category_id,
            'category_name'  => $this->whenLoaded('category', fn () => $this->category?->name),
            'partner_id'     => $this->partner_id,
            'partner_name'   => $this->whenLoaded('partner', fn () => $this->partner?->name),
            'vendor_name'    => $this->vendor_name,
            'cost_center_id' => $this->cost_center_id,
            'cost_center_name' => $this->whenLoaded('costCenter', fn () => $this->costCenter?->name),
            'cost_center_code' => $this->whenLoaded('costCenter', fn () => $this->costCenter?->code),
            'journal_entry_id' => $this->journal_entry_id,
            'expense_date'   => optional($this->expense_date)->toDateString(),
            'payment_method' => $this->payment_method,
            'description'    => $this->description,
            'amount'         => Money::toRiyal($this->amount),
            'tax_rate'       => $this->tax_rate,
            'tax_amount'     => Money::toRiyal($this->tax_amount),
            'total'          => Money::toRiyal($this->total),
            'status'         => $this->status,
            'document_linked' => (int) ($this->document_transaction_links_count ?? 0) > 0,
            'source_document_url' => $this->whenLoaded('documentTransactionLinks', function () {
                $batch = $this->documentTransactionLinks->first()?->batch;

                return $batch === null ? null : '/documents/'.$batch->id;
            }),
            'attachments'    => $this->whenLoaded('attachments', fn () => $this->attachments->map(fn ($attachment) => [
                'id'            => $attachment->id,
                'original_name' => $attachment->original_name,
                'mime_type'     => $attachment->mime_type,
                'size'          => $attachment->size,
            ])->values()),
        ];
    }
}
