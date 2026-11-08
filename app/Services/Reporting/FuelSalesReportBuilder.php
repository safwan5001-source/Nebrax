<?php

namespace App\Services\Reporting;

use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * عائلة المبيعات (A): مبيعات الوردية المشتقة من العدادات فقط (`FuelShiftSalesCalculator` عبر `FuelReportShiftFacts`) — تقدير تشغيلي لا فواتير.
 * كل مبلغ `null` يعني «غير موثوق» (قراءة/سعر ناقص) ولا يُجمع جزئياً. الأعمدة المالية حسّاسة `sales` فتُحذف من الحمولة لمن لا يملك `fuel.sale.view`.
 */
final class FuelSalesReportBuilder implements FuelReportBuilder
{
    public function __construct(private FuelReportShiftFacts $facts) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        $loaded = $this->facts->load($context);
        $shifts = $loaded['shifts'];

        $built = match ($definition->key) {
            'sales.daily' => $this->byPeriod($shifts, 'day', 'sales.daily'),
            'sales.period' => $this->byPeriod($shifts, (string) ($context->filter('group') ?? 'day'), 'sales.period'),
            'sales.by_shift' => $this->byShift($shifts),
            'sales.by_product' => $this->byProduct($shifts),
            'sales.by_pump' => $this->byPump($shifts),
            'sales.by_nozzle' => $this->byNozzle($shifts),
            'sales.by_employee' => $this->byEmployee($shifts, $context),
            'sales.by_station' => $this->byStation($shifts),
            'sales.comparison' => $this->comparison($shifts, $context),
            'sales.consolidated' => $this->consolidated($shifts),
        };

        $notes = [[
            'ar' => 'المبالغ تقدير تشغيلي = فرق العدادات × سعر اللتر الفعّال؛ لا تشمل البيع الآجل ولا التسويات غير المسجّلة وليست فواتير بيع.',
            'en' => 'Amounts are an operational estimate = meter delta × effective price per liter; they exclude deferred sales and unrecorded settlements and are not sales invoices.',
        ]];
        if (in_array('open', array_column($shifts, 'status'), true)) {
            $notes[] = ['ar' => 'تتضمن ورديات مفتوحة بقيم حيّة تتغير حتى الإغلاق.', 'en' => 'Includes open shifts with live values that change until close.'];
        }
        if ($loaded['truncated']) {
            $notes[] = ['ar' => 'تجاوزت الفترة الحد الأقصى للورديات المحسوبة ('.FuelReportShiftFacts::SHIFT_CAP.'). ضيّق الفترة أو المحطة للحصول على نتيجة كاملة.', 'en' => 'The period exceeds the maximum number of computed shifts ('.FuelReportShiftFacts::SHIFT_CAP.'). Narrow the period or station for a complete result.'];
        }

        // مقارنة الفترات: أعلام جودة الفترتين تُدمج (اتحاد الفجوات وOR للاقتطاع) فلا يطغى أحدهما على الآخر.
        $gaps = array_values(array_unique([...$loaded['gaps'], ...($built['gaps'] ?? [])]));
        $truncated = $loaded['truncated'] || ($built['truncated'] ?? false);
        if (($built['truncated'] ?? false) && ! $loaded['truncated']) {
            $notes[] = ['ar' => 'تجاوزت فترة المقارنة الحد الأقصى للورديات؛ ضيّق الفترة.', 'en' => 'The comparison period exceeds the maximum number of shifts; narrow the period.'];
        }

