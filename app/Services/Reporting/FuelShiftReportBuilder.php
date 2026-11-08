<?php

namespace App\Services\Reporting;

use App\Models\FuelNozzle;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\FuelShiftCorrection;
use App\Models\FuelShiftMeterReading;
use App\Models\FuelShiftTankReading;
use App\Models\User;
use App\Services\FuelShiftSalesCalculator;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * عائلة الورديات (B): سجلات تشغيلية من جداول الوردية نفسها (لا اشتقاق مالي جديد). كل ما اشتُق من المبيعات (المتوقع، فرق النقد، فرق التحصيل)
 * حسّاس `sales`؛ حركات الدرج النقدية والتسليم تشغيلية تتبع `fuel.shift.view` كما في مورد الوردية.
 */
final class FuelShiftReportBuilder implements FuelReportBuilder
{
    private const TEXT_LIMIT = 240;

    public function __construct(private FuelReportShiftFacts $facts) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        return match ($definition->key) {
            'shifts.log' => $this->log($context),
            'shifts.detail' => $this->detail($context),
            'shifts.readings' => $this->readings($context),
            'shifts.handover' => $this->handover($context),
            'shifts.closing' => $this->closing($context),
            'shifts.open_overdue' => $this->openOverdue($context),
            'shifts.variances' => $this->variances($context),
            'shifts.corrections' => $this->corrections($context),
        };
    }

    /** @return array{shifts:list<array<string,mixed>>,truncated:bool,gaps:list<string>} */
    private function shifts(FuelReportContext $context, bool $ignorePeriod = false): array
    {
        return $this->facts->load($context, null, false, $ignorePeriod);
    }

    /** @return list<array{ar:string,en:string}> */
    private function capNote(bool $truncated): array
    {
        return $truncated
            ? [['ar' => 'تجاوز عدد الورديات الحد الأقصى ('.FuelReportShiftFacts::SHIFT_CAP.')؛ ضيّق الفترة أو المحطة.', 'en' => 'Shift count exceeds the maximum ('.FuelReportShiftFacts::SHIFT_CAP.'); narrow the period or station.']]
            : [];
    }

    /** @param list<string> $ids @return array<string,string> */
    private function userNames(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));

        return $ids === [] ? [] : User::query()->whereIn('id', $ids)->pluck('name', 'id')->all();
    }

    private function statusCol(): array
    {
        return T::col('status', 'status', 'الحالة', 'Status', ['values' => T::shiftStatusValues()]);
    }

    // ───────── B1 سجل الورديات ─────────

    /** @return array<string,mixed> */
    private function log(FuelReportContext $context): array
    {
        $loaded = $this->shifts($context);
        $rows = array_map(function (array $s) {
            /** @var FuelShift $m */
            $m = $s['model'];

            return [
                'shift' => $s['number'], 'station' => $s['station_name'], 'status' => $s['status'], 'opened_at' => $s['opened_at'], 'closed_at' => $s['closed_at'],
                'duration' => $s['duration_minutes'], 'opened_by' => $s['opened_by_name'], 'closed_by' => $s['closed_by_name'], 'approved_by' => $s['approved_by_name'],
                'staff' => count($s['staff']), 'liters' => $s['status'] === 'open' ? null : (int) $m->operational_meter_milliliters,
            ];
        }, $loaded['shifts']);
        $counts = array_count_values(array_column($loaded['shifts'], 'status'));

        return [
            'summary' => [
                T::item('shifts', 'عدد الورديات', 'Shifts', 'int', count($rows)),
                T::item('open', 'مفتوحة', 'Open', 'int', $counts['open'] ?? 0),
                T::item('closed', 'مغلقة', 'Closed', 'int', $counts['closed'] ?? 0),
                T::item('approved', 'معتمدة', 'Approved', 'int', $counts['approved'] ?? 0),
            ],
            'tables' => [T::table('shifts', 'سجل الورديات', 'Shift log', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), $this->statusCol(),
                T::col('opened_at', 'datetime', 'الفتح', 'Opened'), T::col('closed_at', 'datetime', 'الإغلاق', 'Closed'),
                T::col('duration', 'int', 'المدة (دقيقة)', 'Duration (min)'),
                T::col('opened_by', 'text', 'فتحها', 'Opened by'), T::col('closed_by', 'text', 'أغلقها', 'Closed by'), T::col('approved_by', 'text', 'اعتمدها', 'Approved by'),
                T::col('staff', 'int', 'الطاقم', 'Staff'),
                T::col('liters', 'liters', 'لترات العدادات', 'Meter liters', ['total' => 'sum']),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'],
            'notes' => [
                ['ar' => 'لترات الوردية المفتوحة غير متاحة قبل الإغلاق؛ للقيم الحيّة استعمل تقرير المبيعات حسب الوردية.', 'en' => 'Liters of an open shift are not available before close; use the sales-by-shift report for live values.'],
                ...$this->capNote($loaded['truncated']),
            ],
        ];
    }

    // ───────── B2 تقرير الوردية التفصيلي ─────────

    /** @return array<string,mixed> */
    private function detail(FuelReportContext $context): array
    {
        if ($context->filter('shift_id') === null) {
            throw ValidationException::withMessages(['shift_id' => ['معرّف الوردية مطلوب.']]);
        }
        $loaded = $this->facts->load($context, null, true, true);
        if ($loaded['shifts'] === []) {
            abort(404); // غير موجودة أو خارج نطاق المستخدم: رد واحد
        }
        $s = $loaded['shifts'][0];
        /** @var FuelShift $shift */
        $shift = $s['model'];
        $names = $this->userNames([$shift->opened_by, $shift->closed_by, $shift->approved_by]);

        $nozzleRows = array_map(fn ($n) => [
            'pump' => $n['pump_label'], 'nozzle' => $n['nozzle_number'], 'product' => $n['product_name'], 'opening' => $n['opening'], 'closing' => $n['closing'],
            'liters' => $n['ml'], 'amount' => $n['amount_minor'], 'status' => $n['status'],
        ], $s['nozzles']);
        $productRows = array_map(fn ($p) => ['product' => $p['name'], 'nozzles' => $p['nozzle_count'], 'liters' => $p['milliliters'], 'price' => $p['price_per_liter_minor'], 'amount' => $p['amount_minor']], $s['products']);
        $staffRows = array_map(fn ($m) => ['name' => $m['name'], 'role' => $m['role']], $s['staff']);

        $movements = FuelShiftCashMovement::query()->where('fuel_shift_id', $shift->id)->with('recorder:id,name')->orderBy('recorded_at')->get();
        $receivers = $this->userNames($movements->pluck('received_by_user_id')->all());
        $cashRows = $movements->map(fn (FuelShiftCashMovement $m) => [
            'type' => $m->type, 'amount' => (int) $m->amount_minor, 'purpose' => $m->purpose, 'reason' => mb_substr((string) $m->reason, 0, self::TEXT_LIMIT),
            'received_by' => $receivers[$m->received_by_user_id] ?? null, 'recorded_by' => $m->recorder?->name, 'recorded_at' => $m->recorded_at?->toIso8601String(),
        ])->all();

        $tankRows = FuelShiftTankReading::query()->where('fuel_shift_id', $shift->id)->with('tank:id,name,code')->orderBy('measured_at')->get()
            ->map(fn (FuelShiftTankReading $t) => ['tank' => $t->tank?->name, 'stage' => $t->reading_stage, 'type' => $t->reading_type, 'quantity' => (int) $t->quantity_milliliters, 'measured_at' => $t->measured_at?->toIso8601String()])->all();

        $declaration = FuelShiftCollectionDeclaration::query()->where('fuel_shift_id', $shift->id)->first();
        $collectionRows = collect($declaration?->lines ?? [])->map(fn ($l) => ['method' => $l['name'] ?? null, 'type' => $l['settlement_type'] ?? null, 'amount' => (int) ($l['amount_minor'] ?? 0)])->all();

        $variance = FuelShiftCashVariance::query()->where('fuel_shift_id', $shift->id)->first();

        $tables = [
            T::table('nozzles', 'قراءات الفوهات', 'Nozzle readings', [
                T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzle', 'text', 'الفوهة', 'Nozzle'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('opening', 'liters', 'قراءة الافتتاح', 'Opening'), T::col('closing', 'liters', 'قراءة الإغلاق', 'Closing'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('status', 'text', 'حالة القراءة', 'Reading status'),
            ], $nozzleRows),
            T::table('products', 'المنتجات', 'Products', [
                T::col('product', 'text', 'المنتج', 'Product'), T::col('nozzles', 'int', 'الفوهات', 'Nozzles'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('price', 'money', 'سعر اللتر', 'Price / liter', ['sensitivity' => T::SALES]),
                T::col('amount', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::SALES]),
            ], $productRows),
            T::table('staff', 'الطاقم', 'Staff', [T::col('name', 'text', 'الاسم', 'Name'), T::col('role', 'text', 'الدور', 'Role')], $staffRows),
            T::table('cash', 'حركات الدرج', 'Drawer movements', [
                T::col('type', 'text', 'النوع', 'Type'), T::col('amount', 'money', 'المبلغ', 'Amount', ['total' => 'sum']), T::col('purpose', 'text', 'الغرض', 'Purpose'),
                T::col('reason', 'text', 'السبب', 'Reason'), T::col('received_by', 'text', 'المستلِم', 'Received by'),
                T::col('recorded_by', 'text', 'سجّلها', 'Recorded by'), T::col('recorded_at', 'datetime', 'الوقت', 'Time'),
            ], $cashRows),
            T::table('tanks', 'قراءات الخزانات', 'Tank readings', [
                T::col('tank', 'text', 'الخزان', 'Tank'), T::col('stage', 'text', 'المرحلة', 'Stage'), T::col('type', 'text', 'النوع', 'Type'),
                T::col('quantity', 'liters', 'الكمية', 'Quantity'), T::col('measured_at', 'datetime', 'وقت القياس', 'Measured at'),
            ], $tankRows),
            T::table('collection', 'التحصيل المُقَرّ به', 'Declared collection', [
                T::col('method', 'text', 'طريقة الدفع', 'Payment method'), T::col('type', 'text', 'النوع', 'Type'),
                T::col('amount', 'money', 'المبلغ', 'Amount', ['total' => 'sum', 'sensitivity' => T::SALES]),
            ], $collectionRows, T::SALES),
        ];

        return [
            'summary' => [
                T::item('shift', 'الوردية', 'Shift', 'text', $s['number']),
                T::item('station', 'المحطة', 'Station', 'text', $s['station_name']),
                T::item('status', 'الحالة', 'Status', 'text', $s['status']),
                T::item('opened_at', 'الفتح', 'Opened', 'datetime', $s['opened_at']),
                T::item('closed_at', 'الإغلاق', 'Closed', 'datetime', $s['closed_at']),
                T::item('opened_by', 'فتحها', 'Opened by', 'text', $names[$shift->opened_by] ?? null),
                T::item('closed_by', 'أغلقها', 'Closed by', 'text', $names[$shift->closed_by] ?? null),
                T::item('approved_by', 'اعتمدها', 'Approved by', 'text', $names[$shift->approved_by] ?? null),
                T::item('liters', 'اللترات', 'Liters', 'liters', $s['milliliters']),
                T::item('amount', 'قيمة المبيعات', 'Sales value', 'money', $s['amount_minor'], T::SALES),
                T::item('opening_float', 'عهدة الافتتاح', 'Opening float', 'money', (int) $shift->opening_float_minor),
                T::item('counted_cash', 'النقد المعدود', 'Counted cash', 'money', $shift->counted_cash_minor === null ? null : (int) $shift->counted_cash_minor),
                T::item('expected_cash', 'النقد المتوقع', 'Expected cash', 'money', $variance === null ? null : (int) $variance->expected_operational_cash_minor, T::SALES),
                T::item('cash_variance', 'فرق النقد', 'Cash variance', 'money', $variance === null ? null : (int) $variance->variance_minor, T::SALES),
                T::item('tank_variance', 'فرق الخزان (تشغيلي)', 'Tank variance (operational)', 'liters', $shift->operational_tank_variance_milliliters === null ? null : (int) $shift->operational_tank_variance_milliliters),
                T::item('closing_note', 'ملاحظة الإغلاق', 'Closing note', 'text', $shift->closing_note === null ? null : mb_substr((string) $shift->closing_note, 0, self::TEXT_LIMIT)),
            ],
            'tables' => $tables,
            'gaps' => $loaded['gaps'],
            'period' => false,
            'notes' => [['ar' => 'قيم المبيعات تقدير تشغيلي من العدادات × السعر الفعّال.', 'en' => 'Sales values are an operational estimate: meter delta × effective price.']],
        ];
    }

    // ───────── B3 قراءات بداية ونهاية الوردية ─────────

    /** @return array<string,mixed> */
    private function readings(FuelReportContext $context): array
    {
        $loaded = $this->nozzleRows($context);
        $keep = array_flip(['shift', 'station', 'pump', 'nozzle', 'product', 'opening', 'opening_at', 'closing', 'closing_at', 'liters', 'status']);
        $rows = array_map(fn (array $r) => array_intersect_key($r, $keep), $loaded['rows']);
        $missing = count(array_filter($rows, fn ($r) => $r['status'] === 'missing'));

        return [
            'summary' => [
                T::item('shifts', 'الورديات', 'Shifts', 'int', count($loaded['shifts'])),
                T::item('rows', 'سطور القراءات', 'Reading rows', 'int', count($rows)),
                T::item('missing', 'فوهات بلا قراءة', 'Nozzles without readings', 'int', $missing),
            ],
            'tables' => [T::table('readings', 'قراءات الفوهات', 'Nozzle readings', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('pump', 'text', 'المضخة', 'Pump'), T::col('nozzle', 'text', 'الفوهة', 'Nozzle'),
                T::col('product', 'text', 'المنتج', 'Product'),
                T::col('opening', 'liters', 'الافتتاح', 'Opening'), T::col('opening_at', 'datetime', 'وقت الافتتاح', 'Opened at'),
                T::col('closing', 'liters', 'الإغلاق', 'Closing'), T::col('closing_at', 'datetime', 'وقت الإغلاق', 'Closed at'),
                T::col('liters', 'liters', 'الفرق (لتر)', 'Delta (L)', ['total' => 'sum']),
                T::col('status', 'text', 'الحالة', 'Status'),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'], 'notes' => $this->capNote($loaded['truncated']),
        ];
    }

    /**
     * صفوف قراءات الفوهات لكل وردية (فتح/إغلاق/فرق/حالة) — مصدر مشترك لتقارير القراءات وتقارير المضخات. الفوهة النشطة بلا قراءة تظهر `missing`.
     * الصف يحمل مفاتيح داخلية (`shift_id`، `nozzle_id`، `shift_status`، `shift_opened_at`) لا تدخل الحمولة (يقصّها كل مستدعٍ بأعمدته).
     *
     * @return array{rows:list<array<string,mixed>>,shifts:list<array<string,mixed>>,truncated:bool,gaps:list<string>}
     */
    public function nozzleRows(FuelReportContext $context): array
    {
        $loaded = $this->shifts($context, $context->filter('shift_id') !== null);
        $ids = array_column($loaded['shifts'], 'id');
        $readings = $ids === [] ? collect() : FuelShiftMeterReading::query()->whereIn('fuel_shift_id', $ids)->get()->groupBy('fuel_shift_id');
        $stationIds = array_values(array_unique(array_column($loaded['shifts'], 'station_id')));
        $nozzles = $stationIds === [] ? collect() : FuelNozzle::query()->whereIn('fuel_station_id', $stationIds)->with(['pump', 'fuelProduct'])->get()->groupBy('fuel_station_id');

        $rows = [];
        foreach ($loaded['shifts'] as $s) {
            $byNozzle = ($readings->get($s['id']) ?? collect())->groupBy('fuel_nozzle_id');
            foreach (($nozzles->get($s['station_id']) ?? collect()) as $nozzle) {
                $pair = $byNozzle->get($nozzle->id);
                if ($pair === null && $nozzle->status !== FuelNozzle::STATUS_ACTIVE) {
                    continue;
                }
                if ($context->filter('product_id') !== null && $nozzle->fuel_product_id !== $context->filter('product_id')) {
                    continue;
                }
                if ($context->filter('pump_id') !== null && $nozzle->fuel_pump_id !== $context->filter('pump_id')) {
                    continue;
                }
                if ($context->filter('nozzle_id') !== null && $nozzle->id !== $context->filter('nozzle_id')) {
                    continue;
                }
                $open = $pair?->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_OPENING);
                $close = $pair?->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_CLOSING);
                $delta = ($open !== null && $close !== null) ? (int) $close->meter_milliliters - (int) $open->meter_milliliters : null;
                $status = $open === null || $close === null ? ($s['status'] === 'open' && $open !== null ? 'in_progress' : 'missing') : ($delta < 0 ? 'closing_below_opening' : 'ok');
                $rows[] = [
                    'shift' => $s['number'], 'station' => $s['station_name'], 'pump' => $nozzle->pump?->name ?: (string) $nozzle->pump?->pump_number, 'nozzle' => (string) $nozzle->nozzle_number,
                    'product' => $nozzle->fuelProduct?->name,
                    'opening' => $open === null ? null : (int) $open->meter_milliliters, 'opening_at' => $open?->measured_at?->toIso8601String(),
                    'closing' => $close === null ? null : (int) $close->meter_milliliters, 'closing_at' => $close?->measured_at?->toIso8601String(),
                    'liters' => ($delta !== null && $delta >= 0) ? $delta : null, 'status' => $status,
                    'shift_id' => $s['id'], 'nozzle_id' => $nozzle->id, 'shift_status' => $s['status'], 'shift_opened_at' => $s['opened_at'],
                ];
            }
        }

        // فجوات القراءات تدخل جودة البيانات: كميات الفوهات الناقصة/المقلوبة غير متاحة ولا تُعامل التقارير نتيجتها كاملة.
        $statuses = array_column($rows, 'status');
        $gaps = $loaded['gaps'];
        if (in_array('missing', $statuses, true)) {
            $gaps[] = FuelShiftSalesCalculator::GAP_MISSING_READING;
        }
        if (in_array('closing_below_opening', $statuses, true)) {
            $gaps[] = FuelShiftSalesCalculator::GAP_CLOSING_BELOW_OPENING;
        }

        return ['rows' => $rows, 'shifts' => $loaded['shifts'], 'truncated' => $loaded['truncated'], 'gaps' => array_values(array_unique($gaps))];
    }

    // ───────── B4 التسليم والاستلام ─────────

    /** @return array<string,mixed> */
    private function handover(FuelReportContext $context): array
    {
        $loaded = $this->shifts($context);
        $byId = collect($loaded['shifts'])->keyBy('id');
        $movements = $byId->isEmpty() ? collect() : FuelShiftCashMovement::query()->whereIn('fuel_shift_id', $byId->keys()->all())
            ->where('purpose', 'treasury_handover')->with('recorder:id,name')->orderBy('recorded_at')->get();
        $receivers = $this->userNames($movements->pluck('received_by_user_id')->all());

        $rows = $movements->map(function (FuelShiftCashMovement $m) use ($byId, $receivers) {
            $s = $byId->get($m->fuel_shift_id);

            return [
                'shift' => $s['number'], 'station' => $s['station_name'], 'amount' => (int) $m->amount_minor, 'received_by' => $receivers[$m->received_by_user_id] ?? null,
                'recorded_by' => $m->recorder?->name, 'recorded_at' => $m->recorded_at?->toIso8601String(),
                'proof' => is_array($m->evidence) ? ($m->evidence['proof_reference'] ?? null) : null,
            ];
        })->all();

        return [
            'summary' => [
                T::item('handovers', 'عدد التسليمات', 'Handovers', 'int', count($rows)),
                T::item('amount', 'إجمالي المسلَّم', 'Total handed over', 'money', array_sum(array_column($rows, 'amount'))),
            ],
            'tables' => [T::table('handover', 'تسليم النقد للخزنة', 'Cash handover to treasury', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'),
                T::col('amount', 'money', 'المبلغ', 'Amount', ['total' => 'sum']), T::col('received_by', 'text', 'المستلِم', 'Received by'),
                T::col('recorded_by', 'text', 'سجّله', 'Recorded by'), T::col('recorded_at', 'datetime', 'الوقت', 'Time'), T::col('proof', 'text', 'مرجع الإثبات', 'Proof reference'),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'], 'notes' => $this->capNote($loaded['truncated']),
        ];
    }

    // ───────── B5 تقرير الإقفال ─────────

    /** @return array<string,mixed> */
    private function closing(FuelReportContext $context): array
    {
        $loaded = $this->shifts($context);
        $closed = array_values(array_filter($loaded['shifts'], fn ($s) => $s['status'] !== 'open'));
        $variances = $closed === [] ? collect() : FuelShiftCashVariance::query()->whereIn('fuel_shift_id', array_column($closed, 'id'))->get()->keyBy('fuel_shift_id');

        $rows = array_map(function (array $s) use ($variances) {
            /** @var FuelShift $m */
            $m = $s['model'];
            $v = $variances->get($s['id']);

            return [
                'shift' => $s['number'], 'station' => $s['station_name'], 'status' => $s['status'], 'closed_at' => $s['closed_at'], 'closed_by' => $s['closed_by_name'], 'approved_by' => $s['approved_by_name'],
                'liters' => (int) $m->operational_meter_milliliters, 'opening_float' => (int) $m->opening_float_minor,
                'counted' => $m->counted_cash_minor === null ? null : (int) $m->counted_cash_minor,
                'expected' => $v === null ? null : (int) $v->expected_operational_cash_minor, 'variance' => $v === null ? null : (int) $v->variance_minor,
                'tank_variance' => $m->operational_tank_variance_milliliters === null ? null : (int) $m->operational_tank_variance_milliliters,
                'note' => $m->closing_note === null ? null : mb_substr((string) $m->closing_note, 0, self::TEXT_LIMIT),
            ];
        }, $closed);

        return [
            'summary' => [
                T::item('shifts', 'ورديات مغلقة', 'Closed shifts', 'int', count($rows)),
                T::item('liters', 'لترات العدادات', 'Meter liters', 'liters', array_sum(array_column($rows, 'liters'))),
            ],
            'tables' => [T::table('closing', 'إقفال الورديات', 'Shift closing', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), $this->statusCol(),
                T::col('closed_at', 'datetime', 'الإغلاق', 'Closed'), T::col('closed_by', 'text', 'أغلقها', 'Closed by'), T::col('approved_by', 'text', 'اعتمدها', 'Approved by'),
                T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('opening_float', 'money', 'العهدة', 'Float', ['total' => 'sum']),
                T::col('counted', 'money', 'المعدود', 'Counted', ['total' => 'sum']),
                T::col('expected', 'money', 'المتوقع', 'Expected', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('variance', 'money', 'الفرق', 'Variance', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('tank_variance', 'liters', 'فرق الخزان', 'Tank variance'),
                T::col('note', 'text', 'ملاحظة الإغلاق', 'Closing note'),
            ], $rows)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'], 'notes' => $this->capNote($loaded['truncated']),
        ];
    }

    // ───────── B6 المفتوحة والمتأخرة ─────────

    /** @return array<string,mixed> */
    private function openOverdue(FuelReportContext $context): array
    {
        $threshold = (int) ($context->filter('overdue_hours') ?? 12);
        $shifts = $context->scoped(FuelShift::query()->with(['opener:id,name', 'staffAssignments']))->where('status', FuelShift::STATUS_OPEN)->orderBy('opened_at')->limit(FuelReportShiftFacts::SHIFT_CAP + 1)->get();
        $truncated = $shifts->count() > FuelReportShiftFacts::SHIFT_CAP;
        $now = CarbonImmutable::now();
        $rows = $shifts->take(FuelReportShiftFacts::SHIFT_CAP)->map(function (FuelShift $s) use ($context, $threshold, $now) {
            $age = $s->opened_at === null ? null : (int) $s->opened_at->diffInMinutes($now);

            return [
                'shift' => $s->number, 'station' => $context->stationName((string) $s->fuel_station_id), 'opened_at' => $s->opened_at?->toIso8601String(),
                'opened_by' => $s->opener?->name, 'staff' => $s->staffAssignments->count(), 'age_minutes' => $age,
                'overdue' => ($age !== null && $age > $threshold * 60) ? 1 : 0,
            ];
        })->all();

        return [
            'summary' => [
                T::item('open', 'ورديات مفتوحة', 'Open shifts', 'int', count($rows)),
                T::item('overdue', 'متأخرة', 'Overdue', 'int', array_sum(array_column($rows, 'overdue'))),
                T::item('threshold', 'حد التأخير (ساعة)', 'Overdue threshold (h)', 'int', $threshold),
            ],
            'tables' => [T::table('open', 'الورديات المفتوحة', 'Open shifts', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('opened_at', 'datetime', 'الفتح', 'Opened'),
                T::col('opened_by', 'text', 'فتحها', 'Opened by'), T::col('staff', 'int', 'الطاقم', 'Staff'),
                T::col('age_minutes', 'int', 'العمر (دقيقة)', 'Age (min)'), T::col('overdue', 'int', 'متأخرة (1/0)', 'Overdue (1/0)', ['total' => 'sum']),
            ], $rows)],
            'period' => false, 'truncated' => $truncated,
            'notes' => [['ar' => 'حد التأخير معلمة طلب (الافتراضي 12 ساعة) وليس سياسة مخزَّنة للمؤسسة.', 'en' => 'The overdue threshold is a request parameter (default 12 hours), not a stored tenant policy.'], ...$this->capNote($truncated)],
        ];
    }

    // ───────── B7 فروقات الوردية ─────────

    /** @return array<string,mixed> */
    private function variances(FuelReportContext $context): array
    {
        $loaded = $this->shifts($context);
        $byId = collect($loaded['shifts'])->keyBy('id');
        $ids = $byId->keys()->all();
        $variances = $ids === [] ? collect() : FuelShiftCashVariance::query()->whereIn('fuel_shift_id', $ids)->get()->keyBy('fuel_shift_id');
        $declarations = $ids === [] ? collect() : FuelShiftCollectionDeclaration::query()->whereIn('fuel_shift_id', $ids)->get()->keyBy('fuel_shift_id');
        $names = $this->userNames([...$variances->pluck('counted_by')->all(), ...$variances->pluck('reviewed_by')->all()]);

        $rows = [];
        foreach ($loaded['shifts'] as $s) {
            $v = $variances->get($s['id']);
            $d = $declarations->get($s['id']);
            $cash = $v === null ? null : (int) $v->variance_minor;
            $collection = $d?->difference_minor === null ? null : (int) $d->difference_minor;
            if (($cash === null || $cash === 0) && ($collection === null || $collection === 0) && $v?->status !== FuelShiftCashVariance::STATUS_PENDING_REVIEW) {
                continue;
            }
            $rows[] = [
                'shift' => $s['number'], 'station' => $s['station_name'], 'closed_at' => $s['closed_at'],
                'direction' => $v?->variance_direction, 'cash_variance' => $cash, 'review_status' => $v?->status, 'counted_by' => $names[$v?->counted_by] ?? null,
                'reviewed_by' => $names[$v?->reviewed_by] ?? null, 'reviewed_at' => $v?->reviewed_at?->toIso8601String(),
                'collection_difference' => $collection, 'collection_review_required' => $d === null ? null : ($d->review_required ? 1 : 0),
            ];
        }

        return [
            'summary' => [
                T::item('shifts_with_variance', 'ورديات بفروقات', 'Shifts with variances', 'int', count($rows), T::SALES),
                T::item('pending', 'بانتظار المراجعة', 'Pending review', 'int', count(array_filter($rows, fn ($r) => $r['review_status'] === FuelShiftCashVariance::STATUS_PENDING_REVIEW)), T::SALES),
            ],
            'tables' => [T::table('variances', 'فروقات الوردية', 'Shift variances', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('closed_at', 'datetime', 'الإغلاق', 'Closed'),
                T::col('direction', 'text', 'الاتجاه (عجز/زيادة)', 'Direction', ['sensitivity' => T::SALES]),
                T::col('cash_variance', 'money', 'فرق النقد', 'Cash variance', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('review_status', 'text', 'حالة المراجعة', 'Review status', ['sensitivity' => T::SALES]),
                T::col('counted_by', 'text', 'عدّه', 'Counted by', ['sensitivity' => T::SALES]), T::col('reviewed_by', 'text', 'راجعه', 'Reviewed by', ['sensitivity' => T::SALES]),
                T::col('reviewed_at', 'datetime', 'وقت المراجعة', 'Reviewed at', ['sensitivity' => T::SALES]),
                T::col('collection_difference', 'money', 'فرق التحصيل مقابل العدادات', 'Collection vs meters', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('collection_review_required', 'int', 'مراجعة مطلوبة (1/0)', 'Review required (1/0)', ['sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
            'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated'],
            'notes' => [['ar' => 'فروق النقد تعتمد على المبيعات فتتطلب صلاحية عرض المبيعات.', 'en' => 'Cash variances derive from sales and require the sales-view permission.'], ...$this->capNote($loaded['truncated'])],
        ];
    }

    // ───────── B8 سجل التعديلات والتصحيحات ─────────

    /** @return array<string,mixed> */
    private function corrections(FuelReportContext $context): array
    {
        [$start, $end] = $context->utcEnvelope();
        $query = FuelShiftCorrection::query()->with(['shift:id,number,fuel_station_id', 'requester:id,name', 'reviewer:id,name'])
            ->whereHas('shift', fn ($s) => $context->scoped($s))
            ->where('requested_at', '>=', $start)->where('requested_at', '<', $end);
        if ($context->filter('status') !== null) {
            $query->where('status', $context->filter('status'));
        }
        $all = $query->orderBy('requested_at')->orderBy('id')->limit(1001)->get();
        $truncated = $all->count() > 1000;

        $canSeeSales = $context->user->hasPermission('fuel.sale.view');
        $rows = $all->take(1000)->filter(fn (FuelShiftCorrection $c) => $context->inPeriod($c->requested_at, (string) $c->shift?->fuel_station_id))
            ->map(fn (FuelShiftCorrection $c) => [
                'shift' => $c->shift?->number, 'station' => $context->stationName((string) $c->shift?->fuel_station_id), 'target' => $c->target_type, 'status' => $c->status,
                'reason' => mb_substr((string) $c->reason, 0, self::TEXT_LIMIT), 'before' => $this->snapshotText($c->before, $canSeeSales),
                'proposed' => $this->snapshotText($c->proposed, $canSeeSales),
                'requested_by' => $c->requester?->name, 'requested_at' => $c->requested_at?->toIso8601String(),
                'reviewed_by' => $c->reviewer?->name, 'reviewed_at' => $c->reviewed_at?->toIso8601String(),
            ])->values()->all();

        $counts = array_count_values(array_column($rows, 'status'));

        return [
            'summary' => [
                T::item('requests', 'طلبات التصحيح', 'Correction requests', 'int', count($rows)),
                T::item('requested', 'قيد الانتظار', 'Pending', 'int', $counts['requested'] ?? 0),
                T::item('approved', 'معتمدة', 'Approved', 'int', $counts['approved'] ?? 0),
                T::item('rejected', 'مرفوضة', 'Rejected', 'int', $counts['rejected'] ?? 0),
            ],
            'tables' => [T::table('corrections', 'سجل التصحيحات', 'Corrections log', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('target', 'text', 'الهدف', 'Target'),
                T::col('status', 'text', 'الحالة', 'Status'), T::col('reason', 'text', 'السبب', 'Reason'),
                T::col('before', 'text', 'قبل', 'Before'), T::col('proposed', 'text', 'المقترح', 'Proposed'),
                T::col('requested_by', 'text', 'طلبه', 'Requested by'), T::col('requested_at', 'datetime', 'وقت الطلب', 'Requested at'),
                T::col('reviewed_by', 'text', 'راجعه', 'Reviewed by'), T::col('reviewed_at', 'datetime', 'وقت المراجعة', 'Reviewed at'),
            ], $rows)],
            'truncated' => $truncated,
            'notes' => $truncated ? [['ar' => 'تجاوز عدد الطلبات 1000؛ ضيّق الفترة.', 'en' => 'More than 1000 requests; narrow the period.']] : [],
        ];
    }

    /** مفاتيح لقطة التصحيح المشتقة من المبيعات (نفس قائمة `FuelShiftResource`): تُحجب عمّن لا يملك `fuel.sale.view` (D8). */
    private const SALE_DERIVED_KEYS = ['expected_operational_cash_minor', 'cash_variance_minor', 'variance_minor', 'direction', 'variance_direction', 'expected_cash_minor'];

    /** @param array<string,mixed>|null $snapshot */
    private function snapshotText(?array $snapshot, bool $canSeeSales): string
    {
        if (! $canSeeSales && $snapshot !== null) {
            $snapshot = $this->withoutSaleKeys($snapshot);
        }

        return mb_substr((string) json_encode($snapshot, JSON_UNESCAPED_UNICODE), 0, self::TEXT_LIMIT);
    }

    /** @param array<mixed> $data @return array<mixed> */
    private function withoutSaleKeys(array $data): array
    {
        foreach ($data as $key => $value) {
            if (is_string($key) && in_array($key, self::SALE_DERIVED_KEYS, true)) {
                unset($data[$key]);
            } elseif (is_array($value)) {
                $data[$key] = $this->withoutSaleKeys($value);
            }
        }

        return $data;
    }
}
