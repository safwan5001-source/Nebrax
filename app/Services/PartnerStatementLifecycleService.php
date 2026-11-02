<?php

namespace App\Services;

use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementMatch;
use App\Models\PartnerStatementMatchRun;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\User;
use App\Support\PartnerStatementReviewException;
use App\Support\Rbac;
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
 *  - `reviewed → closed` (`close`، PS-A3d): `partner_statements.close` **و**`.view` (سلطة مستقلة عن المراجعة) + نطاق الطرف/الفرع؛ **المُغلِق ≠ المراجِع** (D-PS-17)؛ ذرّي مع المطالبات النهائية بالحركات
 *    (`PartnerStatementClaimService`) وإقرار التداخل ومنع التعارض الحقيقي بين النهائيات (D-PS-12/14)؛ الحالة طرفية في A3d (الإبطال/الاستبدال A3e).
 *  - كل انتقال حدثٌ في سجل append-only (فاعل، سبب، تشغيلة، بصمة الدفتر والكشف، ملخص)، في المعاملة نفسها، والقاعدة ترفض تغيير الحالة بلا حدث مطابق.
 *
 * التزامن: القفل الاستشاري نفسه لقرارات المراجعة (لكل مقارنة) + `FOR UPDATE` على صف المقارنة؛ فتتسلسل القرارات والانتقالات. **هذا القفل وحده لا يحمي الأستاذ** (`LedgerService` لا يأخذه): فقد يُرحَّل قيد
 * بعد قراءة المراجعة؛ لذلك تعلن القراءة `ledger_changed_since_review` وتُرفض القرارات اللاحقة بـ`run_stale`، وإعادة الفتح متاحة. **الإغلاق** يأخذ فوقه مِرساة المستأجر نفسها التي يقفلها كل ترحيل/عكس قبل قراءة الدفتر،
 * فلا يُثبَّت قيد بين قراءة الإغلاق والتزامه (انظر `PartnerStatementClaimService`).
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
        private readonly PartnerStatementClaimService $claims,
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
                'closed_at' => optional($reconciliation->closed_at)->toIso8601String(), 'closed_by' => $reconciliation->closed_by, 'scope_key' => $reconciliation->scope_key,
            ],
            'run' => $run === null ? null : ['id' => $run->id, 'scope' => $run->scope, 'ledger_fingerprint' => $run->ledger_fingerprint, 'created_at' => optional($run->created_at)->toIso8601String()],
            'readiness' => $evaluation['readiness'] + ['can_mark_reviewed' => $reconciliation->status === PartnerStatementReconciliation::STATUS_DRAFT && $evaluation['blockers'] === []],
            'blockers' => $evaluation['blockers'],
            'reviewed_state' => $reviewedState,
            'close' => $this->closeState($actor, $reconciliation, $reviewedState),
            'final' => $reconciliation->status === PartnerStatementReconciliation::STATUS_CLOSED ? [
                'closed_at' => optional($reconciliation->closed_at)->toIso8601String(), 'closed_by' => $reconciliation->closed_by, 'scope_key' => $reconciliation->scope_key,
                'claims_count' => $this->claims->countFor((string) $reconciliation->id),
            ] : null,
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

    // ═══════════════════════════════ reviewed → closed ═══════════════════════════════

    /**
     * الإغلاق النهائي `reviewed → closed` (PS-A3d): **ذرّي** — كل الفحوص والمطالبات والحدث والانتقال في معاملة واحدة تحت أقفال (استشاري للمقارنة ← استشاري واسع للطرف/الدور ← صف المقارنة ← **مِرساة المستأجر
     * قبل قراءة الدفتر**). أي فشل ⇒ تراجع كامل (لا مطالبات ولا حدث ولا تغيّر حالة). لا أثر مالي.
     *
     * الشروط (بترتيب ثابت): `partner_statements.close`+`.view` ونطاق الطرف والفرع · مقارنة `reviewed` · **المُغلِق ≠ المراجِع** (D-PS-17) · التشغيلة = تشغيلة المراجعة نفسها ·
     * حداثة التشغيلة (محرّك/سياسة/نطاق/بصمة الدفتر/بصمة سطور الكشف) وكل البنود بقرارات صريحة على هذه التشغيلة · نطاق قابل للإغلاق (مؤسسة أو فرع واحد) · لا نهائي قائم بالنطاق والفترة نفسيهما ·
     * لا تعارض حركة مع نهائي آخر (`unit_conflict`) · إقرار بالتداخل مطابق تماماً لقائمة الخادم. إعادة الطلب على مقارنة مُغلقة بالتشغيلة نفسها ⇒ `replayed` بلا حدث جديد.
     *
     * @param  array{run_id: string, acknowledge_overlap?: ?list<string>, note?: ?string}  $input
     * @return array{replayed: bool, status: array<string, mixed>}
     */
    public function close(User $actor, string $reconciliationId, array $input): array
    {
        $reconciliation = $this->matching->authorize($actor, $reconciliationId, 'partner_statements.close');
        $note = isset($input['note']) ? trim((string) $input['note']) : null;
        $note = $note === '' ? null : $note;
        if ($note !== null && mb_strlen($note) > 500) {
            throw new PartnerStatementReviewException('reason_too_long', 'الملاحظة أطول من 500 حرف.');
        }
        $acknowledged = array_values(array_unique(array_map('strval', (array) ($input['acknowledge_overlap'] ?? []))));
        sort($acknowledged);
        $run = $this->run($actor, $reconciliation, (string) ($input['run_id'] ?? ''));

        // 3 محاولات: تُعاد المعاملة بكاملها عند جمود قاعدة البيانات فقط (مِرساة المستأجر يشاركها الترحيل)؛ استثناءات العمل لا تُعاد.
        $replayed = DB::transaction(function () use ($actor, $reconciliation, $run, $note, $acknowledged): bool {
            $this->review->lockReconciliation($reconciliation->id);
            $this->claims->lockPartnerScope((string) $reconciliation->partner_id, (string) $reconciliation->role);
            $fresh = PartnerStatementReconciliation::query()->whereKey($reconciliation->id)->lockForUpdate()->first();
            if ($fresh === null) {
                throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
            }
            if ($fresh->status === PartnerStatementReconciliation::STATUS_CLOSED) {
                $closeEvent = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $fresh->id)->where('action', PartnerStatementReconciliationEvent::ACTION_CLOSE)->orderByDesc('seq')->first();
                if ($closeEvent !== null && $closeEvent->run_id === $run->id) {
                    return true;   // إعادة الطلب نفسه: لا حدث ولا مطالبات جديدة
                }
                throw new PartnerStatementReviewException('reconciliation_already_closed', 'المقارنة مُغلقة نهائياً بتشغيلة أخرى.', 409);
            }
            if ($fresh->status !== PartnerStatementReconciliation::STATUS_REVIEWED) {
                throw new PartnerStatementReviewException('reconciliation_not_reviewed', 'لا يُغلق إلا مقارنة في حالة reviewed.', 409);
            }
            if ((string) $fresh->reviewed_by === (string) $actor->getKey()) {
                throw new PartnerStatementReviewException('closer_must_differ_from_reviewer', 'فصل المهام: من راجع المقارنة لا يُغلقها (D-PS-17).', 403);
            }
            if ($fresh->reviewed_run_id !== $run->id) {
                throw new PartnerStatementReviewException('run_is_not_the_reviewed_run', 'الإغلاق على التشغيلة التي اعتمدتها المراجعة نفسها.', 409, ['reviewed_run_id' => $fresh->reviewed_run_id]);
            }

            // مِرساة المستأجر قبل قراءة الدفتر: لا ترحيل/عكس يُثبَّت بين القراءة والالتزام (يحجب `LedgerService` نفسه دون تعديله).
            $this->claims->lockLedgerAnchor();
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

            $scopeKey = $this->claims->scopeKey($source['scope']);
            $overlaps = $this->claims->overlappingFinals($fresh, $scopeKey);
            $identical = $overlaps->filter(fn (PartnerStatementReconciliation $o): bool => $o->period_from->toDateString() === $fresh->period_from->toDateString() && $o->period_to->toDateString() === $fresh->period_to->toDateString());
            if ($identical->isNotEmpty()) {
                throw new PartnerStatementReviewException('final_already_exists', 'يوجد نهائي قائم لنفس الطرف والدور والفترة بنطاق متقاطع (مؤسسة ⇄ أي نطاق، أو الفرع نفسه): الاستبدال شريحة PS-A3e.', 409, [
                    'reconciliation_ids' => $identical->pluck('id')->values()->all(),
                ]);
            }

            $set = $this->claims->claimSet($source['units'], $fresh->period_from->toDateString(), $fresh->period_to->toDateString(), $this->review->effectiveDecisions((string) $fresh->id));
            $conflicts = $this->claims->conflicts($fresh, $set);
            if ($conflicts !== []) {
                throw new PartnerStatementReviewException('unit_conflict', 'حركة (قيد) مُطالَب بها فعلاً من مقارنة نهائية أخرى لهذا الطرف: لا مطالبة مزدوجة (الاستبدال شريحة PS-A3e).', 409, [
                    'reconciliation_ids' => array_values(array_unique(array_column($conflicts, 'reconciliation_id'))),
                    'conflicts' => count($conflicts), 'sample' => array_slice($conflicts, 0, PartnerStatementClaimService::SAMPLE),
                ]);
            }

            $serverIds = $overlaps->pluck('id')->map(fn ($id): string => (string) $id)->sort()->values()->all();
            if ($serverIds !== [] && $acknowledged === []) {
                throw new PartnerStatementReviewException('overlap_ack_required', 'فترتها تتداخل مع نهائيات قائمة: أقرّ بها صراحةً (acknowledge_overlap) بالقائمة نفسها.', 409, [
                    'overlaps' => $overlaps->map(fn (PartnerStatementReconciliation $o): array => $this->claims->present($o))->all(),
                ]);
            }
            if ($acknowledged !== $serverIds) {
                throw new PartnerStatementReviewException('overlap_ack_stale', 'قائمة الإقرار لا تطابق النهائيات المتداخلة الآن (ظهر أو اختفى نهائي): راجع القائمة وأعد الإقرار.', 409, [
                    'overlaps' => $overlaps->map(fn (PartnerStatementReconciliation $o): array => $this->claims->present($o))->all(),
                ]);
            }

            $written = $this->claims->write($fresh, $set);
            $last = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $fresh->id)->max('seq');
            PartnerStatementReconciliationEvent::create([
                'reconciliation_id' => $fresh->id, 'seq' => ((int) $last) + 1, 'action' => PartnerStatementReconciliationEvent::ACTION_CLOSE,
                'from_status' => PartnerStatementReconciliation::STATUS_REVIEWED, 'to_status' => PartnerStatementReconciliation::STATUS_CLOSED, 'run_id' => $run->id,
                'ledger_fingerprint' => $source['fingerprint'], 'statement_digest' => $digest,
                'summary' => $evaluation['summary'] + ['scope_key' => $scopeKey, 'claims' => $written, 'overlap_acknowledged' => $acknowledged],
                'reason' => $note, 'created_by' => $actor->getKey(), 'reviewer_id' => $fresh->reviewed_by, 'claims_count' => $written['total'], 'created_at' => now(),
            ]);
            $fresh->update(['status' => PartnerStatementReconciliation::STATUS_CLOSED, 'closed_at' => now(), 'closed_by' => $actor->getKey(), 'scope_key' => $scopeKey]);

            return false;
        }, 3);

        return ['replayed' => $replayed, 'status' => $this->status($actor, $reconciliationId, $run->id)];
    }

    /**
     * حالة الإغلاق للعرض فقط (قراءة): متاح أم ممنوع وسببه. القرار الحاسم دائماً داخل `close()`.
     *
     * @param  ?array<string, mixed>  $reviewedState
     * @return array<string, mixed>
     */
    private function closeState(User $actor, PartnerStatementReconciliation $reconciliation, ?array $reviewedState): array
    {
        $blocked = match (true) {
            $reconciliation->status === PartnerStatementReconciliation::STATUS_CLOSED => 'already_closed',
            $reconciliation->status !== PartnerStatementReconciliation::STATUS_REVIEWED => 'not_reviewed',
            ! Rbac::allows((string) $actor->role, 'partner_statements.close') => 'permission_required',
            (string) $reconciliation->reviewed_by === (string) $actor->getKey() => 'closer_must_differ_from_reviewer',
            ($reviewedState['ledger_changed_since_review'] ?? true) || ($reviewedState['statement_changed_since_review'] ?? true) => 'run_stale',
            default => null,
        };

        return ['available' => $blocked === null, 'blocked_reason' => $blocked];
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
                'created_by' => $e->created_by, 'reviewer_id' => $e->reviewer_id, 'claims_count' => $e->claims_count, 'created_at' => optional($e->created_at)->toIso8601String(),
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
