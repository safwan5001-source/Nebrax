<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PosExceptionResource;
use App\Models\PosCaseEvidenceLink;
use App\Models\PosException;
use App\Models\PosExceptionRule;
use App\Models\PosInvestigationCase;
use App\Models\PosLpDigest;
use App\Models\PosOverrideApproval;
use App\Models\PosRiskSnapshot;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Services\Pos\PosExceptionDetectionService;
use App\Services\Pos\PosExceptionReviewService;
use App\Support\Money;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * مساحة الذكاء الرقابي (Phase 2) فوق نفس workspace التدقيق. القراءة والفلترة
 * والتجميع خادمية بالكامل، والعزل tenant/branch مفروض خادمياً عبر
 * `scopeToActiveBranch`. لا تقرأ الفواتير/المدفوعات كمصدر تدقيق، ولا تقبل من
 * العميل درجة أو شدّة أو مبلغاً موثوقاً أو خط أساس أو نتيجة استثناء.
 */
class PosLossPreventionController extends ApiController
{
    public function __construct(
        private readonly PosExceptionDetectionService $detection,
        private readonly PosExceptionReviewService $reviews,
    ) {}

    /** نظرة تشغيلية موجزة: استثناءات تحتاج مراجعة، مبلغ قيد المراجعة، مواضيع الأولوية. */
    public function overview(Request $request): JsonResponse
    {
        $exceptions = $this->visibleExceptions($request);
        $openStates = [PosException::STATE_NEW, PosException::STATE_REVIEWING, PosException::STATE_NEEDS_INVESTIGATION];

        $bySeverity = (clone $exceptions)->whereIn('review_state', $openStates)
            ->selectRaw('severity, COUNT(*) as c')->groupBy('severity')->pluck('c', 'severity');
        $byState = (clone $exceptions)->selectRaw('review_state, COUNT(*) as c')->groupBy('review_state')->pluck('c', 'review_state');

        $snapshots = $this->visibleSnapshots($request);
        $bands = (clone $snapshots)->selectRaw('band, COUNT(*) as c')->groupBy('band')->pluck('c', 'band');

        return response()->json(['data' => [
            'needs_review_count' => (clone $exceptions)->whereIn('review_state', $openStates)->count(),
            'priority_count' => (int) ($bySeverity[PosException::SEVERITY_PRIORITY] ?? 0),
            'review_count' => (int) ($bySeverity[PosException::SEVERITY_REVIEW] ?? 0),
            'watch_count' => (int) ($bySeverity[PosException::SEVERITY_WATCH] ?? 0),
            'amount_under_review' => Money::toRiyal($this->aggregateAmountUnderReview($request, $openStates)),
            'subjects_needing_review' => (clone $snapshots)->whereIn('band', [PosRiskSnapshot::BAND_REVIEW, PosRiskSnapshot::BAND_PRIORITY])->count(),
            'state_breakdown' => $byState,
            'band_breakdown' => $bands,
        ]]);
    }

    /** قائمة الاستثناءات — فلترة وترقيم وتجميع خادمي. */
    public function index(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $query = $this->applyFilters($this->visibleExceptions($request), $filters)
            ->with(['subject:id,name', 'performedBy:id,name', 'approvedBy:id,name', 'reviewer:id,name', 'session:id,number']);

        $total = (clone $query)->count();
        $perPage = min(max((int) ($filters['per_page'] ?? 25), 1), 100);
        $page = max((int) ($filters['page'] ?? 1), 1);

        $query = $this->applySort($query, $filters['sort'] ?? null)
            ->forPage($page, $perPage);

        return response()->json([
            'data' => PosExceptionResource::collection($query->get()),
            'meta' => [
                'total' => $total,
                'per_page' => $perPage,
                'current_page' => $page,
                'last_page' => max(1, (int) ceil($total / $perPage)),
            ],
        ]);
    }

