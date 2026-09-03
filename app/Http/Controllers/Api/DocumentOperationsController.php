<?php

namespace App\Http\Controllers\Api;

use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentRedactionOverlay;
use App\Models\DocumentRetentionHold;
use App\Services\DocumentCenter\DocumentDiagnosticsService;
use App\Services\DocumentCenter\DocumentGovernanceService;
use App\Services\DocumentCenter\DocumentIntelligencePolicy;
use App\Services\DocumentCenter\DocumentOperationsExportService;
use App\Services\DocumentCenter\DocumentOperationsService;
use App\Services\DocumentCenter\DocumentRedactionProjector;
use App\Services\DocumentCenter\DocumentRetentionPolicyService;
use App\Services\DocumentCenter\DocumentRetryService;
use App\Services\DocumentCenter\DocumentUsageReportingService;
use App\Tenancy\BranchContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class DocumentOperationsController extends ApiController
{
    public function __construct(
        private readonly DocumentOperationsService $operations,
        private readonly DocumentRetryService $retry,
        private readonly DocumentUsageReportingService $usage,
        private readonly DocumentOperationsExportService $exports,
        private readonly DocumentRetentionPolicyService $retention,
        private readonly DocumentGovernanceService $governance,
        private readonly DocumentDiagnosticsService $diagnostics,
    ) {}

    public function overview(Request $request): JsonResponse
    {
        $data = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        return response()->json(['data' => $this->operations->tenantOverview((int) ($data['per_page'] ?? 20))]);
    }

    public function retry(Request $request, DocumentProcessingRun $run): JsonResponse
    {
        $this->branch($run);
        $data = $request->validate(['version' => ['nullable', 'string', 'max:64']]);
        $result = $this->retry->retry($run, $request->user(), $data['version'] ?? null);

        return response()->json(['data' => [
            'accepted' => $result['accepted'], 'code' => $result['code'], 'message' => $result['message'],
            'run' => $this->run($result['run']),
        ]], $result['accepted'] ? 202 : 422);
    }

    public function usage(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->usage->tenantSummary($this->usageFilters($request))]);
    }

    public function usageExport(Request $request): StreamedResponse
    {
        return $this->exports->usage($this->usageFilters($request), $request->user());
    }

    public function governance(): JsonResponse
    {
        $effective = $this->retention->effective();
        $branchId = app(BranchContext::class)->id();

        return response()->json(['data' => [
            'policy' => [
                'retention_days' => $effective['retention_days'], 'enabled' => $effective['enabled'],
                'purge_mode' => $effective['purge_mode'], 'policy_source' => $effective['policy'] === null ? 'config_default' : 'platform_policy',
                'last_run_at' => $effective['last_run']?->finished_at?->toIso8601String(),
            ],
            // القرار الفعّال لسياسة المستأجر (المعالجة الذكية + مصير الأصل)،
            // مقروءاً من نفس المصدر الذي تراه الخدمات — لا اشتقاق موازٍ.
            'document_intelligence' => DocumentIntelligencePolicy::forTenant()->toArray(),
            'active_holds' => DocumentRetentionHold::query()->where('branch_id', $branchId)->active()->latest()->limit(100)->get()->map(fn (DocumentRetentionHold $hold) => $this->hold($hold)),
            'redactions' => DocumentRedactionOverlay::query()->where('branch_id', $branchId)->latest('redacted_at')->limit(100)->get()->map(fn (DocumentRedactionOverlay $overlay) => [
                'id' => $overlay->id, 'result_id' => $overlay->document_extraction_result_id, 'field_path' => $overlay->field_path,
                'reason_code' => $overlay->reason_code, 'redacted_at' => $overlay->redacted_at?->toIso8601String(),
            ]),
            'redaction_fields' => DocumentRedactionProjector::fieldPaths(),
        ]]);
    }

    public function createHold(Request $request): JsonResponse
    {
        $data = $request->validate([
            'document_batch_id' => ['nullable', 'uuid', 'required_without:file_id'],
            'file_id' => ['nullable', 'uuid', 'required_without:document_batch_id'],
            'reason_code' => ['required', Rule::in(DocumentRetentionHold::REASONS)],
        ]);
        $batch = isset($data['document_batch_id']) ? DocumentBatch::query()->findOrFail($data['document_batch_id']) : null;
        if ($batch !== null) {
            $this->branch($batch);
        }
        if (isset($data['file_id'])) {
            $this->branch(DocumentFile::query()->findOrFail($data['file_id']));
        }
        $hold = $this->governance->createHold($batch, $data['file_id'] ?? null, $data['reason_code'], $request->user());

        return response()->json(['data' => $this->hold($hold)], 201);
    }

    public function releaseHold(Request $request, DocumentRetentionHold $hold): JsonResponse
    {
        $this->branch($hold);
        $data = $request->validate(['reason_code' => ['required', Rule::in(DocumentRetentionHold::RELEASE_REASONS)]]);

        return response()->json(['data' => $this->hold($this->governance->releaseHold($hold, $data['reason_code'], $request->user()))]);
    }

    public function redact(Request $request): JsonResponse
    {
        $data = $request->validate([
            'document_extraction_result_id' => ['required', 'uuid'],
            'field_path' => ['required', Rule::in(DocumentRedactionProjector::fieldPaths())],
            'reason_code' => ['required', Rule::in(DocumentRedactionOverlay::REASONS)],
        ]);
        $result = DocumentExtractionResult::query()->findOrFail($data['document_extraction_result_id']);
        $this->branch($result);
        $overlay = $this->governance->redact($result->id, $data['field_path'], $data['reason_code'], $request->user());

        return response()->json(['data' => [
            'id' => $overlay->id, 'result_id' => $overlay->document_extraction_result_id, 'field_path' => $overlay->field_path,
            'reason_code' => $overlay->reason_code, 'redacted_at' => $overlay->redacted_at?->toIso8601String(),
        ]], 201);
    }

    public function auditExport(Request $request): StreamedResponse
    {
        return $this->exports->audit($this->auditFilters($request), $request->user());
    }

    public function diagnostics(DocumentBatch $batch): JsonResponse
    {
        $this->branch($batch);

        return response()->json(['data' => $this->diagnostics->tenant($batch)]);
    }

    /** @return array{from:CarbonImmutable,to:CarbonImmutable,provider:?string,model:?string,document_type:?string} */
    private function usageFilters(Request $request): array
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'provider' => ['nullable', 'string', 'max:64'], 'model' => ['nullable', 'string', 'max:128'],
            'document_type' => ['nullable', 'string', 'max:64'],
        ]);

        return $this->range($data) + [
            'provider' => $data['provider'] ?? null, 'model' => $data['model'] ?? null, 'document_type' => $data['document_type'] ?? null,
        ];
    }

    /** @return array{from:CarbonImmutable,to:CarbonImmutable} */
    private function auditFilters(Request $request): array
    {
        return $this->range($request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from']]));
    }

    /** @param array<string,mixed> $data
     * @return array{from:CarbonImmutable,to:CarbonImmutable}
     */
    private function range(array $data): array
    {
        $to = isset($data['to']) ? CarbonImmutable::parse($data['to'])->endOfDay() : now('UTC')->toImmutable()->endOfDay();
        $from = isset($data['from']) ? CarbonImmutable::parse($data['from'])->startOfDay() : $to->subDays(DocumentUsageReportingService::DEFAULT_DAYS - 1)->startOfDay();
        if ($from->diffInDays($to) > DocumentUsageReportingService::MAX_DAYS) {
            abort(422, 'نطاق التاريخ يتجاوز الحد المسموح للتصدير والتقارير.');
        }

        return ['from' => $from, 'to' => $to];
    }

    private function branch(object $model): void
    {
        if (($model->branch_id ?? null) !== app(BranchContext::class)->id()) {
            abort(404);
        }
    }

    /** @return array<string,mixed> */
    private function run(DocumentProcessingRun $run): array
    {
        return ['id' => $run->id, 'stage' => $run->stage, 'status' => $run->status->value,
            'attempt_count' => $run->attempt_count, 'updated_at' => $run->updated_at?->toIso8601String()];
    }

    /** @return array<string,mixed> */
    private function hold(DocumentRetentionHold $hold): array
    {
        return ['id' => $hold->id, 'batch_id' => $hold->document_batch_id, 'file_id' => $hold->document_file_id,
            'reason_code' => $hold->reason_code, 'created_at' => $hold->created_at?->toIso8601String(),
            'released_at' => $hold->released_at?->toIso8601String(), 'release_reason_code' => $hold->release_reason_code];
    }
}
