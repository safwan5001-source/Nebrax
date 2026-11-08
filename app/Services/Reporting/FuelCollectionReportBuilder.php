<?php

namespace App\Services\Reporting;

use App\Models\FuelSale;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\User;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;

/**
 * عائلة التحصيل (C): ما أُقِرّ به/حُصِّل حسب طريقة الدفع (إقرار تحصيل الوردية المجمَّد عند الإغلاق) مقابل مبيعات العدادات، والمبيعات الآجلة من
 * `FuelSale` النهائي. **التحصيل ≠ المبيعات** و**الآجل ≠ نقد محصَّل**: لا يُضاف رصيد آجل إلى أي إجمالي تحصيل أبداً.
 *
 * الحساسية (D8 في `FuelShiftCollectionService`): المبالغ المُقَرّ بها يراها من يرى الوردية؛ أما المبيعات المشتقة والفروق فتتطلب `fuel.sale.view`.
 * وردية بلا إقرار لا يُختلق لها تحصيل (تظهر «غير مُقَرّ» في المطابقة).
 */
final class FuelCollectionReportBuilder implements FuelReportBuilder
{
    public function __construct(private FuelReportShiftFacts $facts, private FuelShiftReportBuilder $shifts) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        if ($definition->key === 'collection.handover') {
            return $this->shifts->build($definition->withKey('shifts.handover'), $context);
        }
        if ($definition->key === 'collection.deferred') {
            return $this->deferred($context);
        }

        $loaded = $this->facts->load($context, null, false);
        $byId = collect($loaded['shifts'])->keyBy('id');
        $declarations = $byId->isEmpty() ? collect() : FuelShiftCollectionDeclaration::query()->whereIn('fuel_shift_id', $byId->keys()->all())->get()->keyBy('fuel_shift_id');
        $built = match ($definition->key) {
            'collection.cash' => $this->channel($byId, $declarations, 'cash', 'التحصيل النقدي', 'Cash collection'),
            'collection.network' => $this->channel($byId, $declarations, 'bank', 'تحصيل الشبكة', 'Network collection'),
            'collection.by_method' => $this->byMethod($declarations),
            'collection.by_employee' => $this->byEmployee($byId, $declarations),
            'collection.variances' => $this->variances($byId, $declarations),
            'collection.reconciliation' => $this->reconciliation($byId, $declarations),
        };

        $notes = [
            ['ar' => 'التحصيل هنا هو الإقرار المسجَّل في الورديات؛ لا يشمل المبيعات الآجلة ولا أي تسوية غير مسجّلة.', 'en' => 'Collection here is the declaration recorded on shifts; it excludes deferred sales and unrecorded settlements.'],
        ];
        if ($loaded['truncated']) {
            $notes[] = ['ar' => 'تجاوز عدد الورديات الحد الأقصى ('.FuelReportShiftFacts::SHIFT_CAP.')؛ ضيّق الفترة.', 'en' => 'Shift count exceeds the maximum ('.FuelReportShiftFacts::SHIFT_CAP.'); narrow the period.'];
        }
        $undeclared = $byId->filter(fn ($s) => $s['status'] !== 'open' && ! $declarations->has($s['id']))->count();
        if ($undeclared > 0) {
            $notes[] = ['ar' => "{$undeclared} وردية مغلقة بلا إقرار تحصيل (لا تُحتسب في الإجماليات).", 'en' => "{$undeclared} closed shift(s) have no collection declaration (excluded from totals)."];
        }