    /** تفصيل استثناء + سجلّ المراجعة + مراجع الأدلة. */
    public function show(Request $request, string $id): JsonResponse
    {
        $exception = $this->visibleExceptions($request)
            ->with(['subject:id,name', 'performedBy:id,name', 'approvedBy:id,name', 'reviewer:id,name', 'session:id,number', 'reviews.reviewer:id,name'])
            ->findOrFail($id);

        return response()->json(['data' => new PosExceptionResource($exception)]);
    }

    /** الأدلة المصدرية للاستثناء — تُقرأ خادمياً بترقيم، لا تُحمّل مسبقاً. */
    public function evidence(Request $request, string $id): JsonResponse
    {
        $exception = $this->visibleExceptions($request)->findOrFail($id);
        $eventQuery = $exception->explanation['evidence_query'] ?? [];
        $events = $this->visibleEvents($request)
            ->when(! empty($eventQuery['user_id']), fn (Builder $q) => $q->where(function (Builder $inner) use ($eventQuery) {
                $inner->where('performed_by', $eventQuery['user_id'])->orWhere('actor_id', $eventQuery['user_id']);
            }))
            ->when(! empty($eventQuery['types']), fn (Builder $q) => $q->whereIn('type', (array) $eventQuery['types']))
            ->when(! empty($eventQuery['from']), fn (Builder $q) => $q->where('created_at', '>=', $eventQuery['from']))
            ->when(! empty($eventQuery['to']), fn (Builder $q) => $q->where('created_at', '<=', $eventQuery['to']))
            ->with(['performedBy:id,name', 'approvedBy:id,name', 'session:id,number'])
            ->orderByDesc('created_at')->limit(100)->get();

        return response()->json([
            'data' => \App\Http\Resources\PosSessionEventResource::collection($events),
            'meta' => ['amount_event_ids' => $exception->amount_event_ids ?? []],
        ]);
    }

