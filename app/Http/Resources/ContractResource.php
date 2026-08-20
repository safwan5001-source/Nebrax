<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ContractResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                 => $this->id,
            'employee_id'        => $this->employee_id,
            'type'               => $this->type,
            'status'             => $this->status,
            'start_date'         => optional($this->start_date)->toDateString(),
            'end_date'           => optional($this->end_date)->toDateString(),
            'probation_end_date' => optional($this->probation_end_date)->toDateString(),
            'items'              => $this->items->map(fn ($item) => [
                'id'       => $item->id,
                'category' => $item->category,
                'name'     => $item->name,
                'amount'   => Money::toRiyal($item->amount),
            ])->values(),
            'basic_salary'       => Money::toRiyal($this->basicSalary()),
            'gosi'               => Money::toRiyal($this->gosiTotal()),
            'other_deductions'   => Money::toRiyal($this->otherDeductionsTotal()),
            'gross'              => Money::toRiyal($this->gross()),
            'net'                => Money::toRiyal($this->net()),
            'notes'              => $this->notes,
            'created_by'         => $this->created_by,
            'created_at'         => optional($this->created_at)->toIso8601String(),
        ];
    }
}
