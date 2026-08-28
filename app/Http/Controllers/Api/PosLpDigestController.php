<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PosLpDigestResource;
use App\Models\PosException;
use App\Models\PosInvestigationCase;
use App\Models\PosLpDigest;
use App\Models\Tenant;
use App\Services\Pos\PosLpDigestService;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * الملخص الرقابي اليومي (Daily LP Digest) — قراءة قائمة/تفصيل + توليد يدوي. صفّ واحد
 * لكل (مستأجر، تاريخ) يخزَّن تجميعاً على مستوى المؤسسة كاملةً؛ **العزل بالفرع للمستخدمين
 * المقيَّدين يُطبَّق هنا وقت العرض** (`redactForAllowedBranches`) — يعيد اشتقاق كل رقم
 * ظاهر من `branch_breakdown` المفصَّل بالكامل، لا يعرض تجميع مؤسسة كاملة لمن لا يراها.
 */
class PosLpDigestController extends ApiController
{
    public function __construct(private readonly PosLpDigestService $service) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = PosLpDigest::query();
        if (! empty($filters['from'])) $query->where('digest_date', '>=', $filters['from']);
        if (! empty($filters['to'])) $query->where('digest_date', '<=', $filters['to']);

        $total = (clone $query)->count();
        $perPage = min(max((int) ($filters['per_page'] ?? 30), 1), 100);
        $page = max((int) ($filters['page'] ?? 1), 1);
        $rows = $query->orderByDesc('digest_date')->forPage($page, $perPage)->get()
            ->map(fn (PosLpDigest $digest) => $this->redactForAllowedBranches($digest, $request));

        return response()->json([
            'data' => PosLpDigestResource::collection($rows),
            'meta' => ['total' => $total, 'per_page' => $perPage, 'current_page' => $page, 'last_page' => max(1, (int) ceil($total / $perPage))],
        ]);
    }

    public function show(Request $request, string $date): JsonResponse
    {
        $digest = PosLpDigest::query()->where('digest_date', $date)->firstOrFail();

        return response()->json(['data' => new PosLpDigestResource($this->redactForAllowedBranches($digest, $request))]);
    }

    public function latest(Request $request): JsonResponse
    {
        $digest = PosLpDigest::query()->orderByDesc('digest_date')->first();

        return response()->json(['data' => $digest ? new PosLpDigestResource($this->redactForAllowedBranches($digest, $request)) : null]);
    }

    /** توليد/إعادة توليد يدوي — idempotent لنفس اليوم، يتطلب pos.investigations.manage. */
    public function generate(Request $request): JsonResponse
    {
        $data = $request->validate(['date' => ['nullable', 'date']]);
        $tenant = Tenant::findOrFail(app(\App\Tenancy\TenantContext::class)->id());
        $forDate = ! empty($data['date']) ? Carbon::parse($data['date']) : null;

        $digest = $this->service->generate($tenant, $forDate, $request->user()->id);

        return response()->json(['data' => new PosLpDigestResource($this->redactForAllowedBranches($digest, $request))], 201);
    }

    /**
     * يعيد اشتقاق كل رقم/معرّف ظاهر من `branch_breakdown` وحده لمستخدم مقيَّد بفروع محدَّدة
     * (`allowedBranchIds() !== null`) — لا تسريب تجميع المؤسسة كاملةً لمن لا يرى كل فروعها.
     * لا يعدّل الصف المخزَّن؛ يعمل على نسخة في الذاكرة لغرض هذا الطلب فقط.
     */
    private function redactForAllowedBranches(PosLpDigest $digest, Request $request): PosLpDigest
    {
        $allowed = $request->user()->allowedBranchIds();
        if ($allowed === null) {
            return $digest;
        }

        $visible = collect($digest->branch_breakdown ?? [])
            ->filter(fn (array $row) => $row['branch_id'] === null || in_array($row['branch_id'], $allowed, true))
            ->values();

        $payload = $digest->payload ?? [];
        $visibleExceptionIds = $this->visibleIds(PosException::class, $payload['exception_ids'] ?? [], $allowed);
        $visibleCaseIds = $this->visibleIds(PosInvestigationCase::class, $payload['case_ids'] ?? [], $allowed);
        $visibleConfirmedLossCaseIds = $this->visibleIds(PosInvestigationCase::class, $payload['confirmed_loss_case_ids'] ?? [], $allowed);

        $redacted = clone $digest;
        $redacted->branch_breakdown = $visible->all();
        $redacted->new_exceptions_count = (int) $visible->sum('new_exceptions_count');
        $redacted->priority_exceptions_count = (int) $visible->sum('priority_exceptions_count');
        $redacted->amount_under_review_minor = (int) $visible->sum('amount_under_review_minor');
        $redacted->new_cases_count = (int) $visible->sum('new_cases_count');
        $redacted->unresolved_high_priority_cases_count = (int) $visible->sum('unresolved_high_priority_cases_count');
        $redacted->confirmed_loss_count = (int) $visible->sum('confirmed_loss_count');
        $redacted->confirmed_loss_minor = (int) $visible->sum('confirmed_loss_minor');
        $redacted->control_failure_count = (int) $visible->sum('control_failure_count');
        $redacted->material_variance_sessions_count = (int) $visible->sum('material_variance_sessions_count');
        // rule_breakdown/تركّز الاعتماد غير مفصَّلين بالفرع في الملخص المخزَّن؛ تُحجَب بالكامل
        // عن المستخدم المقيَّد بدل عرض تجميع مؤسسة كاملة موسوم كأنه محدود بفروعه.
        $redacted->payload = [
            'exception_ids' => $visibleExceptionIds,
            'case_ids' => $visibleCaseIds,
            'confirmed_loss_case_ids' => $visibleConfirmedLossCaseIds,
            'rule_breakdown' => [],
            'performer_approver_concentration' => [],
        ];

        return $redacted;
    }

    /** @param class-string<\Illuminate\Database\Eloquent\Model> $model */
    private function visibleIds(string $model, array $ids, array $allowedBranchIds): array
    {
        if ($ids === []) {
            return [];
        }

        return $model::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('id', $ids)
            ->where(fn ($q) => $q->whereNull('branch_id')->orWhereIn('branch_id', $allowedBranchIds))
            ->pluck('id')->values()->all();
    }
}
