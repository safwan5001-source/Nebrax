<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentChannelIdentity;
use App\Models\DocumentSourceAuditEvent;
use App\Models\DocumentSourceReceiptRecord;
use App\Models\User;
use InvalidArgumentException;

final class DocumentSourceAuditLogger
{
    /** @param array<string, mixed> $metadata */
    public function record(
        string $event,
        DocumentChannelIdentity $identity,
        ?DocumentSourceReceiptRecord $receipt = null,
        ?DocumentBatch $batch = null,
        ?User $actor = null,
        ?string $reason = null,
        array $metadata = [],
    ): DocumentSourceAuditEvent {
        if (! in_array($event, [
            DocumentSourceAuditEvent::RECEIVED,
            DocumentSourceAuditEvent::REPLAYED,
            DocumentSourceAuditEvent::CONFLICT_REJECTED,
            DocumentSourceAuditEvent::REJECTED,
            DocumentSourceAuditEvent::IDENTITY_CREATED,
            DocumentSourceAuditEvent::IDENTITY_DISABLED,
            DocumentSourceAuditEvent::IDENTITY_ENABLED,
        ], true)) {
            throw new InvalidArgumentException('Unsupported document source audit event.');
        }

        $reason = $reason === null ? null : mb_substr(trim($reason), 0, 500);

        return DocumentSourceAuditEvent::create([
            'document_channel_identity_id' => $identity->id,
            'document_source_receipt_id' => $receipt?->id,
            'document_batch_id' => $batch?->id,
            'event' => $event,
            'reason_safe' => $reason === '' ? null : $reason,
            'metadata' => DocumentSourceEnvelope::sanitizeMetadata($metadata) ?: null,
            'performed_by' => $actor?->id,
            'occurred_at' => now('UTC'),
        ]);
    }
}
