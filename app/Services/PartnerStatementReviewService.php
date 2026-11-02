<?php

namespace App\Services;

use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementMatch;
use App\Models\PartnerStatementMatchRun;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReviewDecision;
use App\Models\User;
use App\Support\PartnerStatementReviewException;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * مراجعة نتائج مطابقة كشف طرف: confirm · override · clear — IMP-PS-A3a. **لا أثر مالي**: يقرأ الدفتر عبر `PartnerLedgerCandidates` (بواسطة خدمة المطابقة) ويكتب
 * جدولاً واحداً append-only (`partner_statement_review_decisions`) — لا قيد ولا مستند ولا دفعة ولا رصيد ولا ZATCA، ولا أي حالة للمقارنة (الإغلاق شريحة لاحقة).
 *
 * القواعد:
 *  - **الصلاحية والحماية:** كما التشغيل: `partner_statements.reconcile` **و**`.view` + `assertAccess` (نشاط الفاعل، `partners.view`، رؤية الطرف، الدور، الفرع) عبر
 *    `PartnerStatementMatchService::authorize`؛ مقارنة/تشغيلة غير متاحة ⇒ الرفض الموحَّد نفسه. التشغيلة المخزَّنة لا يراجعها إلا قارئ نطاقه يحتويها.
 *  - **لا اعتماد لنتيجة قديمة (409 `run_stale`):** التشغيلة يجب أن تطابق الحاضر: إصدار المحرّك، السياسة المجمَّدة، نطاق الدفتر المقروء، **وبصمة الدفتر**. تغيّر أيٌّ منها ⇒ أعد المطابقة.
 *  - **confirm:** يقبل اقتراح المحرّك لسطر واحد (`matched | amount_difference | date_difference`) بوحدته؛ السبب إلزامي إن لم يكن `matched`.
 *  - **override:** يُسند وحدات (1..50) يختارها المراجع؛ **سبب إلزامي (≥ 3 محارف)**؛ إن خرج الفرق عن P-2 فلا بد من `accept_difference = true` صريح.
 *  - **clear:** يسحب القرار الفعّال للسطر (لا قرار فعّال بعده)؛ idempotent إن لم يكن هناك قرار.
 *  - **link_pair (PS-A3b، D-PS-15):** ربط يدوي صريح لسطر كشف بأحد طرفي زوج أصل/عكس **مثبت بـ`reversal_of` في الأستاذ**: الوحدة `neutralised` ببساطة قيدين بالضبط
 *    (الأصل `reversed` والعكس `posted` يشير إليه) وصافيهما صفر؛ العضو (`original`|`reversal`) يختاره المراجع ولا يُستنتج من مبلغ أو تاريخ أو رقم؛ سبب إلزامي. السلسلة الناقصة
 *    أو الأطول من قيدين أو غير المثبتة تُرفض؛ ولا يتغيّر ناتج المحرّك (`reversed_in_books`/`missing_in_books` تبقى ظاهرة)، والاستعمال المزدوج يُحرس لكل عضو (`وحدة@عضو`).
 *  - **السبب (D-PS-16، قرار المالك):** أي قبول لفرق مالي (غير صفر) يتطلب سبباً دائماً — ثابت لا يُعطَّل بإعداد مستأجر.
 *  - **الوحدات القابلة للمراجعة:** `active` فقط. المعكوسة (`neutralised`) والناقصة (`incomplete`) و`zero_net` مرفوضة (D-PS-15: لا ربط تلقائي أو مخمَّن؛ الربط اليدوي لزوج معكوس مثبت شريحة مستقلة).
 *  - **لا استعمال مزدوج:** وحدة لها قرار فعّال على سطر لا تُسند لسطر آخر (409 `unit_already_decided`).
 *  - **المسودة فقط:** مقارنة ليست `draft` ⇒ 409 `reconciliation_not_editable` (لا مراجعة بعد الاعتماد).
 *  - **التزامن:** قفل استشاري لكل مقارنة على PostgreSQL + تسلسل نسخ مفروض في القاعدة (فهرس فريد + مُشغّل)؛ لا يُلتقط خطأ تفرّد داخل المعاملة.
 *  - **إعادة الطلب:** طلب مطابق للقرار الفعّال الحالي (الإجراء والوحدات والسبب وبصمة الدفتر) يعيده `replayed` بلا نسخة جديدة.
 */
final class PartnerStatementReviewService
{
    public const MAX_PER_PAGE = 50;

