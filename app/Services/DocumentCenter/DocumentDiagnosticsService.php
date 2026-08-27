<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentRetentionHold;
use App\Models\DocumentTransactionLink;
use App\Services\PlatformIntegrationResolver;
use App\Services\PlatformIntegrationService;
use App\Support\DocumentProcessingStatus;

final class DocumentDiagnosticsService
{
    public const SCHEMA_VERSION = 'document-diagnostics-v1';

    public const MAX_BYTES = 65536;

    public function __construct(
        private readonly DocumentProcessingStatusProjector $status,
        private readonly PlatformIntegrationService $platform,
        private readonly PlatformIntegrationResolver $settings,
        private readonly DocumentRetentionPolicyService $retention,
    ) {}

    /** @return array<string,mixed> */
    public function tenant(DocumentBatch $batch): array
    {
        $files = $batch->files()->orderBy('created_at')->get();
        $runs = DocumentProcessingRun::query()->where('document_batch_id', $batch->id)->orderBy('updated_at')->get();
        $links = DocumentTransactionLink::query()->where('document_batch_id', $batch->id)->get();
        $holds = DocumentRetentionHold::query()->active()->where(function ($query) use ($batch, $files): void {
            $query->where('document_batch_id', $batch->id)->orWhereIn('document_file_id', $files->pluck('id'));
        })->get();
        $policy = $this->retention->effective();
        $firstFile = $files->first();
        $snapshot = [
            'schema_version' => self::SCHEMA_VERSION,
            'generated_at' => now('UTC')->toIso8601String(),
            'scope' => [
                'tenant_id' => $batch->tenant_id,
                'branch_id' => $batch->branch_id,
                'application' => ['key' => 'document_center.core', 'state' => 'entitlement_checked'],
            ],
            'document' => [
                'batch_id' => $batch->id,
                'document_type' => $batch->document_type,
                'workflow_status' => $batch->status->value,
                'workflow_version' => $batch->version,
                'created_at' => $batch->created_at?->toIso8601String(),
                'updated_at' => $batch->updated_at?->toIso8601String(),
                'processing_status' => $this->status->project($batch, $firstFile, $runs, $this->settings->documentExtractionPolicy()->enabled()),
                'files' => $files->map(fn ($file) => [
                    'file_id' => $file->id,
                    'scan_status' => $file->scan_status->value,
                    'purged_at' => $file->purged_at?->toIso8601String(),
                    'retention_until' => $file->retention_until?->toIso8601String(),
                ])->all(),
                'processing_runs' => $runs->map(fn (DocumentProcessingRun $run) => [
                    'run_id' => $run->id,
                    'stage' => $run->stage,
                    'status' => $run->status->value,
                    'attempt_count' => $run->attempt_count,
                    'safe_error_code' => $run->error_code,
                    'safe_error_message' => $run->error_message_safe,
                    'updated_at' => $run->updated_at?->toIso8601String(),
                    'retry_candidate' => $run->status === DocumentProcessingStatus::FAILED,
                ])->all(),
                'source' => ['type' => $batch->source_type],
                'linked_transactions' => $links->map(fn (DocumentTransactionLink $link) => [
                    'type' => $link->transaction_type,
                    'id' => $link->transaction_id,
                    'status' => $link->status,
                ])->all(),
            ],
            'retention' => [
                'enabled' => $policy['enabled'],
                'retention_days' => $policy['retention_days'],
                'purge_mode' => $policy['purge_mode'],
                'active_hold_count' => $holds->count(),
                'holds' => $holds->map(fn (DocumentRetentionHold $hold) => [
                    'hold_id' => $hold->id,
                    'reason_code' => $hold->reason_code,
                    'created_at' => $hold->created_at?->toIso8601String(),
                ])->all(),
            ],
        ];

        return $this->bounded($snapshot);
    }

    /** @return array<string,mixed> */
    public function platform(): array
    {
        $runtime = $this->platform->runtime();
        $snapshot = [
            'schema_version' => self::SCHEMA_VERSION,
            'generated_at' => now('UTC')->toIso8601String(),
            'scope' => ['kind' => 'platform'],
            'runtime' => [
                'queue_configured' => (bool) ($runtime['queue_configured'] ?? false),
                'queue_mode' => config('queue.default') === 'sync' ? 'synchronous' : 'asynchronous',
                'worker_online' => (bool) ($runtime['worker_online'] ?? false),
                'heartbeat_at' => $runtime['worker_last_seen_at'] ?? null,
                'scanner_ready' => $this->settings->activeConfiguration('malware_scanner') !== [],
                'processing_ready' => $this->settings->activeConfiguration('document_processing') !== [],
                'provider_configured' => $this->settings->documentExtractionPolicy()->enabled(),
                'provider_network_locked' => ! DocumentProviderNetworkGate::allowsExternalRequests(),
                'runs' => [
                    'queued' => (int) ($runtime['queued_runs'] ?? 0),
                    'running' => (int) ($runtime['running_runs'] ?? 0),
                    'failed' => (int) ($runtime['failed_runs'] ?? 0),
                ],
            ],
        ];

        return $this->bounded($snapshot);
    }

    /** @param array<string,mixed> $snapshot
     * @return array<string,mixed>
     */
    private function bounded(array $snapshot): array
    {
        $json = json_encode($snapshot, JSON_THROW_ON_ERROR);
        if (strlen($json) > self::MAX_BYTES) {
            throw new \RuntimeException('Diagnostic snapshot exceeds the safe size limit.');
        }

        return $snapshot;
    }
}
