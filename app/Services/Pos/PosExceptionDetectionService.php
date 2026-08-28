<?php

namespace App\Services\Pos;

use App\Models\PosException;
use App\Models\PosExceptionRule;
use App\Models\PosRiskSnapshot;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Tenancy\BranchScope;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * محرّك الكشف الرقابي الحتمي (Phase 2): Collect → Correlate → Detect → Normalize
 * → Score → Explain. يقرأ أدلة `PosSessionEvent` (append-only) وجلسات POS فقط،
 * ولا يعدّلها ولا يولّد قيداً. النتائج (استثناءات/درجات) سجلّات مشتقّة idempotent:
 * إعادة التشغيل على نفس الأدلة تحدّث الصف نفسه بمفتاح `dedup_key` ولا تكرّره،
 * وتحافظ على حالة المراجعة وسجلّها.
 *
 * التشغيل مصمَّم كمهمة إعادة حساب: يجمّع العدّ خادمياً (grouped) ويقرأ إسقاطات
 * محدودة للأنواع النادرة فقط (لا الحمولات الكاملة ولا سيل `item_added`)، فينتقل
 * لاحقاً إلى طابور خلفي بلا إعادة كتابة.
 */
final class PosExceptionDetectionService
{
    /** أنواع تُنسب إلى مالك الجلسة (opened_by) لا إلى منفّذ الحدث. */
    private const SESSION_ATTRIBUTED_TYPES = [
        PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT,
        PosSessionEvent::TYPE_CLOSING_COUNT_RECOUNTED,
        PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED,
        PosSessionEvent::TYPE_CASH_IN_RECORDED,
        PosSessionEvent::TYPE_CASH_OUT_RECORDED,
        PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT,
    ];

    /** أنواع حاملة لمبلغ نحتاج معرّفاتها لإزالة ازدواج «المبلغ قيد المراجعة». */
    private const AMOUNT_TYPES = [
        PosSessionEvent::TYPE_RETURN_RECORDED,
        PosSessionEvent::TYPE_EXCHANGE_RECORDED,
        PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT,
    ];

    /**
     * يشغّل الكشف للمستأجر النشط عبر كل فروعه، ويعيد ملخّصاً بالأرقام.
     *
     * @return array{rules:int, exceptions:int, subjects:int, ran_at:string}
     */
    public function run(?Carbon $now = null): array
    {
        $now = $now ? $now->copy() : Carbon::now();
        $rules = $this->activeRules();

        // findings مفهرسة بـ dedup_key لضمان idempotency عبر النوافذ.
        $findings = [];
        foreach ($this->rulesByWindow($rules) as $windowDays => $windowRules) {
            $current = $this->aggregate($now->copy()->subDays($windowDays), $now, true);
            $prior = $this->aggregate($now->copy()->subDays($windowDays * 2), $now->copy()->subDays($windowDays), false);
            foreach ($windowRules as $rule) {
                foreach ($this->evaluate($rule, $current, $prior, $now, $windowDays) as $finding) {
                    $findings[$finding['dedup_key']] = $finding;
                }
            }
        }

        $persisted = $this->persist($findings, $now);
        $subjects = $this->rebuildSnapshots($persisted, $now);

        return [
            'rules' => count($rules),
            'exceptions' => count($persisted),
            'subjects' => $subjects,
            'ran_at' => $now->toIso8601String(),
        ];
    }

    /** يزرع صفوف الكتالوج للمستأجر مرة واحدة، ويعيد القواعد المفعّلة مدموجةً. */
    public function activeRules(): array
    {
        $this->syncRules();
        $stored = PosExceptionRule::query()->get()->keyBy('rule_key');
        $rules = [];
        foreach (PosExceptionRuleCatalog::rules() as $key => $definition) {
            $row = $stored->get($key);
            if ($row && ! $row->is_enabled) {
                continue;
            }
            $rules[$key] = array_merge($definition, [
                'rule_key' => $key,
                'weight' => $row?->weight ?? $definition['weight'],
                'min_sample' => $row?->min_sample ?? $definition['min_sample'],
                'window_days' => $row?->window_days ?? $definition['window_days'],
                'threshold' => $row?->threshold ?? $definition['threshold'],
                'version' => $row?->version ?? 1,
            ]);
        }

        return $rules;
    }

    /** يضمن وجود صف كتالوج لكل قاعدة دون إعادة كتابة إعداد المستأجر. */
    public function syncRules(): void
    {
        $existing = PosExceptionRule::query()->pluck('rule_key')->all();
        foreach (PosExceptionRuleCatalog::rules() as $key => $definition) {
            if (in_array($key, $existing, true)) {
                continue;
            }
            PosExceptionRule::create([
                'rule_key' => $key,
                'category' => $definition['category'],
                'is_enabled' => true,
                'weight' => $definition['weight'],
                'min_sample' => $definition['min_sample'],
                'window_days' => $definition['window_days'],
                'threshold' => $definition['threshold'],
                'version' => 1,
                'config' => $definition['config'] ?? null,
            ]);
        }
    }

