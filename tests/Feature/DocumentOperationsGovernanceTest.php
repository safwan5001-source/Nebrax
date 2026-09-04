<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\DocumentRetentionHold;
use App\Models\DocumentRetentionPolicy;
use App\Models\DocumentReviewAction;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentGovernanceService;
use App\Services\DocumentCenter\DocumentRedactionProjector;
use App\Services\DocumentCenter\DocumentRetentionPlanner;
use App\Services\DocumentCenter\DocumentRetentionRunner;
use App\Services\DocumentCenter\DocumentRetryService;
use App\Services\DocumentCenter\DocumentFileScanAdmissionService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\EntitlementGrantService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentOperationsGovernanceTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private string $png;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('queue.default', 'sync');
        Queue::fake();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function an_extraction_retry_fails_closed_when_the_provider_network_gate_is_locked(): void
    {
        $auth = $this->authorizedTenant('retry-gate');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC')])->save();
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction',
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 0, 'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'extraction_failed', 'error_message_safe' => 'فشل سابق آمن.',
        ]);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->updated_at->toIso8601String(),
        ])->assertStatus(422)->assertJsonPath('data.code', 'document_retry_network_locked');

        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        $this->assertDatabaseHas('document_governance_events', ['document_processing_run_id' => $run->id, 'action' => 'retry_rejected', 'reason_code' => 'document_retry_network_locked']);
        Queue::assertNothingPushed();
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function a_retry_dispatch_failure_restores_the_run_to_a_retryable_failed_state(): void
    {
        $auth = $this->authorizedTenant('retry-dispatch-failure');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'safety_scan',
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 0, 'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'scan_failed', 'error_message_safe' => 'فشل سابق آمن.',
        ]);
        $settings = \Mockery::mock(PlatformIntegrationResolver::class);
        $settings->shouldReceive('processingPolicy')->andReturn(['max_attempts' => 3, 'backoff_seconds' => [1], 'timeout_seconds' => 30]);
        $settings->shouldReceive('documentProcessingMode')->andReturn('async');
        $settings->shouldReceive('activeConfiguration')->with('document_processing')->andReturn(['enabled' => true]);
        $settings->shouldReceive('activeConfiguration')->with('malware_scanner')->andReturn(['enabled' => true]);
        config()->set('queue.default', 'database');
        $dispatcher = \Mockery::mock(Dispatcher::class);
        $dispatcher->shouldReceive('dispatch')->once()->andThrow(new \RuntimeException('local fake dispatch failure'));
        $this->app->instance(Dispatcher::class, $dispatcher);

        $result = (new DocumentRetryService($settings, app(DocumentStorageService::class), app(DocumentWorkflowService::class), app(DocumentFileScanAdmissionService::class)))->retry($run, null);

        $this->assertFalse($result['accepted']);
        $this->assertSame(DocumentRetryService::CODE_DISPATCH_FAILED, $result['code']);
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        $this->assertSame(DocumentRetryService::CODE_DISPATCH_FAILED, $run->fresh()->error_code);
        $this->assertDatabaseHas('document_governance_events', ['document_processing_run_id' => $run->id, 'action' => 'retry_rejected', 'reason_code' => DocumentRetryService::CODE_DISPATCH_FAILED]);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_planner_skips_active_hold_and_dry_run_never_purges_object_or_file_metadata(): void
    {
        $auth = $this->authorizedTenant('retention-hold');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch->fresh(), DocumentWorkflowStatus::RECEIVED, 'test_received', 'system');
        $batch = $workflow->transition($batch->fresh(), DocumentWorkflowStatus::ARCHIVED, 'test_archived', 'system');
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC'), 'retention_until' => now('UTC')->subDay()])->save();
        DB::table('document_files')->where('id', $file->id)->update(['created_at' => now('UTC')->subDays(366)]);

        $eligible = app(DocumentRetentionPlanner::class)->decide($file->fresh(), 365, now('UTC')->toImmutable());
        $this->assertSame('eligible', $eligible['reason_code']);
        $this->assertTrue($eligible['eligible']);
        $this->assertFalse(app(DocumentRetentionPlanner::class)->decide($file->fresh(), 730, now('UTC')->toImmutable())['eligible']);

        $run = DocumentProcessingRun::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED, 'queued_at' => now('UTC')]);
        $attempt = DocumentProviderAttempt::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'sequence' => 1, 'provider_key' => 'test', 'model' => 'test', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC')]);
        $evidence = DocumentExtractionResult::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'document_provider_attempt_id' => $attempt->id, 'provider_key' => 'test', 'model' => 'test', 'schema_version' => 'document-schema-v1', 'normalized_payload' => ['schema_version' => 'document-schema-v1', 'fields' => [], 'lines' => []], 'extracted_at' => now('UTC')]);
        DB::table('document_transaction_links')->insert(['id' => (string) Str::uuid(), 'tenant_id' => $auth['tenant_id'], 'branch_id' => $auth['branch_id'], 'document_batch_id' => $batch->id, 'document_extraction_result_id' => $evidence->id, 'transaction_type' => 'purchase', 'transaction_id' => (string) Str::uuid(), 'status' => 'created', 'created_at' => now('UTC'), 'updated_at' => now('UTC')]);
        $linked = app(DocumentRetentionPlanner::class)->decide($file->fresh(), 365, now('UTC')->toImmutable());
        $this->assertFalse($linked['eligible']);
        $this->assertSame('linked_transaction_evidence', $linked['reason_code']);
        DB::table('document_transaction_links')->where('document_batch_id', $batch->id)->delete();

        $hold = app(DocumentGovernanceService::class)->createHold($batch, null, 'legal_review', null);
        $held = app(DocumentRetentionPlanner::class)->decide($file->fresh(), 365, now('UTC')->toImmutable());
        $this->assertFalse($held['eligible']);
        $this->assertSame('active_hold', $held['reason_code']);

        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);
        $result = app(DocumentRetentionRunner::class)->run($policy, true, now('UTC')->toImmutable(), 100);
        $this->assertTrue($result['run']->dry_run);
        $this->assertNull($file->fresh()->purged_at);
        $this->assertNotNull($hold->fresh());
        $this->assertDatabaseHas('document_governance_events', [
            'document_file_id' => $file->id,
            'document_retention_run_id' => $result['run']->id,
            'action' => DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED,
            'status' => 'skipped',
            'reason_code' => 'active_hold',
            'actor_type' => 'system',
            'actor_id' => null,
        ]);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_runner_records_linked_and_not_due_skips_in_their_own_tenant_branch_scopes(): void
    {
        $linkedAuth = $this->authorizedTenant('retention-linked-outcome');
        [$linkedBatch, $linkedFile] = $this->batchWithFile($linkedAuth['token']);
        $this->archiveForRetention($linkedBatch, $linkedFile, true);
        $linkedResult = $this->resultForFile($linkedBatch, $linkedFile);
        DB::table('document_transaction_links')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $linkedAuth['tenant_id'], 'branch_id' => $linkedAuth['branch_id'],
            'document_batch_id' => $linkedBatch->id, 'document_extraction_result_id' => $linkedResult->id,
            'transaction_type' => 'purchase', 'transaction_id' => (string) Str::uuid(), 'status' => 'created',
            'created_at' => now('UTC'), 'updated_at' => now('UTC'),
        ]);

        $notDueAuth = $this->authorizedTenant('retention-not-due-outcome');
        [$notDueBatch, $notDueFile] = $this->batchWithFile($notDueAuth['token']);
        $this->archiveForRetention($notDueBatch, $notDueFile, false);
        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);

        $result = app(DocumentRetentionRunner::class)->run($policy, true, now('UTC')->toImmutable(), 100);

        $this->assertSame(2, $result['results']['scanned']);
        $this->assertSame(0, $result['results']['eligible']);
        $this->assertSame(2, $result['results']['skipped']);
        $events = DocumentGovernanceEvent::withoutGlobalScopes()
            ->where('document_retention_run_id', $result['run']->id)
            ->where('action', DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED)
            ->get()
            ->keyBy('document_file_id');
        $this->assertSame('linked_transaction_evidence', $events[$linkedFile->id]->reason_code);
        $this->assertSame($linkedAuth['tenant_id'], $events[$linkedFile->id]->tenant_id);
        $this->assertSame($linkedAuth['branch_id'], $events[$linkedFile->id]->branch_id);
        $this->assertSame('retention_not_due', $events[$notDueFile->id]->reason_code);
        $this->assertSame($notDueAuth['tenant_id'], $events[$notDueFile->id]->tenant_id);
        $this->assertSame($notDueAuth['branch_id'], $events[$notDueFile->id]->branch_id);

        $tenantCsv = $this->withToken($linkedAuth['token'])->get('/api/document-audit/export')->assertOk()->streamedContent();
        $this->assertStringContainsString(DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED, $tenantCsv);
        $this->assertStringContainsString('linked_transaction_evidence', $tenantCsv);
        $this->assertStringNotContainsString('retention_not_due', $tenantCsv);
        $platform = PlatformAdministrator::create(['name' => 'Retention Export Admin', 'email' => 'retention-export+'.uniqid().'@nebrax.test', 'password' => 'platform-password-123']);
        $platformCsv = $this->withToken($platform->createToken('retention-export', ['platform:manage'])->plainTextToken)->get('/api/platform/document-audit/export')->assertOk()->streamedContent();
        $this->assertStringContainsString('linked_transaction_evidence', $platformCsv);
        $this->assertStringContainsString('retention_not_due', $platformCsv);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_dry_run_records_eligible_outcome_with_platform_actor_without_purging(): void
    {
        $auth = $this->authorizedTenant('retention-dry-run-outcome');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $this->archiveForRetention($batch, $file, true);
        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);
        $actor = PlatformAdministrator::create(['name' => 'Retention Platform Admin', 'email' => 'retention-admin+'.uniqid().'@nebrax.test', 'password' => 'platform-password-123']);

        $result = app(DocumentRetentionRunner::class)->run($policy, true, now('UTC')->toImmutable(), 100, $actor);

        $this->assertSame(1, $result['results']['scanned']);
        $this->assertSame(1, $result['results']['eligible']);
        $this->assertSame(0, $result['results']['purged']);
        $this->assertSame(0, $result['results']['skipped']);
        $this->assertNull($file->fresh()->purged_at);
        $this->assertDatabaseHas('document_governance_events', [
            'document_file_id' => $file->id,
            'document_retention_run_id' => $result['run']->id,
            'action' => DocumentGovernanceEvent::ACTION_RETENTION_DRY_RUN_ELIGIBLE,
            'status' => 'eligible',
            'reason_code' => 'eligible',
            'actor_type' => 'platform_administrator',
            'actor_id' => $actor->id,
        ]);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_apply_records_a_durable_pending_event_before_the_local_fake_storage_effect(): void
    {
        $auth = $this->authorizedTenant('retention-pending');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch->fresh(), DocumentWorkflowStatus::RECEIVED, 'test_received', 'system');
        $workflow->transition($batch->fresh(), DocumentWorkflowStatus::ARCHIVED, 'test_archived', 'system');
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC'), 'retention_until' => now('UTC')->subDay()])->save();
        DB::table('document_files')->where('id', $file->id)->update(['created_at' => now('UTC')->subDays(366)]);
        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);

        $result = app(DocumentRetentionRunner::class)->run($policy, false, now('UTC')->toImmutable(), 100);

        $this->assertSame(1, $result['results']['purged']);
        $this->assertNotNull($file->fresh()->purged_at);
        $this->assertNull($file->fresh()->purge_pending_at);
        $this->assertDatabaseHas('document_governance_events', ['document_file_id' => $file->id, 'action' => 'retention_purge_pending', 'actor_type' => 'system']);
        $this->assertDatabaseHas('document_governance_events', ['document_file_id' => $file->id, 'action' => 'retention_purged', 'actor_type' => 'system']);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED]);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_RETENTION_DRY_RUN_ELIGIBLE]);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_storage_delete_failure_keeps_the_durable_pending_state_and_records_a_safe_event(): void
    {
        $auth = $this->authorizedTenant('retention-storage-failure');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch->fresh(), DocumentWorkflowStatus::RECEIVED, 'test_received', 'system');
        $workflow->transition($batch->fresh(), DocumentWorkflowStatus::ARCHIVED, 'test_archived', 'system');
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC')])->save();
        DB::table('document_files')->where('id', $file->id)->update(['created_at' => now('UTC')->subDays(366)]);
        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);
        $storage = \Mockery::mock(DocumentStorageService::class);
        $storage->shouldReceive('exists')->once()->andReturnTrue();
        $storage->shouldReceive('delete')->once()->andThrow(new \RuntimeException('local fake delete failure'));

        $result = (new DocumentRetentionRunner(app(DocumentRetentionPlanner::class), $storage))->run($policy, false, now('UTC')->toImmutable(), 100);

        $this->assertSame(0, $result['results']['purged']);
        $this->assertNull($file->fresh()->purged_at);
        $this->assertNotNull($file->fresh()->purge_pending_at);
        $this->assertDatabaseHas('document_governance_events', ['document_file_id' => $file->id, 'action' => 'retention_purge_storage_failed', 'status' => 'storage_failed', 'reason_code' => 'storage_delete_failed']);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED]);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_RETENTION_DRY_RUN_ELIGIBLE]);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_database_finalization_failure_preserves_pending_without_retrying_the_storage_effect(): void
    {
        $auth = $this->authorizedTenant('retention-finalization-failure');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $this->archiveForRetention($batch, $file, true);
        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);
        $storage = \Mockery::mock(DocumentStorageService::class);
        $storage->shouldReceive('exists')->once()->andReturnTrue();
        $storage->shouldReceive('delete')->once()->andReturnNull();

        $this->createPurgeFinalizationAbortTrigger();

        try {
            app(DocumentRetentionRunner::class, [
                'planner' => app(DocumentRetentionPlanner::class),
                'storage' => $storage,
            ])->run($policy, false, now('UTC')->toImmutable(), 100);
            $this->fail('Expected the simulated finalization failure to escape for safe recovery.');
        } catch (\Throwable $exception) {
            $this->assertStringContainsString('simulated purge finalization database failure', $exception->getMessage());
        } finally {
            $this->dropPurgeFinalizationAbortTrigger();
        }

        $this->assertNull($file->fresh()->purged_at);
        $this->assertNotNull($file->fresh()->purge_pending_at);
        $this->assertDatabaseHas('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_PURGE_PENDING]);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_PURGED]);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_PURGE_STORAGE_FAILED]);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function retention_cutoff_keeps_an_iso_timestamp_exact_and_expands_a_date_only_value(): void
    {
        $this->assertSame('2026-08-27T10:00:00+00:00', DocumentRetentionRunner::cutoff('2026-08-27T10:00:00+00:00')->toIso8601String());
        $this->assertSame('2026-08-27T23:59:59+00:00', DocumentRetentionRunner::cutoff('2026-08-27')->toIso8601String());
    }

    /** @test */
    public function a_hold_cannot_pair_a_batch_with_a_file_from_another_batch(): void
    {
        $auth = $this->authorizedTenant('hold-batch-file-integrity');
        [$batch] = $this->batchWithFile($auth['token']);
        [, $otherFile] = $this->batchWithFile(
            $auth['token'],
            'retention-other.png',
            base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAB0L9bPAAAADUlEQVR42mP8z8BQDwAFgQH/q842WQAAAABJRU5ErkJggg==', true),
        );

        $this->withToken($auth['token'])->postJson('/api/document-retention-holds', [
            'document_batch_id' => $batch->id,
            'file_id' => $otherFile->id,
            'reason_code' => 'legal_review',
        ])->assertUnprocessable()->assertJsonValidationErrors('file_id');

        $this->assertDatabaseCount('document_retention_holds', 0);
        $this->assertDatabaseCount('document_governance_events', 0);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function a_new_file_or_batch_hold_is_rejected_while_a_purge_claim_is_pending(): void
    {
        $auth = $this->authorizedTenant('retention-pending-hold-rejected');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $this->archiveForRetention($batch, $file, true);
        $file->fill(['purge_pending_at' => now('UTC')])->save();

        $this->withToken($auth['token'])->postJson('/api/document-retention-holds', [
            'document_batch_id' => $batch->id,
            'file_id' => $file->id,
            'reason_code' => 'legal_review',
        ])->assertUnprocessable()->assertJsonValidationErrors('file_id');
        $this->withToken($auth['token'])->postJson('/api/document-retention-holds', [
            'document_batch_id' => $batch->id,
            'reason_code' => 'legal_review',
        ])->assertUnprocessable()->assertJsonValidationErrors('file_id');

        $this->assertDatabaseCount('document_retention_holds', 0);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function an_active_hold_clears_a_recovered_purge_pending_state_without_storage_access(): void
    {
        $auth = $this->authorizedTenant('retention-pending-hold');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $this->archiveForRetention($batch, $file, true);
        $file->fill(['purge_pending_at' => now('UTC')])->save();
        DocumentRetentionHold::create([
            'document_batch_id' => $batch->id,
            'reason_code' => 'legal_review',
        ]);
        $policy = DocumentRetentionPolicy::create(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY, 'retention_days' => 365, 'enabled' => true, 'purge_mode' => 'manual_governed']);
        $storage = \Mockery::mock(DocumentStorageService::class);
        $storage->shouldReceive('exists')->never();
        $storage->shouldReceive('delete')->never();

        $result = (new DocumentRetentionRunner(app(DocumentRetentionPlanner::class), $storage))->run($policy, false, now('UTC')->toImmutable(), 100);

        $this->assertSame(0, $result['results']['purged']);
        $this->assertSame(1, $result['results']['skipped']);
        $this->assertNull($file->fresh()->purge_pending_at);
        $this->assertNull($file->fresh()->purged_at);
        $this->assertDatabaseHas('document_governance_events', ['document_file_id' => $file->id, 'action' => DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED, 'reason_code' => 'active_hold']);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function redaction_overlay_replaces_only_the_display_projection_and_never_mutates_immutable_evidence(): void
    {
        $auth = $this->authorizedTenant('redaction-overlay');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $run = DocumentProcessingRun::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED, 'queued_at' => now('UTC')]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id,
            'sequence' => 1, 'provider_key' => 'test', 'model' => 'test-model', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC'),
        ]);
        $payload = ['schema_version' => 'document-schema-v1', 'fields' => ['issuer_name' => 'Private supplier', 'total_amount_minor' => 1000], 'lines' => []];
        $result = DocumentExtractionResult::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'test', 'model' => 'test-model', 'schema_version' => 'document-schema-v1', 'normalized_payload' => $payload, 'extracted_at' => now('UTC'),
        ]);

        $overlay = app(DocumentGovernanceService::class)->redact($result->id, 'fields.issuer_name', 'privacy_request', null);
        $display = app(DocumentRedactionProjector::class)->apply($result->fresh(), $result->fresh()->normalized_payload);
        $this->assertSame('[REDACTED]', $display['fields']['issuer_name']);
        $this->assertSame('Private supplier', $result->fresh()->normalized_payload['fields']['issuer_name']);
        $this->assertDatabaseHas('document_redaction_overlays', ['id' => $overlay->id, 'field_path' => 'fields.issuer_name']);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function review_history_redacts_a_masked_document_number_without_mutating_immutable_evidence(): void
    {
        $auth = $this->authorizedTenant('redaction-history');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $run = DocumentProcessingRun::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED, 'queued_at' => now('UTC')]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id,
            'sequence' => 1, 'provider_key' => 'test', 'model' => 'test-model', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC'),
        ]);
        $result = DocumentExtractionResult::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'test', 'model' => 'test-model', 'schema_version' => 'document-schema-v1',
            'normalized_payload' => ['schema_version' => 'document-schema-v1', 'fields' => ['document_number' => 'INV-PRIVATE-001'], 'lines' => []], 'extracted_at' => now('UTC'),
        ]);
        app(DocumentGovernanceService::class)->redact($result->id, 'fields.document_number', 'privacy_request', null);
        DocumentReviewAction::create([
            'document_batch_id' => $batch->id, 'document_extraction_result_id' => $result->id, 'subject_type' => 'review_change', 'subject_id' => (string) Str::uuid(),
            'action' => 'change', 'before' => ['target_key' => 'fields.document_number', 'value' => 'INV-PRIVATE-001'],
            'after' => ['target_key' => 'fields.document_number', 'value' => 'INV-PRIVATE-002'], 'reason' => 'privacy regression', 'review_version' => 1, 'occurred_at' => now('UTC'),
        ]);

        $response = $this->withToken($auth['token'])->getJson("/api/document-batches/{$batch->id}/review")->assertOk();
        $response->assertJsonPath('data.history.0.before.value', DocumentRedactionProjector::MARKER);
        $response->assertJsonPath('data.history.0.after.value', DocumentRedactionProjector::MARKER);
        $response->assertDontSee('INV-PRIVATE-001')->assertDontSee('INV-PRIVATE-002');
        $this->assertSame('INV-PRIVATE-001', $result->fresh()->normalized_payload['fields']['document_number']);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function diagnostics_and_csv_writer_do_not_expose_storage_key_or_execute_formulas(): void
    {
        $auth = $this->authorizedTenant('diagnostics-safe');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $response = $this->withToken($auth['token'])->getJson("/api/document-batches/{$batch->id}/diagnostics")->assertOk();
        $response->assertJsonPath('data.schema_version', 'document-diagnostics-v1');
        $response->assertDontSee($file->object_key);
        $csv = SpreadsheetWriter::csv(['safe'], [['=SUM(1,1)']]);
        $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
        $this->assertStringContainsString("'=SUM(1,1)", $csv);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /**
     * يحقن فشل DB وقت finalization بمحفّز يرفض كتابة purged_at. المجموعة تعمل على SQLite
     * وPostgreSQL معاً، وصيغة المحفّز خاصة بكل محرك: SQLite يرفع RAISE(ABORT) من جسم المحفّز
     * مباشرة، وPostgreSQL يوجب دالة plpgsql مستقلة ترفع EXCEPTION.
     */
    private function createPurgeFinalizationAbortTrigger(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE FUNCTION document_files_abort_purge_finalization() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'simulated purge finalization database failure';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER document_files_abort_purge_finalization
                BEFORE UPDATE OF purged_at ON document_files
                FOR EACH ROW WHEN (NEW.purged_at IS NOT NULL)
                EXECUTE FUNCTION document_files_abort_purge_finalization();
            SQL);

            return;
        }

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER document_files_abort_purge_finalization
            BEFORE UPDATE OF purged_at ON document_files
            WHEN NEW.purged_at IS NOT NULL
            BEGIN
                SELECT RAISE(ABORT, 'simulated purge finalization database failure');
            END;
        SQL);
    }

    private function dropPurgeFinalizationAbortTrigger(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS document_files_abort_purge_finalization ON document_files');
            DB::unprepared('DROP FUNCTION IF EXISTS document_files_abort_purge_finalization()');

            return;
        }

        DB::unprepared('DROP TRIGGER IF EXISTS document_files_abort_purge_finalization');
    }

    private function archiveForRetention(DocumentBatch $batch, DocumentFile $file, bool $due): void
    {
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch->fresh(), DocumentWorkflowStatus::RECEIVED, 'test_received', 'system');
        $workflow->transition($batch->fresh(), DocumentWorkflowStatus::ARCHIVED, 'test_archived', 'system');
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC')])->save();
        if ($due) {
            DB::table('document_files')->where('id', $file->id)->update(['created_at' => now('UTC')->subDays(366)]);
        }
    }

    private function resultForFile(DocumentBatch $batch, DocumentFile $file): DocumentExtractionResult
    {
        $run = DocumentProcessingRun::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED, 'queued_at' => now('UTC')]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id,
            'sequence' => 1, 'provider_key' => 'test', 'model' => 'test', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC'),
        ]);

        return DocumentExtractionResult::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'test', 'model' => 'test', 'schema_version' => 'document-schema-v1', 'normalized_payload' => ['schema_version' => 'document-schema-v1', 'fields' => [], 'lines' => []], 'extracted_at' => now('UTC'),
        ]);
    }

    /** @return array{0:DocumentBatch,1:DocumentFile} */
    private function batchWithFile(string $token, string $name = 'retention.png', ?string $contents = null): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data');
        $this->withToken($token)->post("/api/document-batches/{$batch['id']}/files", [
            'file' => UploadedFile::fake()->createWithContent($name, $contents ?? $this->png),
        ], ['Accept' => 'application/json'])->assertCreated();

        return [DocumentBatch::findOrFail($batch['id']), DocumentFile::query()->where('document_batch_id', $batch['id'])->firstOrFail()];
    }

    private function authorizedTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'pr12-test', (string) Str::uuid());

        return [...$auth, 'branch_id' => $branchId];
    }
}