    public const DEFAULT_PER_PAGE = 25;

    private const CONFIRMABLE = ['matched', 'amount_difference', 'date_difference'];

    public function __construct(
        private readonly PartnerStatementMatchService $matching,
        private readonly TenantContext $tenant,
    ) {}

    // ═══════════════════════════════ الإجراء ═══════════════════════════════

    /**
     * @param  array{run_id: string, line_id: string, action: string, unit_keys?: ?list<string>, reason?: ?string, accept_difference?: ?bool}  $input
     * @return array{decision: ?array<string, mixed>, replayed: bool, warnings: list<array<string, mixed>>}
     */
    public function decide(User $actor, string $reconciliationId, array $input): array
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.reconcile');
        $action = (string) ($input['action'] ?? '');
        if (! in_array($action, PartnerStatementReviewDecision::ACTIONS, true)) {
            throw new PartnerStatementReviewException('action_invalid', 'إجراء المراجعة غير معروف.');
        }
        $reason = isset($input['reason']) ? trim((string) $input['reason']) : null;
        $reason = $reason === '' ? null : $reason;
        if ($reason !== null && mb_strlen($reason) > 500) {
            throw new PartnerStatementReviewException('reason_too_long', 'سبب المراجعة أطول من 500 حرف.');
        }
        $requested = array_values(array_unique(array_map('strval', (array) ($input['unit_keys'] ?? []))));
        $withUnits = [PartnerStatementReviewDecision::ACTION_OVERRIDE, PartnerStatementReviewDecision::ACTION_LINK_PAIR];
        if (! in_array($action, $withUnits, true) && $requested !== []) {
            throw new PartnerStatementReviewException('unit_keys_not_allowed', 'الوحدات تُحدَّد في التجاوز (override) أو ربط الزوج (link_pair) وحدهما؛ التأكيد يقبل اقتراح المحرّك والسحب بلا وحدات.');
        }
        $member = isset($input['pair_member']) ? (string) $input['pair_member'] : null;
        if ($action === PartnerStatementReviewDecision::ACTION_LINK_PAIR) {
            if (! in_array($member, PartnerStatementReviewDecision::MEMBERS, true)) {
                throw new PartnerStatementReviewException('pair_member_required', 'حدّد طرف الزوج الذي يقابله السطر: original أو reversal.');
            }
            if (count($requested) !== 1) {
                throw new PartnerStatementReviewException('unit_keys_invalid', 'ربط الزوج يتطلب وحدة دفترية واحدة بالضبط.');
            }
            if ($reason === null || mb_strlen($reason) < 3) {
                throw new PartnerStatementReviewException('reason_required', 'سبب ربط الزوج المعكوس إلزامي (3 محارف على الأقل).');
            }
        } elseif ($member !== null) {
            throw new PartnerStatementReviewException('pair_member_not_allowed', 'طرف الزوج يخصّ ربط الزوج (link_pair) وحده.');
        }
        if ($action === PartnerStatementReviewDecision::ACTION_OVERRIDE) {
            if ($requested === [] || count($requested) > PartnerStatementMatchService::MAX_SET) {
                throw new PartnerStatementReviewException('unit_keys_invalid', 'اختر من وحدة إلى '.PartnerStatementMatchService::MAX_SET.' وحدة دفترية.');
            }
            if ($reason === null || mb_strlen($reason) < 3) {
                throw new PartnerStatementReviewException('reason_required', 'سبب التجاوز إلزامي (3 محارف على الأقل).');
            }
        }

        $run = $this->run($actor, $reconciliation, (string) ($input['run_id'] ?? ''));
        $line = $this->line($reconciliation, (string) ($input['line_id'] ?? ''));
        $row = PartnerStatementMatch::query()->where('run_id', $run->id)->where('side', 'statement')->where('line_id', $line->id)->first();
        if ($row === null) {
            throw new PartnerStatementReviewException('line_not_in_run', 'سطر الكشف غير موجود ضمن هذه التشغيلة.');
        }

