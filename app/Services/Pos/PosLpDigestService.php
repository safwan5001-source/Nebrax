<?php

namespace App\Services\Pos;

use App\Models\PosException;
use App\Models\PosInvestigationCase;
use App\Models\PosLpDigest;
use App\Models\PosSessionEvent;
use App\Models\Tenant;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * الملخص الرقابي اليومي — منتج بيانات مشتقّ حتمي فوق Phase 1/2/3 القائمة. لا يكتب شيئاً
 * مالياً ولا يستدعي `LedgerService`. توليد idempotent: نفس `(tenant, digest_date)` يُحدَّث
 * لا يتكرر، فتبقى القراءة متّسقة عند إعادة التوليد اليدوي.
 *
 * **مؤشرات المراجعة والاستثناءات تساعد في ترتيب أولوية التحقيق، ولا تُثبت وحدها وجود مخالفة.**
 */
final class PosLpDigestService
{
    /** قواعد كشف فروق الإغلاق المعتمَدة لتعريف "الفرق الجوهري" — إعادة استخدام Phase 2، لا عتبة جديدة موازية. */
    private const MATERIAL_VARIANCE_RULE_KEYS = ['closing_variance_magnitude', 'closing_variance_frequency'];

    /** أدنى نشاط لعدّه كافياً؛ دونه يُضاف تحذير كفاية بيانات بدل مؤشر مضلِّل بصفر. */
    private const MIN_MEANINGFUL_ACTIVITY = 1;

    public function generate(Tenant $tenant, ?Carbon $forDate = null, ?string $generatedBy = null): PosLpDigest
    {
        $timezone = $tenant->timezone ?: 'Asia/Riyadh';
        // اليوم التشغيلي المُلخَّص = "الفترة السابقة" بتوقيت المؤسسة — أمس افتراضياً.
        $localDay = ($forDate ? $forDate->copy()->setTimezone($timezone) : Carbon::now($timezone)->subDay())->startOfDay();
        $digestDate = $localDay->toDateString();

        $periodStart = $localDay->copy()->setTimezone('UTC');
        $periodEnd = $localDay->copy()->addDay()->setTimezone('UTC');

        $exceptions = PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('detected_at', '>=', $periodStart)->where('detected_at', '<', $periodEnd)->get();

        $newExceptionsCount = $exceptions->count();
        $priorityExceptionsCount = $exceptions->where('severity', PosException::SEVERITY_PRIORITY)->count();
        $amountUnderReview = $this->dedupedAmount($exceptions);

        $cases = PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class)
            ->where('opened_at', '>=', $periodStart)->where('opened_at', '<', $periodEnd)->get();
        $newCasesCount = $cases->count();

        $unresolvedHighPriorityCases = PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('status', [
                PosInvestigationCase::STATUS_OPEN, PosInvestigationCase::STATUS_INVESTIGATING,
                PosInvestigationCase::STATUS_AWAITING_INFORMATION,
            ])
            ->whereIn('priority', [PosInvestigationCase::PRIORITY_HIGH, PosInvestigationCase::PRIORITY_CRITICAL])
            ->get();
        $unresolvedHighPriority = $unresolvedHighPriorityCases->count();

