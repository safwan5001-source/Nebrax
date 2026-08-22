<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosExchangeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'pos_session_id' => $this->pos_session_id,
            'original_invoice_id' => $this->original_invoice_id,
            'return_id' => $this->return_id,
            'replacement_invoice_id' => $this->replacement_invoice_id,
            'applied_credit_amount' => Money::toRiyal($this->applied_credit_amount),
            'cash_refund_amount' => Money::toRiyal($this->cash_refund_amount),
            'journal_entry_id' => $this->journal_entry_id,
            'status' => $this->status,
            'notes' => $this->notes,
            'created_at' => optional($this->created_at)->toISOString(),
            'original_invoice' => $this->whenLoaded('originalInvoice', fn () => [
                'id' => $this->originalInvoice->id,
                'number' => $this->originalInvoice->number,
            ]),
            'return_document' => $this->whenLoaded('returnDocument', fn () => [
                'id' => $this->returnDocument->id,
                'number' => $this->returnDocument->number,
            ]),
            'replacement_invoice' => $this->whenLoaded('replacementInvoice', fn () => [
                'id' => $this->replacementInvoice->id,
                'number' => $this->replacementInvoice->number,
            ]),
        ];
    }
}