    /** @param array<string,array> $rules @return array<int,array<int,array>> */
    private function rulesByWindow(array $rules): array
    {
        $grouped = [];
        foreach ($rules as $rule) {
            $grouped[$rule['window_days']][] = $rule;
        }

        return $grouped;
    }

    // ════════════════════════════ التجميع ════════════════════════════

    /**
     * يجمّع مقاييس نافذة واحدة. العدّ خادمي (grouped)؛ الإسقاطات محدودة بالأنواع
     * الحاملة للمبلغ وبالجلسات فقط. `$full` يجلب إسقاطات المبلغ/التوقيت للنافذة
     * الحالية فقط (السابقة تحتاج المعدّلات لا المعرّفات).
     *
     * @return array<string,mixed>
     */
    private function aggregate(Carbon $start, Carbon $end, bool $full): array
    {
        $counts = [];   // [branch][performer][type] => cnt
        $amounts = [];  // [branch][performer][type] => sum(abs(amount))
        $rows = PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->whereNotNull('performed_by')
            ->where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw('branch_id, performed_by, type, COUNT(*) as cnt, COALESCE(SUM(ABS(amount)), 0) as amt')
            ->groupBy('branch_id', 'performed_by', 'type')->get();
        foreach ($rows as $row) {
            $branch = $row->branch_id ?? '_';
            $counts[$branch][$row->performed_by][$row->type] = (int) $row->cnt;
            $amounts[$branch][$row->performed_by][$row->type] = (int) $row->amt;
        }

        // الأزواج (منفّذ↔معتمِد) من override_approved.
        $pairs = [];
        $pairRows = PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->where('type', PosSessionEvent::TYPE_OVERRIDE_APPROVED)
            ->whereNotNull('performed_by')->whereNotNull('approved_by')
            ->where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw('branch_id, performed_by, approved_by, COUNT(*) as cnt')
            ->groupBy('branch_id', 'performed_by', 'approved_by')->get();
        foreach ($pairRows as $row) {
            $pairs[$row->branch_id ?? '_'][$row->performed_by][$row->approved_by] = (int) $row->cnt;
        }

        // الجلسات: العدّ وساعات العمل وربط الجلسة بمالكها.
        $sessions = [];       // [branch][owner] => ['count','closed','worked_seconds']
        $sessionOwner = [];   // sessionId => ['branch','owner','closed_at']
        PosSession::query()->withoutGlobalScope(BranchScope::class)
            ->whereNotNull('opened_by')
            ->where('opened_at', '>=', $start)->where('opened_at', '<', $end)
            ->get(['id', 'branch_id', 'opened_by', 'opened_at', 'closed_at', 'status'])
            ->each(function (PosSession $session) use (&$sessions, &$sessionOwner) {
                $branch = $session->branch_id ?? '_';
                $sessionOwner[$session->id] = ['branch' => $branch, 'owner' => $session->opened_by, 'closed_at' => $session->closed_at];
                $bucket = &$sessions[$branch][$session->opened_by];
                $bucket['count'] = ($bucket['count'] ?? 0) + 1;
                if ($session->closed_at !== null) {
                    $bucket['closed'] = ($bucket['closed'] ?? 0) + 1;
                    $bucket['worked_seconds'] = ($bucket['worked_seconds'] ?? 0)
                        + max(0, $session->closed_at->getTimestamp() - $session->opened_at->getTimestamp());
                }
                unset($bucket);
            });

        // العدّ المنسوب لمالك الجلسة (grouped، ثم يُربط بالمالك).
        $bySessionOwner = []; // [branch][owner][type] => cnt
        $sessionTypeRows = PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('type', self::SESSION_ATTRIBUTED_TYPES)
            ->whereNotNull('pos_session_id')
            ->where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw('pos_session_id, type, COUNT(*) as cnt')
            ->groupBy('pos_session_id', 'type')->get();
        foreach ($sessionTypeRows as $row) {
            $owner = $sessionOwner[$row->pos_session_id] ?? null;
            if ($owner === null) {
                continue;
            }
            $bySessionOwner[$owner['branch']][$owner['owner']][$row->type]
                = ($bySessionOwner[$owner['branch']][$owner['owner']][$row->type] ?? 0) + (int) $row->cnt;
        }

        $result = [
            'counts' => $counts, 'amounts' => $amounts, 'pairs' => $pairs,
            'sessions' => $sessions, 'session_owner' => $sessionOwner, 'by_session_owner' => $bySessionOwner,
            'start' => $start, 'end' => $end,
        ];

        if ($full) {
            $result['amount_events'] = $this->amountEvents($start, $end, $sessionOwner);
        }

        return $result;
    }

