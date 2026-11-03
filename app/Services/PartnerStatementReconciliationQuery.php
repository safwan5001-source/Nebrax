<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementMatchRun;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReviewDecision;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Rbac;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * قراءة مقارنات كشوف الأطراف للواجهة (IMP-PS-A4a0، N1–N4): القائمة والرأس وسطور الكشف وسياق السطر/القرار الفعّال لصفوف المطابقة. **قراءة فقط**: لا قيد ولا مستند ولا رصيد ولا ZATCA
 * ولا كتابة في أي جدول؛ لا يستدعي `LedgerService`. الصلاحيات على المسار (`partner_statements.view` + بوابة القدرة) وتُعاد هنا كما في بقية قراءات الوحدة.
 *
 *  - **رؤية القائمة = رؤية الرأس (`PartnerStatementMatchService::authorize` ← `PartnerStatementImportService::assertAccess`)** لكن **باستعلام مجمَّع** لا بفحص لكل صف:
 *    الثوابت على الفاعل (نشاط، `partners.view`، عملة المؤسسة) تُفحص مرة واحدة وتُرفض بالرسالة نفسها؛ ورؤية الطرف (موجود غير محذوف، نوعه يوافق الدور) والفرع
 *    (`policy.branch_id` فارغ، أو فرع موجود ضمن نطاق الفاعل) شروط `WHERE` في الاستعلام نفسه — فالعدّاد والترقيم والبحث والفرز كلها تعمل على المرئي فقط ولا تكشف المحجوب.
 *    تطابق القاعدتين يحرسه اختبار مكافئ (oracle) في `PartnerStatementReadApiTest`.
 *  - **بحث `q`** يُطبَّق بـ`AND` بعد شروط الرؤية، وعلى اسم الملف واسم الطرف المرئي فقط.
 *  - **القرار الفعّال لسطر** = أعلى نسخة غير `clear` (كـ`PartnerStatementReviewService`)، ولا يُعرض إلا إن كانت تشغيلته مقروءة للفاعل (كقائمة القرارات).
 */
final class PartnerStatementReconciliationQuery
{
    public const MAX_PER_PAGE = 50;

    public const DEFAULT_PER_PAGE = 25;

    /** مفاتيح الفرز المسموحة (قائمة بيضاء) ← عمود أو تعبير فرز. */
    /** رسالة رفض الفرع في `assertAccess` (غير موحَّدة تاريخياً)؛ تُوحَّد في N2/N4 الجديدتين كي لا تفرّق بين «غير موجود» و«فرع خارج نطاقك». */
    private const BRANCH_REFUSAL = 'هذا الفرع خارج نطاق صلاحياتك.';

    public const SORTS = ['created_at', 'period_from', 'period_to', 'status', 'line_count', 'original_filename', 'partner_name'];

    public function __construct(private readonly TenantContext $tenant, private readonly PartnerStatementMatchService $matching) {}

    // ═══════════════════════════════ N1: القائمة ═══════════════════════════════

