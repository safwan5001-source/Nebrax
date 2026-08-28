<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosCaseEvidenceLinkResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'case_id' => $this->case_id,
            'pos_exception_id' => $this->pos_exception_id,
            'pos_session_event_id' => $this->pos_session_event_id,
            'link_type' => $this->link_type,
            'rationale' => $this->rationale,
            'linked_by' => $this->linked_by,
            'linked_at' => $this->linked_at?->toIso8601String(),
            'unlinked_by' => $this->unlinked_by,
            'unlinked_at' => $this->unlinked_at?->toIso8601String(),
            'exception' => $this->whenLoaded('exception', fn () => $this->exception ? new PosExceptionResource($this->exception) : null),
            'event' => $this->whenLoaded('event', fn () => $this->event ? new PosSessionEventResource($this->event) : null),
        ];
    }
}
