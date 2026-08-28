<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PosCaseActivityResource;
use App\Http\Resources\PosCaseEvidenceLinkResource;
use App\Http\Resources\PosCaseNoteResource;
use App\Http\Resources\PosCctvBookmarkResource;
use App\Http\Resources\PosInvestigationCaseResource;
use App\Http\Resources\PosSessionEventResource;
use App\Models\PosCaseEvidenceLink;
use App\Models\PosCctvBookmark;
use App\Models\PosException;
use App\Models\PosInvestigationCase;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Services\Pos\PosCctvBookmarkService;
use App\Services\Pos\PosInvestigationCaseService;
use App\Support\Money;
use App\Support\Rbac;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * إدارة قضايا التحقيق (Phase 3) فوق نفس workspace التدقيق. القراءة والفلترة والترقيم
 * خادمية بالكامل، والعزل tenant/branch مفروض خادمياً. لا كتابة محاسبية من هنا مطلقاً —
 * `confirmed_loss`/`recovered_amount` بيانات قرار تحقيق بشري لا تمرّ عبر `LedgerService`.
 */
class PosInvestigationCaseController extends ApiController
{
    public function __construct(
        private readonly PosInvestigationCaseService $cases,
        private readonly PosCctvBookmarkService $cctv,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'status' => ['nullable', 'array', 'max:8'], 'status.*' => ['string', Rule::in(PosInvestigationCase::STATUSES)],
            'priority' => ['nullable', 'array', 'max:4'], 'priority.*' => ['string', Rule::in(PosInvestigationCase::PRIORITIES)],
            'owner_id' => ['nullable', 'uuid'], 'unassigned' => ['nullable', 'boolean'],
            'subject_user_id' => ['nullable', 'uuid'], 'number' => ['nullable', 'string', 'max:40'],
            'amount_min' => ['nullable', 'integer'], 'amount_max' => ['nullable', 'integer', 'gte:amount_min'],
            'outcome' => ['nullable', 'string', 'max:30'],
            'mine' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'string', 'max:40'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = $this->visibleCases($request)->with(['owner:id,name', 'subject:id,name', 'session:id,number']);

        if (! empty($filters['from'])) $query->where('opened_at', '>=', $filters['from']);
        if (! empty($filters['to'])) $query->where('opened_at', '<=', $filters['to']);
        if (! empty($filters['status'])) $query->whereIn('status', (array) $filters['status']);
        if (! empty($filters['priority'])) $query->whereIn('priority', (array) $filters['priority']);
        if (! empty($filters['owner_id'])) $query->where('owner_id', $filters['owner_id']);
        if (! empty($filters['unassigned'])) $query->whereNull('owner_id');
        if (! empty($filters['subject_user_id'])) $query->where('subject_user_id', $filters['subject_user_id']);
        if (! empty($filters['number'])) $query->where('number', 'like', '%' . $filters['number'] . '%');
        if (! empty($filters['outcome'])) $query->where('outcome', $filters['outcome']);
        if (isset($filters['amount_min'])) $query->where('amount_under_review_minor', '>=', (int) $filters['amount_min']);
        if (isset($filters['amount_max'])) $query->where('amount_under_review_minor', '<=', (int) $filters['amount_max']);
        if (! empty($filters['mine'])) $query->where('owner_id', $request->user()->id);

        $total = (clone $query)->count();
        $perPage = min(max((int) ($filters['per_page'] ?? 25), 1), 100);
        $page = max((int) ($filters['page'] ?? 1), 1);
        $query = $this->applySort($query, $filters['sort'] ?? null)->forPage($page, $perPage);

        return response()->json([
            'data' => PosInvestigationCaseResource::collection($query->get()),
            'meta' => ['total' => $total, 'per_page' => $perPage, 'current_page' => $page, 'last_page' => max(1, (int) ceil($total / $perPage))],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)
            ->with(['owner:id,name', 'openedByUser:id,name', 'subject:id,name', 'session:id,number'])
            ->findOrFail($id);

        return response()->json(['data' => new PosInvestigationCaseResource($case)]);
    }

    /** خط زمني موحّد للأدلة/الملاحظات/النشاط/مراجع الكاميرا — للقراءة فقط. */
    public function timeline(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);

        $links = PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case->id)
            ->with(['exception.subject:id,name', 'event'])
            ->orderByDesc('linked_at')->get();
        $notes = $case->notes()->with('author:id,name')->get();
        $activities = $case->activities()->with('actor:id,name')->get();
        $bookmarks = $case->cctvBookmarks()->with('createdByUser:id,name')->orderByDesc('timestamp_start')->get();

