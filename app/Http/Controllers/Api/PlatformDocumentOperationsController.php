<?php

namespace App\Http\Controllers\Api;

use App\Models\DocumentRetentionPolicy;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Services\DocumentCenter\DocumentDiagnosticsService;
use App\Services\DocumentCenter\DocumentOperationsService;
use App\Services\DocumentCenter\DocumentRetentionPolicyService;
use App\Services\DocumentCenter\DocumentRetentionRunner;
use App\Services\DocumentCenter\DocumentUsageReportingService;
use App\Services\DocumentCenter\PlatformDocumentAuditExportService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class PlatformDocumentOperationsController extends ApiController
{
    public function __construct(
        private readonly DocumentOperationsService $operations,
        private readonly DocumentUsageReportingService $usage,
        private readonly PlatformDocumentAuditExportService $exports,
        private readonly DocumentDiagnosticsService $diagnostics,
        private readonly DocumentRetentionPolicyService $retention,
        private readonly DocumentRetentionRunner $runner,
    ) {}

    public function overview(): JsonResponse
    {
        return response()->json(['data' => $this->operations->platformOverview()]);
    }

    public function usage(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return response()->json(['data' => $this->usage->platformSummary($from, $to)]);
    }

    public function diagnostics(): JsonResponse
    {
        return response()->json(['data' => $this->diagnostics->platform()]);
    }

    public function auditExport(Request $request): StreamedResponse
    {
        [$from, $to] = $this->range($request);
        /** @var PlatformAdministrator|null $actor */
        $actor = $request->user();

        return $this->exports->download($from, $to, $actor);
    }

    public function updatePolicy(Request $request): JsonResponse
    {
        $data = $request->validate(['retention_days' => ['required', 'integer', 'min:1', 'max:3650'], 'enabled' => ['required', 'boolean']]);
        /** @var PlatformAdministrator|null $actor */
        $actor = $request->user();
        $policy = $this->retention->update((int) $data['retention_days'], (bool) $data['enabled'], $actor);
        PlatformIntegrationAuditEvent::create([
            'platform_administrator_id' => $actor?->id,
            'integration_key' => 'document_retention',
            'action' => 'retention_policy_updated',
            'changed_keys' => ['retention_days', 'enabled'],
            'occurred_at' => now('UTC'),
        ]);

        return response()->json(['data' => $this->policy($policy)]);
    }

    public function retentionRun(Request $request): JsonResponse
    {
        $data = $request->validate([
            'dry_run' => ['sometimes', 'boolean'], 'apply' => ['required_if:dry_run,false', 'accepted'],
            'cutoff_at' => ['nullable', 'date'], 'limit' => ['nullable', 'integer', 'min:1', 'max:'.DocumentRetentionRunner::MAX_LIMIT],
            'after_file_id' => ['nullable', 'uuid'],
        ]);
        $dryRun = (bool) ($data['dry_run'] ?? true);
        $effective = $this->retention->effective();
        if (! $effective['enabled']) {
            abort(422, 'سياسة الاحتفاظ غير مفعلة.');
        }
        /** @var PlatformAdministrator|null $actor */
        $actor = $request->user();
        $result = $this->runner->run(
            $effective['policy'] ?? $this->retention->update($effective['retention_days'], true, $actor),
            $dryRun,
            DocumentRetentionRunner::cutoff($data['cutoff_at'] ?? null),
            (int) ($data['limit'] ?? 100),
            $actor,
            $data['after_file_id'] ?? null,
        );

        return response()->json(['data' => [
            'run_id' => $result['run']->id, 'dry_run' => $result['run']->dry_run, 'status' => $result['run']->status,
            'cutoff_at' => $result['run']->cutoff_at?->toIso8601String(), 'after_file_id' => $result['run']->after_file_id,
            'next_after_file_id' => $result['run']->last_file_id, 'results' => $result['results'],
        ]], 202);
    }

    /** @return array{0:CarbonImmutable,1:CarbonImmutable} */
    private function range(Request $request): array
    {
        $data = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from']]);
        $to = isset($data['to']) ? CarbonImmutable::parse($data['to'])->endOfDay() : now('UTC')->toImmutable()->endOfDay();
        $from = isset($data['from']) ? CarbonImmutable::parse($data['from'])->startOfDay() : $to->subDays(DocumentUsageReportingService::DEFAULT_DAYS - 1)->startOfDay();
        if ($from->diffInDays($to) > DocumentUsageReportingService::MAX_DAYS) {
            abort(422, 'نطاق التاريخ يتجاوز الحد المسموح للتقارير.');
        }

        return [$from, $to];
    }

    /** @return array<string,mixed> */
    private function policy(DocumentRetentionPolicy $policy): array
    {
        return ['id' => $policy->id, 'retention_days' => $policy->retention_days, 'enabled' => $policy->enabled,
            'purge_mode' => $policy->purge_mode, 'updated_at' => $policy->updated_at?->toIso8601String()];
    }
}
