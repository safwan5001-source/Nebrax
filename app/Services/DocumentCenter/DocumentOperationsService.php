<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentRedactionOverlay;
use App\Models\DocumentRetentionHold;
use App\Models\DocumentRetentionRun;
use App\Services\PlatformIntegrationResolver;
use App\Services\PlatformIntegrationService;
use App\Support\DocumentProcessingStatus;
use App\Tenancy\BranchContext;
use Illuminate\Support\Facades\DB;

/** Projections تشغيلية آمنة؛ لا تعيد file binary/object key/extraction payload. */
final class DocumentOperationsService
{
    public function __construct(
        private readonly DocumentRetentionPolicyService $retention,
        private readonly DocumentProcessingStatusProjector $status,
        private readonly PlatformIntegrationResolver $settings,
        private readonly PlatformIntegrationService $platform,
    ) {}

    /** @return array<string,mixed> */
    public function tenantOverview(int $perPage = 20): array
    {
        $branchId = app(BranchContext::class)->id();
        $batches = DocumentBatch::query()->where('branch_id', $branchId)
            ->with(['files' => fn ($query) => $query->select('id', 'document_batch_id', 'scan_status', 'purged_at', 'created_at')])
            ->latest('updated_at')->paginate(max(1, min(100, $perPage)));
        $ids = collect($batches->items())->pluck('id')->all();
        $runsByBatch = DocumentProcessingRun::query()->whereIn('document_batch_id', $ids)->get()->groupBy('document_batch_id');
        $retention = $this->retention->effective();

        return [
            'summary' => [
                'batches' => DocumentBatch::query()->where('branch_id', $branchId)->count(),
                'queued_runs' => DocumentProcessingRun::query()->where('branch_id', $branchId)->where('status', DocumentProcessingStatus::QUEUED->value)->count(),
                'running_runs' => DocumentProcessingRun::query()->where('branch_id', $branchId)->where('status', DocumentProcessingStatus::RUNNING->value)->count(),
                'failed_runs' => DocumentProcessingRun::query()->where('branch_id', $branchId)->where('status', DocumentProcessingStatus::FAILED->value)->count(),
                'active_holds' => DocumentRetentionHold::query()->where('branch_id', $branchId)->active()->count(),
                'redactions' => DocumentRedactionOverlay::query()->where('branch_id', $branchId)->count(),
                'purged_files' => DB::table('document_files')->where('branch_id', $branchId)->whereNotNull('purged_at')->count(),
            ],
            'retention' => $this->retentionProjection($retention),
            'data' => collect($batches->items())->map(function (DocumentBatch $batch) use ($runsByBatch): array {
                $file = $batch->files->sortBy('created_at')->first();
                $runs = $runsByBatch->get($batch->id, collect());

                return [
                    'id' => $batch->id,
                    'document_type' => $batch->document_type,
                    'workflow_status' => $batch->status->value,
                    'version' => $batch->version,
                    'created_at' => $batch->created_at?->toIso8601String(),
                    'updated_at' => $batch->updated_at?->toIso8601String(),
                    'file' => $file === null ? null : [
                        'id' => $file->id,
                        'scan_status' => $file->scan_status->value,
                        'purged_at' => $file->purged_at?->toIso8601String(),
                    ],
                    'processing_status' => $this->status->project($batch, $file, $runs, $this->extractionReady()),
                    'runs' => $runs->map(fn (DocumentProcessingRun $run) => [
                        'id' => $run->id,
                        'stage' => $run->stage,
                        'status' => $run->status->value,
                        'attempt_count' => $run->attempt_count,
                        'error_code' => $run->error_code,
                        'error_message_safe' => $run->error_message_safe,
                        'updated_at' => $run->updated_at?->toIso8601String(),
                    ])->values()->all(),
                ];
            })->all(),
            'meta' => [
                'current_page' => $batches->currentPage(),
                'last_page' => $batches->lastPage(),
                'per_page' => $batches->perPage(),
                'total' => $batches->total(),
            ],
        ];
    }

    /** @return array<string,mixed> */
    public function platformOverview(): array
    {
        $runtime = $this->platform->runtime();

        return [
            'runtime' => $runtime,
            'batches_by_status' => DB::table('document_batches')->select('status', DB::raw('COUNT(*) as count'))->groupBy('status')->orderBy('status')->get()->map(fn ($row) => ['status' => $row->status, 'count' => (int) $row->count])->all(),
            'runs_by_status' => DB::table('document_processing_runs')->select('status', DB::raw('COUNT(*) as count'))->groupBy('status')->orderBy('status')->get()->map(fn ($row) => ['status' => $row->status, 'count' => (int) $row->count])->all(),
            'retention' => $this->retentionProjection($this->retention->effective()),
            'retention_runs' => DocumentRetentionRun::query()->latest('created_at')->limit(10)->get()->map(fn (DocumentRetentionRun $run) => [
                'id' => $run->id, 'dry_run' => $run->dry_run, 'status' => $run->status,
                'cutoff_at' => $run->cutoff_at?->toIso8601String(), 'scanned_count' => $run->scanned_count,
                'eligible_count' => $run->eligible_count, 'purged_count' => $run->purged_count,
                'skipped_count' => $run->skipped_count, 'after_file_id' => $run->after_file_id,
                'next_after_file_id' => $run->last_file_id, 'created_at' => $run->created_at?->toIso8601String(),
            ])->all(),
        ];
    }

    private function extractionReady(): bool
    {
        $policy = $this->settings->documentExtractionPolicy();
        $primary = $policy->primaryProvider();
        $configuration = $primary === null ? null : $policy->provider($primary);

        return config('queue.default') !== 'sync'
            && DocumentProviderNetworkGate::allowsExternalRequests()
            && $policy->enabled()
            && $configuration !== null
            && $configuration->isOperationallyReady();
    }

    /** @param array{policy:mixed,retention_days:int,enabled:bool,purge_mode:string,last_run:mixed} $effective
     * @return array<string,mixed>
     */
    private function retentionProjection(array $effective): array
    {
        $last = $effective['last_run'];

        return [
            'retention_days' => $effective['retention_days'],
            'enabled' => $effective['enabled'],
            'purge_mode' => $effective['purge_mode'],
            'policy_source' => $effective['policy'] === null ? 'config_default' : 'platform_policy',
            'last_run' => $last === null ? null : [
                'id' => $last->id, 'status' => $last->status, 'dry_run' => $last->dry_run,
                'purged_count' => $last->purged_count, 'finished_at' => $last->finished_at?->toIso8601String(),
            ],
        ];
    }
}