    /**
     * إسقاط محدود للأنواع الحاملة للمبلغ (نادرة): يعطي معرّفات ومبالغ لكل من
     * المنفّذ ومالك الجلسة، لأجل «المبلغ قيد المراجعة» ومراجعه الدقيقة.
     *
     * @return array{performer:array,owner:array}
     */
    private function amountEvents(Carbon $start, Carbon $end, array $sessionOwner): array
    {
        $byPerformer = [];
        $byOwner = [];
        PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('type', self::AMOUNT_TYPES)
            ->whereNotNull('amount')
            ->where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->orderBy('created_at')
            ->get(['id', 'branch_id', 'performed_by', 'pos_session_id', 'type', 'amount'])
            ->each(function (PosSessionEvent $event) use (&$byPerformer, &$byOwner, $sessionOwner) {
                $entry = ['id' => $event->id, 'amount' => abs((int) $event->amount)];
                if ($event->performed_by !== null) {
                    $byPerformer[$event->branch_id ?? '_'][$event->performed_by][$event->type][] = $entry;
                }
                $owner = $sessionOwner[$event->pos_session_id] ?? null;
                if ($owner !== null) {
                    $byOwner[$owner['branch']][$owner['owner']][$event->type][] = $entry;
                }
            });

        return ['performer' => $byPerformer, 'owner' => $byOwner];
    }

    // ════════════════════════════ التقييم ════════════════════════════

    /** @return list<array<string,mixed>> */
    private function evaluate(array $rule, array $current, array $prior, Carbon $now, int $windowDays): array
    {
        return match ($rule['subject']) {
            PosExceptionRuleCatalog::SUBJECT_PAIR => $this->evaluatePair($rule, $current, $now, $windowDays),
            PosExceptionRuleCatalog::SUBJECT_APPROVER => $this->evaluateApprover($rule, $current, $now, $windowDays),
            default => $this->evaluateUser($rule, $current, $prior, $now, $windowDays),
        };
    }

    /** قواعد الموضوع = المستخدم (منفّذ أو مالك جلسة بحسب المقام). */
    private function evaluateUser(array $rule, array $current, array $prior, Carbon $now, int $windowDays): array
    {
        $sessionScoped = in_array($rule['denominator'], [
            PosExceptionRuleCatalog::DENOM_SESSIONS,
            PosExceptionRuleCatalog::DENOM_WORKED_SECONDS,
        ], true);

        $subjects = $sessionScoped
            ? $this->sessionSubjects($current)
            : $this->performerSubjects($current);

        $findings = [];
        foreach ($subjects as [$branch, $subject]) {
            // العدّ للعرض، والقيمة للمعدّل (المبلغ لقواعد وضع المبلغ، وإلّا العدّ).
            $observedCount = $this->numeratorFor($rule, $branch, $subject, $current, $sessionScoped);
            $numeratorValue = $this->numeratorValue($rule, $branch, $subject, $current, $sessionScoped, $observedCount);
            $denominator = $this->denominatorFor($rule, $branch, $subject, $current);
            if ($denominator < $rule['min_sample'] || $denominator <= 0) {
                continue; // عينة غير كافية — لا حكم مضلّل.
            }
            $observed = PosBaselineCalculator::rateMilli($numeratorValue, $denominator, $rule['per']);
            if ($observed === null || $numeratorValue <= 0) {
                continue;
            }

            $finding = $rule['compare'] === PosExceptionRuleCatalog::COMPARE_STATIC
                ? $this->assessStatic($rule, $branch, $subject, $observedCount, $denominator, $observed, $current, $sessionScoped)
                : $this->assessBaseline($rule, $branch, $subject, $observedCount, $denominator, $observed, $prior, $current);
            if ($finding !== null) {
                $findings[] = $this->finalizeFinding($rule, $branch, $subject, $subject, null, $finding, $current, $now, $windowDays, $sessionScoped);
            }
        }

        return $findings;
    }

    /** قاعدة تركّز الزوج منفّذ↔معتمِد (عتبة ثابتة). */
    private function evaluatePair(array $rule, array $current, Carbon $now, int $windowDays): array
    {
        $findings = [];
        foreach ($current['pairs'] as $branch => $performers) {
            foreach ($performers as $performer => $approvers) {
                $performerTotal = array_sum($approvers);
                if ($performerTotal < $rule['min_sample']) {
                    continue;
                }
                foreach ($approvers as $approver => $count) {
                    $observed = PosBaselineCalculator::rateMilli($count, $performerTotal, $rule['per']);
                    if ($observed === null || $observed < $rule['threshold']) {
                        continue;
                    }
                    $severity = $this->staticSeverity($observed, $rule['threshold']);
                    $finding = [
                        'observed_count' => $count, 'denominator' => $performerTotal, 'observed_rate' => $observed,
                        'baseline_rate' => $rule['threshold'], 'baseline_type' => 'static', 'sample_size' => $performerTotal,
                        'severity' => $severity, 'sample_sufficient' => true,
                        'amount_under_review' => 0, 'amount_event_ids' => [],
                    ];
                    $findings[] = $this->finalizeFinding($rule, $branch, $performer, $performer, $approver, $finding, $current, $now, $windowDays, false);
                }
            }
        }

        return $findings;
    }

