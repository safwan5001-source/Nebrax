<?php

namespace App\Services\Reporting;

use App\Models\FuelDelivery;
use App\Models\FuelDeliveryAttachment;
use App\Models\FuelOperationalLedger;
use App\Models\FuelReconciliation;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Models\User;
use App\Services\FuelTankBookBalanceReader;
use App\Services\FuelTankLevelMonitor;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;
use Carbon\CarbonImmutable;

/**
 * عائلة الخزانات والمخزون (E). المصادر: قراءات الخزانات (`FuelTankReading`) عبر `FuelTankLevelMonitor` (المصدر الوحيد لحالة المستوى)، رصيد المخزن الدفتري
 * (`FuelTankBookBalanceReader`)، استلامات الوقود، الدفتر التشغيلي (`FuelOperationalLedger`)، وسجلات الجرد (`FuelReconciliation`). قراءة فقط.
 * التكلفة والقيمة حسّاستان `cost` (`products.view_cost`). «الاستهلاك حسب المنتج» مرادف لمبيعات المنتج (لترات العدادات) بلا منطق مكرَّر.
 *
 * الرصيد النظري = افتتاح فعلي + استلامات معتمدة − لترات مبيعات العدادات للفترة؛ **تقدير إرشادي** لأن نوافذ الورديات لا تطابق لحظات القياس تماماً.
 */
final class FuelInventoryReportBuilder implements FuelReportBuilder
{
    private const ROW_CAP = 2000;
    private const TANK_CAP = 100;

