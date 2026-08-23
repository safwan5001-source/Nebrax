<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentWorkflowEvent;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

class DocumentWorkflowService
{
    /** @var array<string, list<DocumentWorkflowStatus>> */
    private const TRANSITIONS = [
        'draft' => [DocumentWorkflowStatus::RECEIVING, DocumentWorkflowStatus::CANCELLED],
        'receiving' => [DocumentWorkflowStatus::RECEIVED, DocumentWorkflowStatus::FAILED, DocumentWorkflowStatus::QUARANTINED, DocumentWorkflowStatus::CANCELLED],
        'received' => [DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::NEEDS_REVIEW, DocumentWorkflowStatus::QUARANTINED, DocumentWorkflowStatus::DUPLICATE, DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED],
        'queued' => [DocumentWorkflowStatus::PROCESSING, DocumentWorkflowStatus::FAILED, DocumentWorkflowStatus::CANCELLED],
        'processing' => [DocumentWorkflowStatus::NEEDS_REVIEW, DocumentWorkflowStatus::READY_FOR_DRAFT, DocumentWorkflowStatus::FAILED, DocumentWorkflowStatus::QUARANTINED],
        'needs_review' => [DocumentWorkflowStatus::READY_FOR_DRAFT, DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED],
        'ready_for_draft' => [DocumentWorkflowStatus::CREATING_DRAFT, DocumentWorkflowStatus::NEEDS_REVIEW, DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED],
        'creating_draft' => [DocumentWorkflowStatus::DRAFT_CREATED, DocumentWorkflowStatus::FAILED, DocumentWorkflowStatus::NEEDS_REVIEW],
        'draft_created' => [DocumentWorkflowStatus::ARCHIVED],
        'failed' => [DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::NEEDS_REVIEW, DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED],
        'quarantined' => [DocumentWorkflowStatus::RECEIVING, DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED],
        'duplicate' => [DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED],
        'cancelled' => [DocumentWorkflowStatus::ARCHIVED],
        'archived' => [],
    ];

    public function transition(
        DocumentBatch $batch,
        DocumentWorkflowStatus $to,
        string $event,
        string $actorType,
        ?string $actorId = null,
        ?string $reason = null,
        array $metadata = [],
    ): DocumentBatch {
        $this->assertAuditText($event, $actorType, $reason);
        $safeMetadata = $this->sanitizeMetadata($metadata);

        return DB::transaction(function () use ($batch, $to, $event, $actorType, $actorId, $reason, $safeMetadata): DocumentBatch {
            $locked = DocumentBatch::query()->whereKey($batch->getKey())->lockForUpdate()->firstOrFail();
            $from = $locked->status;

            if (! $this->allows($from, $to)) {
                throw ValidationException::withMessages([
                    'status' => "Transition from {$from->value} to {$to->value} is not allowed.",
                ]);
            }

            $expectedVersion = $batch->version;
            $updated = DocumentBatch::query()
                ->whereKey($locked->getKey())
                ->where('version', $expectedVersion)
                ->update([
                    'status' => $to->value,
                    'version' => $expectedVersion + 1,
                    'updated_at' => now('UTC'),
                ]);

            if ($updated !== 1) {
                throw ValidationException::withMessages(['version' => 'Document batch changed concurrently.']);
            }

            DocumentWorkflowEvent::create([
                'tenant_id' => $locked->tenant_id,
                'branch_id' => $locked->branch_id,
                'document_batch_id' => $locked->id,
                'from_status' => $from->value,
                'to_status' => $to->value,
                'event' => $event,
                'actor_type' => $actorType,
                'actor_id' => $actorId,
                'reason' => $reason,
                'metadata' => $safeMetadata === [] ? null : $safeMetadata,
                'occurred_at' => now('UTC'),
            ]);

            return $locked->fresh();
        }, 3);
    }

    public function allows(DocumentWorkflowStatus $from, DocumentWorkflowStatus $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from->value], true);
    }

    /** @return list<DocumentWorkflowStatus> */
    public function allowedFrom(DocumentWorkflowStatus $from): array
    {
        return self::TRANSITIONS[$from->value];
    }

    private function assertAuditText(string $event, string $actorType, ?string $reason): void
    {
        if ($event === '' || mb_strlen($event) > 64 || $actorType === '' || mb_strlen($actorType) > 64) {
            throw new InvalidArgumentException('Workflow event and actor type must be present and bounded.');
        }
        if ($reason !== null && mb_strlen($reason) > 500) {
            throw new InvalidArgumentException('Workflow reason is too long.');
        }
    }

    private function sanitizeMetadata(array $metadata): array
    {
        $blocked = ['password', 'secret', 'token', 'credential', 'authorization', 'raw', 'payload'];
        $walk = function (array $values) use (&$walk, $blocked): array {
            $safe = [];
            foreach ($values as $key => $value) {
                if (is_string($key) && in_array(strtolower($key), $blocked, true)) {
                    throw new InvalidArgumentException("Sensitive workflow metadata key is not allowed: {$key}");
                }
                if (is_array($value)) {
                    $safe[$key] = $walk($value);
                } elseif (is_scalar($value) || $value === null) {
                    $safe[$key] = $value;
                } else {
                    throw new InvalidArgumentException('Workflow metadata must contain JSON-safe scalar values only.');
                }
            }
            return $safe;
        };

        $safe = $walk($metadata);
        if (strlen((string) json_encode($safe, JSON_THROW_ON_ERROR)) > 16384) {
            throw new InvalidArgumentException('Workflow metadata exceeds the safe audit limit.');
        }
        return $safe;
    }
}