    /** قواعد الموضوع = المعتمِد (تركّز/معدّل اعتماد مرتفع، عتبة ثابتة). */
    private function evaluateApprover(array $rule, array $current, Carbon $now, int $windowDays): array
    {
        // إجماليات الفرع: كل الاعتمادات، وكل الطلبات.
        $approvalsByApprover = [];
        $approvalsInBranch = [];
        foreach ($current['pairs'] as $branch => $performers) {
            foreach ($performers as $approvers) {
                foreach ($approvers as $approver => $count) {
                    $approvalsByApprover[$branch][$approver] = ($approvalsByApprover[$branch][$approver] ?? 0) + $count;
                    $approvalsInBranch[$branch] = ($approvalsInBranch[$branch] ?? 0) + $count;
                }
            }
        }
        $requestsInBranch = [];
        foreach ($current['counts'] as $branch => $performers) {
            foreach ($performers as $types) {
                $requestsInBranch[$branch] = ($requestsInBranch[$branch] ?? 0)
                    + ($types[PosSessionEvent::TYPE_OVERRIDE_REQUESTED] ?? 0);
            }
        }

        $usesRequests = $rule['denominator'] === PosExceptionRuleCatalog::DENOM_OVERRIDE_REQUESTS;
        $findings = [];
        foreach ($approvalsByApprover as $branch => $approvers) {
            $denominatorBranch = $usesRequests ? ($requestsInBranch[$branch] ?? 0) : ($approvalsInBranch[$branch] ?? 0);
            foreach ($approvers as $approver => $count) {
                if ($count < $rule['min_sample'] || $denominatorBranch <= 0) {
                    continue;
                }
                $observed = PosBaselineCalculator::rateMilli($count, $denominatorBranch, $rule['per']);
                if ($observed === null || $observed < $rule['threshold']) {
                    continue;
                }
                $finding = [
                    'observed_count' => $count, 'denominator' => $denominatorBranch, 'observed_rate' => $observed,
                    'baseline_rate' => $rule['threshold'], 'baseline_type' => 'static', 'sample_size' => $count,
                    'severity' => $this->staticSeverity($observed, $rule['threshold']), 'sample_sufficient' => true,
                    'amount_under_review' => 0, 'amount_event_ids' => [],
                ];
                $findings[] = $this->finalizeFinding($rule, $branch, $approver, $approver, null, $finding, $current, $now, $windowDays, false);
            }
        }

        return $findings;
    }

    // ════════════════════════════ التقدير ════════════════════════════

    /** تقدير قاعدة أساس: يقارن معدّل الموضوع بخط الأساس المحلول. */
    private function assessBaseline(array $rule, string $branch, string $subject, int $numerator, int $denominator, int $observed, array $prior, array $current): ?array
    {
        $priorValue = $this->numeratorValue($rule, $branch, $subject, $prior, $this->isSessionScoped($rule));
        $priorDenominator = $this->denominatorFor($rule, $branch, $subject, $prior);
        $priorRate = $priorDenominator > 0
            ? PosBaselineCalculator::rateMilli($priorValue, $priorDenominator, $rule['per'])
            : null;

        $peerRates = $this->peerRates($rule, $branch, $subject, $current);
        $static = PosExceptionRuleCatalog::STATIC_FALLBACK_RATE[$rule['rule_key']] ?? $rule['threshold'];

        $baseline = PosBaselineCalculator::resolve(
            $denominator, $rule['min_sample'],
            ($priorRate !== null && $priorRate > 0) ? $priorRate : null,
            $priorDenominator, $peerRates, $static,
        );

        $baselineRate = $baseline['rate'];
        // شرط التجاوز: المرصود ≥ الأساس × (العتبة٪ ÷ 100). أساس صفري يتطلب
        // تجاوزاً مطلقاً فوق الاحتياطي كي لا يفجّر حدثٌ واحد نسبةً لا نهائية.
        $trigger = $baselineRate > 0
            ? ($observed * 100 >= $baselineRate * $rule['threshold'])
            : ($observed * 100 >= $static * $rule['threshold']);
        if (! $trigger) {
            return null;
        }

        $severity = $this->baselineSeverity($observed, $baselineRate > 0 ? $baselineRate : $static);

        return [
            'observed_count' => $numerator, 'denominator' => $denominator, 'observed_rate' => $observed,
            'baseline_rate' => $baselineRate, 'baseline_type' => $baseline['type'], 'sample_size' => $denominator,
            'severity' => $severity, 'sample_sufficient' => $baseline['sample_sufficient'],
            'amount_under_review' => 0, 'amount_event_ids' => [],
        ];
    }

