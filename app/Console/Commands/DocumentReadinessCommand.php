<?php

namespace App\Console\Commands;

use App\Services\DocumentCenter\DocumentDiagnosticsService;
use App\Services\DocumentCenter\DocumentProviderNetworkGate;
use App\Support\ApplicationCatalog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

/** يعرض جاهزية الكود المحايدة؛ لا يجري اختبار اتصال أو كتابة أو حذف. */
final class DocumentReadinessCommand extends Command
{
    private const SCHEMA_VERSION = 'document-readiness-v1';

    /** @var list<string> */
    private const REQUIRED_TABLES = [
        'jobs',
        'document_batches',
        'document_workflow_events',
        'document_files',
        'document_processing_runs',
        'document_provider_attempts',
        'document_extraction_results',
        'document_match_results',
        'document_match_candidates',
        'document_issues',
        'document_review_changes',
        'document_review_actions',
        'document_transaction_links',
        'document_channel_identities',
        'document_source_receipts',
        'document_source_audit_events',
        'document_retention_policies',
        'document_retention_runs',
        'document_retention_holds',
        'document_redaction_overlays',
        'document_governance_events',
        'document_provider_usage_events',
    ];

    protected $signature = 'documents:readiness {--json : Print the machine-readable snapshot only}';

    protected $description = 'Report non-destructive Document Center Stage 0 code readiness without external checks.';

    public function handle(DocumentDiagnosticsService $diagnostics): int
    {
        $tables = collect(self::REQUIRED_TABLES)
            ->mapWithKeys(fn (string $table): array => [$table => Schema::hasTable($table)])
            ->all();
        $missingTables = array_keys(array_filter($tables, fn (bool $exists): bool => ! $exists));
        $capability = ApplicationCatalog::find('document_center.core');
        $runtime = $diagnostics->platform()['runtime'] ?? [];
        $snapshot = [
            'schema_version' => self::SCHEMA_VERSION,
            'status' => $missingTables === [] && $capability !== null && ($capability['maturity'] ?? null) === ApplicationCatalog::MATURITY_BUILT
                ? 'ready_for_inert_code'
                : 'missing_required_code_or_schema',
            'code' => [
                'document_center_capability_built' => $capability !== null && ($capability['maturity'] ?? null) === ApplicationCatalog::MATURITY_BUILT,
                'provider_network_locked' => ! DocumentProviderNetworkGate::allowsExternalRequests(),
                'durable_storage_enabled' => (bool) config('document_center.storage.persistent_enabled', false),
            ],
            'schema' => [
                'all_required_tables_present' => $missingTables === [],
                'missing_tables' => $missingTables,
                'failed_jobs_present' => Schema::hasTable('failed_jobs'),
            ],
            'runtime' => [
                'queue_mode' => $runtime['queue_mode'] ?? 'unknown',
                'queue_configured' => (bool) ($runtime['queue_configured'] ?? false),
                'worker_online' => (bool) ($runtime['worker_online'] ?? false),
                'scanner_ready' => (bool) ($runtime['scanner_ready'] ?? false),
                'processing_ready' => (bool) ($runtime['processing_ready'] ?? false),
                'provider_configured' => (bool) ($runtime['provider_configured'] ?? false),
            ],
            'stage_0' => [
                'external_activation_configured' => false,
                'note' => 'External activation is intentionally not configured in Stage 0.',
            ],
        ];

        $json = (string) json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if ((bool) $this->option('json')) {
            $this->line($json);
        } else {
            $this->info($snapshot['status']);
            $this->line($json);
        }

        return $snapshot['status'] === 'ready_for_inert_code' ? self::SUCCESS : self::FAILURE;
    }
}
