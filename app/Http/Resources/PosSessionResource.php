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
            'shift_id'         => $this->shift_id,
            'status'           => $this->status,
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
            'opened_by'        => $this->opened_by,
            'closed_by'        => $this->closed_by,
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
