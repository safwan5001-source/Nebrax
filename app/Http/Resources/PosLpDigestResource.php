<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosLpDigestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'digest_date' => $this->digest_date?->toDateString(),
            'timezone' => $this->timezone,
            'period_start' => $this->period_start?->toIso8601String(),
            'period_end' => $this->period_end?->toIso8601String(),
            'generated_at' => $this->generated_at?->toIso8601String(),
            'generated_by' => $this->generated_by,
            'new_exceptions_count' => $this->new_exceptions_count,
            'priority_exceptions_count' => $this->priority_exceptions_count,
            'amount_under_review' => Money::toRiyal((int) $this->amount_under_review_minor),
            'amount_under_review_minor' => (int) $this->amount_under_review_minor,
            'new_cases_count' => $this->new_cases_count,
            'unresolved_high_priority_cases_count' => $this->unresolved_high_priority_cases_count,
            'confirmed_loss_count' => $this->confirmed_loss_count,
            'confirmed_loss' => Money::toRiyal((int) $this->confirmed_loss_minor),
            'confirmed_loss_minor' => (int) $this->confirmed_loss_minor,
            'control_failure_count' => $this->control_failure_count,
            'material_variance_sessions_count' => $this->material_variance_sessions_count,
            'data_sufficiency_caveats' => $this->data_sufficiency_caveats ?? [],
            'branch_breakdown' => $this->branch_breakdown ?? [],
            'payload' => $this->payload ?? [],
        ];
    }
}
