<?php

namespace App\Services;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementMatch;
use App\Models\PartnerStatementMatchRun;
use App\Models\PartnerStatementReconciliation;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Services\Reporting\PartnerLedgerCandidates;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * تشغيل مطابقة كشف طرف وقراءة نتائجها والتحقق من مجموعة many-to-one — IMP-PS-A2c. **لا أثر مالي**: يقرأ الأستاذ عبر `PartnerLedgerCandidates` وحده،
 * وتكتب هذه الخدمة جدولَي النتائج المشتقة (`partner_statement_match_runs/matches`) فقط — لا قيد ولا مستند ولا دفعة ولا رصيد ولا ZATCA.
 *
 *  - **الحماية:** صلاحية الدور (`partner_statements.reconcile` للتشغيل، `.view` للقراءة) ثم `PartnerStatementImportService::assertAccess` (نشاط الفاعل، `partners.view`،
 *    رؤية الطرف كما التقرير، الدور، الفرع ضمن نطاق الفاعل). مقارنة غير موجودة/من مؤسسة أخرى/طرفها غير متاح ⇒ رفض واحد متطابق (لا كشف وجود).
 *  - **السياسة:** من السياسة المجمَّدة في المقارنة (P-1..P-5) لا من الطلب؛ لا خيارات مطابقة في API.
 *  - **التكرار:** مفتاح التشغيلة = (إصدار المحرّك + السياسة + النطاق + بصمة الدفتر)؛ نفسه ⇒ تعاد التشغيلة القائمة (`replayed`)، وتغيّر الدفتر ⇒ تشغيلة جديدة وتبقى القديمة.
 *    تسلسل التزامن بقفل استشاري على PostgreSQL + فهرس فريد (لا يُلتقط خطؤه داخل المعاملة).
 *  - **many-to-one:** قراءة تحقق فقط (`verifySet`) لا تُسند ولا تحفظ شيئاً.
 */
final class PartnerStatementMatchService
{
    public const MAX_SET = 50;

    public const MAX_PER_PAGE = 50;

    public const DEFAULT_PER_PAGE = 25;

    private const INSERT_CHUNK = 500;

    public function __construct(
        private readonly PartnerLedgerCandidates $candidates,
        private readonly PartnerStatementMatchingEngine $engine,
        private readonly PartnerStatementImportService $access,
        private readonly TenantContext $tenant,
    ) {}

    // ═══════════════════════════════ التشغيل ═══════════════════════════════