        return DB::transaction(function () use ($actor, $reconciliation, $run, $line, $row, $action, $reason, $requested, $member, $input): array {
            $this->lock($reconciliation->id);
            // حالة المقارنة تُعاد قراءتها داخل المعاملة بعد القفل: لا مراجعة إلا على مسودة.
            $fresh = PartnerStatementReconciliation::query()->whereKey($reconciliation->id)->lockForUpdate()->first();
            if ($fresh === null || $fresh->status !== PartnerStatementReconciliation::STATUS_DRAFT) {
                throw new PartnerStatementReviewException('reconciliation_not_editable', 'لا تُراجَع إلا المقارنة في حالة المسودة.', 409);
            }

            // الدفتر يُقرأ **بعد** أخذ القفل (Codex #1915): ترحيل/عكس يُثبَّت أثناء انتظار القفل لا يتسرّب بلقطة سابقة (`LedgerService` لا يأخذ هذا القفل).
            // يبقى حدّ READ COMMITTED المعلن: ترحيل يُثبَّت بين هذه القراءة والالتزام لا يمنعه قفل المراجعة؛ يظهر القِدَم عند أي قراءة/قرار لاحق.
            $source = $this->matching->source($actor, $reconciliation);
            $this->assertFresh($run, $reconciliation, $source);
            $plan = match ($action) {
                PartnerStatementReviewDecision::ACTION_CLEAR => ['units' => [], 'claims' => [], 'net' => null],
                PartnerStatementReviewDecision::ACTION_CONFIRM => $this->planConfirm($row, $reason, $source, $line, $reconciliation, (bool) ($input['accept_difference'] ?? false)),
                PartnerStatementReviewDecision::ACTION_LINK_PAIR => $this->planPair((string) $requested[0], (string) $member, $source, $line, $reconciliation, (bool) ($input['accept_difference'] ?? false)),
                default => $this->planOverride($requested, $source, $line, $reconciliation, (bool) ($input['accept_difference'] ?? false)),
            };
            $warnings = $action === PartnerStatementReviewDecision::ACTION_CLEAR ? [] : $this->warnings($run, $line, $plan['units']);

            $decisions = $this->decisionsOf($reconciliation->id);
            $effective = $this->effective($decisions);
            $current = $effective[$line->id] ?? null;
            $latest = $decisions[$line->id] ?? [];
            $nextRevision = ($latest === [] ? 0 : end($latest)->revision) + 1;

            if ($action === PartnerStatementReviewDecision::ACTION_CLEAR) {
                if ($current === null) {
                    return ['decision' => null, 'replayed' => true, 'warnings' => []];
                }
            } else {
                if ($current !== null && $this->sameDecision($current, $run->id, $action, $plan['units'], $member, $reason, $source['fingerprint'])) {
                    return ['decision' => $this->present($current), 'replayed' => true, 'warnings' => $warnings];
                }
                foreach ($plan['claims'] as $claim) {
                    foreach ($effective as $otherLine => $decision) {
                        if ($otherLine !== $line->id && $this->conflictsWithAny($claim, $this->claimsOf($decision))) {
                            throw new PartnerStatementReviewException('unit_already_decided', 'وحدة دفترية (أو طرف زوج معكوس) مُسندة بقرار فعّال إلى سطر كشف آخر.', 409, [
                                'unit_key' => $claim, 'line_id' => $otherLine,
                            ]);
                        }
                    }
                }
            }

            $decision = PartnerStatementReviewDecision::create([
                'reconciliation_id' => $reconciliation->id, 'run_id' => $run->id, 'line_id' => $line->id, 'revision' => $nextRevision, 'action' => $action,
                'unit_keys' => $plan['units'], 'engine_outcome' => $row->outcome, 'engine_code' => $row->explanation['code'] ?? null,
                'pair_member' => $plan['pair']['member'] ?? null, 'pair_original_entry_id' => $plan['pair']['original'] ?? null, 'pair_reversal_entry_id' => $plan['pair']['reversal'] ?? null,
                'expected_net_minor' => $plan['net']['expected'] ?? null, 'set_net_minor' => $plan['net']['set'] ?? null, 'difference_minor' => $plan['net']['difference'] ?? null,
                'accepted_difference' => (bool) ($plan['net']['accepted'] ?? false), 'reason' => $reason,
                'ledger_fingerprint' => $source['fingerprint'], 'created_by' => $actor->getKey(), 'created_at' => now(),
            ]);

            return ['decision' => $this->present($decision), 'replayed' => false, 'warnings' => $warnings];
        });
    }

    // ═══════════════════════════════ القراءة ═══════════════════════════════

    /**
     * القرارات الفعّالة (أحدث نسخة غير clear لكل سطر)، أو تاريخ سطر كامل (`line_id` + `history`). لا يُعاد قرار بُني على تشغيلة خارج نطاق القارئ.
     *
     * @param  array{line_id?: ?string, history?: ?bool, per_page?: ?int, page?: ?int}  $filters
     */
    public function list(User $actor, string $reconciliationId, array $filters): LengthAwarePaginator
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.view');
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) ($filters['per_page'] ?? self::DEFAULT_PER_PAGE)));

        $readable = [];
        foreach (PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id)->get() as $run) {
            $readable[$run->id] = $this->matching->readable($actor, $run);
        }

        if (! empty($filters['line_id']) && ! empty($filters['history'])) {
            $query = PartnerStatementReviewDecision::query()->where('reconciliation_id', $reconciliation->id)->where('line_id', $filters['line_id'])
                ->whereIn('run_id', array_keys(array_filter($readable)))->orderByDesc('revision');

            return $query->paginate($perPage)->through(fn (PartnerStatementReviewDecision $d): array => $this->present($d));
        }

        $effective = array_filter(
            $this->effective($this->decisionsOf($reconciliation->id)),
            fn (PartnerStatementReviewDecision $d): bool => $readable[$d->run_id] ?? false,
        );
        if (! empty($filters['line_id'])) {
            $effective = array_filter($effective, fn (PartnerStatementReviewDecision $d): bool => $d->line_id === $filters['line_id']);
        }
        $ordinals = PartnerStatementLine::query()->where('reconciliation_id', $reconciliation->id)->pluck('ordinal', 'id')->all();
        usort($effective, fn ($a, $b): int => [$ordinals[$a->line_id] ?? PHP_INT_MAX, $a->id] <=> [$ordinals[$b->line_id] ?? PHP_INT_MAX, $b->id]);
        $page = max(1, (int) ($filters['page'] ?? 1));
        $slice = array_slice($effective, ($page - 1) * $perPage, $perPage);

        return new \Illuminate\Pagination\LengthAwarePaginator(
            array_map(fn (PartnerStatementReviewDecision $d): array => $this->present($d) + ['ordinal' => $ordinals[$d->line_id] ?? null], $slice),
            count($effective), $perPage, $page,
        );
    }

    /**
     * الأزواج المعكوسة المرئية للمراجع في الدفتر الحالي (قراءة فقط، بنطاق الفاعل): المثبتة القابلة للربط اليدوي (`reviewable`) وغيرها بسببها، مع ما أُسند لكل طرف.
     * لا تغيّر نتائج المحرّك ولا تخفي فروقها؛ هي أداة اختيار للمراجع قبل `link_pair`. حدّ العرض 200 زوج (`truncated`).
     *
     * @return array{pairs: list<array<string, mixed>>, truncated: bool, scope: array<string, mixed>, ledger_fingerprint: string}
     */
    public function reversedPairs(User $actor, string $reconciliationId): array
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.view');
        $source = $this->matching->source($actor, $reconciliation);

        $readable = [];
        foreach (PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id)->get() as $run) {
            $readable[$run->id] = $this->matching->readable($actor, $run);
        }
        $claimed = [];
        foreach ($this->effective($this->decisionsOf($reconciliation->id)) as $lineId => $decision) {
            foreach ($this->claimsOf($decision) as $claim) {
                $claimed[$claim] = ['claimed' => true, 'line_id' => ($readable[$decision->run_id] ?? false) ? $lineId : null];
            }
        }
        $free = ['claimed' => false, 'line_id' => null];

        $pairs = [];
        foreach ($source['units'] as $unit) {
            if (! in_array($unit['state'], ['neutralised', 'incomplete'], true)) {
                continue;
            }
            $row = ['unit_key' => $unit['key'], 'kind' => $unit['kind'], 'state' => $unit['state'], 'reasons' => $unit['reasons'], 'entry_numbers' => $unit['numbers']];
            try {
                $proof = $this->provePair($unit);
                $row += ['reviewable' => true, 'blocked_reason' => null];
                foreach (['original', 'reversal'] as $member) {
                    $entry = $proof[$member];
                    // طرف الزوج محجوز بادعائه أو بادعاء الوحدة كاملةً (قرار عادي سابق للعكس).
                    $row[$member] = [
                        'entry_id' => $entry['entry_id'], 'number' => $entry['number'], 'date' => $entry['date'], 'net_minor' => $entry['debit_minor'] - $entry['credit_minor'],
                    ] + ($claimed[$unit['key'].'@'.$member] ?? $claimed[$unit['key']] ?? $free);
                }
            } catch (PartnerStatementReviewException $e) {
                $row += ['reviewable' => false, 'blocked_reason' => $e->reason];
            }
            $pairs[] = $row;
        }

        return [
            'pairs' => array_slice($pairs, 0, 200), 'truncated' => count($pairs) > 200,
            'scope' => $source['scope'], 'ledger_fingerprint' => $source['fingerprint'],
        ];
    }

    // ═══════════════════════════════ الداخل ═══════════════════════════════

    private function run(User $actor, PartnerStatementReconciliation $reconciliation, string $runId): PartnerStatementMatchRun
    {
        $refusal = new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
        if (! Str::isUuid($runId)) {
            throw $refusal;
        }
        $run = PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id)->whereKey($runId)->first();
        if ($run === null || ! $this->matching->readable($actor, $run)) {
            throw $refusal;
        }

        return $run;
    }

    private function line(PartnerStatementReconciliation $reconciliation, string $lineId): PartnerStatementLine
    {
        $line = Str::isUuid($lineId) ? PartnerStatementLine::query()->where('reconciliation_id', $reconciliation->id)->whereKey($lineId)->first() : null;
        if ($line === null) {
            throw new PartnerStatementReviewException('line_not_found', 'سطر الكشف غير موجود في هذه المقارنة.');
        }

        return $line;
    }

    /**
     * التشغيلة يجب أن تطابق الحاضر: لا اعتماد على نتائج قديمة (إصدار المحرّك · السياسة · نطاق الدفتر · بصمة الدفتر).
     *
     * @param  array{scope: array<string, mixed>, fingerprint: string}  $source
     */
    private function assertFresh(PartnerStatementMatchRun $run, PartnerStatementReconciliation $reconciliation, array $source): void
    {
        $causes = [];
        if ($run->engine_version !== PartnerStatementMatchingEngine::VERSION) {
            $causes[] = 'engine_version';
        }
        if ($run->policy !== $this->matching->policy($reconciliation)) {
            $causes[] = 'policy';
        }
        if ($run->scope !== $source['scope']) {
            $causes[] = 'scope';
        }
        if ($run->ledger_fingerprint !== $source['fingerprint']) {
            $causes[] = 'ledger_fingerprint';
        }
        if ($causes !== []) {
            throw new PartnerStatementReviewException('run_stale', 'نتائج المطابقة قديمة: تغيّر الدفتر أو السياسة أو المحرّك منذ التشغيل. أعد المطابقة ثم راجع.', 409, ['causes' => $causes]);
        }
    }

    /**
     * @param  array{units: list<array<string, mixed>>}  $source
     * @return array{units: list<string>, net: array<string, mixed>}
     */
    private function planConfirm(PartnerStatementMatch $row, ?string $reason, array $source, PartnerStatementLine $line, PartnerStatementReconciliation $reconciliation, bool $accept): array
    {
        if (! in_array($row->outcome, self::CONFIRMABLE, true) || $row->unit_key === null) {
            throw new PartnerStatementReviewException('nothing_to_confirm', 'لا يوجد اقتراح مطابقة لهذا السطر يمكن تأكيده؛ استعمل التجاوز (override) لإسناد وحدات.');
        }
        if ($row->outcome !== 'matched' && ($reason === null || mb_strlen($reason) < 3)) {
            throw new PartnerStatementReviewException('reason_required', 'تأكيد مطابقة بفرق (مبلغ أو تاريخ) يتطلب سبباً (3 محارف على الأقل).');
        }

        $net = $this->net($source, [(string) $row->unit_key], $line, $reconciliation, $accept);
        // D-PS-16 (قرار المالك): قبول فرق مالي (غير صفر) يتطلب سبباً دائماً، حتى لو كان داخل التسامح — ثابت، لا إعداد مستأجر.
        if ($net['difference'] !== 0 && ($reason === null || mb_strlen($reason) < 3)) {
            throw new PartnerStatementReviewException('reason_required', 'تأكيد مطابقة بفرق مالي يتطلب سبباً (3 محارف على الأقل).');
        }

        return ['units' => [(string) $row->unit_key], 'claims' => [(string) $row->unit_key], 'net' => $net];
    }

    /**
     * @param  list<string>  $requested
     * @return array{units: list<string>, net: array<string, mixed>}
     */
    private function planOverride(array $requested, array $source, PartnerStatementLine $line, PartnerStatementReconciliation $reconciliation, bool $accept): array
    {
        sort($requested);

        return ['units' => $requested, 'claims' => $requested, 'net' => $this->net($source, $requested, $line, $reconciliation, $accept)];
    }

    /**
     * PS-A3b: ربط سطر كشف بطرف (`original`|`reversal`) من زوج معكوس **مثبت**. الإثبات من الأستاذ نفسه (`reversal_of`) لا من تشابه مبلغ أو تاريخ أو رقم؛ العضو قرار المراجع.
     *
     * @param  array{units: list<array<string, mixed>>}  $source
     * @return array{units: list<string>, claims: list<string>, net: array<string, mixed>, pair: array<string, string>}
     */
    private function planPair(string $unitKey, string $member, array $source, PartnerStatementLine $line, PartnerStatementReconciliation $reconciliation, bool $accept): array
    {
        $unit = null;
        foreach ($source['units'] as $candidate) {
            if ($candidate['key'] === $unitKey) {
                $unit = $candidate;
                break;
            }
        }
        if ($unit === null) {
            throw new PartnerStatementReviewException('unit_not_in_ledger', 'وحدة دفترية غير موجودة ضمن مرشحي هذا الطرف والفترة.', 422, ['unit_key' => $unitKey]);
        }
        $proof = $this->provePair($unit);
        $entry = $proof[$member];

        return [
            'units' => [$unitKey], 'claims' => [$unitKey.'@'.$member],
            'net' => $this->settle($entry['debit_minor'] - $entry['credit_minor'], $line, $reconciliation, $accept),
            'pair' => ['member' => $member, 'original' => $proof['original']['entry_id'], 'reversal' => $proof['reversal']['entry_id']],
        ];
    }

    /**
     * إثبات زوج أصل/عكس بسيط من تفاصيل القيود في الأستاذ: قيدان بالضبط، العكس `posted` ويشير بـ`reversal_of` إلى الأصل `reversed`، والأصل لا يشير لشيء، وصافياهما متعاكسان ومجموعهما صفر.
     * أي حالة أخرى لا تُخمَّن: ناقصة ⇒ `pair_incomplete`، سلسلة أطول أو غير مطابقة ⇒ `pair_not_simple`/`pair_not_proven`، وحدة نشطة ⇒ `unit_not_a_reversed_pair`.
     *
     * @param  array<string, mixed>  $unit
     * @return array{original: array<string, mixed>, reversal: array<string, mixed>}
     */
    private function provePair(array $unit): array
    {
        $key = $unit['key'];
        if (($unit['state'] ?? null) === 'incomplete') {
            throw new PartnerStatementReviewException('pair_incomplete', 'سلسلة العكس ناقصة داخل نافذة الكشف: لا يُربط زوج غير مكتمل.', 422, ['unit_key' => $key, 'reasons' => $unit['reasons'] ?? []]);
        }
        if (($unit['state'] ?? null) !== 'neutralised') {
            throw new PartnerStatementReviewException('unit_not_a_reversed_pair', 'الوحدة ليست زوجاً معكوساً؛ استعمل التجاوز (override) للوحدات النشطة.', 422, ['unit_key' => $key, 'state' => $unit['state'] ?? null]);
        }
        $entries = $unit['entries'] ?? [];
        if (count($entries) !== 2) {
            throw new PartnerStatementReviewException('pair_not_simple', 'الربط اليدوي لزوج أصل/عكس من قيدين فقط؛ السلاسل الأطول لا تُربط هنا.', 422, ['unit_key' => $key, 'entries' => count($entries)]);
        }
        $reversals = array_values(array_filter($entries, fn (array $e): bool => $e['reversal_of'] !== null));
        if (count($reversals) !== 1) {
            throw new PartnerStatementReviewException('pair_not_proven', 'لا رابط عكس مثبت (reversal_of) بين قيدي الوحدة.', 422, ['unit_key' => $key]);
        }
        $reversal = $reversals[0];
        $original = null;
        foreach ($entries as $entry) {
            if ($entry['entry_id'] === $reversal['reversal_of']) {
                $original = $entry;
            }
        }
        $originalNet = $original === null ? 0 : $original['debit_minor'] - $original['credit_minor'];
        $reversalNet = $reversal['debit_minor'] - $reversal['credit_minor'];
        if ($original === null || $original['reversal_of'] !== null || $original['status'] !== 'reversed' || $reversal['status'] !== 'posted'
            || $originalNet === 0 || $originalNet + $reversalNet !== 0) {
            throw new PartnerStatementReviewException('pair_not_proven', 'قيد العكس لا يشير إلى أصل مكتمل الحالة (reversed) بصافٍ معاكس؛ لا ربط بلا إثبات.', 422, ['unit_key' => $key]);
        }

        return ['original' => $original, 'reversal' => $reversal];
    }

    /**
     * يتحقق من الوحدات (موجودة · `active` · قابلة للمطابقة) ويحسب صافي المجموعة مقابل السطر. نفس صيغة `verifySet`.
     *
     * @param  array{units: list<array<string, mixed>>}  $source
     * @param  list<string>  $unitKeys
     * @return array{expected: int, set: int, difference: int, accepted: bool}
     */
    private function net(array $source, array $unitKeys, PartnerStatementLine $line, PartnerStatementReconciliation $reconciliation, bool $accept): array
    {
        $byKey = [];
        foreach ($source['units'] as $unit) {
            $byKey[$unit['key']] = $unit;
        }
        $selected = [];
        foreach ($unitKeys as $key) {
            $unit = $byKey[$key] ?? null;
            if ($unit === null) {
                throw new PartnerStatementReviewException('unit_not_in_ledger', 'وحدة دفترية غير موجودة ضمن مرشحي هذا الطرف والفترة.', 422, ['unit_key' => $key]);
            }
            if ($unit['state'] !== 'active' || ! $unit['matchable']) {
                // D-PS-15: المعكوسة والناقصة وصفرية الصافي لا تُراجَع هنا — لا ربط مخمَّن.
                throw new PartnerStatementReviewException('unit_not_reviewable', 'وحدة معكوسة أو ناقصة السلسلة أو صفرية الصافي لا تُسند بهذا الإجراء.', 422, ['unit_key' => $key, 'state' => $unit['state']]);
            }
            $selected[] = $unit;
        }

        return $this->settle((int) array_sum(array_map(fn (array $u): int => (int) $u['net_minor'], $selected)), $line, $reconciliation, $accept);
    }

    /**
     * يقارن صافي ما أُسند بسطر الكشف (±P-2 المجمَّد) ويشترط الإقرار الصريح خارج التسامح. سطر الكشف الدائن = مدين عندنا (+)، والمدين = دائن عندنا (−).
     *
     * @return array{expected: int, set: int, difference: int, accepted: bool}
     */
    private function settle(int $setNet, PartnerStatementLine $line, PartnerStatementReconciliation $reconciliation, bool $accept): array
    {
        $amount = (int) $line->debit_minor > 0 ? (int) $line->debit_minor : (int) $line->credit_minor;
        $expected = (int) $line->debit_minor > 0 ? -$amount : $amount;
        $difference = $expected - $setNet;
        $tolerance = (int) $this->matching->policy($reconciliation)['amount_tolerance_minor'];
        $outside = abs($difference) > $tolerance;
        if ($outside && ! $accept) {
            throw new PartnerStatementReviewException('difference_exceeds_tolerance', 'فرق المبلغ يتجاوز التسامح المجمَّد؛ أقرّه صراحةً بـ accept_difference.', 422, [
                'difference_minor' => $difference, 'tolerance_minor' => $tolerance,
            ]);
        }

        return ['expected' => $expected, 'set' => $setNet, 'difference' => $difference, 'accepted' => $outside];
    }

    /**
     * تحذيرات غير مانعة: وحدة اقترح المحرّك مطابقتها لسطر آخر.
     *
     * @param  list<string>  $unitKeys
     * @return list<array<string, mixed>>
     */
    private function warnings(PartnerStatementMatchRun $run, PartnerStatementLine $line, array $unitKeys): array
    {
        if ($unitKeys === []) {
            return [];
        }
        $warnings = [];
        $ownOrdinal = (int) $line->ordinal;
        foreach (PartnerStatementMatch::query()->where('run_id', $run->id)->where('side', 'ledger')->whereIn('unit_key', $unitKeys)->whereNotNull('ordinal')->get(['unit_key', 'ordinal']) as $ledger) {
            if ((int) $ledger->ordinal !== $ownOrdinal) {
                $warnings[] = ['code' => 'unit_proposed_for_another_line', 'params' => ['unit_key' => $ledger->unit_key, 'ordinal' => (int) $ledger->ordinal]];
            }
        }

        return $warnings;
    }

    /**
     * @param  list<string>  $units
     */
    private function sameDecision(PartnerStatementReviewDecision $current, string $runId, string $action, array $units, ?string $member, ?string $reason, string $fingerprint): bool
    {
        $existing = $current->unit_keys;
        sort($existing);
        $new = $units;
        sort($new);

        // الإعادة مرتبطة بالتشغيلة المطلوبة نفسها (Codex #1915): تشغيلتان بنطاقين مختلفين قد تشتركان في البصمة، ولا يُعاد لقارئ قرارٌ بُني على تشغيلة لا يقرؤها.
        return $current->run_id === $runId && $current->action === $action && $existing === $new && ($current->pair_member ?? null) === $member && ($current->reason ?? null) === $reason && $current->ledger_fingerprint === $fingerprint;
    }

    /**
     * كل قرارات المقارنة مجمَّعة بسطر الكشف ومرتبة بالنسخة.
     *
     * @return array<string, list<PartnerStatementReviewDecision>>
     */
    private function decisionsOf(string $reconciliationId): array
    {
        $byLine = [];
        foreach (PartnerStatementReviewDecision::query()->where('reconciliation_id', $reconciliationId)->orderBy('line_id')->orderBy('revision')->get() as $decision) {
            $byLine[$decision->line_id][] = $decision;
        }

        return $byLine;
    }

    /**
     * القرار الفعّال لكل سطر: أعلى نسخة، ويُسقط `clear`.
     *
     * @param  array<string, list<PartnerStatementReviewDecision>>  $byLine
     * @return array<string, PartnerStatementReviewDecision>
     */
    private function effective(array $byLine): array
    {
        $effective = [];
        foreach ($byLine as $lineId => $decisions) {
            $last = end($decisions);
            if ($last !== false && $last->action !== PartnerStatementReviewDecision::ACTION_CLEAR) {
                $effective[$lineId] = $last;
            }
        }

        return $effective;
    }

    /**
     * رموز الاستعمال المزدوج للقرار: الوحدات نفسها، أو `وحدة@عضو` لربط الزوج (فكل طرف من الزوج يحمله سطر واحد على الأكثر).
     *
     * @return list<string>
     */
    private function claimsOf(PartnerStatementReviewDecision $decision): array
    {
        if ($decision->action === PartnerStatementReviewDecision::ACTION_LINK_PAIR && $decision->pair_member !== null) {
            return array_map(fn (string $unit): string => $unit.'@'.$decision->pair_member, $decision->unit_keys);
        }

        return $decision->unit_keys;
    }

    /**
     * هل يتعارض ادعاء مع أي من ادعاءات قرار آخر؟ المتطابقان يتعارضان؛ وادعاء الوحدة كاملةً (`وحدة`) يتعارض مع ادعاء أي من طرفيها (`وحدة@عضو`) وبالعكس
     * (Codex #1929): قرار عادي سبق عكس القيد يبقى فعّالاً حتى يُسحب فلا يُعاد إسناد الأصل لسطر آخر. طرفا الزوج المختلفان لا يتعارضان.
     *
     * @param  list<string>  $existing
     */
    private function conflictsWithAny(string $claim, array $existing): bool
    {
        foreach ($existing as $other) {
            if ($claim === $other) {
                return true;
            }
            $claimIsMember = str_contains($claim, '@');
            $otherIsMember = str_contains($other, '@');
            if ($claimIsMember !== $otherIsMember && explode('@', $claim)[0] === explode('@', $other)[0]) {
                return true;
            }
        }

        return false;
    }

    private function lock(string $reconciliationId): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-statement-review:'.$this->tenant->id().':'.$reconciliationId]);
        }
    }

    /** @return array<string, mixed> */
    private function present(PartnerStatementReviewDecision $d): array
    {
        return [
            'id' => $d->id, 'reconciliation_id' => $d->reconciliation_id, 'run_id' => $d->run_id, 'line_id' => $d->line_id, 'revision' => $d->revision, 'action' => $d->action,
            'unit_keys' => $d->unit_keys, 'engine_outcome' => $d->engine_outcome, 'engine_code' => $d->engine_code,
            'pair' => $d->pair_member === null ? null : ['member' => $d->pair_member, 'original_entry_id' => $d->pair_original_entry_id, 'reversal_entry_id' => $d->pair_reversal_entry_id], 'expected_net_minor' => $d->expected_net_minor, 'set_net_minor' => $d->set_net_minor,
            'difference_minor' => $d->difference_minor, 'accepted_difference' => (bool) $d->accepted_difference, 'reason' => $d->reason,
            'created_by' => $d->created_by, 'created_at' => optional($d->created_at)->toIso8601String(),
        ];
    }
}
