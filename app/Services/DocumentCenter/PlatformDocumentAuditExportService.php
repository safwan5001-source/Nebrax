<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentRetentionRun;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Support\SpreadsheetWriter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class PlatformDocumentAuditExportService
{
    public const MAX_ROWS = 10000;

    public function download(CarbonImmutable $from, CarbonImmutable $to, ?PlatformAdministrator $actor): StreamedResponse
    {
        PlatformIntegrationAuditEvent::create([
            'platform_administrator_id' => $actor?->id,
            'integration_key' => 'document_retention',
            'action' => 'audit_exported',
            'changed_keys' => [],
            'occurred_at' => now('UTC'),
        ]);

        return response()->streamDownload(function () use ($from, $to): void {
            SpreadsheetWriter::streamCsv([
                'occurred_at', 'scope', 'tenant_id', 'batch_id', 'event_type', 'stage', 'status', 'reason_code', 'safe_message',
            ], $this->rows($from, $to));
        }, 'platform-document-audit.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'private, no-store']);
    }

    /** @return \Generator<int,array<int,string|null>> */
    private function rows(CarbonImmutable $from, CarbonImmutable $to): \Generator
    {
        $count = 0;
        foreach (DB::table('document_governance_events')->whereBetween('occurred_at', [$from, $to])->orderBy('occurred_at')->cursor() as $event) {
            if (++$count > self::MAX_ROWS) {
                return;
            }
            yield [(string) $event->occurred_at, 'tenant', $event->tenant_id, $event->document_batch_id, $event->action,
                $event->stage, $event->status, $event->reason_code, $event->reason_message_safe];
        }
        foreach (DocumentRetentionRun::query()->whereBetween('created_at', [$from, $to])->orderBy('created_at')->cursor() as $run) {
            if (++$count > self::MAX_ROWS) {
                return;
            }
            yield [$run->created_at?->toIso8601String(), 'platform', null, null, 'retention_run', null, $run->status,
                $run->dry_run ? 'dry_run' : 'apply', $run->error_message_safe];
        }
        foreach (PlatformIntegrationAuditEvent::query()->where('integration_key', 'document_retention')->whereBetween('occurred_at', [$from, $to])->orderBy('occurred_at')->cursor() as $event) {
            if (++$count > self::MAX_ROWS) {
                return;
            }
            yield [$event->occurred_at?->toIso8601String(), 'platform', null, null, $event->action, null, null, null,
                $event->changed_keys === [] ? null : implode('|', $event->changed_keys ?? [])];
        }
    }
}