    /** تقدير قاعدة ثابتة (تركّز/مقدار مطلق). */
    private function assessStatic(array $rule, string $branch, string $subject, int $numerator, int $denominator, int $observed, array $current, bool $sessionScoped): ?array
    {
        // مقدار مطلق (مثل مقدار فرق الإغلاق): متوسط بالهللات مقابل config.absolute.
        if (($rule['amount_abs'] ?? false) && ($rule['numerator_mode'] ?? null) !== 'amount') {
            $absolute = $rule['config']['absolute'] ?? $rule['threshold'];
            $totalAmount = $this->amountSum($rule, $branch, $subject, $current, $sessionScoped);
            $avg = $denominator > 0 ? intdiv($totalAmount['total'], $denominator) : 0;
            if ($avg < $absolute) {
                return null;
            }

            return [
                'observed_count' => $numerator, 'denominator' => $denominator, 'observed_rate' => $avg,
                'baseline_rate' => $absolute, 'baseline_type' => 'static', 'sample_size' => $denominator,
                'severity' => $this->staticSeverity($avg, $absolute), 'sample_sufficient' => true,
                'amount_under_review' => $totalAmount['total'], 'amount_event_ids' => $totalAmount['ids'],
            ];
        }

        return null;
    }

    // ════════════════════════════ الإنهاء ════════════════════════════

    /**
     * يبني صفّ finding نهائياً: dedup_key، الشدّة، مساهمة الدرجة، المبلغ قيد
     * المراجعة (لقواعد المبلغ)، والشرح المنظَّم للعرض AR/EN.
     */
    private function finalizeFinding(array $rule, string $branch, string $subjectUser, string $performedBy, ?string $approvedBy, array $finding, array $current, Carbon $now, int $windowDays, bool $sessionScoped): array
    {
        $branchValue = $branch === '_' ? null : $branch;
        $key = $rule['rule_key'] . ':' . ($branchValue ?? 'null') . ':' . $subjectUser . ($approvedBy ? ':' . $approvedBy : '');

        // قواعد المبلغ (نسبة المرتجع): المبلغ قيد المراجعة من أحداث البسط.
        $amount = $finding['amount_under_review'];
        $amountIds = $finding['amount_event_ids'];
        if (($rule['amount'] ?? false) && ($rule['numerator_mode'] ?? null) === 'amount') {
            $sum = $this->amountSum($rule, $branch, $performedBy, $current, $sessionScoped);
            $amount = $sum['total'];
            $amountIds = $sum['ids'];
        }

        $contribution = (int) round($rule['weight'] * PosExceptionRuleCatalog::SEVERITY_FACTOR[$finding['severity']] / 100);

        return [
            'dedup_key' => $key,
            'branch_id' => $branchValue,
            'rule_key' => $rule['rule_key'],
            'category' => $rule['category'],
            'rule_version' => $rule['version'],
            'rule_snapshot' => [
                'weight' => $rule['weight'], 'min_sample' => $rule['min_sample'], 'window_days' => $rule['window_days'],
                'threshold' => $rule['threshold'], 'per' => $rule['per'], 'compare' => $rule['compare'],
                'denominator' => $rule['denominator'], 'version' => $rule['version'],
            ],
            'subject_user_id' => $subjectUser,
            'performed_by' => $performedBy,
            'approved_by' => $approvedBy,
            'window_start' => $now->copy()->subDays($windowDays),
            'window_end' => $now,
            'observed_count' => $finding['observed_count'],
            'denominator' => $finding['denominator'],
            'observed_rate_milli' => $finding['observed_rate'],
            'baseline_rate_milli' => $finding['baseline_rate'],
            'baseline_type' => $finding['baseline_type'],
            'sample_size' => $finding['sample_size'],
            'severity' => $finding['severity'],
            'risk_contribution' => $contribution,
            'amount_under_review' => $amount,
            'evidence_confidence' => $rule['confidence'],
            'amount_event_ids' => array_map(fn ($e) => $e['id'], $amountIds),
            'explanation' => [
                'rule_key' => $rule['rule_key'],
                'category' => $rule['category'],
                'observed_rate_milli' => $finding['observed_rate'],
                'baseline_rate_milli' => $finding['baseline_rate'],
                'baseline_type' => $finding['baseline_type'],
                'per' => $rule['per'],
                'denominator_kind' => $rule['denominator'],
                'numerator' => $finding['observed_count'],
                'denominator' => $finding['denominator'],
                'sample_size' => $finding['sample_size'],
                'sample_sufficient' => $finding['sample_sufficient'],
                'window_days' => $windowDays,
                'confidence' => $rule['confidence'],
                // مرجع الأدلة: استعلام خادمي محدَّد بدل تحميل الأحداث مسبقاً.
                'evidence_query' => [
                    'user_id' => $performedBy,
                    'types' => array_values(array_filter($rule['numerator_types'], fn ($t) => ! str_starts_with($t, '@'))),
                    'from' => $now->copy()->subDays($windowDays)->toIso8601String(),
                    'to' => $now->toIso8601String(),
                ],
                'amount_event_ids' => array_map(fn ($e) => $e['id'], $amountIds),
            ],
            'contribution_category' => $rule['category'],
        ];
    }

    // ════════════════════════════ مساعدات المقاييس ════════════════════════════

    private function isSessionScoped(array $rule): bool
    {
        return in_array($rule['denominator'], [
            PosExceptionRuleCatalog::DENOM_SESSIONS,
            PosExceptionRuleCatalog::DENOM_WORKED_SECONDS,
        ], true);
    }

