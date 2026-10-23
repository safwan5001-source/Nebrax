<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** طلب جهاز الدفع للواجهة: آخر 4 أرقام فقط، بلا مرجع مزوّد داخلي ولا أسرار. */
class PosTerminalRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'pos_session_id' => $this->pos_session_id,
            'pos_payment_terminal_id' => $this->pos_payment_terminal_id,
            'payment_method_id' => $this->payment_method_id,
            'amount' => Money::toRiyal($this->amount),
            'currency' => $this->currency,
            'status' => $this->status,
            'approval_code' => $this->approval_code,
            'rrn' => $this->rrn,
            'last4' => $this->last4,
            'failure_code' => $this->failure_code,
            'void_attempts' => $this->void_attempts,
            'last_void_error' => $this->last_void_error,
            'consumed_payment_id' => $this->consumed_payment_id,
            'consumed_invoice_id' => $this->consumed_invoice_id,
            'resolution_note' => $this->resolution_note,
            'approved_at' => $this->approved_at?->toISOString(),
            'consumed_at' => $this->consumed_at?->toISOString(),
            'voided_at' => $this->voided_at?->toISOString(),
            'resolved_at' => $this->resolved_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
            'idempotent_replay' => (bool) ($this->resource->getAttribute('idempotent_replay') ?? false),
        ];
    }
}