    /** عرض المخاطر المرتّب — لقطات درجة المراجعة، لا «لوحة صدارة اتهام». */
    public function risk(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'band' => ['nullable', Rule::in([PosRiskSnapshot::BAND_NORMAL, PosRiskSnapshot::BAND_WATCH, PosRiskSnapshot::BAND_REVIEW, PosRiskSnapshot::BAND_PRIORITY])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = $this->visibleSnapshots($request)
            ->when(! empty($filters['band']), fn (Builder $q) => $q->where('band', $filters['band']))
            ->with('subject:id,name');
        $total = (clone $query)->count();
        $perPage = min(max((int) ($filters['per_page'] ?? 25), 1), 100);
        $page = max((int) ($filters['page'] ?? 1), 1);

        $rows = $query->orderByDesc('total_score')->orderByDesc('amount_under_review')
            ->forPage($page, $perPage)->get();

        return response()->json([
            'data' => $rows->map(fn (PosRiskSnapshot $snapshot) => $this->snapshotData($snapshot))->values(),
            'meta' => ['total' => $total, 'per_page' => $perPage, 'current_page' => $page, 'last_page' => max(1, (int) ceil($total / $perPage))],
        ]);
    }

    /** تفصيل مخاطر مستخدم: اللقطة + الأساس الشخصي/النظراء + المقاييس المطبّعة + الاستثناءات المسهِمة. */
    public function riskDetail(Request $request, string $userId): JsonResponse
    {
        $snapshot = $this->visibleSnapshots($request)->where('subject_user_id', $userId)->with('subject:id,name')->first();
        $exceptions = $this->visibleExceptions($request)->where('subject_user_id', $userId)
            ->with(['performedBy:id,name', 'approvedBy:id,name'])
            ->orderByDesc('risk_contribution')->limit(100)->get();

        return response()->json(['data' => [
            'snapshot' => $snapshot ? $this->snapshotData($snapshot) : null,
            'exceptions' => PosExceptionResource::collection($exceptions),
        ]]);
    }

    /** علاقات الاعتماد: تركّز الزوج منفّذ↔معتمِد، عرض تشغيلي مقيَّد لا رسم مثير. */
    public function relationships(Request $request): JsonResponse
    {
        // من الأدلة الخادمية مباشرة (override_approved) — تجميع خادمي بحت.
        $rows = $this->visibleEvents($request)
            ->where('type', PosSessionEvent::TYPE_OVERRIDE_APPROVED)
            ->whereNotNull('performed_by')->whereNotNull('approved_by')
            ->selectRaw('performed_by, approved_by, COUNT(*) as approvals, MAX(created_at) as last_at')
            ->groupBy('performed_by', 'approved_by')
            ->orderByDesc('approvals')->limit(200)->get();

        $userIds = $rows->pluck('performed_by')->merge($rows->pluck('approved_by'))->unique()->filter();
        $names = User::query()->whereIn('id', $userIds)->get(['id', 'name'])->keyBy('id');
        $flaggedPairs = $this->visibleExceptions($request)
            ->where('rule_key', 'performer_approver_pair_concentration')
            ->get(['performed_by', 'approved_by', 'severity'])
            ->keyBy(fn ($e) => $e->performed_by . ':' . $e->approved_by);

        return response()->json(['data' => $rows->map(function ($row) use ($names, $flaggedPairs) {
            $flag = $flaggedPairs->get($row->performed_by . ':' . $row->approved_by);

            return [
                'performed_by' => $row->performed_by,
                'performer_name' => $names->get($row->performed_by)?->name ?? '—',
                'approved_by' => $row->approved_by,
                'approver_name' => $names->get($row->approved_by)?->name ?? '—',
                'approvals' => (int) $row->approvals,
                'last_at' => $row->last_at,
                'flagged_severity' => $flag?->severity,
            ];
        })->values()]);
    }

    /**
     * Phase 4 — قائمة موحّدة «تحتاج انتباهاً»: تجميع بالإشارة (لا نسخ) لأربعة مصادر أدلة
     * قائمة فعلاً — استثناءات أولوية/جديدة، استثناءات بانتظار مراجعة (`needs_investigation`
     * غير المرتبطة بقضية بعد)، طلبات اعتماد معلَّقة (تحجب عملية خادمية فعلية الآن)، وقضايا
     * غير مسنَدة أو متجاوزة لعتبة نشاط. لا تُنشئ جدولاً جديداً ولا حالة مراجعة موازية؛ كل
     * عنصر مرجعٌ لصفّه الأصلي (`reference.type`/`reference.id`) تفتحه الواجهة بشاشته القائمة.
     *
     * الترتيب بدرجة إلحاح (`urgency_rank`، الأصغر أعجل) ثم بالتوقيت الأقدم أولاً ضمن نفس
     * الدرجة — طلب اعتماد يحجب كاشيراً الآن أعجل من قضية مفتوحة منذ أيام. **مؤشرات المراجعة
     * والاستثناءات تساعد في ترتيب أولوية المراجعة والتحقيق، ولا تُثبت وحدها وجود مخالفة.**
     */
    public function needsAttention(Request $request): JsonResponse
    {
        // يضمن وجود صفوف القواعد الحالية قبل تصفية طابور الانتباه على الإصدار —
        // بدونها تختفي استثناءات fixture ذات `rule_version` صحيحة لأن whereExists يفشل.
        $this->detection->syncRules();

        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $perPage = min(max((int) ($filters['per_page'] ?? 25), 1), 100);
        $page = max((int) ($filters['page'] ?? 1), 1);

        $items = collect()
            ->merge($this->pendingApprovalItems($request))
            ->merge($this->priorityExceptionItems($request))
            ->merge($this->needsInvestigationExceptionItems($request))
            ->merge($this->caseItems($request))
            ->merge($this->digestHighlightItem($request));

        $items = $items->sortBy([
            ['urgency_rank', 'asc'],
            ['sort_at', 'asc'],
        ])->values();

        $total = $items->count();
        $paged = $items->forPage($page, $perPage)->map(function (array $item) {
            unset($item['sort_at']);

            return $item;
        })->values();

        return response()->json([
            'data' => $paged,
            'meta' => ['total' => $total, 'per_page' => $perPage, 'current_page' => $page, 'last_page' => max(1, (int) ceil($total / $perPage))],
        ]);
    }

    /** رؤية إعداد القواعد (عرض) — يتطلب pos.audit.view. */
    public function rules(Request $request): JsonResponse
    {
        $this->detection->syncRules();
        $rules = PosExceptionRule::query()->orderBy('category')->orderBy('rule_key')->get();

        return response()->json(['data' => $rules->map(fn (PosExceptionRule $rule) => [
            'id' => $rule->id, 'rule_key' => $rule->rule_key, 'category' => $rule->category,
            'is_enabled' => $rule->is_enabled, 'weight' => $rule->weight, 'min_sample' => $rule->min_sample,
            'window_days' => $rule->window_days, 'threshold' => $rule->threshold, 'version' => $rule->version,
        ])->values()]);
    }

    /** تعديل إعداد قاعدة — يتطلب pos.audit.settings.manage. يرفع الإصدار عند التغيير. */
    public function updateRule(Request $request, string $key): JsonResponse
    {
        $this->detection->syncRules();
        $rule = PosExceptionRule::query()->where('rule_key', $key)->firstOrFail();
        $data = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'weight' => ['sometimes', 'integer', 'min:0', 'max:100'],
            'min_sample' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'window_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'threshold' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
        ]);

