<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CashBankTransferResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'source_cash_bank_account_id' => $this->source_cash_bank_account_id,
            'source_name' => $this->whenLoaded('source', fn () => $this->source?->name),
            'destination_cash_bank_account_id' => $this->destination_cash_bank_account_id,
            'destination_name' => $this->whenLoaded('destination', fn () => $this->destination?->name),
            'amount' => Money::toRiyal($this->amount),
            'currency' => $this->currency,
            'transfer_date' => $this->transfer_date?->toDateString(),
            'reference' => $this->reference,
            'notes' => $this->notes,
            'journal_entry_id' => $this->journal_entry_id,
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