        return $built + ['notes' => $notes, 'truncated' => $loaded['truncated'], 'gaps' => $undeclared > 0 ? ['collection_not_declared'] : []];
    }

    /**
     * @param  \Illuminate\Support\Collection<string,array<string,mixed>>  $byId
     * @param  \Illuminate\Support\Collection<string,FuelShiftCollectionDeclaration>  $declarations
     * @return array<string,mixed>
     */
    private function channel($byId, $declarations, string $type, string $ar, string $en): array
    {
        $rows = [];
        foreach ($byId as $id => $s) {
            $d = $declarations->get($id);
            if ($d === null) {
                continue;
            }
            $amount = collect($d->lines)->where('settlement_type', $type)->sum(fn ($l) => (int) ($l['amount_minor'] ?? 0));
            $rows[] = ['shift' => $s['number'], 'station' => $s['station_name'], 'date' => $s['date'], 'amount' => (int) $amount, 'state' => $d->status];
        }
        $total = array_sum(array_column($rows, 'amount'));

        return [
            'summary' => [T::item('amount', $ar, $en, 'money', $total), T::item('shifts', 'ورديات بإقرار', 'Shifts with declaration', 'int', count($rows))],
            'tables' => [T::table($type, $ar, $en, [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('date', 'date', 'اليوم', 'Day'),
                T::col('amount', 'money', 'المبلغ', 'Amount', ['total' => 'sum']),
                T::col('state', 'status', 'حالة الإقرار', 'Declaration state', ['values' => ['declared' => ['ar' => 'مُقَرّ (مفتوحة)', 'en' => 'Declared (open)'], 'frozen' => ['ar' => 'مجمَّد', 'en' => 'Frozen']]]),
            ], $rows)],
        ];
    }

    /** @param \Illuminate\Support\Collection<string,FuelShiftCollectionDeclaration> $declarations @return array<string,mixed> */
    private function byMethod($declarations): array
    {
        $methods = [];
        foreach ($declarations as $d) {
            foreach ($d->lines as $line) {
                $key = (string) ($line['payment_method_id'] ?? $line['name'] ?? '?');
                $m = &$methods[$key];
                $m ??= ['method' => (string) ($line['name'] ?? '—'), 'type' => (string) ($line['settlement_type'] ?? ''), 'shifts' => 0, 'amount' => 0];
                $m['shifts']++;
                $m['amount'] += (int) ($line['amount_minor'] ?? 0);
                unset($m);
            }
        }
        usort($methods, fn ($a, $b) => strcmp($a['method'], $b['method']));
        $total = array_sum(array_column($methods, 'amount'));
        $rows = array_map(fn ($m) => $m + ['share_bp' => $total > 0 ? intdiv($m['amount'] * 20000 + $total, 2 * $total) : null], $methods);

        return [
            'summary' => [T::item('amount', 'إجمالي التحصيل المُقَرّ به', 'Total declared collection', 'money', $total)],
            'tables' => [T::table('methods', 'التحصيل حسب طريقة الدفع', 'Collection by payment method', [
                T::col('method', 'text', 'طريقة الدفع', 'Payment method'),
                T::col('type', 'status', 'النوع', 'Type', ['values' => ['cash' => ['ar' => 'نقد', 'en' => 'Cash'], 'bank' => ['ar' => 'شبكة/بنك', 'en' => 'Network/bank'], 'cheque' => ['ar' => 'شيك', 'en' => 'Cheque']]]),
                T::col('shifts', 'int', 'الورديات', 'Shifts'),
                T::col('amount', 'money', 'المبلغ', 'Amount', ['total' => 'sum']),
                T::col('share_bp', 'bp', 'الحصة', 'Share'),
            ], $rows)],
        ];
    }

    /**
     * @param  \Illuminate\Support\Collection<string,array<string,mixed>>  $byId
     * @param  \Illuminate\Support\Collection<string,FuelShiftCollectionDeclaration>  $declarations
     * @return array<string,mixed>
     */
    private function byEmployee($byId, $declarations): array
    {
        $names = User::query()->whereIn('id', $declarations->pluck('declared_by')->filter()->all())->pluck('name', 'id')->all();
        $users = [];
        foreach ($declarations as $d) {
            $u = &$users[(string) $d->declared_by];
            $u ??= ['employee' => $names[$d->declared_by] ?? '—', 'shifts' => 0, 'collected' => 0, 'cash' => 0, 'network' => 0];
            $u['shifts']++;
            $u['collected'] += (int) $d->collected_total_minor;
            $u['cash'] += (int) $d->cash_declared_minor;
            $u['network'] += (int) $d->network_declared_minor;
            unset($u);
        }
        usort($users, fn ($a, $b) => strcmp($a['employee'], $b['employee']));

        return [
            'summary' => [T::item('collected', 'إجمالي التحصيل', 'Total collected', 'money', array_sum(array_column($users, 'collected')))],
            'tables' => [T::table('employees', 'التحصيل حسب الموظف', 'Collection by employee', [
                T::col('employee', 'text', 'الموظف', 'Employee'), T::col('shifts', 'int', 'الورديات', 'Shifts', ['total' => 'sum']),
                T::col('cash', 'money', 'نقد', 'Cash', ['total' => 'sum']), T::col('network', 'money', 'شبكة', 'Network', ['total' => 'sum']),
                T::col('collected', 'money', 'الإجمالي', 'Total', ['total' => 'sum']),
            ], $users)],
        ];
    }

    /**
     * العجز والزيادة: فرق النقد (الدرج) وفرق التحصيل مقابل العدادات، مجمَّعين بالاتجاه. مشتق من المبيعات ⇒ `sales`.
     *
     * @param  \Illuminate\Support\Collection<string,array<string,mixed>>  $byId
     * @param  \Illuminate\Support\Collection<string,FuelShiftCollectionDeclaration>  $declarations
     * @return array<string,mixed>
     */
    private function variances($byId, $declarations): array
    {
        $cash = $byId->isEmpty() ? collect() : FuelShiftCashVariance::query()->whereIn('fuel_shift_id', $byId->keys()->all())->get()->keyBy('fuel_shift_id');
        $shortage = $overage = $shortageCount = $overageCount = 0;
        $rows = [];
        foreach ($byId as $id => $s) {
            $v = $cash->get($id);
            $d = $declarations->get($id);
            $cashVar = $v === null ? null : (int) $v->variance_minor;
            $diff = $d?->difference_minor === null ? null : (int) $d->difference_minor;
            if ($cashVar !== null && $cashVar !== 0) {
                $cashVar < 0 ? [$shortage += -$cashVar, $shortageCount++] : [$overage += $cashVar, $overageCount++];
            }
            if (($cashVar ?? 0) === 0 && ($diff ?? 0) === 0) {
                continue;
            }
            $rows[] = ['shift' => $s['number'], 'station' => $s['station_name'], 'date' => $s['date'], 'cash_variance' => $cashVar, 'collection_difference' => $diff, 'review' => $v?->status];
        }

        return [
            'summary' => [
                T::item('shortage', 'إجمالي العجز (نقد)', 'Total cash shortage', 'money', $shortage, T::SALES),
                T::item('overage', 'إجمالي الزيادة (نقد)', 'Total cash overage', 'money', $overage, T::SALES),
                T::item('shortage_count', 'ورديات بعجز', 'Shifts with shortage', 'int', $shortageCount, T::SALES),
                T::item('overage_count', 'ورديات بزيادة', 'Shifts with overage', 'int', $overageCount, T::SALES),
            ],
            'tables' => [T::table('variances', 'العجز والزيادة', 'Shortages and overages', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('date', 'date', 'اليوم', 'Day'),
                T::col('cash_variance', 'money', 'فرق النقد (سالب = عجز)', 'Cash variance (negative = shortage)', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('collection_difference', 'money', 'فرق التحصيل مقابل العدادات', 'Collection vs meters', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('review', 'text', 'حالة المراجعة', 'Review', ['sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
        ];
    }

    /**
     * مطابقة المبيعات والتحصيل: من اللقطة المجمَّدة فقط (مبيعات العدادات × السعر وقت الإغلاق مقابل ما أُقِرّ به). وردية بلا إقرار = «غير مُقَرّ»، لا فرق مختلق.
     *
     * @param  \Illuminate\Support\Collection<string,array<string,mixed>>  $byId
     * @param  \Illuminate\Support\Collection<string,FuelShiftCollectionDeclaration>  $declarations
     * @return array<string,mixed>
     */
    private function reconciliation($byId, $declarations): array
    {
        $rows = [];
        foreach ($byId as $id => $s) {
            $d = $declarations->get($id);
            $rows[] = [
                'shift' => $s['number'], 'station' => $s['station_name'], 'date' => $s['date'], 'status' => $s['status'],
                'declared' => $d === null ? null : (int) $d->collected_total_minor,
                'sales' => $d?->sales_minor === null ? null : (int) $d->sales_minor,
                'difference' => $d?->difference_minor === null ? null : (int) $d->difference_minor,
                'review_required' => $d === null ? null : ($d->review_required ? 1 : 0), 'state' => $d?->status ?? 'none',
            ];
        }
        $declared = array_sum(array_map(fn ($r) => (int) $r['declared'], $rows));
        $matched = count(array_filter($rows, fn ($r) => $r['difference'] === 0));
        $diff = count(array_filter($rows, fn ($r) => $r['difference'] !== null && $r['difference'] !== 0));

        return [
            'summary' => [
                T::item('declared', 'إجمالي المُقَرّ به', 'Total declared', 'money', $declared),
                T::item('matched', 'ورديات مطابقة', 'Matched shifts', 'int', $matched, T::SALES),
                T::item('differences', 'ورديات بفرق', 'Shifts with a difference', 'int', $diff, T::SALES),
            ],
            'tables' => [T::table('reconciliation', 'مطابقة المبيعات والتحصيل', 'Sales vs collection', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('date', 'date', 'اليوم', 'Day'),
                T::col('status', 'status', 'الحالة', 'Status', ['values' => T::shiftStatusValues()]),
                T::col('declared', 'money', 'المُقَرّ به', 'Declared', ['total' => 'sum']),
                T::col('sales', 'money', 'مبيعات العدادات', 'Meter sales', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('difference', 'money', 'الفرق', 'Difference', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('review_required', 'int', 'مراجعة مطلوبة (1/0)', 'Review required (1/0)', ['sensitivity' => T::SALES]),
                T::col('state', 'status', 'الإقرار', 'Declaration', ['values' => ['none' => ['ar' => 'غير مُقَرّ', 'en' => 'Not declared'], 'declared' => ['ar' => 'مُقَرّ', 'en' => 'Declared'], 'frozen' => ['ar' => 'مجمَّد', 'en' => 'Frozen']]]),
            ], $rows)],
        ];
    }

    /**
     * المبيعات الآجلة: بيع وقود نهائي غير مسدَّد كلياً (فاتورة آجلة)، من `FuelSale` الرسمي. **ليس تحصيلاً**: المتبقي ذمة على العميل.
     *
     * @return array<string,mixed>
     */
    private function deferred(FuelReportContext $context): array
    {
        $query = $context->scoped(FuelSale::query()->with('partner:id,name')->where('status', FuelSale::STATUS_FINALIZED)->whereIn('payment_status', [FuelSale::PAYMENT_UNPAID, FuelSale::PAYMENT_PARTIAL]));
        $context->constrainPeriod($query, 'finalized_at');
        $sales = $query->orderBy('finalized_at')->limit(5001)->get();
        $truncated = $sales->count() > 5000;

        $customers = [];
        foreach ($sales->take(5000) as $sale) {
            $key = (string) ($sale->partner_id ?? '-');
            $c = &$customers[$key];
            $c ??= ['customer' => $sale->partner?->name ?? '—', 'sales' => 0, 'liters' => 0, 'gross' => 0, 'paid' => 0];
            $c['sales']++;
            $c['liters'] += (int) $sale->quantity_milliliters;
            $c['gross'] += (int) $sale->gross_minor;
            $c['paid'] += (int) $sale->paid_minor;
            unset($c);
        }
        usort($customers, fn ($a, $b) => strcmp($a['customer'], $b['customer']));
        $rows = array_map(fn ($c) => $c + ['outstanding' => $c['gross'] - $c['paid']], $customers);

        return [
            'summary' => [
                T::item('outstanding', 'المتبقي على العملاء', 'Outstanding from customers', 'money', array_sum(array_column($rows, 'outstanding')), T::SALES),
                T::item('sales', 'عدد المبيعات الآجلة', 'Deferred sales', 'int', array_sum(array_column($rows, 'sales'))),
            ],
            'tables' => [T::table('deferred', 'المبيعات الآجلة', 'Deferred sales', [
                T::col('customer', 'text', 'العميل', 'Customer'), T::col('sales', 'int', 'المبيعات', 'Sales', ['total' => 'sum']),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('gross', 'money', 'قيمة المبيعات', 'Sales value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('paid', 'money', 'المسدَّد', 'Paid', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('outstanding', 'money', 'المتبقي', 'Outstanding', ['total' => 'sum', 'sensitivity' => T::SALES]),
            ], $rows)],
            'truncated' => $truncated,
            'notes' => [['ar' => 'المبيعات الآجلة ذمم على العملاء وليست تحصيلاً نقدياً.', 'en' => 'Deferred sales are receivables, not cash collected.'], ...($truncated ? [['ar' => 'تجاوزت 5000 عملية؛ ضيّق الفترة.', 'en' => 'More than 5000 sales; narrow the period.']] : [])],
        ];
    }
}
