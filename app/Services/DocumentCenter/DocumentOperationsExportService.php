<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentWorkflowEvent;
use App\Models\User;
use App\Support\SpreadsheetWriter;
use Carbon\CarbonImmutable;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class DocumentOperationsExportService
{
    public const MAX_ROWS = 10000;

    public function __construct(private readonly DocumentUsageReportingService $usage) {}

    /** @param array{from:CarbonImmutable,to:CarbonImmutable,provider?:?string,model?:?string,document_type?:?string} $filters */
    public function usage(array $filters, ?User $actor): StreamedResponse
    {
        $this->event(DocumentGovernanceEvent::ACTION_USAGE_EXPORTED, $actor, ['export_scope' => 'usage', 'row_limit' => self::MAX_ROWS]);

        return response()->streamDownload(function () use ($filters): void {
            SpreadsheetWriter::streamCsv([
                'occurred_at', 'batch_id', 'document_type', 'provider', 'model', 'pages',
                'input_tokens', 'output_tokens', 'processing_duration_ms', 'currency', 'cost_minor', 'cost_policy_version',
            ], $this->bounded($this->usage->exportRows($filters)));
        }, 'document-usage.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'private, no-store']);
    }

    /** @param array{from:CarbonImmutable,to:CarbonImmutable} $filters */
    public function audit(array $filters, ?User $actor): StreamedResponse
    {
        $this->event(DocumentGovernanceEvent::ACTION_AUDIT_EXPORTED, $actor, ['export_scope' => 'audit', 'row_limit' => self::MAX_ROWS]);

        return response()->streamDownload(function () use ($filters): void {
            SpreadsheetWriter::streamCsv([
                'occurred_at', 'batch_id', 'event_type', 'stage', 'status', 'actor_type', 'actor_id', 'reason_code', 'safe_message', 'source_type',
            ], $this->bounded($this->auditRows($filters)));
        }, 'document-audit.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'private, no-store']);
    }

    /** @param \Generator<int,array<int,string|int|null>> $rows
     * @return \Generator<int,array<int,string|int|null>>
     */
    private function bounded(\Generator $rows): \Generator
    {
        $count = 0;
        foreach ($rows as $row) {
            if (++$count > self::MAX_ROWS) {
                return;
            }
            yield $row;
        }
    }

    /** @param array{from:CarbonImmutable,to:CarbonImmutable} $filters
     * @return \Generator<int,array<int,string|null>>
     */
    private function auditRows(array $filters): \Generator
    {
        $governance = DocumentGovernanceEvent::query()->whereBetween('occurred_at', [$filters['from'], $filters['to']])
            ->orderBy('occurred_at')->cursor();
        foreach ($governance as $event) {
            $batch = $event->batch()->first();
            yield [
                $event->occurred_at?->toIso8601String(), $event->document_batch_id, $event->action,
                $event->stage, $event->status, $event->actor_type, $event->actor_id,
                $event->reason_code, $event->reason_message_safe, $batch?->source_type,
            ];
        }
        $workflow = DocumentWorkflowEvent::query()->whereBetween('occurred_at', [$filters['from'], $filters['to']])
            ->orderBy('occurred_at')->cursor();
        foreach ($workflow as $event) {
            $batch = $event->batch()->first();
            yield [
                $event->occurred_at?->toIso8601String(), $event->document_batch_id, $event->event,
                null, $event->to_status?->value, $event->actor_type, $event->actor_id,
                null, $event->reason, $batch?->source_type,
            ];
        }
    }

    /** @param array<string,mixed> $metadata */
    private function event(string $action, ?User $actor, array $metadata): void
    {
        DocumentGovernanceEvent::create([
            'action' => $action,
            'actor_type' => $actor === null ? 'system' : 'user',
            'actor_id' => $actor?->id,
            'metadata' => $metadata,
        ]);
    }
}
