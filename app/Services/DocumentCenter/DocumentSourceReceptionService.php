<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentChannelIdentity;
use App\Models\DocumentFile;
use App\Models\DocumentSourceAuditEvent;
use App\Models\DocumentSourceReceiptRecord;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * يستقبل مغلفاً داخلياً موثوقاً فقط. لا يفك payload شبكياً ولا يقبل tenant/branch
 * من المصدر؛ يثبت النطاق من هوية القناة قبل المرور بمسار intake القائم.
 */
final class DocumentSourceReceptionService
{
    public function __construct(
        private readonly DocumentChannelIdentityResolver $identities,
        private readonly DocumentSourceAccessGate $access,
        private readonly DocumentFileInspector $inspector,
        private readonly DocumentFileIntakeService $intake,
        private readonly DocumentStorageService $storage,
        private readonly DocumentSourceAuditLogger $audit,
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
    ) {}

    public function receive(DocumentSourceEnvelope $envelope): DocumentSourceReceipt
    {
        if (! $envelope->channel->isInternallySupported()) {
            throw new DocumentSourceException(DocumentSourceException::NOT_SUPPORTED);
        }

        $identity = $this->identities->resolveFingerprint(
            $envelope->channel,
            $envelope->identity->external_identity_fingerprint,
            $envelope->actor,
        );
        $this->access->assertCanReceive($envelope->actor, $identity);
        if ($identity->status !== DocumentChannelIdentity::STATUS_ACTIVE) {
            $this->inIdentityScope($identity, function () use ($identity, $envelope): void {
                $this->audit->record(
                    DocumentSourceAuditEvent::REJECTED,
                    $identity,
                    actor: $envelope->actor,
                    reason: DocumentSourceException::IDENTITY_DISABLED,
                    metadata: $this->auditMetadata($identity, $envelope),
                );
            });
            throw new DocumentSourceException(DocumentSourceException::IDENTITY_DISABLED);
        }

        return $this->inIdentityScope($identity, function () use ($identity, $envelope): DocumentSourceReceipt {
            try {
                $inspected = $this->inspector->inspect($envelope->uploadedFile);
            } catch (Throwable $exception) {
                $this->audit->record(
                    DocumentSourceAuditEvent::REJECTED,
                    $identity,
                    actor: $envelope->actor,
                    reason: DocumentSourceException::INTAKE_REJECTED,
                    metadata: $this->auditMetadata($identity, $envelope),
                );
                throw new DocumentSourceException(DocumentSourceException::INTAKE_REJECTED);
            }

            $file = null;
            try {
                $outcome = DB::transaction(function () use ($identity, $envelope, $inspected, &$file): DocumentSourceReceipt|DocumentSourceReceiptRecord {
                    // يقفل هذا الصف المرساة المشتركة قبل أي كتابة تخزين؛ لذلك لا تصل
                    // محاولتان متزامنتان إلى intake للمرجع نفسه في الوقت ذاته.
                    $lockedIdentity = DocumentChannelIdentity::query()
                        ->lockForUpdate()
                        ->findOrFail($identity->id);
                    if ($lockedIdentity->status !== DocumentChannelIdentity::STATUS_ACTIVE) {
                        throw new DocumentSourceException(DocumentSourceException::IDENTITY_DISABLED);
                    }
                    $existing = $this->receiptFor($lockedIdentity, $envelope);
                    if ($existing !== null) {
                        // قرار فقط: يسجل التعارض بعد commit حتى لا يسحبه rollback.
                        return $existing;
                    }

                    $batch = DocumentBatch::create([
                        'document_type' => $envelope->documentType,
                        'source_type' => $envelope->channel->value,
                        'created_by' => $envelope->actor->id,
                    ]);
                    $file = $this->intake->ingest($batch, $envelope->uploadedFile, $envelope->actor->id);
                    $batch = $this->intake->complete($batch->fresh(), $envelope->actor->id);
                    $receipt = DocumentSourceReceiptRecord::create([
                        'document_channel_identity_id' => $lockedIdentity->id,
                        'channel' => $envelope->channel->value,
                        'external_reference_fingerprint' => $envelope->externalReferenceFingerprint(),
                        'external_reference_masked' => $envelope->externalReferenceMasked(),
                        'content_sha256' => $inspected->sha256,
                        'document_batch_id' => $batch->id,
                        'document_file_id' => $file->id,
                        'received_by' => $envelope->actor->id,
                        'received_at' => now('UTC'),
                    ]);
                    $audit = $this->audit->record(
                        DocumentSourceAuditEvent::RECEIVED,
                        $lockedIdentity,
                        $receipt,
                        $batch,
                        $envelope->actor,
                        metadata: $this->auditMetadata($lockedIdentity, $envelope),
                    );

                    return new DocumentSourceReceipt($batch, $file, $audit->id, false);
                }, 3);
            } catch (QueryException $exception) {
                $this->cleanUpStoredFile($file);
                $winning = $this->receiptFor($identity, $envelope);
                if ($winning !== null) {
                    return $this->replayOrConflict($identity, $envelope, $winning, $inspected->sha256);
                }

                throw new DocumentSourceException(DocumentSourceException::INTAKE_REJECTED);
            } catch (Throwable $exception) {
                $this->cleanUpStoredFile($file);
                if ($exception instanceof DocumentSourceException) {
                    throw $exception;
                }
                $this->audit->record(
                    DocumentSourceAuditEvent::REJECTED,
                    $identity,
                    actor: $envelope->actor,
                    reason: DocumentSourceException::INTAKE_REJECTED,
                    metadata: $this->auditMetadata($identity, $envelope),
                );
                throw new DocumentSourceException(DocumentSourceException::INTAKE_REJECTED);
            }

            if ($outcome instanceof DocumentSourceReceiptRecord) {
                return $this->replayOrConflict($identity, $envelope, $outcome, $inspected->sha256);
            }

            return $outcome;
        });
    }

