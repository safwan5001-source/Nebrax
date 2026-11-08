<?php

namespace App\Services\Reporting;

use App\Models\FuelDelivery;
use App\Models\FuelReconciliation;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\FuelTank;
use App\Models\FuelTankReadingRequest;
use App\Services\FuelTankLevelMonitor;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;
use Carbon\CarbonImmutable;

/**
 * العائلة الإدارية والتحليلية (G): **تركيب لمصادر قائمة** لا حساب جديد. المقارنات والأداء والأسبوعي والشهري مرادفات لبانيَي المبيعات والتحصيل بفترة افتراضية مناسبة
 * (مرشحات المستخدم تتقدّم دائماً). الجديد: لوحة اليوم، اتجاه المبيعات والتحصيل، ملخص الاستثناءات، والتقرير الموحَّد لإقفال اليوم.
 * الاستثناءات التي تكشف مبالغ مشتقة من المبيعات تُحذف لمن لا يملك `fuel.sale.view`.
 */
final class FuelManagementReportBuilder implements FuelReportBuilder
{
    /** حد تأخر الوردية المفتوحة (ساعات) في ملخص الاستثناءات — معلمة عرض (كتقرير الورديات المتأخرة)، لا سياسة مخزَّنة. */
    private const OVERDUE_HOURS = 12;
    private const STALE_DRAFT_HOURS = 24;

    public function __construct(
        private FuelSalesReportBuilder $sales,
        private FuelShiftReportBuilder $shifts,
        private FuelCollectionReportBuilder $collection,
        private FuelReportShiftFacts $facts,
        private FuelTankLevelMonitor $monitor,
    ) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        $today = $context->today();
        // الفترة الفعّالة (بعد الافتراضي الخاص بالتقرير) تُعاد في الحمولة كي لا تُعرض فترة المحرك الافتراضية العامة.
        $ctx = match ($definition->key) {
            'management.dashboard', 'management.day_close' => $context->withDefaults(['from' => $today, 'to' => $today]),
            'management.monthly' => $context->withDefaults(['from' => substr($today, 0, 7).'-01', 'to' => $today, 'group' => 'day']),
            'management.weekly' => $context->withDefaults(['group' => 'day']),
            default => $context,
        };

        $built = match ($definition->key) {
            'management.dashboard' => $this->dashboard($definition, $ctx),
            'management.weekly', 'management.monthly' => $this->sales->build($definition->withKey('sales.period'), $ctx),
            'management.station_comparison' => $this->sales->build($definition->withKey('sales.by_station'), $ctx),
            'management.product_comparison' => $this->sales->build($definition->withKey('sales.by_product'), $ctx),
            'management.employee_performance' => $this->sales->build($definition->withKey('sales.by_employee'), $ctx),
            'management.trends' => $this->trends($ctx),
            'management.exceptions' => $this->exceptions($ctx),
            'management.day_close' => $this->dayClose($ctx),
        };

