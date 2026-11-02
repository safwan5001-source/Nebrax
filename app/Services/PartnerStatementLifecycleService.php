<?php

namespace App\Services;

use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementMatch;
use App\Models\PartnerStatementMatchRun;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\User;
use App\Support\PartnerStatementReviewException;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * دورة حالات مقارنة كشف طرف `draft ⇄ reviewed` — IMP-PS-A3c. **لا أثر مالي**: لا قيد ولا مستند ولا رصيد ولا ضريبة ولا ZATCA؛ تكتب حقول حالة المقارنة وسجل أحداثها فقط.
 *
 * الانتقالات والصلاحيات (كلها `partner_statements.reconcile` **و**`.view` + `partners.view` + رؤية الطرف والفرع + بوابة القدرة، كقرارات المراجعة):
 *  - `draft → reviewed` (`markReviewed`): تشغيلة واحدة صريحة (`run_id`) **حديثة** (محرّك · سياسة · نطاق · بصمة الدفتر · بصمة سطور الكشف)، **وكل سطر كشف له قرار فعّال صريح**
 *    (confirm/override/link_pair/dismiss — لا سياسة تلقائية معتمدة تُغني عن القرار)، وكل القرارات على **هذه التشغيلة** نفسها وببصمة دفترها. وإلا رفض بسبب ثابت ولا أثر.
 *  - `reviewed → draft` (`reopen`): سبب إلزامي (≥ 3)، وتشغيلة المراجعة مقروءة للفاعل. يعيد فتح القرارات (A3a تقبلها على المسودة فقط) دون حذف شيء؛ السجل كله باقٍ.
 *  - `reviewed → closed` (`close`): **محجوب عمداً** (409 `close_blocked_pending_claims`) والقاعدة لا تقبل `closed` أصلاً. السبب: الإغلاق النهائي يتطلب منع **المطالبة المزدوجة بالحركات** بين مقارنات
 *    نهائية متداخلة (D-PS-12/14) — جدول المطالبات والإقرار بالتداخل وفهرسه الفريد شريحة PS-A3d؛ إغلاق بلا ذلك يسمح بمطابقة الحركة نفسها مرتين (حتى لفترتين متجاورتين عبر نافذة التسامح).
 *  - كل انتقال حدثٌ في سجل append-only (فاعل، سبب، تشغيلة، بصمة الدفتر والكشف، ملخص)، في المعاملة نفسها، والقاعدة ترفض تغيير الحالة بلا حدث مطابق.
 *
 * التزامن: القفل الاستشاري نفسه لقرارات المراجعة (لكل مقارنة) + `FOR UPDATE` على صف المقارنة؛ فتتسلسل القرارات والانتقالات. **هذا القفل لا يحمي الأستاذ**: `LedgerService` لا يأخذه، فقد يُرحَّل قيد
 * بعد القراءة داخل المعاملة؛ لذلك تعلن القراءة `ledger_changed_since_review` وتُرفض القرارات اللاحقة بـ`run_stale`، وإعادة الفتح متاحة. الحدّ معلن لا مخفي.
 */
final class PartnerStatementLifecycleService
{
    public const MAX_PER_PAGE = 50;

    private const SAMPLE = 20;

    public function __construct(
        private readonly PartnerStatementMatchService $matching,
        private readonly PartnerStatementReviewService $review,
        private readonly PartnerStatementDigest $digest,
        private readonly TenantContext $tenant,
    ) {}

    // ═══════════════════════════════ الحالة (قراءة) ═══════════════════════════════

