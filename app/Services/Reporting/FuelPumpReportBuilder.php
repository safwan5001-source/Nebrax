<?php

namespace App\Services\Reporting;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelStationAuditEvent;
use App\Models\User;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;

/**
 * عائلة المضخات والفوهات (D). المرادفات (قراءات، استهلاك الفوهة، مبيعات المضخة) تعيد استعمال بانيَي الورديات والمبيعات بمفتاح آخر — لا منطق منسوخ.
 * الجديد: مقارنة قراءات العدادات بالمبيعات الرسمية، فروق استمرارية العداد، الشذوذ، وسجل تغييرات إعداد المضخات/الفوهات من سجل التدقيق.
 *
 * مقارنة العدادات بالمبيعات: لتر العداد (إغلاق − افتتاح) مقابل مجموع `FuelSale` النهائي للوردية والفوهة نفسيهما. الفرق ليس عجزاً محاسبياً بل
 * «لترات لم تُسجَّل كبيع رسمي» أو العكس؛ وحدة التسوية الرسمية خارج نطاق التقرير.
 */
final class FuelPumpReportBuilder implements FuelReportBuilder
{
    private const TEXT_LIMIT = 240;

    /** حقول إعداد الفوهة/المضخة التي تعني تغييرها «إعادة ضبط أو تغيير ارتباط». */
    private const WATCHED = ['meter_opening_milliliters', 'fuel_tank_id', 'fuel_product_id', 'fuel_pump_id', 'nozzle_number', 'pump_number', 'status', 'controller_key'];

