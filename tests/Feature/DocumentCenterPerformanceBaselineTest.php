<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentRetentionPolicy;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentRetentionPlanner;
use App\Services\DocumentCenter\DocumentRetentionRunner;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Baseline PR-13: حدود الاستعلامات أهم من زمن CI؛ لا يستخدم provider أو queue أو تخزين خارجي.
 */
class DocumentCenterPerformanceBaselineTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @test */
    public function document_center_operations_remain_paginated_and_query_bounded_with_one_thousand_batches(): void
    {
        $auth = $this->registerTenant('document-performance', 'owner@document-performance.test');
        $branchId = (string) Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']),
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'document-center-performance-baseline',
            (string) Str::uuid(),
        );
        Branch::create(['tenant_id' => $auth['tenant_id'], 'code' => 'PERF-SECONDARY', 'name' => 'Performance secondary branch']);

        $batchIds = $this->seedBatches($auth['tenant_id'], $branchId, 1000);
        $this->seedUsageAndGovernanceEvidence($auth['tenant_id'], $branchId, array_slice($batchIds, 0, 25));
        $today = now('UTC')->toDateString();

        [$review, $reviewQueries] = $this->measured(fn () => $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branchId)
            ->getJson('/api/document-batches?per_page=25'));
        $review->assertOk()->assertJsonCount(25, 'data')->assertJsonPath('meta.total', 1000);
        $this->assertLessThanOrEqual(15, $reviewQueries, 'Review list must remain paginated and avoid N+1 queries.');

        [$operations, $operationsQueries] = $this->measured(fn () => $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branchId)
            ->getJson('/api/document-operations?per_page=25'));
        $operations->assertOk()->assertJsonCount(25, 'data.data')->assertJsonPath('data.meta.total', 1000);
        [$operationPageOne, $operationPageOneQueries] = $this->measured(fn () => $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branchId)
            ->getJson('/api/document-operations?per_page=1'));
        $operationPageOne->assertOk()->assertJsonCount(1, 'data.data');
        $this->assertLessThanOrEqual(30, $operationsQueries, 'Operations overview must remain a bounded set of queries.');
        $this->assertLessThanOrEqual($operationPageOneQueries + 4, $operationsQueries, 'Operations overview must not query per batch.');

        [$usage, $usageQueries] = $this->measured(fn () => $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branchId)
            ->getJson("/api/document-usage?from={$today}&to={$today}"));
        $usage->assertOk()->assertJsonPath('data.operations', 25)->assertJsonPath('data.successful_operations', 25);
        $this->assertLessThanOrEqual(15, $usageQueries, 'Usage aggregates must remain a bounded set of grouped queries.');

        [$export, $exportQueries] = $this->measured(fn () => $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branchId)
            ->get("/api/document-audit/export?from={$today}&to={$today}"));
        $export->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $csv = $export->streamedContent();
        $this->assertStringContainsString('source_type', $csv);
        $this->assertLessThanOrEqual(12, $exportQueries, 'Audit export must join source types instead of loading a batch per event.');
        $this->assertLessThanOrEqual(10001, substr_count($csv, "\n"), 'Audit export remains bounded by its 10,000-row contract plus header.');

        $policy = DocumentRetentionPolicy::create([
            'policy_key' => DocumentRetentionPolicy::DEFAULT_KEY,
            'retention_days' => 365,
            'enabled' => true,
            'purge_mode' => 'manual_governed',
        ]);
        [$retention, $retentionQueries] = $this->measured(fn () => (new DocumentRetentionRunner(
            app(DocumentRetentionPlanner::class),
            app(DocumentStorageService::class),
        ))->run($policy, true, CarbonImmutable::now('UTC'), 25));
        $this->assertSame(25, $retention['results']['scanned']);
        $this->assertSame(0, $retention['results']['purged']);
        $this->assertLessThanOrEqual(225, $retentionQueries, 'Retention work remains bounded by the explicit candidate limit.');
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @return array{0:mixed,1:int} */
    private function measured(callable $operation): array
    {
        $queries = 0;
        DB::listen(static function () use (&$queries): void {
            $queries++;
        });

        return [$operation(), $queries];
    }

    /** @return list<string> */
    private function seedBatches(string $tenantId, string $branchId, int $count): array
    {
        $now = now('UTC');
        $rows = [];
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            $id = (string) Str::uuid();
            $ids[] = $id;
            $rows[] = [
                'id' => $id,
                'tenant_id' => $tenantId,
                'branch_id' => $branchId,
                'document_type' => 'purchase_invoice',
                'source_type' => 'manual',
                'status' => 'received',
                'schema_version' => 1,
                'version' => 1,
                'created_by' => null,
                'review_assigned_to' => null,
                'failure_code' => null,
                'failure_message_safe' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($rows, 250) as $chunk) {
            DB::table('document_batches')->insert($chunk);
        }

        return $ids;
    }

    /** @param list<string> $batchIds */
    private function seedUsageAndGovernanceEvidence(string $tenantId, string $branchId, array $batchIds): void
    {
        $now = now('UTC');
        $fileRows = [];
        $runRows = [];
        $attemptRows = [];
        $usageRows = [];
        $governanceRows = [];
        foreach ($batchIds as $index => $batchId) {
            $fileId = (string) Str::uuid();
            $runId = (string) Str::uuid();
            $attemptId = (string) Str::uuid();
            $fileRows[] = [
                'id' => $fileId, 'tenant_id' => $tenantId, 'branch_id' => $branchId, 'document_batch_id' => $batchId,
                'storage_profile' => 'platform', 'object_key' => "performance/{$fileId}", 'original_name' => "fixture-{$index}.png",
                'declared_mime' => 'image/png', 'detected_mime' => 'image/png', 'size_bytes' => 1,
                'page_count' => 1, 'sha256' => hash('sha256', $fileId), 'scan_status' => 'clean', 'scan_provider' => 'fixture',
                'scanned_at' => $now, 'uploaded_by' => null, 'retention_until' => null, 'purged_at' => null,
                'purge_pending_at' => null, 'purge_reason_code' => null, 'document_retention_policy_id' => null,
                'created_at' => $now, 'updated_at' => $now,
            ];
            $runRows[] = [
                'id' => $runId, 'tenant_id' => $tenantId, 'branch_id' => $branchId, 'document_batch_id' => $batchId,
                'document_file_id' => $fileId, 'stage' => 'extraction', 'status' => 'succeeded', 'attempt_count' => 1,
                'job_uuid' => null, 'error_code' => null, 'error_message_safe' => null, 'queued_at' => $now,
                'started_at' => $now, 'finished_at' => $now, 'next_retry_at' => null, 'created_at' => $now, 'updated_at' => $now,
            ];
            $attemptRows[] = [
                'id' => $attemptId, 'tenant_id' => $tenantId, 'branch_id' => $branchId, 'document_batch_id' => $batchId,
                'document_file_id' => $fileId, 'document_processing_run_id' => $runId, 'sequence' => 1, 'provider_key' => 'fixture',
                'model' => 'fixture-model', 'status' => 'succeeded', 'error_code' => null, 'error_message_safe' => null,
                'page_count' => 1, 'input_tokens' => 10, 'output_tokens' => 5, 'provider_request_id' => null,
                'processing_duration_ms' => 1, 'started_at' => $now, 'finished_at' => $now, 'created_at' => $now, 'updated_at' => $now,
            ];
            $usageRows[] = [
                'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'branch_id' => $branchId, 'document_provider_attempt_id' => $attemptId,
                'document_batch_id' => $batchId, 'provider_key' => 'fixture', 'model' => 'fixture-model', 'provider_event_key' => "performance-{$attemptId}",
                'page_count' => 1, 'input_tokens' => 10, 'output_tokens' => 5, 'processing_duration_ms' => 1,
                'currency' => null, 'cost_minor' => null, 'cost_policy_version' => null, 'occurred_at' => $now,
                'created_at' => $now, 'updated_at' => $now,
            ];
        }
        for ($i = 0; $i < 1000; $i++) {
            $batchId = $batchIds[$i % count($batchIds)];
            $governanceRows[] = [
                'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'branch_id' => $branchId,
                'document_batch_id' => $batchId, 'document_file_id' => null, 'document_processing_run_id' => null,
                'document_retention_hold_id' => null, 'document_redaction_overlay_id' => null, 'document_retention_run_id' => null,
                'action' => 'performance_fixture', 'stage' => null, 'status' => 'recorded', 'reason_code' => 'baseline',
                'reason_message_safe' => null, 'actor_type' => 'system', 'actor_id' => null, 'metadata' => json_encode(['fixture' => true]),
                'occurred_at' => $now, 'created_at' => $now, 'updated_at' => $now,
            ];
        }
        DB::table('document_files')->insert($fileRows);
        DB::table('document_processing_runs')->insert($runRows);
        DB::table('document_provider_attempts')->insert($attemptRows);
        DB::table('document_provider_usage_events')->insert($usageRows);
        foreach (array_chunk($governanceRows, 250) as $chunk) {
            DB::table('document_governance_events')->insert($chunk);
        }
    }
}