        return response()->json(['data' => [
            'evidence_links' => PosCaseEvidenceLinkResource::collection($links),
            'notes' => PosCaseNoteResource::collection($notes),
            'activities' => PosCaseActivityResource::collection($activities),
            'cctv_bookmarks' => PosCctvBookmarkResource::collection($bookmarks),
        ]]);
    }

    /** فحص قضايا مفتوحة محتملة الازدواج قبل الإنشاء — تحذير لا اندماج تلقائي. */
    public function duplicateCheck(Request $request): JsonResponse
    {
        $data = $request->validate([
            'subject_user_id' => ['nullable', 'uuid'],
            'pos_session_id' => ['nullable', 'uuid'],
        ]);

        $duplicates = $this->cases->findPossibleDuplicates($data['subject_user_id'] ?? null, $data['pos_session_id'] ?? null);

        return response()->json(['data' => PosInvestigationCaseResource::collection(collect($duplicates))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'summary' => ['nullable', 'string', 'max:5000'],
            'priority' => ['nullable', 'string', Rule::in(PosInvestigationCase::PRIORITIES)],
            'owner_id' => ['nullable', 'uuid'],
            'subject_user_id' => ['nullable', 'uuid'],
            'pos_session_id' => ['nullable', 'uuid'],
            'cart_id' => ['nullable', 'uuid'],
            'correlation_id' => ['nullable', 'uuid'],
            'opened_at' => ['nullable', 'date'],
        ]);

        if (! empty($data['owner_id'])) {
            $this->assertUserInTenant($data['owner_id'], 'المستخدم المسنَد إليه');
        }
        if (! empty($data['subject_user_id'])) {
            $this->assertUserInTenant($data['subject_user_id'], 'موضوع القضية');
        }
        if (! empty($data['pos_session_id'])) {
            $this->assertTenantOwned(\App\Models\PosSession::class, $data['pos_session_id'], 'جلسة نقطة البيع');
        }

        $result = $this->domain(fn () => $this->cases->create($request->user(), $data));

        return response()->json([
            'data' => new PosInvestigationCaseResource($result['case']->load(['owner:id,name', 'subject:id,name'])),
            'meta' => ['possible_duplicates' => PosInvestigationCaseResource::collection(collect($result['duplicates']))],
        ], 201);
    }

    /** ترقية استثناء إلى قضية جديدة — يربطه مباشرة بلا مسّ لحالة المراجعة الخفيفة الخاصة به. */
    public function promoteException(Request $request): JsonResponse
    {
        $data = $request->validate([
            'pos_exception_id' => ['required', 'uuid'],
            'title' => ['nullable', 'string', 'max:200'],
            'summary' => ['nullable', 'string', 'max:5000'],
            'priority' => ['nullable', 'string', Rule::in(PosInvestigationCase::PRIORITIES)],
            'owner_id' => ['nullable', 'uuid'],
            'rationale' => ['nullable', 'string', 'max:2000'],
        ]);

        $exception = PosException::query()->withoutGlobalScope(BranchScope::class)->findOrFail($data['pos_exception_id']);
        if (! empty($data['owner_id'])) {
            $this->assertUserInTenant($data['owner_id'], 'المستخدم المسنَد إليه');
        }

        $result = $this->domain(fn () => $this->cases->promoteException($request->user(), $exception, $data));

        return response()->json([
            'data' => new PosInvestigationCaseResource($result['case']->load(['owner:id,name', 'subject:id,name'])),
            'meta' => ['possible_duplicates' => PosInvestigationCaseResource::collection(collect($result['duplicates']))],
        ], 201);
    }

    public function linkException(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate([
            'pos_exception_id' => ['required', 'uuid'],
            'rationale' => ['nullable', 'string', 'max:2000'],
        ]);
        $exception = PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('tenant_id', $case->tenant_id)->find($data['pos_exception_id']);
        if (! $exception) {
            abort(422, 'الاستثناء غير موجود ضمن هذا المستأجر.');
        }

        $link = $this->domain(fn () => $this->cases->linkException($request->user(), $case, $exception, $data['rationale'] ?? null));

        return response()->json(['data' => new PosCaseEvidenceLinkResource($link->load(['exception']))]);
    }

    public function linkEvent(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate([
            'pos_session_event_id' => ['required', 'uuid'],
            'rationale' => ['nullable', 'string', 'max:2000'],
        ]);
        $event = PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->where('tenant_id', $case->tenant_id)->find($data['pos_session_event_id']);
        if (! $event) {
            abort(422, 'الحدث غير موجود ضمن هذا المستأجر.');
        }

        $link = $this->domain(fn () => $this->cases->linkEvent($request->user(), $case, $event, $data['rationale'] ?? null));

        return response()->json(['data' => new PosCaseEvidenceLinkResource($link->load(['event']))]);
    }

    public function unlinkEvidence(Request $request, string $id, string $linkId): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $link = PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case->id)->findOrFail($linkId);
        $data = $request->validate(['rationale' => ['nullable', 'string', 'max:2000']]);

        $updated = $this->domain(fn () => $this->cases->unlink($request->user(), $case, $link, $data['rationale'] ?? null));

        return response()->json(['data' => new PosCaseEvidenceLinkResource($updated)]);
    }

    public function assign(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate(['owner_id' => ['nullable', 'uuid']]);
        if (! empty($data['owner_id'])) {
            $this->assertUserInTenant($data['owner_id'], 'المستخدم المسنَد إليه');
        }

        $updated = $this->domain(fn () => $this->cases->assign($request->user(), $case, $data['owner_id'] ?? null));

        return response()->json(['data' => new PosInvestigationCaseResource($updated->load('owner:id,name'))]);
    }

    public function updatePriority(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate(['priority' => ['required', 'string', Rule::in(PosInvestigationCase::PRIORITIES)]]);

        $updated = $this->domain(fn () => $this->cases->changePriority($request->user(), $case, $data['priority']));

        return response()->json(['data' => new PosInvestigationCaseResource($updated)]);
    }

    public function addNote(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate([
            'body' => ['required', 'string', 'max:5000'],
            'category' => ['nullable', 'string', Rule::in(\App\Models\PosCaseNote::CATEGORIES)],
        ]);

        $note = $this->domain(fn () => $this->cases->addNote($request->user(), $case, $data['body'], $data['category'] ?? 'general'));

        return response()->json(['data' => new PosCaseNoteResource($note->load('author:id,name'))], 201);
    }

    /**
     * انتقال حالة/حسم. حالات الحسم (`OUTCOME_STATUSES`) تتطلب إضافةً صلاحية
     * `pos.investigations.resolve` — لا تكفي `pos.investigations.manage` وحدها، فالخسارة
     * المؤكَّدة والإغلاق قرار سلطة أعلى صراحة (بند القبول ٦/٢٠).
     */
    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate([
            'status' => ['required', 'string', Rule::in(PosInvestigationCase::STATUSES)],
            'reason' => ['nullable', 'string', 'max:80'],
            'note' => ['nullable', 'string', 'max:2000'],
            'confirmed_loss_minor' => ['nullable', 'integer', 'min:0'],
            'recovered_amount_minor' => ['nullable', 'integer', 'min:0'],
        ]);

        if (in_array($data['status'], PosInvestigationCase::OUTCOME_STATUSES, true)
            && ! Rbac::allows($request->user()->role, 'pos.investigations.resolve')) {
            abort(403, 'حسم القضية يتطلب صلاحية pos.investigations.resolve.');
        }

        $updated = $this->domain(fn () => $this->cases->changeStatus(
            $request->user(), $case, $data['status'], $data['reason'] ?? null, $data['note'] ?? null,
            $data['confirmed_loss_minor'] ?? null, $data['recovered_amount_minor'] ?? null,
        ));

        return response()->json(['data' => new PosInvestigationCaseResource($updated)]);
    }

    public function reopen(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $request->validate(['reason' => ['required', 'string', 'max:2000']]);

        $updated = $this->domain(fn () => $this->cases->reopen($request->user(), $case, $data['reason']));

        return response()->json(['data' => new PosInvestigationCaseResource($updated)]);
    }

    // ════════════════════════════ CCTV Bookmarks ════════════════════════════

    public function storeCctvBookmark(Request $request, string $id): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $data = $this->validateCctvBookmark($request);

        $bookmark = $this->domain(fn () => $this->cctv->create($request->user(), $case, $data));

        return response()->json(['data' => new PosCctvBookmarkResource($bookmark->load('createdByUser:id,name'))], 201);
    }

    public function updateCctvBookmark(Request $request, string $id, string $bookmarkId): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $bookmark = PosCctvBookmark::query()->withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case->id)->findOrFail($bookmarkId);
        $data = $this->validateCctvBookmark($request, true);

        $updated = $this->domain(fn () => $this->cctv->update($request->user(), $case, $bookmark, $data));

        return response()->json(['data' => new PosCctvBookmarkResource($updated)]);
    }

    public function destroyCctvBookmark(Request $request, string $id, string $bookmarkId): JsonResponse
    {
        $case = $this->visibleCases($request)->findOrFail($id);
        $bookmark = PosCctvBookmark::query()->withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case->id)->findOrFail($bookmarkId);

        $this->domain(fn () => $this->cctv->delete($request->user(), $case, $bookmark));

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function export(Request $request): JsonResponse|\Symfony\Component\HttpFoundation\StreamedResponse
    {
        $query = $this->visibleCases($request)->with(['owner:id,name', 'subject:id,name'])->orderByDesc('opened_at');

        $headers = ['Content-Type' => 'text/csv; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="investigation-cases.csv"'];

        return response()->streamDownload(function () use ($query) {
            $out = fopen('php://output', 'w');
            fputs($out, "\xEF\xBB\xBF");
            fputcsv($out, ['number', 'title', 'status', 'priority', 'owner', 'subject', 'amount_under_review', 'confirmed_loss', 'opened_at', 'outcome']);
            $query->chunk(200, function ($rows) use ($out) {
                foreach ($rows as $row) {
                    fputcsv($out, [
                        $row->number, $row->title, $row->status, $row->priority,
                        $row->owner?->name ?? '', $row->subject?->name ?? '',
                        Money::toRiyal((int) $row->amount_under_review_minor),
                        $row->confirmed_loss_minor !== null ? Money::toRiyal((int) $row->confirmed_loss_minor) : '',
                        $row->opened_at?->toIso8601String(), $row->outcome ?? '',
                    ]);
                }
            });
            fclose($out);
        }, 'investigation-cases.csv', $headers);
    }

    // ════════════════════════════ مساعدات ════════════════════════════

    /**
     * تحقق ملكية مرجع مستخدم داخل المستأجر. `User` لا يرث `BaseModel`/`TenantScope`
     * (يستحيل تفعيله قبل حلّ المصادقة نفسها)، فـ`assertTenantOwned` العامة لا تفلتره
     * فعلياً — التصفية الصريحة بـ`tenant_id` هنا إلزامية، بنفس نمط بقية المتحكّمات
     * (`UserController`, `RoleController`) التي تستعلم `User` صراحةً لهذا السبب.
     */
    private function assertUserInTenant(?string $userId, string $label): void
    {
        if ($userId !== null && ! User::where('tenant_id', app(TenantContext::class)->id())->whereKey($userId)->exists()) {
            abort(422, "{$label} غير موجود.");
        }
    }

    /** @return Builder<PosInvestigationCase> */
    private function visibleCases(Request $request): Builder
    {
        return $this->scopeToActiveBranch(PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return Builder<PosInvestigationCase> */
    private function applySort(Builder $query, ?string $sort): Builder
    {
        $columns = ['opened_at', 'last_activity_at', 'priority', 'amount_under_review_minor', 'status'];
        $descending = str_starts_with((string) $sort, '-');
        $column = ltrim((string) $sort, '-');
        if (! in_array($column, $columns, true)) {
            return $query->orderByDesc('last_activity_at')->orderByDesc('id');
        }

        return $query->orderBy($column, $descending ? 'desc' : 'asc')->orderByDesc('id');
    }

    /** @return array<string,mixed> */
    private function validateCctvBookmark(Request $request, bool $isUpdate = false): array
    {
        $required = $isUpdate ? 'sometimes' : 'required';

        $data = $request->validate([
            'pos_session_id' => ['nullable', 'uuid'],
            'cart_id' => ['nullable', 'uuid'],
            'correlation_id' => ['nullable', 'uuid'],
            'camera_label' => [$required, 'string', 'max:120'],
            'timestamp_start' => [$required, 'date'],
            'timestamp_end' => ['nullable', 'date', 'after_or_equal:timestamp_start'],
            'source_timezone' => ['nullable', 'string', 'max:60'],
            'external_reference' => ['nullable', 'string', 'max:2048'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        if (! empty($data['external_reference'])) {
            $reference = trim($data['external_reference']);
            if (! preg_match('#^https?://#i', $reference)) {
                throw ValidationException::withMessages(['external_reference' => 'مرجع الكاميرا الخارجي يجب أن يبدأ بـ http:// أو https:// فقط.']);
            }
            $data['external_reference'] = $reference;
        }

        return $data;
    }
}