        // أي تغيير في مقاييس الكشف يرفع الإصدار كي تبقى الاستثناءات التاريخية
        // مفسَّرة بلقطتها ولا تُعاد كتابتها.
        $tuning = array_intersect_key($data, array_flip(['weight', 'min_sample', 'window_days', 'threshold']));
        if ($tuning !== []) {
            $data['version'] = $rule->version + 1;
        }
        $rule->update($data);

        return response()->json(['data' => [
            'rule_key' => $rule->rule_key, 'is_enabled' => $rule->is_enabled, 'weight' => $rule->weight,
            'min_sample' => $rule->min_sample, 'window_days' => $rule->window_days,
            'threshold' => $rule->threshold, 'version' => $rule->version,
        ]]);
    }

    /** إجراء مراجعة — يتطلب pos.audit.review. */
    public function review(Request $request, string $id): JsonResponse
    {
        $exception = $this->visibleExceptions($request)->findOrFail($id);
        $data = $request->validate([
            'to_state' => ['required', Rule::in(PosException::STATES)],
            'reason' => ['nullable', 'string', 'max:80'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);
        $updated = $this->domain(fn () => $this->reviews->transition(
            $exception, $request->user(), $data['to_state'], $data['reason'] ?? null, $data['note'] ?? null,
        ));

        return response()->json(['data' => new PosExceptionResource($updated->load(['reviewer:id,name', 'reviews.reviewer:id,name']))]);
    }

    /** إعادة الحساب — يتطلب pos.audit.recalculate. حتمي وidempotent. */
    public function recalculate(Request $request): JsonResponse
    {
        $summary = $this->detection->run();

        return response()->json(['data' => $summary]);
    }

    // ════════════════════════════ مساعدات ════════════════════════════

    /** @return Builder<PosException> */
    private function visibleExceptions(Request $request): Builder
    {
        return $this->scopeToActiveBranch(PosException::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return Builder<PosRiskSnapshot> */
    private function visibleSnapshots(Request $request): Builder
    {
        return $this->scopeToActiveBranch(PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return Builder<PosSessionEvent> */
    private function visibleEvents(Request $request): Builder
    {
        return $this->scopeToActiveBranch(PosSessionEvent::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return Builder<PosOverrideApproval> */
    private function visibleApprovals(Request $request): Builder
    {
        return $this->scopeToActiveBranch(PosOverrideApproval::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return Builder<PosInvestigationCase> */
    private function visibleCases(Request $request): Builder
    {
        return $this->scopeToActiveBranch(PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return array<string,mixed> */
    private function filters(Request $request): array
    {
        return $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'category' => ['nullable', 'array', 'max:10'], 'category.*' => ['string', 'max:40'],
            'rule_key' => ['nullable', 'string', 'max:80'],
            'severity' => ['nullable', 'array', 'max:5'], 'severity.*' => ['string', 'max:20'],
            'review_state' => ['nullable', 'array', 'max:6'], 'review_state.*' => ['string', 'max:30'],
            'confidence' => ['nullable', 'string', 'max:30'],
            'subject_user_id' => ['nullable', 'uuid'], 'pos_session_id' => ['nullable', 'uuid'],
            'approver_id' => ['nullable', 'uuid'],
            'amount_min' => ['nullable', 'integer'], 'amount_max' => ['nullable', 'integer', 'gte:amount_min'],
            'sort' => ['nullable', 'string', 'max:40'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
    }

    /**
     * @param  Builder<PosException>  $query
     * @param  array<string,mixed>  $filters
     * @return Builder<PosException>
     */
    private function applyFilters(Builder $query, array $filters): Builder
    {
        if (! empty($filters['from'])) $query->where('detected_at', '>=', $filters['from']);
        if (! empty($filters['to'])) $query->where('detected_at', '<=', $filters['to']);
        if (! empty($filters['category'])) $query->whereIn('category', (array) $filters['category']);
        if (! empty($filters['rule_key'])) $query->where('rule_key', $filters['rule_key']);
        if (! empty($filters['severity'])) $query->whereIn('severity', (array) $filters['severity']);
        if (! empty($filters['review_state'])) $query->whereIn('review_state', (array) $filters['review_state']);
        if (! empty($filters['confidence'])) $query->where('evidence_confidence', $filters['confidence']);
        if (! empty($filters['subject_user_id'])) $query->where('subject_user_id', $filters['subject_user_id']);
        if (! empty($filters['approver_id'])) $query->where('approved_by', $filters['approver_id']);
        if (! empty($filters['pos_session_id'])) $query->where('pos_session_id', $filters['pos_session_id']);
        if (isset($filters['amount_min'])) $query->where('amount_under_review', '>=', (int) $filters['amount_min']);
        if (isset($filters['amount_max'])) $query->where('amount_under_review', '<=', (int) $filters['amount_max']);

        return $query;
    }

    /**
     * @param  Builder<PosException>  $query
     * @return Builder<PosException>
     */
    private function applySort(Builder $query, ?string $sort): Builder
    {
        $columns = ['detected_at', 'severity', 'risk_contribution', 'amount_under_review'];
        $descending = str_starts_with((string) $sort, '-');
        $column = ltrim((string) $sort, '-');
        if (! in_array($column, $columns, true)) {
            return $query->orderByDesc('detected_at')->orderByDesc('id');
        }

        return $query->orderBy($column, $descending ? 'desc' : 'asc')->orderByDesc('id');
    }

    /** المبلغ قيد المراجعة المجمّع — مجموع مبالغ الأحداث المتمايزة (بلا ازدواج). */
    private function aggregateAmountUnderReview(Request $request, array $states): int
    {
        $ids = [];
        $this->visibleExceptions($request)->whereIn('review_state', $states)
            ->where('amount_under_review', '>', 0)
            ->select(['amount_event_ids'])
            ->chunk(500, function ($rows) use (&$ids) {
                foreach ($rows as $row) {
                    foreach ((array) $row->amount_event_ids as $id) {
                        $ids[$id] = true;
                    }
                }
            });
        if ($ids === []) {
            return 0;
        }

        return (int) PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('id', array_keys($ids))->sum(DB::raw('ABS(amount)'));
    }

    /**
     * حدّ «تجاوز عتبة نشاط» لقضية مفتوحة — ثابت موثَّق لا إعداد جديد: الخطة لم تطلب حقل
     * إعداد لهذا (خلافاً لـ`outside_hours_grace_minutes`/`self_approval_blocked_for_variance`
     * الصريحين)، وإضافته الآن كانت ستفرض سياسة غير مطلوبة. ٣ أيام بلا أي نشاط توثيقي
     * (`last_activity_at`) اختيار متحفظ يفضّل عدم الإفراط في التنبيه على تفويت قضية راكدة.
     */
    private const CASE_OVERDUE_AFTER_DAYS = 3;

    /** @return \Illuminate\Support\Collection<int,array<string,mixed>> */
    private function pendingApprovalItems(Request $request): \Illuminate\Support\Collection
    {
        // `GET pos/audit/approvals` نفسه محكوم بـ`pos.audit.review`؛ نفس القيد هنا
        // كي لا تُدرَج طلبات موافقة في قائمة من لا يراها أصلاً في تبويب الموافقات.
        $user = $request->user();
        if (! $user || (! $user->hasPermission('pos.audit.review') && ! $user->hasPermission('pos.override.approve'))) {
            return collect();
        }

        return $this->visibleApprovals($request)
            ->where('status', PosOverrideApproval::STATUS_PENDING)
            ->where(fn (Builder $q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->with(['performedBy:id,name'])
            ->orderBy('created_at')
            ->limit(100)
            ->get()
            ->map(fn (PosOverrideApproval $approval) => [
                'id' => 'approval:' . $approval->id,
                'kind' => 'pending_approval',
                'urgency_rank' => 1,
                'sort_at' => $approval->created_at?->toIso8601String(),
                'branch_id' => $approval->branch_id,
                'reference' => ['type' => 'approval', 'id' => $approval->id],
                'operation' => $approval->operation,
                'cart_id' => $approval->cart_id,
                'pos_session_id' => $approval->pos_session_id,
                'reason_code' => $approval->reason_code,
                'performed_by' => $approval->performed_by,
                'performed_by_name' => $approval->performedBy?->name ?? '—',
                'created_at' => $approval->created_at?->toIso8601String(),
                'expires_at' => $approval->expires_at?->toIso8601String(),
            ]);
    }

    /** @return \Illuminate\Support\Collection<int,array<string,mixed>> */
    private function priorityExceptionItems(Request $request): \Illuminate\Support\Collection
    {
        $openStates = [PosException::STATE_NEW, PosException::STATE_REVIEWING];

        return $this->visibleExceptions($request)
            ->where('severity', PosException::SEVERITY_PRIORITY)
            ->whereIn('review_state', $openStates)
            ->where(fn (Builder $q) => $this->constrainToCurrentRuleVersion($q))
            ->with(['subject:id,name'])
            ->orderByDesc('detected_at')
            ->limit(100)
            ->get()
            ->map(fn (PosException $exception) => [
                'id' => 'exception:' . $exception->id,
                'kind' => 'priority_exception',
                'urgency_rank' => 2,
                'sort_at' => $exception->detected_at?->toIso8601String(),
                'branch_id' => $exception->branch_id,
                'reference' => ['type' => 'exception', 'id' => $exception->id],
                'rule_key' => $exception->rule_key,
                'category' => $exception->category,
                'severity' => $exception->severity,
                'review_state' => $exception->review_state,
                'subject_user_id' => $exception->subject_user_id,
                'subject_name' => $exception->subject?->name ?? '—',
                'amount_under_review' => Money::toRiyal((int) $exception->amount_under_review),
                'detected_at' => $exception->detected_at?->toIso8601String(),
            ]);
    }

    /**
     * استثناءات `needs_investigation` **غير المرتبطة بقضية نشطة بعد** — إن رُقّي استثناء
     * إلى قضية بالفعل (`PosCaseEvidenceLink` غير مفكوك)، ظهوره هنا تكرار للعنصر في
     * `caseItems()`؛ لا شيء يُخفى، فقط لا يُعرض مرتين بمصدرين مختلفين لنفس القرار البشري.
     *
     * @return \Illuminate\Support\Collection<int,array<string,mixed>>
     */
    private function needsInvestigationExceptionItems(Request $request): \Illuminate\Support\Collection
    {
        $linkedExceptionIds = PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
            ->where('link_type', PosCaseEvidenceLink::TYPE_EXCEPTION)
            ->whereNotNull('pos_exception_id')
            ->whereNull('unlinked_at')
            ->pluck('pos_exception_id');

        return $this->visibleExceptions($request)
            ->where('review_state', PosException::STATE_NEEDS_INVESTIGATION)
            ->whereNotIn('id', $linkedExceptionIds)
            ->where(fn (Builder $q) => $this->constrainToCurrentRuleVersion($q))
            ->with(['subject:id,name'])
            ->orderByDesc('detected_at')
            ->limit(100)
            ->get()
            ->map(fn (PosException $exception) => [
                'id' => 'exception:' . $exception->id,
                'kind' => 'needs_investigation_exception',
                'urgency_rank' => 2,
                'sort_at' => $exception->detected_at?->toIso8601String(),
                'branch_id' => $exception->branch_id,
                'reference' => ['type' => 'exception', 'id' => $exception->id],
                'rule_key' => $exception->rule_key,
                'category' => $exception->category,
                'severity' => $exception->severity,
                'review_state' => $exception->review_state,
                'subject_user_id' => $exception->subject_user_id,
                'subject_name' => $exception->subject?->name ?? '—',
                'amount_under_review' => Money::toRiyal((int) $exception->amount_under_review),
                'detected_at' => $exception->detected_at?->toIso8601String(),
            ]);
    }

    /** @return \Illuminate\Support\Collection<int,array<string,mixed>> */
    private function caseItems(Request $request): \Illuminate\Support\Collection
    {
        // قضايا التحقيق محكومة بصلاحية أضيق من `pos.audit.view`؛ من لا يملك
        // `pos.investigations.view` لا يرى تفاصيلها أصلاً (`GET pos/investigations/{id}`
        // يرفضها 403)، فلا تُدرَج في القائمة كي لا يظهر عنصر لا يمكن فتحه.
        if (! $request->user()?->hasPermission('pos.investigations.view')) {
            return collect();
        }

        $openStatuses = [
            PosInvestigationCase::STATUS_OPEN, PosInvestigationCase::STATUS_INVESTIGATING,
            PosInvestigationCase::STATUS_AWAITING_INFORMATION,
        ];
        $overdueBefore = now()->subDays(self::CASE_OVERDUE_AFTER_DAYS);

        return $this->visibleCases($request)
            ->whereIn('status', $openStatuses)
            ->where(fn (Builder $q) => $q->whereNull('owner_id')->orWhere('last_activity_at', '<=', $overdueBefore))
            ->with(['owner:id,name', 'subject:id,name'])
            ->orderBy('last_activity_at')
            ->limit(100)
            ->get()
            ->map(function (PosInvestigationCase $case) use ($overdueBefore) {
                $reasons = [];
                if ($case->owner_id === null) $reasons[] = 'unassigned';
                if ($case->last_activity_at !== null && $case->last_activity_at->lte($overdueBefore)) $reasons[] = 'overdue';

                return [
                    'id' => 'case:' . $case->id,
                    'kind' => 'attention_case',
                    'urgency_rank' => 3,
                    'sort_at' => $case->last_activity_at?->toIso8601String() ?? $case->opened_at?->toIso8601String(),
                    'branch_id' => $case->branch_id,
                    'reference' => ['type' => 'case', 'id' => $case->id],
                    'reasons' => $reasons,
                    'number' => $case->number,
                    'title' => $case->title,
                    'status' => $case->status,
                    'priority' => $case->priority,
                    'owner_id' => $case->owner_id,
                    'owner_name' => $case->owner?->name,
                    'subject_user_id' => $case->subject_user_id,
                    'subject_name' => $case->subject?->name ?? '—',
                    'amount_under_review' => Money::toRiyal((int) $case->amount_under_review_minor),
                    'opened_at' => $case->opened_at?->toIso8601String(),
                    'last_activity_at' => $case->last_activity_at?->toIso8601String(),
                ];
            });
    }

    /**
     * إشارة إلى أحدث ملخص يومي فيه ما يستحق الانتباه — بلا نسخ لأي رقم لا يراه المستخدم.
     * `PosLpDigest` مصنَّف `CompanyWide`، فتُعاد الأرقام المشتقّة هنا من `branch_breakdown`
     * المفصَّل فرعياً وحده للمستخدم المقيَّد بفروع — نفس مبدأ
     * `PosLpDigestController::redactForAllowedBranches`، مُضيَّقاً لحاجة هذا العنصر فقط
     * (عدد صحيح للقرار لا نسخة كاملة من الملخص).
     *
     * @return \Illuminate\Support\Collection<int,array<string,mixed>>
     */
    private function digestHighlightItem(Request $request): \Illuminate\Support\Collection
    {
        // نفس قيد `caseItems()`: الملخص اليومي محكوم بـ`pos.investigations.view`
        // (`GET pos/lp-digests/*`)، فلا تُدرَج إشارته في القائمة لمن لا يملكها.
        if (! $request->user()?->hasPermission('pos.investigations.view')) {
            return collect();
        }

        $digest = PosLpDigest::query()->orderByDesc('digest_date')->first();
        if ($digest === null) {
            return collect();
        }

        $allowed = $request->user()?->allowedBranchIds();
        if ($allowed === null) {
            $priority = (int) $digest->priority_exceptions_count;
            $highPriorityCases = (int) $digest->unresolved_high_priority_cases_count;
            $confirmedLoss = (int) $digest->confirmed_loss_count;
        } else {
            $visible = collect($digest->branch_breakdown ?? [])
                ->filter(fn (array $row) => $row['branch_id'] === null || in_array($row['branch_id'], $allowed, true));
            $priority = (int) $visible->sum('priority_exceptions_count');
            $highPriorityCases = (int) $visible->sum('unresolved_high_priority_cases_count');
            $confirmedLoss = (int) $visible->sum('confirmed_loss_count');
        }

        if ($priority === 0 && $highPriorityCases === 0 && $confirmedLoss === 0) {
            return collect();
        }

        return collect([[
            'id' => 'digest:' . $digest->digest_date->toDateString(),
            'kind' => 'digest_highlight',
            'urgency_rank' => 4,
            'sort_at' => $digest->generated_at?->toIso8601String() ?? $digest->digest_date->toDateString(),
            'branch_id' => null,
            'reference' => ['type' => 'digest', 'id' => $digest->digest_date->toDateString()],
            'digest_date' => $digest->digest_date->toDateString(),
            'priority_exceptions_count' => $priority,
            'unresolved_high_priority_cases_count' => $highPriorityCases,
            'confirmed_loss_count' => $confirmedLoss,
        ]]);
    }

    /**
     * طابور Needs Attention يعرض فقط استثناءات إصدار القاعدة الحالي.
     * بعد bump لـ`version` تبقى صفوف الإصدار السابق مجمّدةً للتدقيق التاريخي،
     * لكن ظهورها بجانب النسخة الجديدة في طابور الانتباه يكرّر نفس الإشارة تشغيلياً.
     *
     * @param  Builder<PosException>  $query
     * @return Builder<PosException>
     */
    private function constrainToCurrentRuleVersion(Builder $query): Builder
    {
        return $query->whereExists(function ($sub) {
            $sub->select(DB::raw(1))
                ->from('pos_exception_rules')
                ->whereColumn('pos_exception_rules.tenant_id', 'pos_exceptions.tenant_id')
                ->whereColumn('pos_exception_rules.rule_key', 'pos_exceptions.rule_key')
                ->whereColumn('pos_exception_rules.version', 'pos_exceptions.rule_version');
        });
    }

    /** @return array<string,mixed> */
    private function snapshotData(PosRiskSnapshot $snapshot): array
    {
        return [
            'subject_user_id' => $snapshot->subject_user_id,
            'subject_name' => $snapshot->subject?->name ?? '—',
            'branch_id' => $snapshot->branch_id,
            'total_score' => $snapshot->total_score,
            'band' => $snapshot->band,
            'exception_count' => $snapshot->exception_count,
            'amount_under_review' => Money::toRiyal((int) $snapshot->amount_under_review),
            'amount_under_review_minor' => (int) $snapshot->amount_under_review,
            'sample_size' => $snapshot->sample_size,
            'sample_sufficient' => $snapshot->sample_sufficient,
            'components' => $snapshot->components,
            'window_start' => $snapshot->window_start?->toIso8601String(),
            'window_end' => $snapshot->window_end?->toIso8601String(),
            'calculated_at' => $snapshot->calculated_at?->toIso8601String(),
        ];
    }
}