    /** بسط القاعدة للموضوع، مع اشتقاق الأنواع الافتراضية (@aborted/@near_close). */
    private function numeratorFor(array $rule, string $branch, string $subject, array $data, bool $sessionScoped): int
    {
        $types = $rule['numerator_types'];
        if ($types === ['@aborted_checkouts']) {
            $counts = $data['counts'][$branch][$subject] ?? [];
            return max(0, ($counts[PosSessionEvent::TYPE_CHECKOUT_STARTED] ?? 0) - ($counts[PosSessionEvent::TYPE_CHECKOUT_COMPLETED] ?? 0));
        }
        if ($types === ['@near_close_sensitive']) {
            // متغيّر التوقيت: يُقارب بعدد العمليات الحساسة (تقريب محافظ يتجنّب
            // تحميل أحداث كل جلسة؛ التطبيق الكامل لنافذة الدقائق مؤجَّل لـPhase 3).
            return $this->sensitiveOps($data, $branch, $subject);
        }

        $source = $sessionScoped ? ($data['by_session_owner'][$branch][$subject] ?? []) : ($data['counts'][$branch][$subject] ?? []);
        $sum = 0;
        foreach ($types as $type) {
            $sum += $source[$type] ?? 0;
        }

        return $sum;
    }

    /**
     * قيمة البسط لحساب المعدّل: مجموع المبلغ لقواعد «وضع المبلغ» (من عمود المبلغ
     * المجمّع خادمياً، متاح لكل نافذة)، وإلّا العدّ. `$count` تمريرٌ اختياري لتفادي
     * إعادة الحساب حين يكون العدّ محسوباً مسبقاً.
     */
    private function numeratorValue(array $rule, string $branch, string $subject, array $data, bool $sessionScoped, ?int $count = null): int
    {
        if (($rule['numerator_mode'] ?? null) === 'amount') {
            $amounts = $data['amounts'][$branch][$subject] ?? [];
            $sum = 0;
            foreach ($rule['numerator_types'] as $type) {
                $sum += $amounts[$type] ?? 0;
            }

            return $sum;
        }

        return $count ?? $this->numeratorFor($rule, $branch, $subject, $data, $sessionScoped);
    }

    /** مقام القاعدة للموضوع. */
    private function denominatorFor(array $rule, string $branch, string $subject, array $data): int
    {
        $counts = $data['counts'][$branch][$subject] ?? [];
        $amounts = $data['amounts'][$branch][$subject] ?? [];
        $sessions = $data['sessions'][$branch][$subject] ?? [];

        return match ($rule['denominator']) {
            PosExceptionRuleCatalog::DENOM_ITEMS_ADDED => $counts[PosSessionEvent::TYPE_ITEM_ADDED] ?? 0,
            PosExceptionRuleCatalog::DENOM_CARTS => $counts[PosSessionEvent::TYPE_CART_CREATED] ?? 0,
            PosExceptionRuleCatalog::DENOM_CHECKOUTS_STARTED => $counts[PosSessionEvent::TYPE_CHECKOUT_STARTED] ?? 0,
            PosExceptionRuleCatalog::DENOM_CHECKOUTS_COMPLETED => $counts[PosSessionEvent::TYPE_CHECKOUT_COMPLETED] ?? 0,
            PosExceptionRuleCatalog::DENOM_SESSIONS => $sessions['count'] ?? 0,
            PosExceptionRuleCatalog::DENOM_WORKED_SECONDS => $sessions['worked_seconds'] ?? 0,
            PosExceptionRuleCatalog::DENOM_SALES_AMOUNT => $amounts[PosSessionEvent::TYPE_CHECKOUT_COMPLETED] ?? 0,
            PosExceptionRuleCatalog::DENOM_SENSITIVE_OPS => $this->sensitiveOps($data, $branch, $subject),
            default => 0,
        };
    }

    private function sensitiveOps(array $data, string $branch, string $subject): int
    {
        $counts = $data['counts'][$branch][$subject] ?? [];
        $sum = 0;
        foreach (PosExceptionRuleCatalog::sensitiveOpTypes() as $type) {
            $sum += $counts[$type] ?? 0;
        }

        return $sum;
    }

    /** @return array{total:int, ids:list<array{id:string,amount:int}>} */
    private function amountSum(array $rule, string $branch, string $subject, array $data, bool $sessionScoped): array
    {
        $bucket = $sessionScoped ? 'owner' : 'performer';
        $events = $data['amount_events'][$bucket][$branch][$subject] ?? [];
        $total = 0;
        $ids = [];
        foreach ($rule['numerator_types'] as $type) {
            foreach ($events[$type] ?? [] as $entry) {
                $total += $entry['amount'];
                $ids[] = $entry;
            }
        }

        return ['total' => $total, 'ids' => $ids];
    }