    /** @return array<string, mixed> */
    public function run(User $actor, string $reconciliationId): array
    {
        $reconciliation = $this->authorize($actor, $reconciliationId, 'partner_statements.reconcile');
        $source = $this->source($actor, $reconciliation);
        $units = $this->enrich($source['units']);
        $policy = $this->policy($reconciliation);
        $result = $this->engine->match($this->lines($reconciliation), $units, $policy, $reconciliation->role);

        $runKey = hash('sha256', json_encode([
            'engine' => PartnerStatementMatchingEngine::VERSION, 'policy' => $policy, 'scope' => $source['scope'], 'fingerprint' => $source['fingerprint'],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($actor, $reconciliation, $source, $policy, $result, $runKey): array {
            $this->lock($reconciliation->id);
            $existing = PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id)->where('run_key', $runKey)->first();
            if ($existing !== null) {
                return $this->runSummary($existing, created: false);
            }

            $run = PartnerStatementMatchRun::create([
                'reconciliation_id' => $reconciliation->id, 'engine_version' => PartnerStatementMatchingEngine::VERSION, 'run_key' => $runKey, 'status' => 'completed',
                'policy' => $policy, 'scope' => $source['scope'], 'ledger_fingerprint' => $source['fingerprint'], 'counts' => $result['counts'], 'created_by' => $actor->getKey(),
            ]);

            $tenantId = (string) $this->tenant->id();
            $now = now();
            foreach (array_chunk(array_merge($result['statement'], $result['ledger']), self::INSERT_CHUNK) as $chunk) {
                PartnerStatementMatch::query()->insert(array_map(fn (array $row): array => [
                    'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'run_id' => $run->id, 'side' => $row['side'], 'line_id' => $row['line_id'], 'ordinal' => $row['ordinal'],
                    'outcome' => $row['outcome'], 'rule' => $row['rule'], 'unit_key' => $row['unit_key'], 'difference_minor' => $row['difference_minor'], 'day_difference' => $row['day_difference'],
                    'explanation' => $this->json($row['explanation']), 'warnings' => $this->json($row['warnings'] ?? []), 'unit' => $this->json($row['unit']),
                    'candidates' => $this->json($row['candidates']), 'suggestions' => $this->json($row['suggestions']), 'created_at' => $now, 'updated_at' => $now,
                ], $chunk));
            }

            return $this->runSummary($run, created: true);
        });
    }

    // ═══════════════════════════════ القراءة ═══════════════════════════════

    /**
     * @param  array{run_id?: ?string, side?: ?string, outcome?: ?string, per_page?: ?int, page?: ?int}  $filters
     * @return array{run: ?array<string, mixed>, ledger_changed: ?bool, page: ?LengthAwarePaginator}
     */
    public function matches(User $actor, string $reconciliationId, array $filters): array
    {
        $reconciliation = $this->authorize($actor, $reconciliationId, 'partner_statements.view');

        // التشغيلة المخزَّنة تحمل لقطات دفتر بنطاق من أنشأها: لا تُعاد إلا لقارئ نطاقه يحتويها (Codex #1908 P1) — افتراضياً أحدث تشغيلة **مقروءة** له، وصراحةً (`run_id`) رفضٌ موحَّد.
        $runs = PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id);
        if (! empty($filters['run_id'])) {
            $run = (clone $runs)->whereKey($filters['run_id'])->first();
            if ($run === null || ! $this->readable($actor, $run)) {
                throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
            }
        } else {
            $run = (clone $runs)->orderByDesc('created_at')->orderByDesc('id')->get()->first(fn (PartnerStatementMatchRun $r): bool => $this->readable($actor, $r));
        }
        if ($run === null) {
            return ['run' => null, 'ledger_changed' => null, 'page' => null];
        }

        $query = PartnerStatementMatch::query()->where('run_id', $run->id);
        if (! empty($filters['side'])) {
            $query->where('side', $filters['side']);
        }
        if (! empty($filters['outcome'])) {
            $query->whereIn('outcome', (array) $filters['outcome']);
        }
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) ($filters['per_page'] ?? self::DEFAULT_PER_PAGE)));
        $page = $query->orderBy('side', 'desc')->orderByRaw('COALESCE(ordinal, 2147483647) asc')->orderBy('unit_key')->orderBy('id')->paginate($perPage);

        $current = $this->source($actor, $reconciliation);

        return [
            'run' => $this->runSummary($run, created: false),
            'ledger_changed' => $current['fingerprint'] !== $run->ledger_fingerprint || $current['scope'] !== $run->scope,
            'page' => $page,
        ];
    }

    /**
     * يتحقق هل مجموعة وحدات دفترية يختارها المراجع تساوي سطر كشف (±P-2). **قراءة فقط**: لا إسناد ولا حفظ.
     *
     * @param  list<string>  $unitKeys
     * @return array<string, mixed>
     */
    public function verifySet(User $actor, string $reconciliationId, string $lineId, array $unitKeys): array
    {
        $reconciliation = $this->authorize($actor, $reconciliationId, 'partner_statements.view');
        $unitKeys = array_values(array_unique($unitKeys));
        if ($unitKeys === [] || count($unitKeys) > self::MAX_SET) {
            throw new RuntimeException('اختر من وحدة إلى '.self::MAX_SET.' وحدة دفترية.');
        }
        $line = PartnerStatementLine::query()->where('reconciliation_id', $reconciliation->id)->whereKey($lineId)->first();
        if ($line === null) {
            throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
        }

        $source = $this->source($actor, $reconciliation);
        $byKey = [];
        foreach ($this->enrich($source['units']) as $unit) {
            $byKey[$unit['key']] = $unit;
        }

        $problems = [];
        $selected = [];
        foreach ($unitKeys as $key) {
            if (! isset($byKey[$key])) {
                $problems[] = ['code' => 'unit_not_in_candidates', 'params' => ['unit_key' => $key]];

                continue;
            }
            $unit = $byKey[$key];
            if ($unit['state'] !== 'active') {
                $problems[] = ['code' => 'unit_not_matchable', 'params' => ['unit_key' => $key, 'state' => $unit['state'], 'reasons' => $unit['reasons']]];
            }
            $selected[] = $unit;
        }

        $policy = $this->policy($reconciliation);
        $amount = (int) $line->debit_minor > 0 ? (int) $line->debit_minor : (int) $line->credit_minor;
        // سطر الكشف الدائن = مدين عندنا (+)، والمدين = دائن عندنا (−).
        $expected = (int) $line->debit_minor > 0 ? -$amount : $amount;
        $setNet = array_sum(array_map(fn (array $u): int => $u['net_minor'], $selected));
        $difference = $expected - $setNet;

        return [
            'applied' => false,
            'line' => ['id' => $line->id, 'ordinal' => $line->ordinal, 'date' => $line->line_date->toDateString(), 'debit_minor' => (int) $line->debit_minor, 'credit_minor' => (int) $line->credit_minor],
            'units' => array_map(fn (array $u): array => [
                'key' => $u['key'], 'kind' => $u['kind'], 'doc_number' => $u['doc']['number'] ?? null, 'date' => $u['date'], 'state' => $u['state'],
                'direction' => $u['direction'], 'net_minor' => $u['net_minor'],
            ], $selected),
            'expected_net_minor' => $expected, 'set_net_minor' => $setNet, 'difference_minor' => $difference,
            'tolerance_minor' => $policy['amount_tolerance_minor'],
            'equal_within_tolerance' => $problems === [] && abs($difference) <= $policy['amount_tolerance_minor'],
            'problems' => $problems,
        ];
    }

    // ═══════════════════════════════ الداخل ═══════════════════════════════

    private function authorize(User $actor, string $reconciliationId, string $permission): PartnerStatementReconciliation
    {
        $refusal = new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
        // الصلاحيات مستقلة بلا منح ضمني (D-PS-02): التشغيل يقرأ الدفتر والنتائج فيتطلب `reconcile` **و**`view` معاً؛ القراءة والتحقق `view`. الفحص هنا إضافة إلى فحص المسار.
        $required = $permission === 'partner_statements.reconcile' ? ['partner_statements.reconcile', 'partner_statements.view'] : [$permission];
        foreach ($required as $needed) {
            if (! Rbac::allows((string) $actor->role, $needed)) {
                // ليس RuntimeException عمداً: `ApiController::domain()` يحوّل الأخيرة (وHttpException منها) إلى 422، والمطلوب 403.
                throw new \Illuminate\Auth\Access\AuthorizationException('ليس لديك صلاحية لتنفيذ هذا الإجراء.');
            }
        }
        if (! Str::isUuid($reconciliationId)) {
            throw $refusal;
        }
        $reconciliation = PartnerStatementReconciliation::query()->find($reconciliationId);
        if ($reconciliation === null) {
            throw $refusal;
        }
        $this->access->assertAccess([
            'partner_id' => (string) $reconciliation->partner_id, 'role' => (string) $reconciliation->role, 'branch_id' => $reconciliation->policy['branch_id'] ?? null,
        ], (string) $actor->getKey());

        return $reconciliation;
    }

    /** @return array<string, mixed> */
    private function policy(PartnerStatementReconciliation $reconciliation): array
    {
        $frozen = $reconciliation->policy ?? [];

        return [
            'version' => (int) ($frozen['version'] ?? 1),
            'date_tolerance_days' => (int) ($frozen['date_tolerance_days'] ?? PartnerStatementImportService::DEFAULT_DATE_TOLERANCE_DAYS),
            'amount_tolerance_minor' => (int) ($frozen['amount_tolerance_minor'] ?? PartnerStatementImportService::DEFAULT_AMOUNT_TOLERANCE_MINOR),
            'branch_id' => $frozen['branch_id'] ?? null,
        ];
    }

    /** @return array{units: list<array<string, mixed>>, scope: array<string, mixed>, fingerprint: string} */
    private function source(User $actor, PartnerStatementReconciliation $reconciliation): array
    {
        $policy = $this->policy($reconciliation);
        $result = $this->candidates->for($actor, [
            'partner_id' => (string) $reconciliation->partner_id, 'role' => (string) $reconciliation->role,
            'period_from' => $reconciliation->period_from->toDateString(), 'period_to' => $reconciliation->period_to->toDateString(),
            'date_tolerance_days' => $policy['date_tolerance_days'], 'branch_id' => $policy['branch_id'],
        ]);

        return ['units' => $result['units'], 'scope' => $result['scope'], 'fingerprint' => $result['fingerprint']];
    }

    /** @return list<array<string, mixed>> */
    private function lines(PartnerStatementReconciliation $reconciliation): array
    {
        return PartnerStatementLine::query()->where('reconciliation_id', $reconciliation->id)->orderBy('ordinal')->get()->map(fn (PartnerStatementLine $l): array => [
            'id' => $l->id, 'ordinal' => $l->ordinal, 'date' => $l->line_date->toDateString(), 'reference_key' => (string) $l->reference_key,
            'our_reference_key' => (string) $l->our_reference_key, 'debit_minor' => (int) $l->debit_minor, 'credit_minor' => (int) $l->credit_minor, 'kind' => $l->kind,
        ])->all();
    }

    /**
     * يضيف أرقام المستندات (للمفاتيح R1/R2) إلى وحدات المرشحين. **قراءة فقط** من نماذج المستندات بمعرّفات جاءت أصلاً من الدفتر المصرَّح به للفاعل،
     * مع تقييد صريح بالمؤسسة (نزع نطاقات الفرع هنا مقصود: المعرّفات سبق تقييدها بنطاق الفاعل، والمؤسسة تُقيَّد يدوياً).
     *
     * @param  list<array<string, mixed>>  $units
     * @return list<array<string, mixed>>
     */
    private function enrich(array $units): array
    {
        $tenantId = (string) $this->tenant->id();
        $ids = [];
        foreach ($units as $unit) {
            if ($unit['source_id'] !== null) {
                $ids[$unit['kind']][] = (string) $unit['source_id'];
            }
        }
        $models = ['invoice' => Invoice::class, 'payment' => Payment::class, 'purchase' => Purchase::class, 'credit_note' => CreditNote::class, 'return' => ReturnDocument::class];
        $docs = [];
        foreach ($models as $kind => $model) {
            if (empty($ids[$kind])) {
                continue;
            }
            $columns = $kind === 'purchase' ? ['id', 'number', 'supplier_invoice_no'] : ['id', 'number'];
            foreach ($model::query()->withoutGlobalScopes()->where('tenant_id', $tenantId)->whereIn('id', array_values(array_unique($ids[$kind])))->get($columns) as $doc) {
                $docs[$kind][(string) $doc->id] = ['number' => (string) $doc->number, 'external' => $kind === 'purchase' ? (string) $doc->supplier_invoice_no : ''];
            }
        }

        return array_map(function (array $unit) use ($docs): array {
            $doc = $docs[$unit['kind']][(string) $unit['source_id']] ?? null;
            // قيد يدوي/افتتاحي بلا مستند: رقم القيد نفسه هو رقمه.
            $number = $doc['number'] ?? ($unit['source_id'] === null || $unit['kind'] === 'journal' ? (string) ($unit['numbers'][0] ?? '') : '');
            $unit['doc'] = [
                'number' => $number !== '' ? $number : null,
                'number_key' => (string) (DocumentDuplicateReservationService::normalizeReference($number) ?? ''),
                'external_key' => (string) (DocumentDuplicateReservationService::normalizeReference($doc['external'] ?? '') ?? ''),
            ];

            return $unit;
        }, $units);
    }

    /**
     * هل نطاق التشغيلة المخزَّنة داخل نطاق القارئ الحالي؟ غير المقيَّد يقرأ كل شيء؛ المقيَّد يقرأ فقط تشغيلة نطاقها فروع محددة كلها ضمن فروعه
     * (تشغيلة «المؤسسة» أو بلا فروع محددة لا يقرؤها المقيَّد).
     */
    private function readable(User $actor, PartnerStatementMatchRun $run): bool
    {
        $allowed = $actor->allowedBranchIds();
        if ($allowed === null) {
            return true;
        }
        $branches = $run->scope['branch_ids'] ?? null;
        if (($run->scope['kind'] ?? null) === 'organization' || ! is_array($branches) || $branches === []) {
            return false;
        }

        return array_diff($branches, $allowed) === [];
    }

    private function lock(string $reconciliationId): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-statement-match:'.$this->tenant->id().':'.$reconciliationId]);
        }
    }

    /** @return array<string, mixed> */
    private function runSummary(PartnerStatementMatchRun $run, bool $created): array
    {
        return [
            'id' => $run->id, 'reconciliation_id' => $run->reconciliation_id, 'created' => $created, 'replayed' => ! $created, 'engine_version' => $run->engine_version,
            'status' => $run->status, 'policy' => $run->policy, 'scope' => $run->scope, 'ledger_fingerprint' => $run->ledger_fingerprint, 'counts' => $run->counts,
            'created_at' => optional($run->created_at)->toIso8601String(),
        ];
    }

    private function json(mixed $value): ?string
    {
        return $value === null ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