        return ($built['period'] ?? null) === false ? $built : ['period' => ['from' => $ctx->period()[0], 'to' => $ctx->period()[1]]] + $built;
    }

    // ───────── لوحة المؤشرات اليومية ─────────

    /** @return array<string,mixed> */
    private function dashboard(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        $built = $this->sales->build($definition->withKey('sales.by_product'), $context);
        $ex = $this->exceptionCounts($context);
        $open = $context->scoped(FuelShift::query())->where('status', FuelShift::STATUS_OPEN)->count();
        $tanks = $this->monitor->snapshot($context->scoped(FuelTank::query()), $context->user);
        $flagged = count(array_filter($tanks, fn ($t) => $t['level']['needs_review']));

        $extra = [
            T::item('open_shifts', 'ورديات مفتوحة الآن', 'Open shifts now', 'int', $open),
            T::item('tanks_review', 'خزانات تحتاج مراجعة', 'Tanks needing review', 'int', $flagged),
            T::item('pending_items', 'بنود بانتظار الإجراء', 'Items awaiting action', 'int', array_sum(array_column($ex, 'count'))),
        ];
        $built['summary'] = [...($built['summary'] ?? []), ...$extra];
        $built['notes'] = [...($built['notes'] ?? []), ['ar' => 'لوحة اليوم بتوقيت المحطة؛ المبالغ من عدادات الورديات (تقدير تشغيلي).', 'en' => 'Today dashboard in station time; amounts come from shift meters (operational estimate).']];

        return $built;
    }

    // ───────── اتجاه المبيعات والتحصيل ─────────

    /** @return array<string,mixed> */
    private function trends(FuelReportContext $context): array
    {
        $loaded = $this->facts->load($context, null, false);
        $byId = collect($loaded['shifts'])->keyBy('id');
        $decl = $byId->isEmpty() ? collect() : FuelShiftCollectionDeclaration::query()->whereIn('fuel_shift_id', $byId->keys()->all())->get()->keyBy('fuel_shift_id');

        $days = [];
        $incomplete = false;
        foreach ($byId as $id => $s) {
            if ($s['date'] === null) {
                continue;
            }
            $d = &$days[$s['date']];
            $d ??= ['date' => $s['date'], 'shifts' => 0, 'liters' => 0, 'sales' => 0, 'collected' => 0, 'undeclared' => 0];
            $d['shifts']++;
            $d['liters'] += $s['status'] === 'open' ? 0 : (int) $s['model']->operational_meter_milliliters;
            $x = $decl->get($id);
            if ($x === null || $x->sales_minor === null) {
                $d['sales'] = null;
                $d['undeclared']++;
                if ($x !== null) {
                    $incomplete = true;
                }
            } else {
                $d['sales'] = $d['sales'] === null ? null : $d['sales'] + (int) $x->sales_minor;
            }
            $d['collected'] += $x === null ? 0 : (int) $x->collected_total_minor;
            unset($d);
        }
        ksort($days);
        $rows = array_values(array_map(fn ($d) => $d + ['difference' => $d['sales'] === null ? null : $d['collected'] - $d['sales']], $days));

        return [
            'summary' => [
                T::item('liters', 'اللترات', 'Liters', 'liters', array_sum(array_column($rows, 'liters'))),
                T::item('sales', 'مبيعات العدادات (المجمَّدة)', 'Meter sales (frozen)', 'money', in_array(null, array_column($rows, 'sales'), true) ? null : array_sum(array_column($rows, 'sales')), T::SALES),
                T::item('collected', 'المُقَرّ بتحصيله', 'Declared collection', 'money', array_sum(array_column($rows, 'collected'))),
            ],
            'tables' => [T::table('trends', 'اتجاهات المبيعات والتحصيل', 'Sales and collection trends', [
                T::col('date', 'date', 'اليوم', 'Day'), T::col('shifts', 'int', 'الورديات', 'Shifts', ['total' => 'sum']),
                T::col('liters', 'liters', 'لترات الورديات المغلقة', 'Closed-shift liters', ['total' => 'sum']),
                T::col('sales', 'money', 'مبيعات العدادات', 'Meter sales', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('collected', 'money', 'المُقَرّ بتحصيله', 'Declared collection', ['total' => 'sum']),
                T::col('difference', 'money', 'تحصيل − مبيعات', 'Collected − sales', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('undeclared', 'int', 'ورديات بلا لقطة', 'Shifts without snapshot'),
            ], $rows)],
            'gaps' => array_values(array_unique([...$loaded['gaps'], ...(array_sum(array_column($rows, 'undeclared')) > 0 ? ['collection_not_declared'] : []), ...($incomplete ? ['declaration_sales_incomplete'] : [])])),
            'truncated' => $loaded['truncated'],
            'notes' => [['ar' => 'من لقطات الإقرار المجمَّدة والورديات؛ وردية بلا لقطة تجعل مبيعات يومها غير متاحة (لا تقدير).', 'en' => 'From frozen declaration snapshots and shifts; a shift without a snapshot makes its day sales unavailable (no estimate).']],
        ];
    }

    // ───────── ملخص الاستثناءات ─────────

    /** @return list<array{type:string,count:int,oldest:?string}> */
    private function exceptionCounts(FuelReportContext $context): array
    {
        $now = CarbonImmutable::now();
        $out = [];
        $push = function (string $type, $query, string $column) use (&$out) {
            $count = (clone $query)->count();
            $oldest = $count === 0 ? null : (clone $query)->min($column);
            $out[] = ['type' => $type, 'count' => (int) $count, 'oldest' => $oldest === null ? null : CarbonImmutable::parse($oldest)->toIso8601String()];
        };

        $push('overdue_shift', $context->scoped(FuelShift::query())->where('status', FuelShift::STATUS_OPEN)->where('opened_at', '<', $now->subHours(self::OVERDUE_HOURS)), 'opened_at');
        $push('stale_receipt_draft', $context->scoped(FuelDelivery::query())->where('status', FuelDelivery::STATUS_DRAFT)->where('received_at', '<', $now->subHours(self::STALE_DRAFT_HOURS)), 'received_at');
        $push('reconciliation_draft', $context->scoped(FuelReconciliation::query())->where('status', FuelReconciliation::STATUS_DRAFT), 'created_at');
        $push('reading_request_pending', $context->scoped(FuelTankReadingRequest::query())->where('status', FuelTankReadingRequest::STATUS_PENDING), 'created_at');
        if ($context->user->hasPermission('fuel.sale.view')) {
            $push('cash_variance_pending', $context->scoped(FuelShiftCashVariance::query())->where('status', FuelShiftCashVariance::STATUS_PENDING_REVIEW)->whereNull('reviewed_at'), 'counted_at');
            $push('collection_review_pending', $context->scoped(FuelShiftCollectionDeclaration::query())->where('review_required', true)->whereNull('reviewed_at'), 'declared_at');
        }

        return $out;
    }

    /** @return array<string,mixed> */
    private function exceptions(FuelReportContext $context): array
    {
        $rows = $this->exceptionCounts($context);
        $labels = [
            'overdue_shift' => ['ar' => 'ورديات مفتوحة متأخرة (>'.self::OVERDUE_HOURS.' ساعة)', 'en' => 'Overdue open shifts (>'.self::OVERDUE_HOURS.' h)'],
            'stale_receipt_draft' => ['ar' => 'مسودات استلام قديمة (>'.self::STALE_DRAFT_HOURS.' ساعة)', 'en' => 'Stale receipt drafts (>'.self::STALE_DRAFT_HOURS.' h)'],
            'reconciliation_draft' => ['ar' => 'جرد غير معتمد', 'en' => 'Unapproved stocktakes'],
            'reading_request_pending' => ['ar' => 'طلبات قراءة متأخرة معلّقة', 'en' => 'Pending late-reading requests'],
            'cash_variance_pending' => ['ar' => 'فروق نقد بانتظار المراجعة', 'en' => 'Cash variances awaiting review'],
            'collection_review_pending' => ['ar' => 'فروق تحصيل بانتظار المراجعة', 'en' => 'Collection differences awaiting review'],
        ];

        return [
            'summary' => [T::item('total', 'إجمالي البنود المعلّقة', 'Total pending items', 'int', array_sum(array_column($rows, 'count')))],
            'tables' => [T::table('exceptions', 'ملخص الاستثناءات', 'Exceptions summary', [
                T::col('type', 'status', 'النوع', 'Type', ['values' => $labels]), T::col('count', 'int', 'العدد', 'Count', ['total' => 'sum']), T::col('oldest', 'datetime', 'الأقدم', 'Oldest'),
            ], $rows)],
            'period' => false,
            'notes' => [['ar' => 'الحالة الراهنة لا الفترة؛ عتبات التأخر معلمات عرض ثابتة وليست سياسة مؤسسة.', 'en' => 'The current state, not a period; staleness thresholds are fixed display parameters, not a tenant policy.']],
        ];
    }

    // ───────── التقرير الموحَّد لإقفال اليوم ─────────

    /** @return array<string,mixed> */
    private function dayClose(FuelReportContext $context): array
    {
        $loaded = $this->facts->load($context, null, false);
        $byStation = [];
        foreach ($loaded['shifts'] as $s) {
            $g = &$byStation[$s['station_id']];
            $g ??= ['station' => $s['station_name'], 'shifts' => 0, 'open' => 0, 'liters' => 0, 'sales' => 0, 'collected' => 0, 'handover' => 0, 'received' => 0, 'ids' => []];
            $g['shifts']++;
            $g['open'] += $s['status'] === 'open' ? 1 : 0;
            $g['liters'] += $s['status'] === 'open' ? 0 : (int) $s['model']->operational_meter_milliliters;
            $g['ids'][] = $s['id'];
            unset($g);
        }
        $allIds = array_merge(...array_column($byStation, 'ids') ?: [[]]);
        $decl = $allIds === [] ? collect() : FuelShiftCollectionDeclaration::query()->whereIn('fuel_shift_id', $allIds)->get()->keyBy('fuel_shift_id');
        $handovers = $allIds === [] ? collect() : FuelShiftCashMovement::query()->whereIn('fuel_shift_id', $allIds)->where('purpose', 'treasury_handover')->get()->groupBy('fuel_shift_id');
        foreach ($byStation as &$g) {
            foreach ($g['ids'] as $id) {
                $d = $decl->get($id);
                $g['sales'] = ($g['sales'] === null || $d === null || $d->sales_minor === null) ? null : $g['sales'] + (int) $d->sales_minor;
                $g['collected'] += $d === null ? 0 : (int) $d->collected_total_minor;
                $g['handover'] += (int) ($handovers->get($id)?->sum('amount_minor') ?? 0);
            }
        }
        unset($g);

        $query = $context->scoped(FuelDelivery::query())->where('status', FuelDelivery::STATUS_APPROVED);
        $context->constrainPeriod($query, 'received_at');
        foreach ($query->get(['fuel_station_id', 'received_milliliters']) as $d) {
            $stationId = (string) $d->fuel_station_id;
            // محطة استلمت وقوداً في اليوم بلا ورديات تظهر بصفّها أيضاً (لا يُغفَل استلام لغياب وردية).
            $byStation[$stationId] ??= ['station' => $context->stationName($stationId), 'shifts' => 0, 'open' => 0, 'liters' => 0, 'sales' => 0, 'collected' => 0, 'handover' => 0, 'received' => 0, 'ids' => []];
            $byStation[$stationId]['received'] += (int) $d->received_milliliters;
        }
        $rows = array_values(array_map(fn ($g) => array_diff_key($g, ['ids' => 1]), $byStation));
        [$day] = $context->period();

        return [
            'summary' => [
                T::item('day', 'اليوم', 'Day', 'text', $day),
                T::item('shifts', 'الورديات', 'Shifts', 'int', array_sum(array_column($rows, 'shifts'))),
                T::item('open', 'ما زالت مفتوحة', 'Still open', 'int', array_sum(array_column($rows, 'open'))),
            ],
            'tables' => [T::table('day_close', 'إقفال اليوم الموحَّد', 'Unified day close', [
                T::col('station', 'text', 'المحطة', 'Station'), T::col('shifts', 'int', 'الورديات', 'Shifts', ['total' => 'sum']), T::col('open', 'int', 'مفتوحة', 'Open', ['total' => 'sum']),
                T::col('liters', 'liters', 'لترات مغلقة', 'Closed liters', ['total' => 'sum']),
                T::col('sales', 'money', 'مبيعات العدادات', 'Meter sales', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('collected', 'money', 'المُقَرّ بتحصيله', 'Declared collection', ['total' => 'sum']),
                T::col('handover', 'money', 'المسلَّم للخزنة', 'Handed to treasury', ['total' => 'sum']),
                T::col('received', 'liters', 'وقود مستلم معتمد', 'Approved fuel received', ['total' => 'sum']),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'],
            'notes' => [['ar' => 'اليوم بتوقيت المحطة (الورديات حسب فتحها). مبيعات العدادات من اللقطات المجمَّدة وتغيب لوردية بلا إقرار.', 'en' => 'The day in station time (shifts by opening). Meter sales come from frozen snapshots and are unavailable for a shift without a declaration.']],
        ];
    }
}
