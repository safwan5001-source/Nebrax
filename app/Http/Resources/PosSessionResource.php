<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosSessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'number'           => $this->number,
            'branch_id'        => $this->branch_id,
            'pos_device_id'    => $this->pos_device_id,
            'warehouse_id'     => $this->warehouse_id,
            'pos_shift_id'     => $this->pos_shift_id,
            // Legacy HR shift reference: historical compatibility only.
            'shift_id'         => $this->shift_id,
            // حساب خزينة الجلسة المثبّت وقت الفتح؛ للعرض والتتبّع فقط (يحلّه الخادم).
            'cash_account_id'  => $this->cash_account_id,
            'status'           => $this->status,
            'handover_status'  => $this->handover_status,
            'opening_balance'  => Money::toRiyal($this->opening_balance),
            'closing_balance'  => $this->closing_balance !== null ? Money::toRiyal($this->closing_balance) : null,
            'expected_balance' => $this->expected_balance !== null ? Money::toRiyal($this->expected_balance) : null,
            'difference'       => $this->difference !== null ? Money::toRiyal($this->difference) : null,
            'difference_status' => $this->difference_status,
            // نوع الفرق مشتق من إشارته: عجز/فائض/لا شيء — لا يخزّن، لعرض الواجهة فقط.
            'variance_type'    => $this->varianceType(),
            // رابط قيد التسوية المثبّت؛ وجوده يعني أن الفرق سُوِّي محاسبياً.
            'variance_journal_entry_id' => $this->variance_journal_entry_id,
            'difference_acknowledgement' => $this->difference_acknowledged_at ? [
                'acknowledged_by' => $this->difference_acknowledged_by,
                'acknowledged_at' => $this->difference_acknowledged_at->toIso8601String(),
                'note' => $this->difference_acknowledgement_note,
            ] : null,
            'opened_at'        => optional($this->opened_at)->toIso8601String(),
            'closed_at'        => optional($this->closed_at)->toIso8601String(),
            'notes'            => $this->notes,
            'handover_note'    => $this->handover_note,
            'handover_submitted_at' => optional($this->handover_submitted_at)->toIso8601String(),
            'opened_by'        => $this->opened_by,
            'closed_by'        => $this->closed_by,
            'handover_confirmed_by' => $this->handover_confirmed_by,
            'handover_confirmed_at' => optional($this->handover_confirmed_at)->toIso8601String(),
            'handover_confirmation_note' => $this->handover_confirmation_note,
            'handover_receiver' => $this->whenLoaded('handoverConfirmedBy', fn () => $this->handoverConfirmedBy ? [
                'id' => $this->handoverConfirmedBy->id,
                'name' => $this->handoverConfirmedBy->name,
            ] : null),
            'reconciliations' => $this->whenLoaded('reconciliations', fn () => $this->reconciliations->map(fn ($row) => [
                'id' => $row->id,
                'reconciliation_key' => $row->reconciliation_key,
                'payment_method_id' => $row->payment_method_id,
                'payment_method_name' => $row->payment_method_name,
                'settlement_type' => $row->settlement_type,
                'expected_amount' => Money::toRiyal($row->expected_amount),
                'counted_amount' => Money::toRiyal($row->counted_amount),
                'difference' => Money::toRiyal($row->difference),
                'count_source' => $row->count_source,
            ])->values()),
            'pos_device'       => $this->whenLoaded('posDevice', fn () => $this->posDevice ? [
                'id'   => $this->posDevice->id,
                'name' => $this->posDevice->name,
                'code' => $this->posDevice->code,
            ] : null),
            'warehouse'        => $this->whenLoaded('warehouse', fn () => $this->warehouse ? [
                'id'   => $this->warehouse->id,
                'code' => $this->warehouse->code,
                'name' => $this->warehouse->name,
            ] : null),
            'pos_shift'        => $this->whenLoaded('posShift', fn () => $this->posShift ? [
                'id'   => $this->posShift->id,
                'name' => $this->posShift->name,
                'code' => $this->posShift->code,
            ] : null),
            'shift'            => $this->whenLoaded('shift', fn () => $this->shift ? [
                'id'   => $this->shift->id,
                'name' => $this->shift->name,
            ] : null),
        ];
    }

    /** عجز إن كان المعدود أقل من المتوقّع، فائض إن كان أكبر، وإلا لا شيء. */
    private function varianceType(): ?string
    {
        if ($this->difference === null || (int) $this->difference === 0) {
            return null;
        }

        return (int) $this->difference < 0 ? 'shortage' : 'overage';
    }
}