    /** معدّلات النظراء (نفس الفرع، مواضيع أخرى بعينة كافية) في النافذة الحالية. */
    private function peerRates(array $rule, string $branch, string $subject, array $data): array
    {
        $sessionScoped = $this->isSessionScoped($rule);
        $subjects = $sessionScoped ? array_keys($data['sessions'][$branch] ?? []) : array_keys($data['counts'][$branch] ?? []);
        $rates = [];
        foreach ($subjects as $peer) {
            if ($peer === $subject) {
                continue;
            }
            $denominator = $this->denominatorFor($rule, $branch, (string) $peer, $data);
            if ($denominator < $rule['min_sample'] || $denominator <= 0) {
                continue;
            }
            $numerator = $this->numeratorValue($rule, $branch, (string) $peer, $data, $sessionScoped);
            $rate = PosBaselineCalculator::rateMilli($numerator, $denominator, $rule['per']);
            if ($rate !== null) {
                $rates[] = $rate;
            }
        }

        return $rates;
    }

    /** @return list<array{0:string,1:string}> */
    private function performerSubjects(array $data): array
    {
        $out = [];
        foreach ($data['counts'] as $branch => $performers) {
            foreach ($performers as $performer => $_) {
                $out[] = [(string) $branch, (string) $performer];
            }
        }

        return $out;
    }

    /** @return list<array{0:string,1:string}> */
    private function sessionSubjects(array $data): array
    {
        $out = [];
        foreach ($data['sessions'] as $branch => $owners) {
            foreach ($owners as $owner => $_) {
                $out[] = [(string) $branch, (string) $owner];
            }
        }

        return $out;
    }

    private function baselineSeverity(int $observed, int $baseline): string
    {
        if ($baseline <= 0) {
            return PosException::SEVERITY_REVIEW;
        }
        $ratio = intdiv($observed * 100, $baseline);
        if ($ratio >= PosExceptionRuleCatalog::SEVERITY_RATIO['priority']) {
            return PosException::SEVERITY_PRIORITY;
        }
        if ($ratio >= PosExceptionRuleCatalog::SEVERITY_RATIO['review']) {
            return PosException::SEVERITY_REVIEW;
        }

        return PosException::SEVERITY_WATCH;
    }

    private function staticSeverity(int $observed, int $threshold): string
    {
        if ($threshold <= 0) {
            return PosException::SEVERITY_WATCH;
        }
        $over = intdiv(($observed - $threshold) * 100, $threshold);
        if ($over >= PosExceptionRuleCatalog::STATIC_SEVERITY_OVER['priority']) {
            return PosException::SEVERITY_PRIORITY;
        }
        if ($over >= PosExceptionRuleCatalog::STATIC_SEVERITY_OVER['review']) {
            return PosException::SEVERITY_REVIEW;
        }

        return PosException::SEVERITY_WATCH;
    }

    // ════════════════════════════ الحفظ والدرجات ════════════════════════════

    /** @param array<string,array> $findings @return list<PosException> */
    private function persist(array $findings, Carbon $now): array
    {
        $persisted = [];
        foreach ($findings as $finding) {
            $existing = PosException::query()->withoutGlobalScope(BranchScope::class)
                ->where('dedup_key', $finding['dedup_key'])->first();

            $attributes = [
                'branch_id' => $finding['branch_id'],
                'rule_key' => $finding['rule_key'],
                'category' => $finding['category'],
                'rule_version' => $finding['rule_version'],
                'rule_snapshot' => $finding['rule_snapshot'],
                'subject_user_id' => $finding['subject_user_id'],
                'performed_by' => $finding['performed_by'],
                'approved_by' => $finding['approved_by'],
                'window_start' => $finding['window_start'],
                'window_end' => $finding['window_end'],
                'observed_count' => $finding['observed_count'],
                'denominator' => $finding['denominator'],
                'observed_rate_milli' => $finding['observed_rate_milli'],
                'baseline_rate_milli' => $finding['baseline_rate_milli'],
                'baseline_type' => $finding['baseline_type'],
                'sample_size' => $finding['sample_size'],
                'severity' => $finding['severity'],
                'risk_contribution' => $finding['risk_contribution'],
                'amount_under_review' => $finding['amount_under_review'],
                'evidence_confidence' => $finding['evidence_confidence'],
                'amount_event_ids' => $finding['amount_event_ids'],
                'explanation' => $finding['explanation'],
            ];

            if ($existing) {
                // idempotent: يحدّث المقاييس ويحافظ على حالة المراجعة وسجلّها
                // ولقطة القاعدة الأصلية (لا يُعاد كتابتها بعد تغيير الإعداد).
                $attributes['rule_snapshot'] = $existing->rule_snapshot ?? $finding['rule_snapshot'];
                $attributes['rule_version'] = $existing->rule_version;
                $existing->forceFill($attributes)->save();
                $persisted[] = $existing;
            } else {
                $persisted[] = PosException::create($attributes + [
                    'dedup_key' => $finding['dedup_key'],
                    'detected_at' => $now,
                    'review_state' => PosException::STATE_NEW,
                ]);
            }
        }

        return $persisted;
    }

