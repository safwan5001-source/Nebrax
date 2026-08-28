<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * مورد الاستثناء الرقابي المشتقّ. المبالغ بالهللات تُعرض بالريال في طبقة العرض
 * فقط. الدرجات والمعدّلات والشدّة كلها مصدرها الخادم — لا يقبل الخادم أياً منها
 * من العميل. `evidence_confidence` يوسم الأدلة العميلية الثانوية صراحةً.
 */
class PosExceptionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'rule_key' => $this->rule_key,
            'category' => $this->category,
            'rule_version' => $this->rule_version,
            'severity' => $this->severity,
            'risk_contribution' => $this->risk_contribution,
            'observed_count' => $this->observed_count,
            'denominator' => $this->denominator,
            'observed_rate_milli' => $this->observed_rate_milli,
            'baseline_rate_milli' => $this->baseline_rate_milli,
            'baseline_type' => $this->baseline_type,
            'sample_size' => $this->sample_size,
            'amount_under_review' => Money::toRiyal((int) $this->amount_under_review),
            'amount_under_review_minor' => (int) $this->amount_under_review,
            'evidence_confidence' => $this->evidence_confidence,
            'subject_user_id' => $this->subject_user_id,
            'pos_session_id' => $this->pos_session_id,
            'cart_id' => $this->cart_id,
            'performed_by' => $this->performed_by,
            'approved_by' => $this->approved_by,
            'window_start' => $this->window_start?->toIso8601String(),
            'window_end' => $this->window_end?->toIso8601String(),
            'detected_at' => $this->detected_at?->toIso8601String(),
            'review_state' => $this->review_state,
            'reviewed_by' => $this->reviewed_by,
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            'review_reason' => $this->review_reason,
            'review_note' => $this->review_note,
            'explanation' => $this->explanation,
            'rule_snapshot' => $this->rule_snapshot,
            'subject' => $this->whenLoaded('subject', fn () => $this->subject ? ['id' => $this->subject->id, 'name' => $this->subject->name] : null),
            'performer' => $this->whenLoaded('performedBy', fn () => $this->performedBy ? ['id' => $this->performedBy->id, 'name' => $this->performedBy->name] : null),
            'approver' => $this->whenLoaded('approvedBy', fn () => $this->approvedBy ? ['id' => $this->approvedBy->id, 'name' => $this->approvedBy->name] : null),
            'reviewer' => $this->whenLoaded('reviewer', fn () => $this->reviewer ? ['id' => $this->reviewer->id, 'name' => $this->reviewer->name] : null),
            'session' => $this->whenLoaded('session', fn () => $this->session ? ['id' => $this->session->id, 'number' => $this->session->number] : null),
            'reviews' => $this->whenLoaded('reviews', fn () => $this->reviews->map(fn ($review) => [
                'id' => $review->id,
                'from_state' => $review->from_state,
                'to_state' => $review->to_state,
                'reviewed_by' => $review->reviewed_by,
                'reviewer_name' => $review->reviewer?->name,
                'reason' => $review->reason,
                'note' => $review->note,
                'created_at' => $review->created_at?->toIso8601String(),
            ])->values()),
        ];
    }
}
