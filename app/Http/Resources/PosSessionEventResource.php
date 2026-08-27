<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosSessionEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'pos_session_id' => $this->pos_session_id,
            'branch_id' => $this->branch_id,
            'cart_id' => $this->cart_id,
            'correlation_id' => $this->correlation_id,
            'type' => $this->type,
            'category' => $this->category,
            'actor_id' => $this->actor_id,
            'performed_by' => $this->performed_by,
            'approved_by' => $this->approved_by,
            'amount' => $this->amount !== null ? \App\Support\Money::toRiyal((int) $this->amount) : null,
            'reason_code' => $this->reason_code,
            'reason_note' => $this->reason_note,
            'payload' => $this->payload,
            'created_at' => $this->created_at?->toIso8601String(),
            'actor' => $this->whenLoaded('actor', fn () => $this->actor ? [
                'id' => $this->actor->id,
                'name' => $this->actor->name,
            ] : null),
            'performed_by_user' => $this->whenLoaded('performedBy', fn () => $this->performedBy ? [
                'id' => $this->performedBy->id,
                'name' => $this->performedBy->name,
            ] : null),
            'approved_by_user' => $this->whenLoaded('approvedBy', fn () => $this->approvedBy ? [
                'id' => $this->approvedBy->id,
                'name' => $this->approvedBy->name,
            ] : null),
            'session' => $this->whenLoaded('session', fn () => $this->session ? [
                'id' => $this->session->id,
                'number' => $this->session->number,
                'device' => $this->session->posDevice ? [
                    'id' => $this->session->posDevice->id,
                    'name' => $this->session->posDevice->name,
                    'code' => $this->session->posDevice->code,
                ] : null,
            ] : null),
        ];
    }
}
