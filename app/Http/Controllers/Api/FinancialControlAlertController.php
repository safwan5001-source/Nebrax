<?php

namespace App\Http\Controllers\Api;

use App\Models\FinancialControlAlert;
use App\Services\Accounting\FinancialControlService;
use App\Tenancy\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FinancialControlAlertController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['nullable', 'in:active,acknowledged,resolved'],
            'severity' => ['nullable', 'in:critical,high,medium'],
            'rule' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json([
            'data' => $this->visibleAlerts($request)
                ->orderByRaw("CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END")
                ->orderByDesc('last_detected_at')
                ->get()
                ->map(fn (FinancialControlAlert $alert) => $this->mapAlert($alert))
                ->values(),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return response()->json([
            'data' => $this->mapAlert($this->visibleAlerts($request)->whereKey($id)->firstOrFail()),
        ]);
    }

    public function acknowledge(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:1000']]);
        $alert = $this->visibleAlerts($request)->whereKey($id)->firstOrFail();

        if ($alert->status === 'resolved') {
            return response()->json(['message' => 'لا يمكن إقرار تنبيه تم حله بالفعل.'], 422);
        }

        $alert->update([
            'status' => 'acknowledged',
            'acknowledged_by' => $request->user()->id,
            'acknowledged_at' => now(),
            'acknowledgement_note' => $data['note'] ?? null,
        ]);

        return response()->json(['data' => $this->mapAlert($alert->fresh())]);
    }

    public function runCheck(FinancialControlService $controls): JsonResponse
    {
        $result = $controls->scan();

        if (! $result['enabled']) {
            return response()->json([
                'message' => 'تنبيهات الرقابة المالية معطّلة لهذا المستأجر. فعّلها أولاً من إعدادات المالية.',
                'code' => 'financial_alerts_disabled',
            ], 422);
        }

        return response()->json([
            'data' => [
                'detected' => $result['detected'],
                'active' => $result['active'],
                'resolved' => $result['resolved'],
            ],
        ]);
    }

    private function visibleAlerts(Request $request): Builder
    {
        $query = FinancialControlAlert::query();
        $allowed = $request->user()?->allowedBranchIds();
        $branchId = app(BranchContext::class)->id();

        if ($request->query('branch') === 'all') {
            if ($allowed !== null) {
                $query->where(fn (Builder $builder) => $builder->whereIn('branch_id', $allowed)->orWhereNull('branch_id'));
            }
        } elseif ($branchId !== null) {
            $query->where(fn (Builder $builder) => $builder->where('branch_id', $branchId)->orWhereNull('branch_id'));
        } elseif ($allowed !== null) {
            $query->where(fn (Builder $builder) => $builder->whereIn('branch_id', $allowed)->orWhereNull('branch_id'));
        }

        return $query
            ->when($request->query('status'), fn (Builder $builder, string $status) => $builder->where('status', $status))
            ->when($request->query('severity'), fn (Builder $builder, string $severity) => $builder->where('severity', $severity))
            ->when($request->query('rule'), fn (Builder $builder, string $rule) => $builder->where('rule', $rule));
    }

    /** @return array<string,mixed> */
    private function mapAlert(FinancialControlAlert $alert): array
    {
        return [
            'id' => $alert->id,
            'branch_id' => $alert->branch_id,
            'rule' => $alert->rule,
            'severity' => $alert->severity,
            'status' => $alert->status,
            'title' => $alert->title,
            'description' => $alert->description,
            'source_type' => $alert->source_type,
            'source_id' => $alert->source_id,
            'details' => $alert->details,
            'first_detected_at' => $alert->first_detected_at?->toISOString(),
            'last_detected_at' => $alert->last_detected_at?->toISOString(),
            'resolved_at' => $alert->resolved_at?->toISOString(),
            'acknowledged_at' => $alert->acknowledged_at?->toISOString(),
            'acknowledgement_note' => $alert->acknowledgement_note,
        ];
    }
}