    public function __construct(private FuelShiftReportBuilder $shifts, private FuelSalesReportBuilder $sales) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        return match ($definition->key) {
            'pumps.readings' => $this->shifts->build($definition->withKey('shifts.readings'), $context),
            'pumps.nozzle_consumption' => $this->sales->build($definition->withKey('sales.by_nozzle'), $context),
            'pumps.pump_sales' => $this->sales->build($definition->withKey('sales.by_pump'), $context),
            'pumps.meter_vs_sales' => $this->meterVsSales($context),
            'pumps.differences' => $this->continuity($context),
            'pumps.resets' => $this->resets($context),
            'pumps.anomalies' => $this->anomalies($context),
        };
    }

    /** @return array<string,mixed> */
    private function meterVsSales(FuelReportContext $context): array
    {
        $loaded = $this->shifts->nozzleRows($context);
        $shiftIds = array_values(array_unique(array_column($loaded['rows'], 'shift_id')));
        $formal = $shiftIds === [] ? collect() : FuelSale::query()->whereIn('fuel_shift_id', $shiftIds)->where('status', FuelSale::STATUS_FINALIZED)
            ->selectRaw('fuel_shift_id, fuel_nozzle_id, COALESCE(SUM(quantity_milliliters), 0) as ml, COUNT(*) as n')->groupBy('fuel_shift_id', 'fuel_nozzle_id')->get()
            ->keyBy(fn ($r) => $r->fuel_shift_id.'|'.$r->fuel_nozzle_id);

        $rows = [];
        foreach ($loaded['rows'] as $r) {
            if ($r['liters'] === null) {
                continue; // لا فرق يُحسب لقراءة ناقصة/غير طبيعية (تظهر في تقرير الشذوذ)
            }
            $f = $formal->get($r['shift_id'].'|'.$r['nozzle_id']);
            $sold = $f === null ? 0 : (int) $f->ml;
            $diff = $r['liters'] - $sold;
            $rows[] = [
                'shift' => $r['shift'], 'station' => $r['station'], 'pump' => $r['pump'], 'nozzle' => $r['nozzle'], 'product' => $r['product'],
                'meter' => $r['liters'], 'formal' => $sold, 'sales_count' => $f === null ? 0 : (int) $f->n, 'difference' => $diff,
                'state' => $diff === 0 ? 'matched' : ($diff > 0 ? 'meter_higher' : 'formal_higher'),
            ];
        }
        $unmatched = count(array_filter($rows, fn ($r) => $r['difference'] !== 0));

        return [
            'summary' => [
                T::item('meter', 'لترات العدادات', 'Meter liters', 'liters', array_sum(array_column($rows, 'meter'))),
                T::item('formal', 'لترات المبيعات الرسمية', 'Formal sales liters', 'liters', array_sum(array_column($rows, 'formal'))),
                T::item('unmatched', 'فوهات/ورديات بفرق', 'Nozzle-shifts with a difference', 'int', $unmatched),
            ],
            'tables' => [T::table('compare', 'مقارنة قراءات العدادات بالمبيعات', 'Meter readings vs sales', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzle', 'text', 'الفوهة', 'Nozzle'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('meter', 'liters', 'لتر العداد', 'Meter liters', ['total' => 'sum']),
                T::col('formal', 'liters', 'لتر المبيعات الرسمية', 'Formal liters', ['total' => 'sum']),
                T::col('sales_count', 'int', 'عدد المبيعات', 'Sales'),
                T::col('difference', 'liters', 'الفرق (عداد − مبيعات)', 'Difference (meter − sales)', ['total' => 'sum']),
                T::col('state', 'status', 'الحالة', 'State', ['values' => ['matched' => ['ar' => 'مطابق', 'en' => 'Matched'], 'meter_higher' => ['ar' => 'العداد أعلى', 'en' => 'Meter higher'], 'formal_higher' => ['ar' => 'المبيعات أعلى', 'en' => 'Sales higher']]]),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'],
            'notes' => [
                ['ar' => 'المبيعات الرسمية هي بيع الوقود النهائي المسجَّل؛ الفرق لترات لم تُسجَّل كبيع رسمي (أو العكس) وليس عجزاً محاسبياً.', 'en' => 'Formal sales are the recorded finalized fuel sales; a difference is liters not recorded as a formal sale (or the reverse), not an accounting shortage.'],
                ...($loaded['truncated'] ? [['ar' => 'تجاوز عدد الورديات الحد الأقصى؛ ضيّق الفترة.', 'en' => 'Shift count exceeds the maximum; narrow the period.']] : []),
            ],
        ];
    }

    /**
     * فروق الاستمرارية: افتتاح الوردية يجب أن يساوي إغلاق الوردية السابقة لنفس الفوهة. الفحص ضمن ورديات الفترة المعروضة فقط
     * (الوردية الأولى لا مرجع سابقاً لها داخل الفترة فلا تُفحص).
     *
     * @return array<string,mixed>
     */
    private function continuity(FuelReportContext $context): array
    {
        $loaded = $this->shifts->nozzleRows($context);
        $byNozzle = [];
        foreach ($loaded['rows'] as $r) {
            $byNozzle[$r['nozzle_id']][] = $r;
        }
        $rows = [];
        foreach ($byNozzle as $list) {
            usort($list, fn ($a, $b) => strcmp((string) $a['shift_opened_at'], (string) $b['shift_opened_at']));
            for ($i = 1; $i < count($list); $i++) {
                $prev = $list[$i - 1];
                $cur = $list[$i];
                if ($prev['closing'] === null || $cur['opening'] === null || $prev['closing'] === $cur['opening']) {
                    continue;
                }
                $rows[] = [
                    'station' => $cur['station'], 'pump' => $cur['pump'], 'nozzle' => $cur['nozzle'], 'product' => $cur['product'],
                    'previous_shift' => $prev['shift'], 'previous_closing' => $prev['closing'], 'shift' => $cur['shift'], 'opening' => $cur['opening'],
                    'difference' => $cur['opening'] - $prev['closing'],
                ];
            }
        }
        usort($rows, fn ($a, $b) => strcmp($a['station'].$a['nozzle'].$a['shift'], $b['station'].$b['nozzle'].$b['shift']));

        return [
            'summary' => [T::item('breaks', 'انقطاعات الاستمرارية', 'Continuity breaks', 'int', count($rows))],
            'tables' => [T::table('continuity', 'فروقات العدادات', 'Meter differences', [
                T::col('station', 'text', 'المحطة', 'Station'), T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzle', 'text', 'الفوهة', 'Nozzle'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('previous_shift', 'text', 'الوردية السابقة', 'Previous shift'), T::col('previous_closing', 'liters', 'إغلاقها', 'Its closing'),
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('opening', 'liters', 'افتتاحها', 'Its opening'),
                T::col('difference', 'liters', 'الفرق (افتتاح − إغلاق سابق)', 'Difference (opening − previous closing)'),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'],
            'notes' => [['ar' => 'افتتاح وردية لا يطابق إغلاق سابقتها يعني حركة عداد خارج الورديات أو تعديل قراءة؛ يُفحص ضمن ورديات الفترة فقط.', 'en' => 'An opening that differs from the previous closing means meter movement outside shifts or an edited reading; checked within the period shifts only.']],
        ];
    }

    /** @return array<string,mixed> */
    private function anomalies(FuelReportContext $context): array
    {
        $loaded = $this->shifts->nozzleRows($context);
        $rows = [];
        foreach ($loaded['rows'] as $r) {
            $closed = $r['shift_status'] !== 'open';
            $type = match (true) {
                $r['status'] === 'missing' => 'missing',
                $r['status'] === 'closing_below_opening' => 'closing_below_opening',
                $closed && $r['status'] === 'ok' && $r['liters'] === 0 => 'no_movement',
                default => null,
            };
            if ($type !== null) {
                $rows[] = ['type' => $type] + array_intersect_key($r, array_flip(['shift', 'station', 'pump', 'nozzle', 'product', 'opening', 'closing']));
            }
        }
        $counts = array_count_values(array_column($rows, 'type'));

        return [
            'summary' => [
                T::item('anomalies', 'عدد الشذوذات', 'Anomalies', 'int', count($rows)),
                T::item('missing', 'قراءات ناقصة', 'Missing readings', 'int', $counts['missing'] ?? 0),
                T::item('below', 'إغلاق أقل من الافتتاح', 'Closing below opening', 'int', $counts['closing_below_opening'] ?? 0),
                T::item('idle', 'فوهات بلا حركة', 'Idle nozzles', 'int', $counts['no_movement'] ?? 0),
            ],
            'tables' => [T::table('anomalies', 'القراءات والحركات غير الطبيعية', 'Abnormal readings and movements', [
                T::col('type', 'status', 'النوع', 'Type', ['values' => [
                    'missing' => ['ar' => 'قراءة ناقصة', 'en' => 'Missing reading'], 'closing_below_opening' => ['ar' => 'إغلاق أقل من الافتتاح', 'en' => 'Closing below opening'], 'no_movement' => ['ar' => 'بلا حركة', 'en' => 'No movement'],
                ]]),
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzle', 'text', 'الفوهة', 'Nozzle'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('opening', 'liters', 'الافتتاح', 'Opening'), T::col('closing', 'liters', 'الإغلاق', 'Closing'),
            ], $rows)],
            'gaps' => array_values(array_diff($loaded['gaps'], ['missing_reading', 'closing_below_opening'])), 'truncated' => $loaded['truncated'], // القراءات الناقصة/المقلوبة هي موضوع التقرير نفسه لا فجوة في جودته
            'notes' => [['ar' => 'قواعد حتمية فقط (ناقصة، إغلاق<افتتاح، بلا حركة في وردية مغلقة)؛ لا عتبات إحصائية مخترعة.', 'en' => 'Deterministic rules only (missing, closing<opening, no movement in a closed shift); no invented statistical thresholds.']],
        ];
    }

    /**
     * سجل تغييرات إعداد المضخات والفوهات من سجل التدقيق (إعادة ضبط العدّاد الافتتاحي، تغيير الخزان/المنتج/رقم الفوهة/الحالة…).
     *
     * @return array<string,mixed>
     */
    private function resets(FuelReportContext $context): array
    {
        [$start, $end] = $context->utcEnvelope();
        $query = $context->scoped(FuelStationAuditEvent::query())
            ->whereIn('subject_type', [FuelNozzle::class, FuelPump::class])
            ->where('occurred_at', '>=', $start)->where('occurred_at', '<', $end);
        if ($context->filter('nozzle_id') !== null) {
            $query->where('subject_id', $context->filter('nozzle_id'));
        }
        if ($context->filter('pump_id') !== null) {
            $query->where('subject_id', $context->filter('pump_id'));
        }
        $events = $query->orderBy('occurred_at')->orderBy('id')->limit(1001)->get();
        $truncated = $events->count() > 1000;
        $names = User::query()->whereIn('id', $events->pluck('actor_id')->filter()->unique()->all())->pluck('name', 'id')->all();

        $rows = [];
        foreach ($events->take(1000) as $e) {
            $stationId = (string) $e->fuel_station_id;
            if (! $context->inPeriod($e->occurred_at, $stationId)) {
                continue;
            }
            $changes = [];
            foreach (self::WATCHED as $field) {
                $before = $e->before[$field] ?? null;
                $after = $e->after[$field] ?? null;
                if ($e->after !== null && $e->before !== null && $before !== $after) {
                    $changes[] = $field.': '.$this->show($before).' → '.$this->show($after);
                }
            }
            if ($e->action === 'nozzle.updated' && $changes === []) {
                continue; // تعديل لا يمس حقول الارتباط/العدّاد
            }
            $subject = $e->after ?? $e->before ?? [];
            $rows[] = [
                'at' => $e->occurred_at?->toIso8601String(), 'station' => $context->stationName($stationId), 'action' => $e->action,
                'subject' => (string) ($subject['nozzle_number'] ?? $subject['pump_number'] ?? ''), 'changes' => mb_substr(implode('؛ ', $changes), 0, self::TEXT_LIMIT),
                'actor' => $names[$e->actor_id] ?? null,
            ];
        }

        return [
            'summary' => [T::item('events', 'عدد الأحداث', 'Events', 'int', count($rows))],
            'tables' => [T::table('resets', 'سجل إعادة الضبط وتغيير الارتباطات', 'Resets and re-linking log', [
                T::col('at', 'datetime', 'الوقت', 'Time'), T::col('station', 'text', 'المحطة', 'Station'),
                T::col('action', 'status', 'الإجراء', 'Action', ['values' => [
                    'nozzle.created' => ['ar' => 'إنشاء فوهة', 'en' => 'Nozzle created'], 'nozzle.updated' => ['ar' => 'تعديل فوهة', 'en' => 'Nozzle updated'], 'nozzle.deleted' => ['ar' => 'حذف فوهة', 'en' => 'Nozzle deleted'],
                    'pump.created' => ['ar' => 'إنشاء مضخة', 'en' => 'Pump created'], 'pump.updated' => ['ar' => 'تعديل مضخة', 'en' => 'Pump updated'], 'pump.deleted' => ['ar' => 'حذف مضخة', 'en' => 'Pump deleted'],
                ]]),
                T::col('subject', 'text', 'الفوهة/المضخة', 'Nozzle/Pump'), T::col('changes', 'text', 'التغييرات', 'Changes'), T::col('actor', 'text', 'بواسطة', 'By'),
            ], $rows)],
            'truncated' => $truncated,
            'notes' => $truncated ? [['ar' => 'تجاوز 1000 حدث؛ ضيّق الفترة.', 'en' => 'More than 1000 events; narrow the period.']] : [],
        ];
    }

    private function show(mixed $value): string
    {
        return $value === null ? '—' : (is_scalar($value) ? (string) $value : (string) json_encode($value, JSON_UNESCAPED_UNICODE));
    }
}