        $confirmedLossCases = PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class)
            ->where('outcome', PosInvestigationCase::STATUS_CONFIRMED_LOSS)
            ->where('resolved_at', '>=', $periodStart)->where('resolved_at', '<', $periodEnd)->get();
        $controlFailureCases = PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class)
            ->where('outcome', PosInvestigationCase::STATUS_CONTROL_FAILURE)
            ->where('resolved_at', '>=', $periodStart)->where('resolved_at', '<', $periodEnd)->get();
        $controlFailureCount = $controlFailureCases->count();

        $materialVarianceSessions = $exceptions
            ->whereIn('rule_key', self::MATERIAL_VARIANCE_RULE_KEYS)
            ->pluck('pos_session_id')->filter()->unique()->count();

        $concentrationPairs = $exceptions
            ->where('rule_key', 'performer_approver_pair_concentration')
            ->map(fn (PosException $e) => ['performed_by' => $e->performed_by, 'approved_by' => $e->approved_by, 'severity' => $e->severity])
            ->unique(fn ($row) => $row['performed_by'] . ':' . $row['approved_by'])
            ->values();

        $ruleBreakdown = $exceptions->groupBy('rule_key')->map->count();

        // كل مقياس مفصَّل بالفرع هنا أيضاً — لا فقط الثلاثة الأصلية — لأن `PosLpDigestController`
        // يعيد اشتقاق كل الأرقام المعروضة لمستخدم مقيَّد بفروع من هذا التفصيل حصراً (بلا مصدر
        // حقيقة موازٍ)، فحجب فرع لا يراه المستخدم يجب أن يُخفي مساهمته من كل مقياس لا بعضها.
        $branchBreakdown = $this->branchBreakdown(
            $exceptions, $cases, $unresolvedHighPriorityCases, $confirmedLossCases, $controlFailureCases,
        );

        $caveats = [];
        if ($newExceptionsCount < self::MIN_MEANINGFUL_ACTIVITY && $newCasesCount < self::MIN_MEANINGFUL_ACTIVITY) {
            $caveats[] = 'no_activity';
        }
        if ($exceptions->contains(fn (PosException $e) => $e->sample_size > 0 && ! ($e->explanation['sample_sufficient'] ?? true))) {
            $caveats[] = 'insufficient_sample_some_exceptions';
        }

        $payload = [
            'exception_ids' => $exceptions->pluck('id')->values(),
            'case_ids' => $cases->pluck('id')->values(),
            'confirmed_loss_case_ids' => $confirmedLossCases->pluck('id')->values(),
            'rule_breakdown' => $ruleBreakdown,
            'performer_approver_concentration' => $concentrationPairs,
        ];

        return DB::transaction(function () use (
            $tenant, $digestDate, $timezone, $periodStart, $periodEnd, $generatedBy,
            $newExceptionsCount, $priorityExceptionsCount, $amountUnderReview, $newCasesCount,
            $unresolvedHighPriority, $confirmedLossCases, $controlFailureCount, $materialVarianceSessions,
            $caveats, $branchBreakdown, $payload,
        ) {
            return PosLpDigest::query()->updateOrCreate(
                ['tenant_id' => $tenant->id, 'digest_date' => $digestDate],
                [
                    'timezone' => $timezone,
                    'period_start' => $periodStart,
                    'period_end' => $periodEnd,
                    'generated_at' => Carbon::now(),
                    'generated_by' => $generatedBy,
                    'new_exceptions_count' => $newExceptionsCount,
                    'priority_exceptions_count' => $priorityExceptionsCount,
                    'amount_under_review_minor' => $amountUnderReview,
                    'new_cases_count' => $newCasesCount,
                    'unresolved_high_priority_cases_count' => $unresolvedHighPriority,
                    'confirmed_loss_count' => $confirmedLossCases->count(),
                    'confirmed_loss_minor' => (int) $confirmedLossCases->sum('confirmed_loss_minor'),
                    'control_failure_count' => $controlFailureCount,
                    'material_variance_sessions_count' => $materialVarianceSessions,
                    'data_sufficiency_caveats' => $caveats,
                    'branch_breakdown' => $branchBreakdown,
                    'payload' => $payload,
                ],
            );
        });
    }

    /** يولّد الملخص لكل مستأجر — يُستدعى من أمر الكونسول المجدول، بلا لمس أي بيانات مالية. */
    public function generateForAllTenants(TenantContext $context, ?Carbon $forDate = null): array
    {
        $summary = [];
        foreach (Tenant::orderBy('name')->get() as $tenant) {
            $context->set($tenant->id);
            $digest = $this->generate($tenant, $forDate);
            $summary[] = ['tenant' => $tenant->name, 'digest_date' => $digest->digest_date->toDateString()];
        }
        $context->forget();

        return $summary;
    }

    /** مبلغ قيد المراجعة بلا ازدواج — اتحاد معرّفات الأحداث الحاملة للمبلغ عبر الاستثناءات المرصودة. */
    private function dedupedAmount($exceptions): int
    {
        $ids = [];
        foreach ($exceptions as $exception) {
            foreach ((array) ($exception->amount_event_ids ?? []) as $id) {
                $ids[$id] = true;
            }
        }
        if ($ids === []) {
            return 0;
        }

        return (int) PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('id', array_keys($ids))->sum(DB::raw('ABS(amount)'));
    }

    private function branchBreakdown($exceptions, $cases, $unresolvedHighPriorityCases, $confirmedLossCases, $controlFailureCases): array
    {
        $branches = $exceptions->pluck('branch_id')
            ->merge($cases->pluck('branch_id'))
            ->merge($unresolvedHighPriorityCases->pluck('branch_id'))
            ->merge($confirmedLossCases->pluck('branch_id'))
            ->merge($controlFailureCases->pluck('branch_id'))
            ->unique();
        $breakdown = [];
        foreach ($branches as $branchId) {
            $branchExceptions = $exceptions->where('branch_id', $branchId);
            $branchConfirmedLoss = $confirmedLossCases->where('branch_id', $branchId);
            $key = $branchId ?? 'unassigned';
            $breakdown[$key] = [
                'branch_id' => $branchId,
                'new_exceptions_count' => $branchExceptions->count(),
                'priority_exceptions_count' => $branchExceptions->where('severity', PosException::SEVERITY_PRIORITY)->count(),
                'new_cases_count' => $cases->where('branch_id', $branchId)->count(),
                'amount_under_review_minor' => $this->dedupedAmount($branchExceptions),
                'unresolved_high_priority_cases_count' => $unresolvedHighPriorityCases->where('branch_id', $branchId)->count(),
                'confirmed_loss_count' => $branchConfirmedLoss->count(),
                'confirmed_loss_minor' => (int) $branchConfirmedLoss->sum('confirmed_loss_minor'),
                'control_failure_count' => $controlFailureCases->where('branch_id', $branchId)->count(),
                'material_variance_sessions_count' => $branchExceptions
                    ->whereIn('rule_key', self::MATERIAL_VARIANCE_RULE_KEYS)
                    ->pluck('pos_session_id')->filter()->unique()->count(),
            ];
        }

        return array_values($breakdown);
    }
}