    /**
     * يعيد بناء لقطات درجة المراجعة من استثناءات هذا التشغيل (نظرة حالية)، مع
     * أسقف الفئة والدرجة الكلية وإزالة ازدواج المبلغ عبر معرّفات الأحداث.
     */
    private function rebuildSnapshots(array $exceptions, Carbon $now): int
    {
        $bySubject = [];
        foreach ($exceptions as $exception) {
            $branchKey = $exception->branch_id ?? '_';
            $bySubject[$branchKey][$exception->subject_user_id][] = $exception;
        }

        $seen = [];
        $built = 0;
        foreach ($bySubject as $branch => $subjects) {
            $branchValue = $branch === '_' ? null : $branch;
            foreach ($subjects as $subjectId => $items) {
                $snapshot = $this->buildSnapshot($branchValue, (string) $subjectId, $items, $now);
                $this->upsertSnapshot($snapshot);
                $seen[] = $subjectId;
                $built++;
            }
        }

        // يزيل لقطات المواضيع التي لم تعد تنتج استثناءات (تصحيح الوضع الحالي).
        $stale = PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)
            ->when($seen !== [], fn ($q) => $q->whereNotIn('subject_user_id', $seen))
            ->get();
        foreach ($stale as $snapshot) {
            $snapshot->delete();
        }

        return $built;
    }

    /** @param list<PosException> $items @return array<string,mixed> */
    private function buildSnapshot(?string $branch, string $subjectId, array $items, Carbon $now): array
    {
        $categoryPoints = [];
        $components = [];
        $amountIds = [];
        $amountTotal = 0;
        $sampleSufficient = false;
        $sampleSize = 0;

        foreach ($items as $exception) {
            $category = $exception->category;
            $categoryPoints[$category] = ($categoryPoints[$category] ?? 0) + $exception->risk_contribution;
            $components[$category]['rules'][] = [
                'rule_key' => $exception->rule_key,
                'severity' => $exception->severity,
                'contribution' => $exception->risk_contribution,
                'observed_rate_milli' => $exception->observed_rate_milli,
                'baseline_rate_milli' => $exception->baseline_rate_milli,
                'baseline_type' => $exception->baseline_type,
                'confidence' => $exception->evidence_confidence,
                'exception_id' => $exception->id,
            ];
            $sampleSize = max($sampleSize, $exception->sample_size);
            if (($exception->explanation['sample_sufficient'] ?? false) === true) {
                $sampleSufficient = true;
            }
            foreach ((array) $exception->amount_event_ids as $id) {
                if (! isset($amountIds[$id])) {
                    $amountIds[$id] = true;
                }
            }
        }

        // إزالة ازدواج «المبلغ قيد المراجعة»: مجموع مبالغ الأحداث المتمايزة فقط.
        if ($amountIds !== []) {
            $amountTotal = (int) PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
                ->whereIn('id', array_keys($amountIds))
                ->sum(DB::raw('ABS(amount)'));
        }

        // أسقف الفئة ثم السقف الكلي تمنعان تفجير الدرجة من فئة واحدة.
        $total = 0;
        foreach ($categoryPoints as $category => $points) {
            $capped = min($points, PosExceptionRuleCatalog::CATEGORY_SCORE_CAP);
            $components[$category]['points'] = $capped;
            $components[$category]['raw_points'] = $points;
            $total += $capped;
        }
        $total = min($total, PosExceptionRuleCatalog::TOTAL_SCORE_CAP);

        return [
            'branch_id' => $branch,
            'scope' => 'user',
            'subject_user_id' => $subjectId,
            'window_start' => $now->copy()->subDays(60),
            'window_end' => $now,
            'total_score' => $total,
            'band' => $this->band($total),
            'exception_count' => count($items),
            'amount_under_review' => $amountTotal,
            'sample_size' => $sampleSize,
            'sample_sufficient' => $sampleSufficient,
            'components' => $components,
            'calculated_at' => $now,
        ];
    }

    private function upsertSnapshot(array $snapshot): void
    {
        $existing = PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)
            ->where('scope', 'user')
            ->where('subject_user_id', $snapshot['subject_user_id'])
            ->when($snapshot['branch_id'] === null, fn ($q) => $q->whereNull('branch_id'), fn ($q) => $q->where('branch_id', $snapshot['branch_id']))
            ->first();
        if ($existing) {
            $existing->forceFill($snapshot)->save();
        } else {
            PosRiskSnapshot::create($snapshot);
        }
    }

    private function band(int $score): string
    {
        if ($score >= PosExceptionRuleCatalog::BAND_THRESHOLDS['priority']) {
            return PosRiskSnapshot::BAND_PRIORITY;
        }
        if ($score >= PosExceptionRuleCatalog::BAND_THRESHOLDS['review']) {
            return PosRiskSnapshot::BAND_REVIEW;
        }
        if ($score >= PosExceptionRuleCatalog::BAND_THRESHOLDS['watch']) {
            return PosRiskSnapshot::BAND_WATCH;
        }

        return PosRiskSnapshot::BAND_NORMAL;
    }
}