    /**
     * @param  array{status?: ?array<int, string>, partner_id?: ?string, role?: ?string, period_from?: ?string, period_to?: ?string, branch_id?: ?string, q?: ?string, sort?: ?string, per_page?: ?int, page?: ?int}  $filters
     */
    public function paginate(User $actor, array $filters): LengthAwarePaginator
    {
        $this->assertActorMayRead($actor);

        $query = PartnerStatementReconciliation::query();
        $this->applyVisibility($query, $actor);

        if (! empty($filters['status'])) {
            $query->whereIn('status', array_values((array) $filters['status']));
        }
        if (! empty($filters['partner_id'])) {
            $query->where('partner_id', $filters['partner_id']);
        }
        if (! empty($filters['role'])) {
            $query->where('role', $filters['role']);
        }
        // نافذة الفترة: المقارنات التي تتقاطع فترتها مع [period_from, period_to] (أحد الطرفين اختياري).
        if (! empty($filters['period_from'])) {
            $query->where('period_to', '>=', $filters['period_from']);
        }
        if (! empty($filters['period_to'])) {
            $query->where('period_from', '<=', $filters['period_to']);
        }
        if (! empty($filters['branch_id'])) {
            $query->where('policy->branch_id', $filters['branch_id']);
        }
        $needle = trim((string) ($filters['q'] ?? ''));
        if ($needle !== '') {
            $this->applySearch($query, $needle);
        }

        $this->applySort($query, (string) ($filters['sort'] ?? '-created_at'));
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) ($filters['per_page'] ?? self::DEFAULT_PER_PAGE)));
        $page = $query->paginate($perPage);

        $rows = $page->getCollection();
        $partners = $this->partnersById($rows->pluck('partner_id')->all());
        $branches = $this->branchesById($rows->map(fn (PartnerStatementReconciliation $r) => $r->policy['branch_id'] ?? null)->filter()->unique()->values()->all());

        return $page->through(fn (PartnerStatementReconciliation $r): array => $this->present($r, $partners, $branches));
    }

    // ═══════════════════════════════ N2: الرأس ═══════════════════════════════

    /** @return array<string, mixed> */
    public function header(User $actor, string $reconciliationId): array
    {
        // نفس بوابة بقية قراءات الوحدة حرفياً: الصلاحية ← معرّف صالح ← وجود ← `assertAccess` (رفض موحَّد `PARTNER_UNAVAILABLE`).
        $reconciliation = $this->authorizeUniformly($actor, $reconciliationId);
        $branchId = $reconciliation->policy['branch_id'] ?? null;

        return $this->present(
            $reconciliation,
            $this->partnersById([(string) $reconciliation->partner_id]),
            $this->branchesById($branchId === null ? [] : [(string) $branchId]),
        ) + [
            'policy' => $reconciliation->policy,
            'checks' => $reconciliation->checks,
            'source_import_job_id' => $reconciliation->source_import_job_id,
            'reviewed_by' => $reconciliation->reviewed_by,
            'reviewed_run_id' => $reconciliation->reviewed_run_id,
            'closed_by' => $reconciliation->closed_by,
            'scope_key' => $reconciliation->scope_key,
            'voided_by' => $reconciliation->voided_by,
            'void_reason' => $reconciliation->void_reason,
        ];
    }

    // ═══════════════════════════════ N4: سطور الكشف ═══════════════════════════════

    /**
     * سطور الكشف بترتيب `ordinal` الثابت (قبل أي تشغيلة مطابقة). نفس رفض الرأس لمقارنة غير مرئية.
     *
     * @param  array{per_page?: ?int, page?: ?int}  $filters
     */
    public function lines(User $actor, string $reconciliationId, array $filters): LengthAwarePaginator
    {
        $reconciliation = $this->authorizeUniformly($actor, $reconciliationId);
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) ($filters['per_page'] ?? self::DEFAULT_PER_PAGE)));

        return PartnerStatementLine::query()->where('reconciliation_id', $reconciliation->id)->orderBy('ordinal')->orderBy('id')
            ->paginate($perPage)->through(fn (PartnerStatementLine $l): array => $this->presentLine($l));
    }

    // ═══════════════════════════════ N3: سياق صفوف المطابقة ═══════════════════════════════

    /**
     * يضيف `line` و`decision` إلى صفوف جهة الكشف (وبـ`null` لجهة الدفتر) بثلاثة استعلامات ثابتة مهما بلغ حجم الصفحة. حقول الصف الأصلية لا تُمَسّ.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    public function withLineContext(User $actor, string $reconciliationId, array $rows): array
    {
        $lineIds = array_values(array_unique(array_filter(array_map(fn (array $r): ?string => ($r['side'] ?? null) === 'statement' ? ($r['line_id'] ?? null) : null, $rows))));
        $lines = [];
        $decisions = [];
        if ($lineIds !== []) {
            foreach (PartnerStatementLine::query()->where('reconciliation_id', $reconciliationId)->whereIn('id', $lineIds)->get() as $line) {
                $lines[$line->id] = $this->presentLine($line);
            }
            $decisions = $this->effectiveDecisions($actor, $reconciliationId, $lineIds);
        }

        return array_map(fn (array $row): array => $row + [
            'line' => ($row['side'] ?? null) === 'statement' ? ($lines[$row['line_id'] ?? ''] ?? null) : null,
            'decision' => ($row['side'] ?? null) === 'statement' ? ($decisions[$row['line_id'] ?? ''] ?? null) : null,
        ], $rows);
    }

    /**
     * القرار الفعّال لكل سطر من المعطاة (أعلى نسخة غير `clear`) بشرط أن تكون تشغيلته مقروءة للفاعل — كما في `GET …/decisions` (القرار الأحدث على تشغيلة غير مقروءة ⇒ لا قرار ظاهر).
     *
     * @param  list<string>  $lineIds
     * @return array<string, array<string, mixed>>
     */
    private function effectiveDecisions(User $actor, string $reconciliationId, array $lineIds): array
    {
        $latest = [];
        foreach (PartnerStatementReviewDecision::query()->where('reconciliation_id', $reconciliationId)->whereIn('line_id', $lineIds)->orderBy('line_id')->orderBy('revision')->get() as $decision) {
            $latest[$decision->line_id] = $decision;   // الأخير في الترتيب = أعلى نسخة
        }
        $latest = array_filter($latest, fn (PartnerStatementReviewDecision $d): bool => $d->action !== PartnerStatementReviewDecision::ACTION_CLEAR);
        if ($latest === []) {
            return [];
        }

        $readable = [];
        $allowed = $actor->allowedBranchIds();   // استعلام واحد لكل طلب، لا لكل تشغيلة
        $runIds = array_values(array_unique(array_map(fn (PartnerStatementReviewDecision $d): string => (string) $d->run_id, $latest)));
        foreach (PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliationId)->whereIn('id', $runIds)->get() as $run) {
            $readable[$run->id] = $this->matching->readableWithin($allowed, $run);
        }

        $out = [];
        foreach ($latest as $lineId => $decision) {
            if ($readable[$decision->run_id] ?? false) {
                $out[$lineId] = $this->presentDecision($decision);
            }
        }

        return $out;
    }

    // ═══════════════════════════════ الرؤية ═══════════════════════════════

    /**
     * بوابة الرأس والسطور: `PartnerStatementMatchService::authorize` نفسها، لكن فرعٌ خارج نطاق الفاعل يُرفض بالرسالة الموحَّدة `PARTNER_UNAVAILABLE`
     * (كالمجهول والطرف غير المتاح) فلا يكشف وجود مقارنة في فرع محجوب. الصلاحية (403) وعملة المؤسسة تبقيان كما هما.
     */
    private function authorizeUniformly(User $actor, string $reconciliationId): PartnerStatementReconciliation
    {
        try {
            return $this->matching->authorize($actor, $reconciliationId, 'partner_statements.view');
        } catch (RuntimeException $e) {
            if ($e->getMessage() === self::BRANCH_REFUSAL) {
                throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
            }
            throw $e;
        }
    }

    /**
     * ثوابت الفاعل في `assertAccess` — تنطبق على كل المقارنات سواء، فتُفحص مرة واحدة وتُرفض بالرسالة نفسها التي يرفض بها الرأس (لا تفاصيل إضافية).
     */
    private function assertActorMayRead(User $actor): void
    {
        if (! Rbac::allows((string) $actor->role, 'partner_statements.view')) {
            throw new \Illuminate\Auth\Access\AuthorizationException('ليس لديك صلاحية لتنفيذ هذا الإجراء.');
        }
        if ($actor->is_active === false || ! Rbac::allows((string) $actor->role, 'partners.view')) {
            throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
        }
        $tenant = Tenant::query()->find($this->tenant->id());
        if ($tenant === null || strtoupper((string) $tenant->currency) !== 'SAR') {
            throw new RuntimeException('كشوف الأطراف بالريال السعودي فقط، وعملة مؤسستك مختلفة.');
        }
    }

    /** شروط رؤية الطرف والفرع (بقية `assertAccess`) كـ`WHERE` على الاستعلام نفسه. */
    private function applyVisibility(Builder $query, User $actor): void
    {
        $table = (new PartnerStatementReconciliation)->getTable();

        // الطرف: موجود غير محذوف في المؤسسة، ونوعه يوافق الدور (عميل ← customer|both، وغيره ← supplier|both).
        $query->whereExists(function ($sub) use ($table): void {
            $sub->select(DB::raw('1'))->from('partners')
                ->whereColumn('partners.id', $table.'.partner_id')
                ->whereColumn('partners.tenant_id', $table.'.tenant_id')
                ->whereNull('partners.deleted_at')
                ->where(function ($types) use ($table): void {
                    $types->where(fn ($q) => $q->where($table.'.role', PartnerStatementReconciliation::ROLE_CUSTOMER)->whereIn('partners.type', ['customer', 'both']))
                        ->orWhere(fn ($q) => $q->where($table.'.role', '!=', PartnerStatementReconciliation::ROLE_CUSTOMER)->whereIn('partners.type', ['supplier', 'both']));
                });
        });

        // الفرع: بلا فرع في السياسة، أو فرع موجود في المؤسسة وضمن نطاق الفاعل. قائمة المعرّفات المرئية استعلام واحد صغير (عدد الفروع) لا فحص لكل صف.
        $visible = Branch::query();
        $allowed = $actor->allowedBranchIds();
        if ($allowed !== null) {
            $visible->whereIn('id', $allowed);
        }
        $ids = $visible->pluck('id')->map(fn ($id): string => (string) $id)->all();
        $query->where(function (Builder $q) use ($ids): void {
            $q->whereNull('policy->branch_id');
            if ($ids !== []) {
                $q->orWhereIn('policy->branch_id', $ids);
            }
        });
    }

    private function applySearch(Builder $query, string $needle): void
    {
        $table = (new PartnerStatementReconciliation)->getTable();
        // الهروب بالرمز `!` لا `\`: ماسح PDO في PostgreSQL يفسّر `'\'` كاقتباس مُهرَّب فيبتلع العناصر النائبة التالية.
        $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($needle)).'%';
        $query->where(function (Builder $q) use ($like, $table): void {
            $q->whereRaw("lower({$table}.original_filename) like ? escape '!'", [$like])
                ->orWhereExists(function ($sub) use ($like, $table): void {
                    $sub->select(DB::raw('1'))->from('partners')
                        ->whereColumn('partners.id', $table.'.partner_id')->whereColumn('partners.tenant_id', $table.'.tenant_id')->whereNull('partners.deleted_at')
                        ->where(fn ($n) => $n->whereRaw("lower(partners.name) like ? escape '!'", [$like])->orWhereRaw("lower(coalesce(partners.name_en, '')) like ? escape '!'", [$like]));
                });
        });
    }

    private function applySort(Builder $query, string $sort): void
    {
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $key = ltrim($sort, '-');
        $table = (new PartnerStatementReconciliation)->getTable();
        if ($key === 'partner_name') {
            $query->orderBy(DB::table('partners')->select('partners.name')->whereColumn('partners.id', $table.'.partner_id')->whereColumn('partners.tenant_id', $table.'.tenant_id')->limit(1), $direction);
        } else {
            $query->orderBy($table.'.'.$key, $direction);
        }
        // ترتيب ثابت متعادل (لا تكرار ولا فقد بين الصفحات).
        $query->orderBy($table.'.id', $direction);
    }

    // ═══════════════════════════════ العرض ═══════════════════════════════

    /**
     * @param  list<string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function partnersById(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        foreach (BranchScope::reference(Partner::class)->whereIn('id', array_values(array_unique($ids)))->get(['id', 'name', 'name_en', 'type']) as $partner) {
            $out[$partner->id] = ['id' => $partner->id, 'name' => $partner->name, 'name_en' => $partner->name_en, 'type' => $partner->type];
        }

        return $out;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function branchesById(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        foreach (Branch::query()->whereIn('id', array_values(array_unique($ids)))->get(['id', 'name', 'code']) as $branch) {
            $out[$branch->id] = ['id' => $branch->id, 'name' => $branch->name, 'code' => $branch->code];
        }

        return $out;
    }

    /**
     * @param  array<string, array<string, mixed>>  $partners
     * @param  array<string, array<string, mixed>>  $branches
     * @return array<string, mixed>
     */
    private function present(PartnerStatementReconciliation $r, array $partners, array $branches): array
    {
        $branchId = $r->policy['branch_id'] ?? null;

        return [
            'id' => $r->id, 'status' => $r->status, 'role' => $r->role, 'partner_id' => $r->partner_id, 'partner' => $partners[$r->partner_id] ?? null,
            'branch_id' => $branchId, 'branch' => $branchId === null ? null : ($branches[$branchId] ?? null),
            'period_from' => $r->period_from->toDateString(), 'period_to' => $r->period_to->toDateString(), 'currency' => $r->currency,
            'original_filename' => $r->original_filename, 'line_count' => (int) $r->line_count,
            'total_debit_minor' => (int) $r->total_debit_minor, 'total_credit_minor' => (int) $r->total_credit_minor,
            'created_by' => $r->created_by, 'created_at' => optional($r->created_at)->toIso8601String(),
            'reviewed_at' => optional($r->reviewed_at)->toIso8601String(), 'closed_at' => optional($r->closed_at)->toIso8601String(),
            'voided_at' => optional($r->voided_at)->toIso8601String(), 'superseded_by_id' => $r->superseded_by_id,
        ];
    }

    /** @return array<string, mixed> */
    private function presentLine(PartnerStatementLine $l): array
    {
        return [
            'id' => $l->id, 'ordinal' => $l->ordinal, 'date' => $l->line_date->toDateString(), 'reference' => $l->reference, 'our_reference' => $l->our_reference,
            'description' => $l->description, 'debit_minor' => (int) $l->debit_minor, 'credit_minor' => (int) $l->credit_minor,
            'balance_minor' => $l->balance_minor === null ? null : (int) $l->balance_minor, 'kind' => $l->kind,
        ];
    }

    /** نفس شكل `GET …/decisions` (المرجع: `PartnerStatementReviewService::present`) — يحرس تطابقهما اختبار. @return array<string, mixed> */
    private function presentDecision(PartnerStatementReviewDecision $d): array
    {
        return [
            'id' => $d->id, 'reconciliation_id' => $d->reconciliation_id, 'run_id' => $d->run_id, 'line_id' => $d->line_id, 'revision' => $d->revision, 'action' => $d->action,
            'unit_keys' => $d->unit_keys, 'engine_outcome' => $d->engine_outcome, 'engine_code' => $d->engine_code,
            'pair' => $d->pair_member === null ? null : ['member' => $d->pair_member, 'original_entry_id' => $d->pair_original_entry_id, 'reversal_entry_id' => $d->pair_reversal_entry_id],
            'expected_net_minor' => $d->expected_net_minor, 'set_net_minor' => $d->set_net_minor,
            'difference_minor' => $d->difference_minor, 'accepted_difference' => (bool) $d->accepted_difference, 'reason' => $d->reason,
            'created_by' => $d->created_by, 'created_at' => optional($d->created_at)->toIso8601String(),
        ];
    }
}