    public function __construct(
        private FuelTankLevelMonitor $monitor,
        private FuelTankBookBalanceReader $book,
        private FuelShiftReportBuilder $shifts,
        private FuelSalesReportBuilder $sales,
    ) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        return match ($definition->key) {
            'inventory.tank_balances' => $this->balances($context),
            'inventory.opening_closing' => $this->tankPeriod($context, false),
            'inventory.theoretical_vs_actual' => $this->tankPeriod($context, true),
            'inventory.receipts' => $this->receipts($context, false),
            'inventory.supply_tracking' => $this->receipts($context, true),
            'inventory.movements' => $this->movements($context),
            'inventory.consumption' => $this->sales->build($definition->withKey('sales.by_product'), $context),
            'inventory.stocktake' => $this->reconciliations($context, 'all'),
            'inventory.variances' => $this->reconciliations($context, 'variances'),
            'inventory.adjustments' => $this->reconciliations($context, 'adjustments'),
        };
    }

    // ───────── E1 أرصدة الخزانات (الحالة الراهنة) ─────────

    /** @return array<string,mixed> */
    private function balances(FuelReportContext $context): array
    {
        $tanks = $context->scoped(FuelTank::query());
        if ($context->filter('product_id') !== null) {
            $tanks->where('fuel_product_id', $context->filter('product_id'));
        }
        $snapshot = $this->monitor->snapshot($tanks->limit(self::TANK_CAP + 1), $context->user);
        $truncated = count($snapshot) > self::TANK_CAP;
        $snapshot = array_slice($snapshot, 0, self::TANK_CAP);
        $models = $context->scoped(FuelTank::query())->whereIn('id', array_column(array_column($snapshot, 'tank'), 'id'))->get();
        $book = $this->book->forTanks($models);

        $rows = array_map(function (array $s) use ($book) {
            $latest = $s['latest'];
            $qty = $latest['quantity_milliliters'] ?? null;
            $bookMl = $book[$s['tank']['id']]['book_level']['milliliters'] ?? null;

            return [
                'station' => $s['station']['name'], 'tank' => $s['tank']['name'], 'product' => $s['fuel_product']['name'],
                'capacity' => $s['tank']['capacity_milliliters'], 'quantity' => $qty, 'reading_type' => $latest['reading_type'] ?? null, 'measured_at' => $latest['measured_at'] ?? null,
                'fill_bp' => $s['level']['fill_basis_points'], 'freshness' => $s['level']['freshness'], 'flags' => implode('، ', $s['level']['flags']),
                'book' => $bookMl, 'book_difference' => ($qty !== null && $bookMl !== null) ? $qty - $bookMl : null,
            ];
        }, $snapshot);
        $noReading = count(array_filter($rows, fn ($r) => $r['quantity'] === null));

        return [
            'summary' => [
                T::item('tanks', 'عدد الخزانات', 'Tanks', 'int', count($rows)),
                T::item('quantity', 'إجمالي آخر قراءة', 'Total of latest readings', 'liters', $noReading > 0 ? null : array_sum(array_column($rows, 'quantity'))),
                T::item('review', 'خزانات تحتاج مراجعة', 'Tanks needing review', 'int', count(array_filter($rows, fn ($r) => $r['flags'] !== ''))),
                T::item('no_reading', 'بلا قراءة', 'No reading', 'int', $noReading),
            ],
            'tables' => [T::table('balances', 'أرصدة الخزانات', 'Tank balances', [
                T::col('station', 'text', 'المحطة', 'Station'), T::col('tank', 'text', 'الخزان', 'Tank'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('capacity', 'liters', 'السعة', 'Capacity'), T::col('quantity', 'liters', 'آخر قراءة', 'Latest reading', ['total' => 'sum']),
                T::col('reading_type', 'status', 'نوع القراءة', 'Type', ['values' => ['physical' => ['ar' => 'يدوية', 'en' => 'Physical'], 'atg' => ['ar' => 'ATG', 'en' => 'ATG']]]),
                T::col('measured_at', 'datetime', 'وقت القياس', 'Measured at'), T::col('fill_bp', 'bp', 'الامتلاء', 'Fill'),
                T::col('freshness', 'text', 'الحداثة', 'Freshness'), T::col('flags', 'text', 'تنبيهات', 'Flags'),
                T::col('book', 'liters', 'الرصيد الدفتري', 'Book balance'), T::col('book_difference', 'liters', 'قراءة − دفتري', 'Reading − book'),
            ], $rows)],
            'period' => false, 'truncated' => $truncated,
            'gaps' => $noReading > 0 ? ['tank_reading_missing'] : [],
            'notes' => [...($truncated ? [['ar' => 'تجاوز عدد الخزانات '.self::TANK_CAP.'؛ ضيّق بالمحطة أو المنتج.', 'en' => 'Tank count exceeds '.self::TANK_CAP.'; narrow by station or product.']] : []), ['ar' => 'الرصيد الدفتري يظهر للخزان الوحيد المغذّي لمجمّع المخزن فقط؛ وإلا يبقى فارغاً (لا نسبة تخمينية).', 'en' => 'The book balance is shown only for a tank that is the sole feeder of its warehouse pool; otherwise it stays empty (no guessed split).']],
        ];
    }

    // ───────── E2/E10 افتتاح/ختام ومقارنة نظري/فعلي ─────────

    /** @return array<string,mixed> */
    private function tankPeriod(FuelReportContext $context, bool $theoretical): array
    {
        [$from, $to] = $context->period();
        $tanks = $context->scoped(FuelTank::query())->with(['station', 'fuelProduct']);
        if ($context->filter('product_id') !== null) {
            $tanks->where('fuel_product_id', $context->filter('product_id'));
        }
        $tanks = $tanks->orderBy('code')->limit(self::TANK_CAP + 1)->get();
        $truncated = $tanks->count() > self::TANK_CAP;
        $tanks = $tanks->take(self::TANK_CAP);

        $soldByTank = $theoretical ? $this->soldByTank($context) : ['liters' => [], 'unknown' => [], 'gaps' => [], 'truncated' => false];
        $rows = [];
        $missing = false;
        foreach ($tanks as $tank) {
            $tz = $context->timezone((string) $tank->fuel_station_id);
            $start = CarbonImmutable::parse($from, $tz)->startOfDay()->utc();
            $end = CarbonImmutable::parse($to, $tz)->addDay()->startOfDay()->utc();
            $opening = $this->readingAt($tank->id, $start);
            $closing = $this->readingAt($tank->id, $end);
            $row = [
                'station' => $tank->station?->name, 'tank' => $tank->name, 'product' => $tank->fuelProduct?->name,
                'opening' => $opening?->quantity_milliliters === null ? null : (int) $opening->quantity_milliliters, 'opening_at' => $opening?->measured_at?->toIso8601String(),
                'closing' => $closing?->quantity_milliliters === null ? null : (int) $closing->quantity_milliliters, 'closing_at' => $closing?->measured_at?->toIso8601String(),
            ];
            $row['change'] = ($row['opening'] !== null && $row['closing'] !== null) ? $row['closing'] - $row['opening'] : null;
            if ($theoretical) {
                $received = (int) FuelDelivery::query()->where('fuel_tank_id', $tank->id)->where('status', FuelDelivery::STATUS_APPROVED)
                    ->where('received_at', '>=', $start)->where('received_at', '<', $end)->sum('received_milliliters');
                $sold = isset($soldByTank['unknown'][$tank->id]) ? null : (int) ($soldByTank['liters'][$tank->id] ?? 0);
                $expected = ($row['opening'] === null || $sold === null) ? null : $row['opening'] + $received - $sold;
                $row += ['received' => $received, 'sold' => $sold, 'theoretical' => $expected, 'difference' => ($expected === null || $row['closing'] === null) ? null : $row['closing'] - $expected];
            }
            $missing = $missing || $row['opening'] === null || $row['closing'] === null;
            $rows[] = $row;
        }

        $cols = [
            T::col('station', 'text', 'المحطة', 'Station'), T::col('tank', 'text', 'الخزان', 'Tank'), T::col('product', 'text', 'المنتج', 'Product'),
            T::col('opening', 'liters', 'الرصيد الافتتاحي', 'Opening', ['total' => 'sum']), T::col('opening_at', 'datetime', 'وقت قياسه', 'Measured at'),
            T::col('closing', 'liters', 'الرصيد الختامي', 'Closing', ['total' => 'sum']), T::col('closing_at', 'datetime', 'وقت قياسه', 'Measured at'),
            T::col('change', 'liters', 'التغير', 'Change', ['total' => 'sum']),
        ];
        if ($theoretical) {
            array_push($cols,
                T::col('received', 'liters', 'استلامات معتمدة', 'Approved receipts', ['total' => 'sum']),
                T::col('sold', 'liters', 'مبيعات العدادات', 'Meter sales', ['total' => 'sum']),
                T::col('theoretical', 'liters', 'الرصيد النظري', 'Theoretical', ['total' => 'sum']),
                T::col('difference', 'liters', 'الفرق (فعلي − نظري)', 'Difference (actual − theoretical)', ['total' => 'sum']),
            );
        }
        $title = $theoretical ? ['مقارنة الرصيد النظري والفعلي', 'Theoretical vs actual balance'] : ['الرصيد الافتتاحي والختامي', 'Opening and closing balance'];

        return [
            'summary' => [T::item('tanks', 'عدد الخزانات', 'Tanks', 'int', count($rows))],
            'tables' => [T::table($theoretical ? 'theoretical' : 'opening_closing', $title[0], $title[1], $cols, $rows)],
            'gaps' => array_values(array_unique([...($missing ? ['tank_reading_missing'] : []), ...$soldByTank['gaps'], ...($soldByTank['unknown'] !== [] ? [\App\Services\FuelShiftSalesCalculator::GAP_MISSING_READING] : [])])),
            'truncated' => $truncated || $soldByTank['truncated'],
            'notes' => [
                ['ar' => 'الافتتاح/الختام = آخر قراءة خزان (يدوية ثم ATG) حتى بداية/نهاية الفترة بتوقيت المحطة؛ غيابها يترك الخانة فارغة.', 'en' => 'Opening/closing = the latest tank reading (physical, then ATG) up to the period start/end in station time; a missing reading leaves the cell empty.'],
                ...($theoretical ? [['ar' => 'الرصيد النظري تقدير إرشادي: افتتاح + استلامات معتمدة − مبيعات عدادات الورديات؛ نوافذ الورديات لا تطابق لحظات القياس تماماً.', 'en' => 'The theoretical balance is indicative: opening + approved receipts − shift meter sales; shift windows do not exactly match measurement times.']] : []),
            ],
        ];
    }

    private function readingAt(string $tankId, CarbonImmutable $at): ?FuelTankReading
    {
        foreach ([FuelTankReading::TYPE_PHYSICAL, FuelTankReading::TYPE_ATG] as $type) {
            $reading = FuelTankReading::query()->where('fuel_tank_id', $tankId)->where('reading_type', $type)->where('measured_at', '<', $at)
                ->orderByDesc('measured_at')->orderByDesc('created_at')->first();
            if ($reading !== null) {
                return $reading;
            }
        }

        return null;
    }

    /** @return array{liters:array<string,int>,unknown:array<string,bool>,gaps:list<string>,truncated:bool} لترات العدادات لكل خزان (فوهاته) في الفترة. */
    private function soldByTank(FuelReportContext $context): array
    {
        $loaded = $this->shifts->nozzleRows($context);
        $tankOf = \App\Models\FuelNozzle::query()->whereIn('id', array_values(array_unique(array_column($loaded['rows'], 'nozzle_id'))))->pluck('fuel_tank_id', 'id')->all();
        $liters = [];
        $unknown = [];
        foreach ($loaded['rows'] as $r) {
            $tankId = $tankOf[$r['nozzle_id']] ?? null;
            if ($tankId === null) {
                continue;
            }
            if ($r['liters'] === null) {
                $unknown[$tankId] = true;      // استهلاك مجهول لفوهة ⇒ مبيعات الخزان كلها مجهولة (لا مجموع جزئي)
            } else {
                $liters[$tankId] = ($liters[$tankId] ?? 0) + $r['liters'];
            }
        }

        return ['liters' => $liters, 'unknown' => $unknown, 'gaps' => $loaded['gaps'], 'truncated' => $loaded['truncated']];
    }

    // ───────── E3/E9 الاستلامات وتتبع التوريدات ─────────

    /** @return array<string,mixed> */
    private function receipts(FuelReportContext $context, bool $tracking): array
    {
        $query = $context->scoped(FuelDelivery::query())->with(['station:id,name', 'tank:id,name', 'fuelProduct:id,name', 'supplier:id,name']);
        $context->constrainPeriod($query, 'received_at');
        if ($context->filter('status') === 'draft' || $context->filter('status') === 'approved') {
            $query->where('status', $context->filter('status'));
        }
        if ($context->filter('product_id') !== null) {
            $query->where('fuel_product_id', $context->filter('product_id'));
        }
        $deliveries = $query->orderBy('received_at')->orderBy('id')->limit(self::ROW_CAP + 1)->get();
        $truncated = $deliveries->count() > self::ROW_CAP;
        $deliveries = $deliveries->take(self::ROW_CAP);
        $attachments = $tracking && $deliveries->isNotEmpty() ? FuelDeliveryAttachment::query()->whereIn('fuel_delivery_id', $deliveries->pluck('id'))->selectRaw('fuel_delivery_id, COUNT(*) as n')->groupBy('fuel_delivery_id')->pluck('n', 'fuel_delivery_id') : collect();
        $now = CarbonImmutable::now();

        $rows = $deliveries->map(function (FuelDelivery $d) use ($tracking, $attachments, $now) {
            $variance = (int) $d->transit_variance_milliliters;
            $row = [
                'reference' => $d->reference(), 'received_at' => $d->received_at?->toIso8601String(), 'status' => $d->status, 'note' => $d->delivery_note_number,
                'station' => $d->station?->name, 'supplier' => $d->supplier?->name, 'product' => $d->fuelProduct?->name, 'tank' => $d->tank?->name,
                'dispatched' => (int) $d->dispatched_milliliters, 'received' => (int) $d->received_milliliters, 'variance' => $variance,
                'variance_bp' => (int) $d->dispatched_milliliters > 0 ? intdiv(abs($variance) * 20000 + (int) $d->dispatched_milliliters, 2 * (int) $d->dispatched_milliliters) * ($variance < 0 ? -1 : 1) : null,
                'cost' => $d->received_total_cost_minor === null ? null : (int) $d->received_total_cost_minor,
            ];
            if ($tracking) {
                $end = $d->approved_at ?? $now;
                $row += [
                    'approved_at' => $d->approved_at?->toIso8601String(), 'age_hours' => $d->received_at === null ? null : (int) intdiv($d->received_at->diffInMinutes($end), 60),
                    'cost_recorded' => $d->received_total_cost_minor === null ? 0 : 1, 'attachments' => (int) ($attachments[$d->id] ?? 0),
                    'tanker' => $d->tanker_identifier, 'driver' => $d->driver_name,
                ];
            }

            return $row;
        })->all();

        $cols = [
            T::col('reference', 'text', 'رقم الاستلام', 'Receipt'), T::col('received_at', 'datetime', 'الاستلام', 'Received'),
            T::col('status', 'status', 'الحالة', 'Status', ['values' => ['draft' => ['ar' => 'مسودة', 'en' => 'Draft'], 'approved' => ['ar' => 'معتمد', 'en' => 'Approved']]]),
            T::col('note', 'text', 'سند المورد', 'Supplier note'), T::col('station', 'text', 'المحطة', 'Station'), T::col('supplier', 'text', 'المورد', 'Supplier'),
            T::col('product', 'text', 'المنتج', 'Product'), T::col('tank', 'text', 'الخزان', 'Tank'),
            T::col('dispatched', 'liters', 'المرسل', 'Dispatched', ['total' => 'sum']), T::col('received', 'liters', 'المستلم', 'Received', ['total' => 'sum']),
            T::col('variance', 'liters', 'فرق النقل', 'Transit variance', ['total' => 'sum']), T::col('variance_bp', 'bp', 'نسبة الفرق', 'Variance %'),
        ];
        if ($tracking) {
            array_push($cols,
                T::col('approved_at', 'datetime', 'الاعتماد', 'Approved'), T::col('age_hours', 'int', 'العمر/مدة الاعتماد (ساعة)', 'Age / time to approve (h)'),
                T::col('cost_recorded', 'int', 'تكلفة مسجَّلة (1/0)', 'Cost recorded (1/0)', ['sensitivity' => T::COST]),
                T::col('attachments', 'int', 'مرفقات', 'Attachments'), T::col('tanker', 'text', 'الصهريج', 'Tanker'), T::col('driver', 'text', 'السائق', 'Driver'),
            );
        } else {
            $cols[] = T::col('cost', 'money', 'التكلفة', 'Cost', ['total' => 'sum', 'sensitivity' => T::COST]);
        }
        $pending = count(array_filter($rows, fn ($r) => $r['status'] === 'draft'));

        return [
            'summary' => [
                T::item('count', 'عدد الاستلامات', 'Receipts', 'int', count($rows)),
                T::item('received', 'المستلم', 'Received', 'liters', array_sum(array_column($rows, 'received'))),
                T::item('pending', 'مسودات غير معتمدة', 'Unapproved drafts', 'int', $pending),
            ],
            'tables' => [T::table($tracking ? 'tracking' : 'receipts', $tracking ? 'تتبع التوريدات' : 'استلام الوقود', $tracking ? 'Supply tracking' : 'Fuel receipts', $cols, $rows)],
            'truncated' => $truncated,
            'notes' => $truncated ? [['ar' => 'تجاوز 2000 استلام؛ ضيّق الفترة.', 'en' => 'More than 2000 receipts; narrow the period.']] : [],
        ];
    }

    // ───────── E4 حركة المخزون (الدفتر التشغيلي) ─────────

    /**
     * تكلفة اللتر من القيمة الرسمية والكمية (نصف لأعلى)؛ حقل التوافق unit_cost_minor بالمللتر ويفقد الدقة بـintdiv فلا يُستعمل.
     */
    private static function costPerLiter(?int $valueMinor, int $quantityMl): ?int
    {
        $q = abs($quantityMl);
        if ($valueMinor === null || $q === 0) {
            return null;
        }

        return intdiv(abs((int) $valueMinor) * 2000 + $q, 2 * $q);
    }

    /** @return array<string,mixed> */
    private function movements(FuelReportContext $context): array
    {
        $query = $context->scoped(FuelOperationalLedger::query());
        $context->constrainPeriod($query, 'occurred_at');
        if ($context->filter('product_id') !== null) {
            $query->where('fuel_product_id', $context->filter('product_id'));
        }
        $entries = $query->orderBy('occurred_at')->orderBy('id')->limit(self::ROW_CAP + 1)->get();
        $truncated = $entries->count() > self::ROW_CAP;
        $entries = $entries->take(self::ROW_CAP);
        $tanks = FuelTank::query()->whereIn('id', $entries->pluck('fuel_tank_id')->filter()->unique()->all())->pluck('name', 'id');
        $products = \App\Models\FuelProduct::query()->whereIn('id', $entries->pluck('fuel_product_id')->filter()->unique()->all())->pluck('name', 'id');

        $rows = $entries->map(fn (FuelOperationalLedger $e) => [
            'at' => $e->occurred_at?->toIso8601String(), 'station' => $context->stationName((string) $e->fuel_station_id), 'tank' => $tanks[$e->fuel_tank_id] ?? null,
            'product' => $products[$e->fuel_product_id] ?? null, 'type' => $e->movement_type, 'quantity' => (int) $e->quantity_milliliters,
            'book' => (int) $e->book_balance_milliliters, 'unit_cost' => self::costPerLiter($e->value_minor, (int) $e->quantity_milliliters), 'value' => $e->value_minor === null ? null : (int) $e->value_minor,
        ])->all();
        $types = [];
        foreach ([
            'opening' => ['افتتاحي', 'Opening'], 'delivery' => ['استلام', 'Delivery'], 'sale' => ['بيع', 'Sale'], 'transfer_in' => ['تحويل وارد', 'Transfer in'], 'transfer_out' => ['تحويل صادر', 'Transfer out'],
            'adjustment_gain' => ['تسوية زيادة', 'Adjustment gain'], 'adjustment_loss' => ['تسوية عجز', 'Adjustment loss'], 'evaporation' => ['تبخر', 'Evaporation'], 'stocktake' => ['جرد', 'Stocktake'],
            'reconciliation_matched' => ['مطابقة جرد', 'Reconciliation matched'],
        ] as $code => [$ar, $en]) {
            $types[$code] = ['ar' => $ar, 'en' => $en];
        }

        return [
            'summary' => [T::item('entries', 'عدد الحركات', 'Movements', 'int', count($rows))],
            'tables' => [T::table('movements', 'حركة المخزون', 'Inventory movements', [
                T::col('at', 'datetime', 'الوقت', 'Time'), T::col('station', 'text', 'المحطة', 'Station'), T::col('tank', 'text', 'الخزان', 'Tank'), T::col('product', 'text', 'المنتج', 'Product'),
                T::col('type', 'status', 'النوع', 'Type', ['values' => $types]), T::col('quantity', 'liters', 'الكمية', 'Quantity'), T::col('book', 'liters', 'الرصيد الدفتري بعدها', 'Book balance after'),
                T::col('unit_cost', 'money', 'تكلفة اللتر', 'Unit cost', ['sensitivity' => T::COST]), T::col('value', 'money', 'القيمة', 'Value', ['total' => 'sum', 'sensitivity' => T::COST]),
            ], $rows)],
            'truncated' => $truncated,
            'notes' => [
                ['ar' => 'الدفتر التشغيلي تفصيل تشغيلي؛ المرجع الرسمي لرصيد المخزن هو حركات المخزون المحاسبية.', 'en' => 'The operational ledger is operational detail; the official warehouse balance is the accounting stock movements.'],
                ...($truncated ? [['ar' => 'تجاوز 2000 حركة؛ ضيّق الفترة.', 'en' => 'More than 2000 movements; narrow the period.']] : []),
            ],
        ];
    }

    // ───────── E6/E7/E8 الجرد والفروق والتسويات ─────────

    /** @return array<string,mixed> */
    private function reconciliations(FuelReportContext $context, string $mode): array
    {
        $query = $context->scoped(FuelReconciliation::query())->with(['tank:id,name', 'station:id,name']);
        $context->constrainPeriod($query, 'created_at');
        if ($context->filter('product_id') !== null) {
            $query->where('fuel_product_id', $context->filter('product_id'));
        }
        if ($context->filter('status') === 'draft' || $context->filter('status') === 'approved') {
            $query->where('status', $context->filter('status'));
        }
        if ($mode === 'variances') {
            $query->whereNotNull('variance_milliliters')->where('variance_milliliters', '!=', 0);
        }
        if ($mode === 'adjustments') {
            $query->where('status', FuelReconciliation::STATUS_APPROVED)->whereNotNull('stock_movement_id');
        }
        $all = $query->orderBy('created_at')->orderBy('id')->limit(self::ROW_CAP + 1)->get();
        $truncated = $all->count() > self::ROW_CAP;
        $all = $all->take(self::ROW_CAP);
        $products = \App\Models\FuelProduct::query()->whereIn('id', $all->pluck('fuel_product_id')->unique()->all())->pluck('name', 'id');
        $names = User::query()->whereIn('id', $all->pluck('approved_by')->filter()->unique()->all())->pluck('name', 'id');

        $rows = $all->map(fn (FuelReconciliation $r) => [
            'created_at' => $r->created_at?->toIso8601String(), 'station' => $r->station?->name, 'tank' => $r->tank?->name, 'product' => $products[$r->fuel_product_id] ?? null,
            'status' => $r->status, 'opening' => (int) $r->opening_book_milliliters, 'deliveries' => (int) $r->deliveries_milliliters, 'sales' => (int) $r->sales_milliliters,
            'transfers' => (int) $r->transfers_milliliters, 'prior_adjustments' => (int) $r->prior_adjustments_milliliters, 'expected' => (int) $r->expected_closing_milliliters,
            'physical' => $r->physical_closing_milliliters === null ? null : (int) $r->physical_closing_milliliters, 'atg' => $r->atg_closing_milliliters === null ? null : (int) $r->atg_closing_milliliters,
            'variance' => $r->variance_milliliters === null ? null : (int) $r->variance_milliliters, 'variance_bp' => $r->variance_basis_points,
            'financial' => $r->financial_variance_minor === null ? null : (int) $r->financial_variance_minor,
            'requires_approval' => $r->requires_approval ? 1 : 0, 'approved_by' => $names[$r->approved_by] ?? null, 'approved_at' => $r->approved_at?->toIso8601String(),
            'adjusted' => $r->stock_movement_id === null ? 0 : 1, 'posted' => $r->journal_entry_id === null ? 0 : 1,
        ])->all();

        $base = [
            T::col('created_at', 'datetime', 'التاريخ', 'Date'), T::col('station', 'text', 'المحطة', 'Station'), T::col('tank', 'text', 'الخزان', 'Tank'), T::col('product', 'text', 'المنتج', 'Product'),
            T::col('status', 'status', 'الحالة', 'Status', ['values' => ['draft' => ['ar' => 'مسودة', 'en' => 'Draft'], 'approved' => ['ar' => 'معتمد', 'en' => 'Approved']]]),
        ];
        $full = [
            T::col('opening', 'liters', 'افتتاحي دفتري', 'Book opening'), T::col('deliveries', 'liters', 'استلامات', 'Deliveries', ['total' => 'sum']), T::col('sales', 'liters', 'مبيعات', 'Sales', ['total' => 'sum']),
            T::col('transfers', 'liters', 'تحويلات', 'Transfers', ['total' => 'sum']), T::col('prior_adjustments', 'liters', 'تسويات سابقة', 'Prior adjustments'),
            T::col('expected', 'liters', 'المتوقع', 'Expected'), T::col('physical', 'liters', 'الفعلي (يدوي)', 'Physical'), T::col('atg', 'liters', 'ATG', 'ATG'),
        ];
        $var = [T::col('variance', 'liters', 'الفرق', 'Variance', ['total' => 'sum']), T::col('variance_bp', 'bp', 'نسبة الفرق', 'Variance %'), T::col('financial', 'money', 'الأثر المالي', 'Financial effect', ['total' => 'sum', 'sensitivity' => T::COST])];
        $approval = [T::col('requires_approval', 'int', 'يتطلب اعتماداً (1/0)', 'Requires approval (1/0)'), T::col('approved_by', 'text', 'اعتمده', 'Approved by'), T::col('approved_at', 'datetime', 'وقت الاعتماد', 'Approved at')];
        [$cols, $ar, $en, $key] = match ($mode) {
            'variances' => [[...$base, ...$var, ...$approval], 'فروقات المخزون', 'Inventory variances', 'variances'],
            'adjustments' => [[...$base, ...$var, T::col('adjusted', 'int', 'حركة مخزون (1/0)', 'Stock movement (1/0)'), T::col('posted', 'int', 'قيد (1/0)', 'Journal (1/0)'), ...$approval], 'التسويات المخزنية', 'Stock adjustments', 'adjustments'],
            default => [[...$base, ...$full, ...$var, ...$approval], 'الجرد والمطابقة', 'Stocktake and reconciliation', 'stocktake'],
        };
        // مجهول واحد يجعل المجموع مجهولاً (لا صفر ولا مجموع جزئي).
        $sumOrNull = static function (string $key) use ($rows): ?int {
            $sum = 0;
            foreach ($rows as $r) {
                if ($r[$key] === null) {
                    return null;
                }
                $sum += (int) $r[$key];
            }

            return $sum;
        };
        $total = $sumOrNull('variance');

        return [
            'summary' => [
                T::item('count', 'عدد السجلات', 'Records', 'int', count($rows)),
                T::item('variance', 'مجموع الفروق', 'Total variance', 'liters', $total),
                T::item('financial', 'الأثر المالي', 'Financial effect', 'money', $sumOrNull('financial'), T::COST),
            ],
            'tables' => [T::table($key, $ar, $en, $cols, $rows)],
            'truncated' => $truncated,
            'notes' => [
                ['ar' => 'الأثر المالي يظهر لمن يملك صلاحية التكلفة فقط؛ لا تقدير مالي مخترع حين لا توجد تكلفة موثوقة.', 'en' => 'The financial effect is shown only to users with cost permission; no invented estimate when there is no reliable cost.'],
                ...($truncated ? [['ar' => 'تجاوز 2000 سجل؛ ضيّق الفترة.', 'en' => 'More than 2000 records; narrow the period.']] : []),
            ],
        ];
    }
}