    /**
     * جاهزية المقارنة للمراجعة على تشغيلة (الصريحة أو أحدث تشغيلة مقروءة للفاعل): البنود المعالَجة، الموانع بأسبابها، وحالة الإغلاق.
     *
     * @return array<string, mixed>
     */
    public function status(User $actor, string $reconciliationId, ?string $runId = null): array
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.view');
        $run = $runId !== null && $runId !== ''
            ? $this->run($actor, $reconciliation, $runId)
            : PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id)->orderByDesc('created_at')->orderByDesc('id')->get()
                ->first(fn (PartnerStatementMatchRun $r): bool => $this->matching->readable($actor, $r));

        $source = $this->matching->source($actor, $reconciliation);
        $digest = $this->digest->for((string) $reconciliation->id);
        $evaluation = $this->evaluate($reconciliation, $run, $source, $digest);

        $reviewedState = null;
        if ($reconciliation->status === PartnerStatementReconciliation::STATUS_REVIEWED) {
            $event = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $reconciliation->id)
                ->where('action', PartnerStatementReconciliationEvent::ACTION_MARK_REVIEWED)->orderByDesc('seq')->first();
            $reviewedRun = PartnerStatementMatchRun::query()->whereKey($reconciliation->reviewed_run_id)->first();
            $reviewedState = [
                'run_id' => $reconciliation->reviewed_run_id,
                'ledger_changed_since_review' => $event === null || $event->ledger_fingerprint !== $source['fingerprint'] || ($reviewedRun !== null && $reviewedRun->scope !== $source['scope']),
                'statement_changed_since_review' => $event === null || $event->statement_digest !== $digest,
            ];
        }

        return [
            'reconciliation' => [
                'id' => $reconciliation->id, 'status' => $reconciliation->status, 'partner_id' => $reconciliation->partner_id, 'role' => $reconciliation->role,
                'period_from' => $reconciliation->period_from->toDateString(), 'period_to' => $reconciliation->period_to->toDateString(), 'line_count' => $reconciliation->line_count,
                'reviewed_at' => optional($reconciliation->reviewed_at)->toIso8601String(), 'reviewed_by' => $reconciliation->reviewed_by, 'reviewed_run_id' => $reconciliation->reviewed_run_id,
            ],
            'run' => $run === null ? null : ['id' => $run->id, 'scope' => $run->scope, 'ledger_fingerprint' => $run->ledger_fingerprint, 'created_at' => optional($run->created_at)->toIso8601String()],
            'readiness' => $evaluation['readiness'] + ['can_mark_reviewed' => $reconciliation->status === PartnerStatementReconciliation::STATUS_DRAFT && $evaluation['blockers'] === []],
            'blockers' => $evaluation['blockers'],
            'reviewed_state' => $reviewedState,
            'close' => ['available' => false, 'blocked_reason' => 'close_blocked_pending_claims'],
        ];
    }

    // ═══════════════════════════════ draft → reviewed ═══════════════════════════════

    /** @return array{replayed: bool, status: array<string, mixed>} */
    public function markReviewed(User $actor, string $reconciliationId, string $runId, ?string $note): array
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.reconcile');
        $note = $note === null ? null : trim($note);
        $note = $note === '' ? null : $note;
        if ($note !== null && mb_strlen($note) > 500) {
            throw new PartnerStatementReviewException('reason_too_long', 'الملاحظة أطول من 500 حرف.');
        }
        $run = $this->run($actor, $reconciliation, $runId);

        $replayed = DB::transaction(function () use ($actor, $reconciliation, $run, $note): bool {
            $this->review->lockReconciliation($reconciliation->id);
            $fresh = PartnerStatementReconciliation::query()->whereKey($reconciliation->id)->lockForUpdate()->first();
            if ($fresh === null) {
                throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
            }
            if ($fresh->status === PartnerStatementReconciliation::STATUS_REVIEWED && $fresh->reviewed_run_id === $run->id) {
                return true;   // إعادة الطلب نفسه: لا حدث جديد
            }
            if ($fresh->status !== PartnerStatementReconciliation::STATUS_DRAFT) {
                throw new PartnerStatementReviewException('reconciliation_not_draft', 'لا يُنتقل إلى reviewed إلا من حالة المسودة.', 409);
            }

            // الدفتر وبصمة الكشف يُقرآن **بعد** القفل (القفل لا يمنع ترحيل الأستاذ؛ يضيّق النافذة فقط).
            $source = $this->matching->source($actor, $fresh);
            $digest = $this->digest->for((string) $fresh->id);
            if ($fresh->lines_digest !== null && $fresh->lines_digest !== $digest) {
                throw new PartnerStatementReviewException('statement_changed', 'سطور الكشف تغيّرت عن بصمة الاستيراد (تعديل خارج التطبيق).', 409);
            }
            $this->review->assertFresh($run, $fresh, $source, $digest);

            $evaluation = $this->evaluate($fresh, $run, $source, $digest);
            if ($evaluation['blockers'] !== []) {
                $first = $evaluation['blockers'][0];
                throw new PartnerStatementReviewException($first['code'], $first['message'], 409, array_diff_key($first, ['code' => 1, 'message' => 1]));
            }

            $last = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $fresh->id)->max('seq');
            PartnerStatementReconciliationEvent::create([
                'reconciliation_id' => $fresh->id, 'seq' => ((int) $last) + 1, 'action' => PartnerStatementReconciliationEvent::ACTION_MARK_REVIEWED,
                'from_status' => PartnerStatementReconciliation::STATUS_DRAFT, 'to_status' => PartnerStatementReconciliation::STATUS_REVIEWED, 'run_id' => $run->id,
                'ledger_fingerprint' => $source['fingerprint'], 'statement_digest' => $digest, 'summary' => $evaluation['summary'], 'reason' => $note,
                'created_by' => $actor->getKey(), 'created_at' => now(),
            ]);
            $fresh->update(['status' => PartnerStatementReconciliation::STATUS_REVIEWED, 'reviewed_at' => now(), 'reviewed_by' => $actor->getKey(), 'reviewed_run_id' => $run->id]);

            return false;
        });

        return ['replayed' => $replayed, 'status' => $this->status($actor, $reconciliationId, $runId)];
    }

    // ═══════════════════════════════ reviewed → draft ═══════════════════════════════

    /** @return array<string, mixed> */
    public function reopen(User $actor, string $reconciliationId, ?string $reason): array
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.reconcile');
        $reason = $reason === null ? null : trim($reason);
        if ($reason === null || mb_strlen($reason) < 3) {
            throw new PartnerStatementReviewException('reason_required', 'سبب إعادة الفتح إلزامي (3 محارف على الأقل).');
        }
        if (mb_strlen($reason) > 500) {
            throw new PartnerStatementReviewException('reason_too_long', 'السبب أطول من 500 حرف.');
        }

        DB::transaction(function () use ($actor, $reconciliation, $reason): void {
            $this->review->lockReconciliation($reconciliation->id);
            $fresh = PartnerStatementReconciliation::query()->whereKey($reconciliation->id)->lockForUpdate()->first();
            if ($fresh === null || $fresh->status !== PartnerStatementReconciliation::STATUS_REVIEWED) {
                throw new PartnerStatementReviewException('reconciliation_not_reviewed', 'لا تُعاد فتح إلا مقارنة في حالة reviewed.', 409);
            }
            // إعادة الفتح تُبطل مراجعة بُنيت على تشغيلة: لا يفعلها من لا يقرأ تلك التشغيلة (نطاق أضيق من نطاق من راجع).
            $reviewedRun = PartnerStatementMatchRun::query()->whereKey($fresh->reviewed_run_id)->first();
            if ($reviewedRun === null || ! $this->matching->readable($actor, $reviewedRun)) {
                throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
            }
            $last = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $fresh->id)->max('seq');
            PartnerStatementReconciliationEvent::create([
                'reconciliation_id' => $fresh->id, 'seq' => ((int) $last) + 1, 'action' => PartnerStatementReconciliationEvent::ACTION_REOPEN,
                'from_status' => PartnerStatementReconciliation::STATUS_REVIEWED, 'to_status' => PartnerStatementReconciliation::STATUS_DRAFT, 'run_id' => $fresh->reviewed_run_id,
                'reason' => $reason, 'created_by' => $actor->getKey(), 'created_at' => now(),
            ]);
            $fresh->update(['status' => PartnerStatementReconciliation::STATUS_DRAFT, 'reviewed_at' => null, 'reviewed_by' => null, 'reviewed_run_id' => null]);
        });

        return $this->status($actor, $reconciliationId);
    }

    // ═══════════════════════════════ reviewed → closed (محجوب) ═══════════════════════════════

    /** @throws PartnerStatementReviewException دائماً — الإغلاق النهائي ينتظر مطالبات PS-A3d (انظر وصف الصنف). */
    public function close(User $actor, string $reconciliationId): never
    {
        $this->matching->authorize($actor, $reconciliationId, 'partner_statements.reconcile');

        throw new PartnerStatementReviewException(
            'close_blocked_pending_claims',
            'الإغلاق النهائي غير متاح بعد: يتطلب منع المطالبة المزدوجة بالحركات بين المقارنات النهائية المتداخلة (PS-A3d). المقارنة تبقى reviewed.',
            409,
        );
    }

    // ═══════════════════════════════ السجل ═══════════════════════════════

    /** @param array{per_page?: ?int, page?: ?int} $filters */
    public function events(User $actor, string $reconciliationId, array $filters): LengthAwarePaginator
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.view');
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) ($filters['per_page'] ?? 25)));

        // حدث مرتبط بتشغيلة لا يقرؤها القارئ (نطاق أوسع) لا يُعرض له.
        $readable = [];
        foreach (PartnerStatementMatchRun::query()->where('reconciliation_id', $reconciliation->id)->get() as $run) {
            if ($this->matching->readable($actor, $run)) {
                $readable[] = $run->id;
            }
        }

        return PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $reconciliation->id)
            ->where(fn ($q) => $q->whereNull('run_id')->orWhereIn('run_id', $readable))
            ->orderByDesc('seq')->paginate($perPage)->through(fn (PartnerStatementReconciliationEvent $e): array => [
                'id' => $e->id, 'seq' => $e->seq, 'action' => $e->action, 'from_status' => $e->from_status, 'to_status' => $e->to_status, 'run_id' => $e->run_id,
                'ledger_fingerprint' => $e->ledger_fingerprint, 'statement_digest' => $e->statement_digest, 'summary' => $e->summary, 'reason' => $e->reason,
                'created_by' => $e->created_by, 'created_at' => optional($e->created_at)->toIso8601String(),
            ]);
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

    /**
     * يقيّم جاهزية المراجعة على التشغيلة: الموانع (بترتيب ثابت) والعدّادات والملخص الذي يُسجَّل في الحدث. قراءة فقط.
     *
     * @param  array{scope: array<string, mixed>, fingerprint: string}  $source
     * @return array{blockers: list<array<string, mixed>>, readiness: array<string, mixed>, summary: array<string, mixed>}
     */
    private function evaluate(PartnerStatementReconciliation $reconciliation, ?PartnerStatementMatchRun $run, array $source, string $digest): array
    {
        $blockers = [];
        if ($reconciliation->lines_digest !== null && $reconciliation->lines_digest !== $digest) {
            $blockers[] = ['code' => 'statement_changed', 'message' => 'سطور الكشف تغيّرت عن بصمة الاستيراد (تعديل خارج التطبيق).'];
        }

        $lines = PartnerStatementLine::query()->where('reconciliation_id', $reconciliation->id)->orderBy('ordinal')->get(['id', 'ordinal']);
        $effective = $this->review->effectiveDecisions((string) $reconciliation->id);
        $byAction = [];
        $unresolved = [];
        $otherRun = 0;
        $acceptedDifferenceMinor = 0;
        foreach ($lines as $line) {
            $decision = $effective[$line->id] ?? null;
            if ($decision === null) {
                $unresolved[] = (int) $line->ordinal;

                continue;
            }
            $valid = $run !== null && $decision->run_id === $run->id && $decision->ledger_fingerprint === $run->ledger_fingerprint;
            if (! $valid) {
                $otherRun++;

                continue;
            }
            $byAction[$decision->action] = ($byAction[$decision->action] ?? 0) + 1;
            // كل فرق مالي قُبل بقرار (داخل التسامح بسبب أو خارجه بإقرار) يدخل المجموع المطلق — لا يُستثنى ما كان ضمن التسامح (Codex #1939، D-PS-16).
            $acceptedDifferenceMinor += abs((int) $decision->difference_minor);
        }

        if ($run === null) {
            array_unshift($blockers, ['code' => 'no_run', 'message' => 'لا توجد تشغيلة مطابقة مقروءة؛ شغّل المطابقة أولاً.']);
        } else {
            try {
                $this->review->assertFresh($run, $reconciliation, $source, $digest);
            } catch (PartnerStatementReviewException $e) {
                $blockers[] = ['code' => 'run_stale', 'message' => $e->getMessage(), 'causes' => $e->details['causes'] ?? []];
            }
        }
        if ($unresolved !== []) {
            $blockers[] = [
                'code' => 'unresolved_lines', 'message' => 'بنود كشف بلا قرار مراجعة صريح (confirm / override / link_pair / dismiss).',
                'count' => count($unresolved), 'sample_ordinals' => array_slice($unresolved, 0, self::SAMPLE),
            ];
        }
        if ($otherRun > 0) {
            $blockers[] = ['code' => 'decisions_on_other_runs', 'message' => 'قرارات فعّالة بُنيت على تشغيلة أخرى أو ببصمة دفتر مختلفة: أعد القرار على هذه التشغيلة.', 'count' => $otherRun];
        }

        $missingInStatement = $run === null ? 0 : PartnerStatementMatch::query()->where('run_id', $run->id)->where('side', 'ledger')->where('outcome', 'missing_in_statement')->count();

        return [
            'blockers' => $blockers,
            'readiness' => [
                'lines_total' => $lines->count(), 'resolved' => array_sum($byAction), 'unresolved' => count($unresolved), 'decisions_on_other_runs' => $otherRun,
                'decisions_by_action' => $byAction,
            ],
            'summary' => [
                'lines_total' => $lines->count(), 'decisions_by_action' => $byAction, 'accepted_difference_minor' => $acceptedDifferenceMinor,
                'ledger_units_missing_in_statement' => $missingInStatement, 'engine_version' => PartnerStatementMatchingEngine::VERSION,
            ],
        ];
    }
}
