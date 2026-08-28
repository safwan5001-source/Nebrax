<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * مورد قضية تحقيق. المبالغ بالهللات تُعرض بالريال في طبقة العرض فقط. `confirmed_loss`/
 * `recovered_amount` بيانات قرار تحقيق بشري صرف — لا صلة لهما بأي قيد محاسبي.
 */
class PosInvestigationCaseResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'number' => $this->number,
            'title' => $this->title,
            'summary' => $this->summary,
            'status' => $this->status,
            'priority' => $this->priority,
            'owner_id' => $this->owner_id,
            'opened_by' => $this->opened_by,
            'opened_at' => $this->opened_at?->toIso8601String(),
            'last_activity_at' => $this->last_activity_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
            'subject_user_id' => $this->subject_user_id,
            'pos_session_id' => $this->pos_session_id,
            'cart_id' => $this->cart_id,
            'correlation_id' => $this->correlation_id,
            'amount_under_review' => Money::toRiyal((int) $this->amount_under_review_minor),
            'amount_under_review_minor' => (int) $this->amount_under_review_minor,
            'confirmed_loss' => $this->confirmed_loss_minor !== null ? Money::toRiyal((int) $this->confirmed_loss_minor) : null,
            'confirmed_loss_minor' => $this->confirmed_loss_minor !== null ? (int) $this->confirmed_loss_minor : null,
            'recovered_amount' => $this->recovered_amount_minor !== null ? Money::toRiyal((int) $this->recovered_amount_minor) : null,
            'recovered_amount_minor' => $this->recovered_amount_minor !== null ? (int) $this->recovered_amount_minor : null,
            'outcome' => $this->outcome,
            'resolution_reason' => $this->resolution_reason,
            'resolution_summary' => $this->resolution_summary,
            'created_at' => $this->created_at?->toIso8601String(),
            'owner' => $this->whenLoaded('owner', fn () => $this->owner ? ['id' => $this->owner->id, 'name' => $this->owner->name] : null),
            'opened_by_user' => $this->whenLoaded('openedByUser', fn () => $this->openedByUser ? ['id' => $this->openedByUser->id, 'name' => $this->openedByUser->name] : null),
            'subject' => $this->whenLoaded('subject', fn () => $this->subject ? ['id' => $this->subject->id, 'name' => $this->subject->name] : null),
            'session' => $this->whenLoaded('session', fn () => $this->session ? ['id' => $this->session->id, 'number' => $this->session->number] : null),
            'evidence_links' => PosCaseEvidenceLinkResource::collection($this->whenLoaded('evidenceLinks')),
            'notes' => PosCaseNoteResource::collection($this->whenLoaded('notes')),
            'activities' => PosCaseActivityResource::collection($this->whenLoaded('activities')),
            'cctv_bookmarks' => PosCctvBookmarkResource::collection($this->whenLoaded('cctvBookmarks')),
        ];
    }
}