        return ['summary' => $built['summary'] ?? [], 'tables' => $built['tables'], 'gaps' => $gaps, 'truncated' => $truncated, 'notes' => $notes];
    }

    // ───────── مجمِّعات ─────────

    /** @return array{shifts:int,ml:int,amount:?int,incomplete:int} */
    private function acc(): array
    {
        return ['shifts' => 0, 'ml' => 0, 'amount' => 0, 'incomplete' => 0];
    }

    /** @param array{shifts:int,ml:int,amount:?int,incomplete:int} $acc @param array<string,mixed> $shift */
    private function addShift(array &$acc, array $shift): void
    {
        $acc['shifts']++;
        $acc['ml'] += (int) $shift['milliliters'];
        $acc['amount'] = ($acc['amount'] === null || $shift['amount_minor'] === null) ? null : $acc['amount'] + (int) $shift['amount_minor'];
        $acc['incomplete'] += $shift['complete'] ? 0 : 1;
    }

    /** @param list<array<string,mixed>> $shifts @return array{shifts:int,ml:int,amount:?int,incomplete:int} */
    private function totalOf(array $shifts): array
    {
        $acc = $this->acc();
        foreach ($shifts as $shift) {
            $this->addShift($acc, $shift);
        }

        return $acc;
    }

    /** @param array{shifts:int,ml:int,amount:?int,incomplete:int} $acc @return list<array<string,mixed>> */
    private function summaryOf(array $acc): array
    {
        return [
            T::item('shifts', 'عدد الورديات', 'Shifts', 'int', $acc['shifts']),
            T::item('liters', 'اللترات', 'Liters', 'liters', $acc['ml']),
            T::item('amount', 'قيمة المبيعات', 'Sales value', 'money', $acc['amount'], T::SALES),
            T::item('incomplete_shifts', 'ورديات ببيانات ناقصة', 'Shifts with incomplete data', 'int', $acc['incomplete']),
        ];
    }

    private function cols(): array
    {
        return [
            T::col('shifts', 'int', 'الورديات', 'Shifts', ['total' => 'sum']),
            T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
            T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
            T::col('incomplete', 'int', 'ورديات ناقصة البيانات', 'Incomplete shifts', ['total' => 'sum']),
        ];
    }

    /** @param array{shifts:int,ml:int,amount:?int,incomplete:int} $acc @return array<string,mixed> */
    private function accRow(array $acc): array
    {
        return ['shifts' => $acc['shifts'], 'liters' => $acc['ml'], 'amount' => $acc['amount'], 'incomplete' => $acc['incomplete']];
    }

    // ───────── التقارير ─────────

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function byPeriod(array $shifts, string $group, string $key): array
    {
        $groups = [];
        foreach ($shifts as $shift) {
            if ($shift['date'] === null) {
                continue;
            }
            $bucket = match ($group) {
                'week' => CarbonImmutable::parse($shift['date'])->startOfWeek(CarbonInterface::SUNDAY)->toDateString(),
                'month' => substr((string) $shift['date'], 0, 7),
                default => (string) $shift['date'],
            };
            $groups[$bucket.'|'.$shift['station_id']]['bucket'] = $bucket;
            $groups[$bucket.'|'.$shift['station_id']]['station'] = $shift['station_name'];
            $groups[$bucket.'|'.$shift['station_id']]['acc'] ??= $this->acc();
            $this->addShift($groups[$bucket.'|'.$shift['station_id']]['acc'], $shift);
        }
        ksort($groups);
        $rows = array_map(fn ($g) => ['period' => $g['bucket'], 'station' => $g['station']] + $this->accRow($g['acc']), array_values($groups));
        $periodCol = match ($group) {
            'week' => T::col('period', 'date', 'بداية الأسبوع (الأحد)', 'Week starting (Sunday)'),
            'month' => T::col('period', 'text', 'الشهر', 'Month'),
            default => T::col('period', 'date', 'اليوم', 'Day'),
        };

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table($key === 'sales.daily' ? 'daily' : 'period', $key === 'sales.daily' ? 'المبيعات اليومية' : 'المبيعات حسب الفترة', $key === 'sales.daily' ? 'Daily sales' : 'Sales by period', [
                $periodCol, T::col('station', 'text', 'المحطة', 'Station'), ...$this->cols(),
            ], $rows)],
        ];
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function byShift(array $shifts): array
    {
        $rows = array_map(fn ($s) => [
            'shift' => $s['number'], 'station' => $s['station_name'], 'status' => $s['status'], 'opened_at' => $s['opened_at'], 'closed_at' => $s['closed_at'],
            'opened_by' => $s['opened_by_name'], 'liters' => $s['milliliters'], 'amount' => $s['amount_minor'], 'complete' => $s['complete'] ? 1 : 0,
        ], $shifts);

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table('shifts', 'المبيعات حسب الوردية', 'Sales by shift', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'),
                T::col('status', 'status', 'الحالة', 'Status', ['values' => T::shiftStatusValues()]),
                T::col('opened_at', 'datetime', 'الفتح', 'Opened'), T::col('closed_at', 'datetime', 'الإغلاق', 'Closed'),
                T::col('opened_by', 'text', 'فتحها', 'Opened by'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('complete', 'int', 'مكتملة البيانات (1/0)', 'Complete (1/0)'),
            ], $rows)],
        ];
    }

    /**
     * يجمّع صفوف الفوهات حسب مفتاح؛ كمية الفوهة null ⇒ المجموعة غير مكتملة (لترات جزئية تُعلَّم) ومبلغها null.
     *
     * @param  list<array<string,mixed>>  $shifts
     * @param  callable(array<string,mixed>,array<string,mixed>):array<string,mixed>  $keyOf  يعيد [key, attrs]
     * @return array<string,array<string,mixed>>
     */
    private function groupNozzles(array $shifts, callable $keyOf): array
    {
        $groups = [];
        foreach ($shifts as $shift) {
            foreach ($shift['nozzles'] as $nozzle) {
                ['key' => $key, 'attrs' => $attrs] = $keyOf($shift, $nozzle);
                $g = &$groups[$key];
                $g ??= $attrs + ['ml' => 0, 'amount' => 0, 'shifts' => [], 'nozzles' => [], 'incomplete' => false];
                $g['ml'] += (int) ($nozzle['ml'] ?? 0);
                $g['amount'] = ($g['amount'] === null || $nozzle['amount_minor'] === null) ? null : $g['amount'] + (int) $nozzle['amount_minor'];
                $g['incomplete'] = $g['incomplete'] || $nozzle['ml'] === null || $nozzle['amount_minor'] === null;
                $g['shifts'][$shift['id']] = true;
                $g['nozzles'][$nozzle['nozzle_id']] = true;
                unset($g);
            }
        }
        ksort($groups);

        return $groups;
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function byProduct(array $shifts): array
    {
        $groups = $this->groupNozzles($shifts, fn ($s, $n) => ['key' => (string) $n['product_name'].'|'.$n['product_id'], 'attrs' => ['product' => $n['product_name']]]);
        $totalMl = array_sum(array_column($groups, 'ml'));
        $rows = [];
        foreach ($groups as $g) {
            $rows[] = [
                'product' => $g['product'], 'liters' => $g['ml'], 'amount' => $g['amount'],
                'avg_price' => ($g['amount'] !== null && $g['ml'] > 0) ? intdiv($g['amount'] * 2000 + $g['ml'], 2 * $g['ml']) : null,
                'share_bp' => $totalMl > 0 ? intdiv($g['ml'] * 20000 + $totalMl, 2 * $totalMl) : null,
                'shifts' => count($g['shifts']), 'incomplete' => $g['incomplete'] ? 1 : 0,
            ];
        }

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table('products', 'المبيعات حسب المنتج', 'Sales by product', [
                T::col('product', 'text', 'المنتج', 'Product'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('avg_price', 'money', 'متوسط سعر اللتر', 'Average price / liter', ['sensitivity' => T::SALES]),
                T::col('share_bp', 'bp', 'الحصة من اللترات', 'Share of liters'),
                T::col('shifts', 'int', 'الورديات', 'Shifts'),
                T::col('incomplete', 'int', 'ناقصة البيانات (1/0)', 'Incomplete (1/0)'),
            ], $rows)],
        ];
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function byPump(array $shifts): array
    {
        $groups = $this->groupNozzles($shifts, fn ($s, $n) => ['key' => $s['station_name'].'|'.(string) $n['pump_label'].'|'.$n['pump_id'], 'attrs' => ['station' => $s['station_name'], 'pump' => $n['pump_label']]]);
        $rows = array_map(fn ($g) => ['station' => $g['station'], 'pump' => $g['pump'], 'nozzles' => count($g['nozzles']), 'shifts' => count($g['shifts']), 'liters' => $g['ml'], 'amount' => $g['amount'], 'incomplete' => $g['incomplete'] ? 1 : 0], array_values($groups));

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table('pumps', 'المبيعات حسب المضخة', 'Sales by pump', [
                T::col('station', 'text', 'المحطة', 'Station'), T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzles', 'int', 'الفوهات', 'Nozzles'),
                T::col('shifts', 'int', 'الورديات', 'Shifts'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('incomplete', 'int', 'ناقصة البيانات (1/0)', 'Incomplete (1/0)'),
            ], $rows)],
        ];
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function byNozzle(array $shifts): array
    {
        $groups = $this->groupNozzles($shifts, fn ($s, $n) => ['key' => $s['station_name'].'|'.(string) $n['pump_label'].'|'.$n['nozzle_number'].'|'.$n['nozzle_id'], 'attrs' => [
            'station' => $s['station_name'], 'pump' => $n['pump_label'], 'nozzle' => $n['nozzle_number'], 'product' => $n['product_name'],
        ]]);
        $rows = array_map(fn ($g) => ['station' => $g['station'], 'pump' => $g['pump'], 'nozzle' => $g['nozzle'], 'product' => $g['product'], 'shifts' => count($g['shifts']), 'liters' => $g['ml'], 'amount' => $g['amount'], 'incomplete' => $g['incomplete'] ? 1 : 0], array_values($groups));

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table('nozzles', 'المبيعات حسب الفوهة', 'Sales by nozzle', [
                T::col('station', 'text', 'المحطة', 'Station'), T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzle', 'text', 'الفوهة', 'Nozzle'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('shifts', 'int', 'الورديات', 'Shifts'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('incomplete', 'int', 'ناقصة البيانات (1/0)', 'Incomplete (1/0)'),
            ], $rows)],
        ];
    }

    /**
     * الموظف: وردية بطاقم واحد = «منفردة» تُنسب كاملةً له؛ بطاقم متعدد = «مشتركة» تُعرض منفصلة ولا تُقسَّم بالتخمين.
     * وردية بلا إسناد طاقم تُنسب لمن فتحها.
     *
     * @param  list<array<string,mixed>>  $shifts
     * @return array<string,mixed>
     */
    private function byEmployee(array $shifts, FuelReportContext $context): array
    {
        $users = [];
        $filter = $context->filter('user_id');
        foreach ($shifts as $shift) {
            $crew = [];
            foreach ($shift['staff'] as $member) {
                $crew[$member['user_id']] = $member['name'];
            }
            if ($crew === [] && $shift['opened_by'] !== null) {
                $crew[$shift['opened_by']] = $shift['opened_by_name'];
            }
            $sole = count($crew) === 1;
            foreach ($crew as $userId => $name) {
                if ($filter !== null && $filter !== $userId) {
                    continue;
                }
                $u = &$users[$userId];
                $u ??= ['name' => $name, 'sole' => $this->acc(), 'shared' => $this->acc()];
                $this->addShift($u[$sole ? 'sole' : 'shared'], $shift);
                unset($u);
            }
        }
        uasort($users, fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));
        $rows = array_map(fn ($u) => [
            'employee' => $u['name'],
            'sole_shifts' => $u['sole']['shifts'], 'sole_liters' => $u['sole']['ml'], 'sole_amount' => $u['sole']['shifts'] === 0 ? 0 : $u['sole']['amount'],
            'shared_shifts' => $u['shared']['shifts'], 'shared_liters' => $u['shared']['ml'], 'shared_amount' => $u['shared']['shifts'] === 0 ? 0 : $u['shared']['amount'],
        ], array_values($users));

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table('employees', 'المبيعات حسب الموظف', 'Sales by employee', [
                T::col('employee', 'text', 'الموظف', 'Employee'),
                T::col('sole_shifts', 'int', 'ورديات منفردة', 'Sole shifts', ['total' => 'sum']),
                T::col('sole_liters', 'liters', 'لترات منفردة', 'Sole liters', ['total' => 'sum']),
                T::col('sole_amount', 'money', 'قيمة منفردة', 'Sole value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('shared_shifts', 'int', 'ورديات مشتركة', 'Shared shifts'),
                T::col('shared_liters', 'liters', 'لترات الورديات المشتركة', 'Shared-shift liters'),
                T::col('shared_amount', 'money', 'قيمة الورديات المشتركة', 'Shared-shift value', ['sensitivity' => T::SALES]),
            ], $rows)],
            'notes' => [['ar' => 'أرقام الورديات المشتركة لكل مشارك هي إجمالي الوردية نفسها وليست حصته؛ لذا لا تُجمع عبر الموظفين.', 'en' => 'Shared-shift figures per participant are the whole shift total, not their share, so they must not be summed across employees.']],
        ];
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function byStation(array $shifts): array
    {
        $groups = [];
        foreach ($shifts as $shift) {
            $groups[$shift['station_name'].'|'.$shift['station_id']]['name'] = $shift['station_name'];
            $groups[$shift['station_name'].'|'.$shift['station_id']]['acc'] ??= $this->acc();
            $groups[$shift['station_name'].'|'.$shift['station_id']]['open'] ??= 0;
            $this->addShift($groups[$shift['station_name'].'|'.$shift['station_id']]['acc'], $shift);
            $groups[$shift['station_name'].'|'.$shift['station_id']]['open'] += $shift['status'] === 'open' ? 1 : 0;
        }
        ksort($groups);
        $rows = array_map(fn ($g) => ['station' => $g['name']] + $this->accRow($g['acc']) + ['open' => $g['open']], array_values($groups));

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [T::table('stations', 'المبيعات حسب المحطة', 'Sales by station', [
                T::col('station', 'text', 'المحطة', 'Station'), ...$this->cols(), T::col('open', 'int', 'ورديات مفتوحة', 'Open shifts'),
            ], $rows)],
        ];
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function comparison(array $shifts, FuelReportContext $context): array
    {
        $comparePeriod = $context->comparePeriod();
        $other = $this->facts->load($context, $comparePeriod);
        $dimension = (string) ($context->filter('dimension') ?? 'product');

        $a = $this->dimensionTotals($shifts, $dimension);
        $b = $this->dimensionTotals($other['shifts'], $dimension);
        // الهوية بالمعرّف (الاسم قد يتكرر بين محطتين/منتجين)؛ الاسم تسمية عرض فقط.
        $keys = array_values(array_unique([...array_keys($a), ...array_keys($b)]));
        usort($keys, fn ($x, $y) => [($a[$x] ?? $b[$x])['name'], $x] <=> [($a[$y] ?? $b[$y])['name'], $y]);
        $rows = [];
        foreach ($keys as $key) {
            $ax = $a[$key] ?? ['ml' => 0, 'amount' => 0];
            $bx = $b[$key] ?? ['ml' => 0, 'amount' => 0];
            $name = ($a[$key] ?? $b[$key])['name'];
            $rows[] = [
                'name' => $name,
                'a_liters' => $ax['ml'], 'b_liters' => $bx['ml'], 'delta_liters' => $ax['ml'] - $bx['ml'], 'delta_liters_bp' => $this->deltaBp($ax['ml'], $bx['ml']),
                'a_amount' => $ax['amount'], 'b_amount' => $bx['amount'],
                'delta_amount' => ($ax['amount'] === null || $bx['amount'] === null) ? null : $ax['amount'] - $bx['amount'],
                'delta_amount_bp' => $this->deltaBp($ax['amount'], $bx['amount']),
            ];
        }
        [$from, $to] = $context->period();

        return [
            'summary' => [
                T::item('period_a', 'الفترة الحالية', 'Current period', 'text', "{$from} → {$to}"),
                T::item('period_b', 'فترة المقارنة', 'Comparison period', 'text', "{$comparePeriod[0]} → {$comparePeriod[1]}"),
                ...$this->summaryOf($this->totalOf($shifts)),
            ],
            'tables' => [T::table('comparison', 'مقارنة المبيعات بين الفترات', 'Sales period comparison', [
                T::col('name', 'text', $dimension === 'station' ? 'المحطة' : 'المنتج', $dimension === 'station' ? 'Station' : 'Product'),
                T::col('a_liters', 'liters', 'لترات الحالية', 'Current liters', ['total' => 'sum']),
                T::col('b_liters', 'liters', 'لترات المقارنة', 'Comparison liters', ['total' => 'sum']),
                T::col('delta_liters', 'liters', 'فرق اللترات', 'Liters delta', ['total' => 'sum']),
                T::col('delta_liters_bp', 'bp', 'نسبة التغير', 'Change'),
                T::col('a_amount', 'money', 'قيمة الحالية', 'Current value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('b_amount', 'money', 'قيمة المقارنة', 'Comparison value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('delta_amount', 'money', 'فرق القيمة', 'Value delta', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('delta_amount_bp', 'bp', 'نسبة تغير القيمة', 'Value change', ['sensitivity' => T::SALES]),
            ], $rows)],
            'gaps' => $other['gaps'],
            'truncated' => $other['truncated'],
        ];
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,array{name:string,ml:int,amount:?int}> مفتاحه معرّف المحطة/المنتج */
    private function dimensionTotals(array $shifts, string $dimension): array
    {
        $out = [];
        foreach ($shifts as $shift) {
            if ($dimension === 'station') {
                $row = &$out[(string) $shift['station_id']];
                $row ??= ['name' => (string) $shift['station_name'], 'ml' => 0, 'amount' => 0];
                $row['ml'] += (int) $shift['milliliters'];
                $row['amount'] = ($row['amount'] === null || $shift['amount_minor'] === null) ? null : $row['amount'] + (int) $shift['amount_minor'];
                unset($row);

                continue;
            }
            foreach ($shift['nozzles'] as $nozzle) {
                $row = &$out[(string) ($nozzle['product_id'] ?? $nozzle['product_name'])];
                $row ??= ['name' => (string) $nozzle['product_name'], 'ml' => 0, 'amount' => 0];
                $row['ml'] += (int) ($nozzle['ml'] ?? 0);
                $row['amount'] = ($row['amount'] === null || $nozzle['amount_minor'] === null) ? null : $row['amount'] + (int) $nozzle['amount_minor'];
                unset($row);
            }
        }

        return $out;
    }

    /** نسبة التغير بالنقاط الأساسية (تقريب نصف لأعلى بأعداد صحيحة)؛ null إن غابت قيمة أو كان الأساس صفراً. */
    private function deltaBp(?int $current, ?int $base): ?int
    {
        if ($current === null || $base === null || $base === 0) {
            return null;
        }
        $delta = ($current - $base) * 10000;
        $sign = $delta < 0 ? -1 : 1;

        return $sign * intdiv(abs($delta) * 2 + abs($base), 2 * abs($base));
    }

    /** @param list<array<string,mixed>> $shifts @return array<string,mixed> */
    private function consolidated(array $shifts): array
    {
        $products = [];
        $cells = [];
        $stations = [];
        foreach ($shifts as $shift) {
            $stations[$shift['station_name'].'|'.$shift['station_id']] = $shift['station_name'];
            foreach ($shift['nozzles'] as $nozzle) {
                $pk = 'p_'.$nozzle['product_id'];
                $products[$pk] = (string) $nozzle['product_name'];
                $c = &$cells[$shift['station_name'].'|'.$shift['station_id']][$pk];
                $c ??= ['ml' => 0, 'amount' => 0];
                $c['ml'] += (int) ($nozzle['ml'] ?? 0);
                $c['amount'] = ($c['amount'] === null || $nozzle['amount_minor'] === null) ? null : $c['amount'] + (int) $nozzle['amount_minor'];
                unset($c);
            }
        }
        ksort($stations);
        asort($products);

        $literCols = [T::col('station', 'text', 'المحطة', 'Station')];
        $amountCols = [T::col('station', 'text', 'المحطة', 'Station')];
        foreach ($products as $pk => $name) {
            $literCols[] = T::col($pk, 'liters', $name, $name, ['total' => 'sum']);
            $amountCols[] = T::col($pk, 'money', $name, $name, ['total' => 'sum', 'sensitivity' => T::SALES]);
        }
        $literCols[] = T::col('total', 'liters', 'الإجمالي', 'Total', ['total' => 'sum']);
        $amountCols[] = T::col('total', 'money', 'الإجمالي', 'Total', ['total' => 'sum', 'sensitivity' => T::SALES]);

        $literRows = [];
        $amountRows = [];
        foreach ($stations as $sk => $name) {
            $lr = ['station' => $name];
            $ar = ['station' => $name];
            $totalMl = 0;
            $totalAmount = 0;
            foreach ($products as $pk => $_) {
                $cell = $cells[$sk][$pk] ?? ['ml' => 0, 'amount' => 0];
                $lr[$pk] = $cell['ml'];
                $ar[$pk] = $cell['amount'];
                $totalMl += $cell['ml'];
                $totalAmount = ($totalAmount === null || $cell['amount'] === null) ? null : $totalAmount + $cell['amount'];
            }
            $lr['total'] = $totalMl;
            $ar['total'] = $totalAmount;
            $literRows[] = $lr;
            $amountRows[] = $ar;
        }

        return [
            'summary' => $this->summaryOf($this->totalOf($shifts)),
            'tables' => [
                T::table('liters', 'اللترات (المحطات × المنتجات)', 'Liters (stations × products)', $literCols, $literRows),
                T::table('amount', 'القيمة (المحطات × المنتجات)', 'Value (stations × products)', $amountCols, $amountRows, T::SALES),
            ],
        ];
    }
}