    private function receiptFor(DocumentChannelIdentity $identity, DocumentSourceEnvelope $envelope): ?DocumentSourceReceiptRecord
    {
        return DocumentSourceReceiptRecord::query()
            ->where('document_channel_identity_id', $identity->id)
            ->where('channel', $envelope->channel->value)
            ->where('external_reference_fingerprint', $envelope->externalReferenceFingerprint())
            ->with(['batch', 'file'])
            ->first();
    }

    private function replayOrConflict(
        DocumentChannelIdentity $identity,
        DocumentSourceEnvelope $envelope,
        DocumentSourceReceiptRecord $existing,
        string $checksum,
    ): DocumentSourceReceipt {
        if (! hash_equals($existing->content_sha256, $checksum)) {
            $this->audit->record(
                DocumentSourceAuditEvent::CONFLICT_REJECTED,
                $identity,
                $existing,
                $existing->batch,
                $envelope->actor,
                DocumentSourceException::REFERENCE_CONFLICT,
                $this->auditMetadata($identity, $envelope),
            );
            throw new DocumentSourceException(DocumentSourceException::REFERENCE_CONFLICT);
        }

        $audit = $this->audit->record(
            DocumentSourceAuditEvent::REPLAYED,
            $identity,
            $existing,
            $existing->batch,
            $envelope->actor,
            metadata: $this->auditMetadata($identity, $envelope),
        );

        return new DocumentSourceReceipt($existing->batch, $existing->file, $audit->id, true);
    }

    private function cleanUpStoredFile(?DocumentFile $file): void
    {
        if ($file === null) {
            return;
        }

        try {
            $this->storage->delete($file->storage_profile, $file->object_key);
        } catch (Throwable) {
            // لا يغطي هذا catch فشل التخزين نفسه؛ تنفذ خدمة intake تعويضها حينها.
            // أعيدت معاملة DB بالفعل، ولا نكتب receipt نجاح كاذباً.
        }
    }

    /** @template T @param callable():T $callback @return T */
    private function inIdentityScope(DocumentChannelIdentity $identity, callable $callback): mixed
    {
        $tenantId = $this->tenantContext->id();
        $branchId = $this->branchContext->id();
        $this->tenantContext->set($identity->tenant_id);
        $this->branchContext->set($identity->branch_id);

        try {
            return $callback();
        } finally {
            $tenantId === null ? $this->tenantContext->forget() : $this->tenantContext->set($tenantId);
            $branchId === null ? $this->branchContext->forget() : $this->branchContext->set($branchId);
        }
    }

    /** @return array<string, string> */
    private function auditMetadata(DocumentChannelIdentity $identity, DocumentSourceEnvelope $envelope): array
    {
        return [
            'channel' => $envelope->channel->value,
            'reference_masked' => $envelope->externalReferenceMasked(),
            'identity_label' => $identity->external_identity_masked,
        ];
    }
}
