<?php

namespace App\Support;

use App\Models\User;
use App\Services\Reporting\FuelCollectionReportBuilder;
use App\Services\Reporting\FuelFinancialReportBuilder;
use App\Services\Reporting\FuelInventoryReportBuilder;
use App\Services\Reporting\FuelManagementReportBuilder;
use App\Services\Reporting\FuelPumpReportBuilder;
use App\Services\Reporting\FuelSalesReportBuilder;
use App\Services\Reporting\FuelShiftReportBuilder;

/**
 * سجل تقارير الوقود الوحيد: كل تقرير مُعلَن هنا يُنفَّذ فعلاً في بانيه وله اختبار (لا إدخال «قريباً» ولا تقرير وهمي).
 * يستهلكه تطبيق المحطة ووحدة أَوْج بالمسارات نفسها، فلا تختلف النتائج بين الواجهتين.
 */
final class FuelReportCatalog
{
    public const FAMILIES = [
        'sales' => ['ar' => 'المبيعات', 'en' => 'Sales'],
        'shifts' => ['ar' => 'الورديات', 'en' => 'Shifts'],
        'collection' => ['ar' => 'التحصيل', 'en' => 'Collection'],
        'pumps' => ['ar' => 'المضخات والفوهات', 'en' => 'Pumps & nozzles'],
        'inventory' => ['ar' => 'الخزانات والمخزون', 'en' => 'Tanks & inventory'],
        'financial' => ['ar' => 'المالية والمحاسبية', 'en' => 'Financial'],
        'management' => ['ar' => 'الإدارية والتحليلية', 'en' => 'Management'],
    ];

    /** صلاحيات الاطلاع الدنيا لعائلة المبيعات/الورديات: كميات الوردية. المبالغ تتطلب `fuel.sale.view` (تُحذف من الحمولة). */
    private const SHIFT_VIEW = ['fuel.shift.view', 'fuel.sale.view'];

    /** @var list<FuelReportDefinition>|null */
    private static ?array $all = null;

    /** @return list<FuelReportDefinition> */
    public static function all(): array
    {
        return self::$all ??= array_merge(self::sales(), self::shifts(), self::collection(), self::pumps(), self::inventory(), self::financial(), self::management());
    }

    /**
     * اتحاد صلاحيات كل التقارير: بوابة المسار الخشنة (يكفي واحدة)، والتفويض الدقيق لكل تقرير يفرضه المحرك (`allows`).
     *
     * @return list<string>
     */
    public static function routePermissions(): array
    {
        return array_values(array_unique(array_merge(...array_map(fn (FuelReportDefinition $d) => $d->permissionsAny, self::all()))));
    }

    public static function find(string $key): ?FuelReportDefinition
    {
        foreach (self::all() as $definition) {
            if ($definition->key === $key) {
                return $definition;
            }
        }

        return null;
    }

    public static function allows(User $user, FuelReportDefinition $definition): bool
    {
        foreach ($definition->permissionsAny as $permission) {
            if ($user->hasPermission($permission)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<FuelReportDefinition> التقارير المسموحة لهذا المستخدم فقط. */
    public static function visibleTo(User $user): array
    {
        return array_values(array_filter(self::all(), fn (FuelReportDefinition $d) => self::allows($user, $d)));
    }

    /** @return list<FuelReportDefinition> */
    private static function sales(): array
    {
        $b = FuelSalesReportBuilder::class;
        $common = ['station_id', 'from', 'to', 'product_id', 'status', 'date_basis'];
        $meter = FuelReportDefinition::SOURCE_METER;

        return [
            new FuelReportDefinition('sales.daily', 'sales', ['ar' => 'المبيعات اليومية', 'en' => 'Daily sales'], ['ar' => 'لترات وقيمة مبيعات كل يوم وكل محطة من عدادات الورديات.', 'en' => 'Liters and sales value per day and station, from shift meter readings.'], self::SHIFT_VIEW, $common, $b, $meter),
            new FuelReportDefinition('sales.period', 'sales', ['ar' => 'المبيعات حسب الفترة', 'en' => 'Sales by period'], ['ar' => 'تجميع المبيعات يومياً أو أسبوعياً أو شهرياً.', 'en' => 'Sales grouped by day, week or month.'], self::SHIFT_VIEW, [...$common, 'group'], $b, $meter),
            new FuelReportDefinition('sales.by_shift', 'sales', ['ar' => 'المبيعات حسب الوردية', 'en' => 'Sales by shift'], ['ar' => 'مبيعات كل وردية.', 'en' => 'Sales for each shift.'], self::SHIFT_VIEW, [...$common, 'user_id'], $b, $meter),
            new FuelReportDefinition('sales.by_product', 'sales', ['ar' => 'المبيعات حسب المنتج', 'en' => 'Sales by product'], ['ar' => 'لترات وقيمة كل منتج وقود ومتوسط سعره وحصته.', 'en' => 'Liters and value per fuel product, average price and share.'], self::SHIFT_VIEW, $common, $b, $meter),
            new FuelReportDefinition('sales.by_pump', 'sales', ['ar' => 'المبيعات حسب المضخة', 'en' => 'Sales by pump'], ['ar' => 'مبيعات كل مضخة.', 'en' => 'Sales for each pump.'], self::SHIFT_VIEW, [...$common, 'pump_id'], $b, $meter),
            new FuelReportDefinition('sales.by_nozzle', 'sales', ['ar' => 'المبيعات حسب الفوهة', 'en' => 'Sales by nozzle'], ['ar' => 'مبيعات كل فوهة.', 'en' => 'Sales for each nozzle.'], self::SHIFT_VIEW, [...$common, 'pump_id', 'nozzle_id'], $b, $meter),
            new FuelReportDefinition('sales.by_employee', 'sales', ['ar' => 'المبيعات حسب الموظف', 'en' => 'Sales by employee'], ['ar' => 'ورديات كل موظف: المنفرد منها والمشترك منفصلان (لا يُقسَّم مبلغ وردية مشتركة بالتخمين).', 'en' => 'Shifts per employee: sole and shared shifts are kept apart (shared shift totals are never split by guess).'], self::SHIFT_VIEW, [...$common, 'user_id'], $b, $meter),
            new FuelReportDefinition('sales.by_station', 'sales', ['ar' => 'المبيعات حسب المحطة', 'en' => 'Sales by station'], ['ar' => 'مبيعات كل محطة.', 'en' => 'Sales for each station.'], self::SHIFT_VIEW, $common, $b, $meter),
            new FuelReportDefinition('sales.comparison', 'sales', ['ar' => 'مقارنة المبيعات بين الفترات', 'en' => 'Sales period comparison'], ['ar' => 'فترة مقابل فترة (الافتراضي: الفترة السابقة بالطول نفسه).', 'en' => 'One period against another (default: the preceding period of equal length).'], self::SHIFT_VIEW, [...$common, 'compare_from', 'compare_to', 'dimension'], $b, $meter),
            new FuelReportDefinition('sales.consolidated', 'sales', ['ar' => 'التقرير المجمّع للمبيعات', 'en' => 'Consolidated sales'], ['ar' => 'مصفوفة المحطات × المنتجات.', 'en' => 'Stations × products matrix.'], self::SHIFT_VIEW, $common, $b, $meter),
        ];
    }

    /** @return list<FuelReportDefinition> */
    private static function shifts(): array
    {
        $b = FuelShiftReportBuilder::class;
        $ops = FuelReportDefinition::SOURCE_OPERATIONS;
        $list = ['station_id', 'from', 'to', 'status', 'date_basis', 'user_id'];

        return [
            new FuelReportDefinition('shifts.log', 'shifts', ['ar' => 'سجل الورديات', 'en' => 'Shift log'], ['ar' => 'كل الورديات في الفترة بحالتها ومدتها ومن فتحها وأغلقها.', 'en' => 'Every shift in the period with status, duration and who opened/closed it.'], ['fuel.shift.view'], $list, $b, $ops),
            new FuelReportDefinition('shifts.detail', 'shifts', ['ar' => 'تقرير الوردية التفصيلي', 'en' => 'Shift detail'], ['ar' => 'قراءات الفوهات والمنتجات والطاقم والنقد والخزانات لوردية واحدة.', 'en' => 'Nozzle readings, products, staff, cash and tanks for one shift.'], ['fuel.shift.view'], ['shift_id'], $b, $ops, 'portrait', true),
            new FuelReportDefinition('shifts.readings', 'shifts', ['ar' => 'قراءات بداية ونهاية الوردية', 'en' => 'Shift opening & closing readings'], ['ar' => 'قراءات العدادات عند الفتح والإغلاق لكل فوهة.', 'en' => 'Meter readings at open and close per nozzle.'], ['fuel.shift.view'], [...$list, 'shift_id', 'pump_id', 'nozzle_id', 'product_id'], $b, $ops, 'landscape', true),
            new FuelReportDefinition('shifts.handover', 'shifts', ['ar' => 'تقرير تسليم واستلام الوردية', 'en' => 'Shift handover'], ['ar' => 'تسليمات الدرج للخزنة ومن استلمها.', 'en' => 'Drawer handovers to treasury and who received them.'], ['fuel.shift.view'], $list, $b, $ops, 'landscape', true),
            new FuelReportDefinition('shifts.closing', 'shifts', ['ar' => 'تقرير إقفال الوردية', 'en' => 'Shift closing'], ['ar' => 'نقد الإقفال والمعدود وفرق الخزان لكل وردية مغلقة.', 'en' => 'Closing cash, counted cash and tank variance per closed shift.'], ['fuel.shift.view'], $list, $b, $ops, 'landscape', true),
            new FuelReportDefinition('shifts.open_overdue', 'shifts', ['ar' => 'الورديات المفتوحة والمتأخرة', 'en' => 'Open & overdue shifts'], ['ar' => 'ورديات ما زالت مفتوحة وعمرها؛ تُعلَّم المتأخرة بعد الحد المحدد.', 'en' => 'Shifts still open and their age; those beyond the threshold are flagged.'], ['fuel.shift.view'], ['station_id', 'overdue_hours'], $b, $ops),
            new FuelReportDefinition('shifts.variances', 'shifts', ['ar' => 'فروقات الوردية', 'en' => 'Shift variances'], ['ar' => 'عجز وزيادة النقد وحالة مراجعتها.', 'en' => 'Cash shortages/overages and their review status.'], ['fuel.shift.view'], $list, $b, $ops),
            new FuelReportDefinition('shifts.corrections', 'shifts', ['ar' => 'سجل التعديلات والتصحيحات', 'en' => 'Corrections log'], ['ar' => 'طلبات تصحيح القراءات والنقد وقراراتها.', 'en' => 'Reading and cash correction requests and their decisions.'], ['fuel.shift.view'], ['station_id', 'from', 'to', 'status'], $b, $ops),
        ];
    }

    /** @return list<FuelReportDefinition> */
    private static function collection(): array
    {
        $b = FuelCollectionReportBuilder::class;
        $ops = FuelReportDefinition::SOURCE_OPERATIONS;
        $filters = ['station_id', 'from', 'to', 'status', 'date_basis'];

        return [
            new FuelReportDefinition('collection.cash', 'collection', ['ar' => 'التحصيل النقدي', 'en' => 'Cash collection'], ['ar' => 'النقد المُقَرّ به لكل وردية من إقرار التحصيل.', 'en' => 'Declared cash per shift from the collection declaration.'], self::SHIFT_VIEW, $filters, $b, $ops),
            new FuelReportDefinition('collection.network', 'collection', ['ar' => 'تحصيل الشبكة', 'en' => 'Network collection'], ['ar' => 'مبالغ الشبكة/البنك المُقَرّ بها لكل وردية.', 'en' => 'Declared network/bank amounts per shift.'], self::SHIFT_VIEW, $filters, $b, $ops),
            new FuelReportDefinition('collection.deferred', 'collection', ['ar' => 'المبيعات الآجلة', 'en' => 'Deferred sales'], ['ar' => 'مبيعات نهائية غير مسدَّدة والمتبقي لكل عميل (ليست تحصيلاً).', 'en' => 'Unsettled finalized sales and the outstanding per customer (not collection).'], ['fuel.sale.view'], ['station_id', 'from', 'to'], $b, FuelReportDefinition::SOURCE_FORMAL),
            new FuelReportDefinition('collection.by_method', 'collection', ['ar' => 'التحصيل حسب طريقة الدفع', 'en' => 'Collection by payment method'], ['ar' => 'مجموع المُقَرّ به لكل طريقة دفع وحصتها.', 'en' => 'Declared total per payment method and its share.'], self::SHIFT_VIEW, $filters, $b, $ops),
            new FuelReportDefinition('collection.by_employee', 'collection', ['ar' => 'التحصيل حسب الموظف', 'en' => 'Collection by employee'], ['ar' => 'ما أقرّ به كل موظف عبر ورديات الفترة.', 'en' => 'What each employee declared across the period.'], self::SHIFT_VIEW, $filters, $b, $ops),
            new FuelReportDefinition('collection.variances', 'collection', ['ar' => 'العجز والزيادة', 'en' => 'Shortages & overages'], ['ar' => 'فروق النقد والتحصيل مقابل العدادات مع إجماليات العجز والزيادة.', 'en' => 'Cash and collection-vs-meter differences with shortage/overage totals.'], self::SHIFT_VIEW, $filters, $b, $ops),
            new FuelReportDefinition('collection.reconciliation', 'collection', ['ar' => 'مطابقة المبيعات والتحصيل', 'en' => 'Sales vs collection'], ['ar' => 'مبيعات العدادات مقابل المُقَرّ به لكل وردية.', 'en' => 'Meter sales against declared collection per shift.'], self::SHIFT_VIEW, $filters, $b, $ops),
            new FuelReportDefinition('collection.handover', 'collection', ['ar' => 'تسليم النقد', 'en' => 'Cash handover'], ['ar' => 'تسليمات الدرج للخزنة ومن استلمها.', 'en' => 'Drawer handovers to treasury and who received them.'], ['fuel.shift.view'], ['station_id', 'from', 'to', 'status', 'date_basis', 'user_id'], $b, $ops, 'landscape', true),
        ];
    }

    /** @return list<FuelReportDefinition> */
    private static function pumps(): array
    {
        $b = FuelPumpReportBuilder::class;
        $ops = FuelReportDefinition::SOURCE_OPERATIONS;
        $eq = ['station_id', 'from', 'to', 'status', 'date_basis', 'pump_id', 'nozzle_id', 'product_id'];

        return [
            new FuelReportDefinition('pumps.readings', 'pumps', ['ar' => 'قراءات العدادات', 'en' => 'Meter readings'], ['ar' => 'قراءات الافتتاح والإغلاق لكل فوهة في كل وردية.', 'en' => 'Opening and closing readings per nozzle per shift.'], ['fuel.shift.view'], [...$eq, 'shift_id'], $b, $ops),
            new FuelReportDefinition('pumps.nozzle_consumption', 'pumps', ['ar' => 'استهلاك كل فوهة', 'en' => 'Nozzle consumption'], ['ar' => 'لترات (وقيمة) كل فوهة في الفترة.', 'en' => 'Liters (and value) per nozzle in the period.'], self::SHIFT_VIEW, $eq, $b, FuelReportDefinition::SOURCE_METER),
            new FuelReportDefinition('pumps.pump_sales', 'pumps', ['ar' => 'مبيعات كل مضخة', 'en' => 'Pump sales'], ['ar' => 'لترات وقيمة كل مضخة.', 'en' => 'Liters and value per pump.'], self::SHIFT_VIEW, $eq, $b, FuelReportDefinition::SOURCE_METER),
            new FuelReportDefinition('pumps.meter_vs_sales', 'pumps', ['ar' => 'مقارنة القراءات بالمبيعات', 'en' => 'Meters vs sales'], ['ar' => 'لتر العداد مقابل المبيعات الرسمية لكل فوهة ووردية.', 'en' => 'Meter liters against formal sales per nozzle and shift.'], ['fuel.sale.view'], $eq, $b, FuelReportDefinition::SOURCE_FORMAL),
            new FuelReportDefinition('pumps.differences', 'pumps', ['ar' => 'فروقات العدادات', 'en' => 'Meter differences'], ['ar' => 'انقطاعات استمرارية العداد بين وردية وسابقتها.', 'en' => 'Meter continuity breaks between a shift and its predecessor.'], ['fuel.shift.view'], $eq, $b, $ops),
            new FuelReportDefinition('pumps.resets', 'pumps', ['ar' => 'إعادة ضبط العدادات وتغيير الارتباطات', 'en' => 'Meter resets & re-linking'], ['ar' => 'تغييرات إعداد المضخات والفوهات من سجل التدقيق.', 'en' => 'Pump and nozzle configuration changes from the audit trail.'], ['fuel_stations.manage'], ['station_id', 'from', 'to', 'pump_id', 'nozzle_id'], $b, $ops),
            new FuelReportDefinition('pumps.anomalies', 'pumps', ['ar' => 'القراءات والحركات غير الطبيعية', 'en' => 'Abnormal readings & movements'], ['ar' => 'قراءات ناقصة، إغلاق أقل من الافتتاح، فوهات بلا حركة.', 'en' => 'Missing readings, closing below opening, idle nozzles.'], ['fuel.shift.view'], $eq, $b, $ops),
        ];
    }

    /** @return list<FuelReportDefinition> */
    private static function inventory(): array
    {
        $b = FuelInventoryReportBuilder::class;
        $ops = FuelReportDefinition::SOURCE_OPERATIONS;
        $period = ['station_id', 'from', 'to', 'product_id'];
        $reading = ['fuel_stations.view', 'fuel.reading.view'];
        $recon = ['fuel.reconciliation.view'];
        $delivery = ['fuel.delivery.view', 'fuel_stations.manage'];

        return [
            new FuelReportDefinition('inventory.tank_balances', 'inventory', ['ar' => 'أرصدة الخزانات', 'en' => 'Tank balances'], ['ar' => 'آخر قراءة لكل خزان ونسبة الامتلاء والحداثة والرصيد الدفتري.', 'en' => 'Latest reading per tank, fill, freshness and book balance.'], $reading, ['station_id', 'product_id'], $b, $ops, 'landscape', true),
            new FuelReportDefinition('inventory.opening_closing', 'inventory', ['ar' => 'الرصيد الافتتاحي والختامي', 'en' => 'Opening & closing balance'], ['ar' => 'قراءة كل خزان عند بداية الفترة ونهايتها.', 'en' => 'Each tank reading at the start and end of the period.'], $reading, $period, $b, $ops),
            new FuelReportDefinition('inventory.receipts', 'inventory', ['ar' => 'استلام الوقود', 'en' => 'Fuel receipts'], ['ar' => 'الاستلامات بالكميات وفرق النقل (والتكلفة لمن يملك صلاحيتها).', 'en' => 'Receipts with quantities and transit variance (and cost for those allowed).'], $delivery, [...$period, 'status'], $b, $ops),
            new FuelReportDefinition('inventory.movements', 'inventory', ['ar' => 'حركة المخزون', 'en' => 'Inventory movements'], ['ar' => 'الدفتر التشغيلي لحركات الخزانات.', 'en' => 'The operational ledger of tank movements.'], $recon, $period, $b, $ops),
            new FuelReportDefinition('inventory.consumption', 'inventory', ['ar' => 'الاستهلاك حسب المنتج', 'en' => 'Consumption by product'], ['ar' => 'اللترات المصروفة لكل منتج من عدادات الورديات.', 'en' => 'Liters dispensed per product from shift meters.'], self::SHIFT_VIEW, ['station_id', 'from', 'to', 'product_id', 'status', 'date_basis'], $b, FuelReportDefinition::SOURCE_METER),
            new FuelReportDefinition('inventory.stocktake', 'inventory', ['ar' => 'الجرد والمطابقة', 'en' => 'Stocktake & reconciliation'], ['ar' => 'سجلات المطابقة بين الدفتري والفعلي.', 'en' => 'Reconciliation records between book and physical.'], $recon, [...$period, 'status'], $b, $ops),
            new FuelReportDefinition('inventory.variances', 'inventory', ['ar' => 'فروقات المخزون', 'en' => 'Inventory variances'], ['ar' => 'سجلات الجرد ذات الفرق مع نسبته وأثره المالي.', 'en' => 'Stocktake records with a variance, its percentage and financial effect.'], $recon, [...$period, 'status'], $b, $ops),
            new FuelReportDefinition('inventory.adjustments', 'inventory', ['ar' => 'التسويات المخزنية', 'en' => 'Stock adjustments'], ['ar' => 'تسويات الجرد المعتمدة التي ولّدت حركة مخزون.', 'en' => 'Approved stocktake adjustments that produced a stock movement.'], $recon, $period, $b, $ops),
            new FuelReportDefinition('inventory.supply_tracking', 'inventory', ['ar' => 'تتبع التوريدات', 'en' => 'Supply tracking'], ['ar' => 'عمر كل استلام ومدة اعتماده والتكلفة والمرفقات.', 'en' => 'Age and approval time of each receipt, cost and attachments.'], $delivery, [...$period, 'status'], $b, $ops),
            new FuelReportDefinition('inventory.theoretical_vs_actual', 'inventory', ['ar' => 'مقارنة الرصيد النظري والفعلي', 'en' => 'Theoretical vs actual balance'], ['ar' => 'افتتاح + استلامات − مبيعات العدادات مقابل القراءة الختامية (إرشادي).', 'en' => 'Opening + receipts − meter sales against the closing reading (indicative).'], ['fuel.shift.view'], $period, $b, $ops),
        ];
    }

    /** @return list<FuelReportDefinition> */
    private static function financial(): array
    {
        $b = FuelFinancialReportBuilder::class;
        $formal = FuelReportDefinition::SOURCE_FORMAL;
        $perm = ['fuel.reports.view', 'fuel.sale.view'];
        $f = ['station_id', 'from', 'to', 'product_id'];

        return [
            new FuelReportDefinition('financial.revenue', 'financial', ['ar' => 'إيرادات المحطات', 'en' => 'Station revenue'], ['ar' => 'إجمالي وصافي وضريبة المبيعات النهائية لكل محطة.', 'en' => 'Gross, net and tax of finalized sales per station.'], $perm, $f, $b, $formal),
            new FuelReportDefinition('financial.vat', 'financial', ['ar' => 'ضريبة القيمة المضافة', 'en' => 'VAT'], ['ar' => 'الوعاء الضريبي والضريبة من الفواتير الرسمية.', 'en' => 'Taxable base and VAT from the official invoices.'], $perm, $f, $b, $formal),
            new FuelReportDefinition('financial.cogs', 'financial', ['ar' => 'تكلفة الوقود المباع', 'en' => 'Cost of fuel sold'], ['ar' => 'COGS الرسمي لكل منتج؛ «غير متاحة» حيث لا تكلفة موثوقة.', 'en' => 'Official COGS per product; unavailable where there is no reliable cost.'], $perm, $f, $b, $formal),
            new FuelReportDefinition('financial.gross_profit', 'financial', ['ar' => 'مجمل الربح', 'en' => 'Gross profit'], ['ar' => 'الإيراد الصافي − COGS الرسمي لكل منتج (لمن يملك صلاحيتَي المبيعات والتكلفة).', 'en' => 'Net revenue − official COGS per product (for those with both sales and cost permissions).'], $perm, $f, $b, $formal),
            new FuelReportDefinition('financial.payment_methods', 'financial', ['ar' => 'المبيعات حسب طريقة الدفع', 'en' => 'Sales by payment method'], ['ar' => 'المقبوض مقابل بيع الوقود لكل طريقة دفع.', 'en' => 'Amounts received against fuel sales per payment method.'], $perm, ['station_id', 'from', 'to'], $b, $formal),
            new FuelReportDefinition('financial.reconciliations', 'financial', ['ar' => 'المطابقات المالية', 'en' => 'Financial reconciliation'], ['ar' => 'مبيعات العدادات مقابل المبيعات الرسمية مقابل التحصيل لكل وردية.', 'en' => 'Meter sales vs official sales vs collection per shift.'], $perm, ['station_id', 'from', 'to', 'status', 'date_basis'], $b, FuelReportDefinition::SOURCE_OPERATIONS),
            new FuelReportDefinition('financial.accounting_links', 'financial', ['ar' => 'الارتباطات المحاسبية', 'en' => 'Accounting links'], ['ar' => 'ارتباط كل بيع نهائي بالفاتورة والقيود وحركة المخزون.', 'en' => 'The link of each finalized sale to invoice, entries and stock movement.'], $perm, $f, $b, $formal),
            new FuelReportDefinition('financial.exceptions', 'financial', ['ar' => 'الفروقات والاستثناءات', 'en' => 'Differences & exceptions'], ['ar' => 'مبيعات بلا فاتورة/تكلفة وفروق نقد وتحصيل بانتظار المراجعة.', 'en' => 'Sales without invoice/cost and cash/collection differences awaiting review.'], $perm, ['station_id', 'from', 'to', 'status', 'date_basis'], $b, $formal),
        ];
    }

    /** @return list<FuelReportDefinition> */
    private static function management(): array
    {
        $b = FuelManagementReportBuilder::class;
        $m = FuelReportDefinition::SOURCE_METER;
        $ops = FuelReportDefinition::SOURCE_OPERATIONS;
        $f = ['station_id', 'from', 'to', 'product_id', 'status', 'date_basis'];

        return [
            new FuelReportDefinition('management.dashboard', 'management', ['ar' => 'لوحة المؤشرات اليومية', 'en' => 'Daily dashboard'], ['ar' => 'مبيعات اليوم والورديات المفتوحة والخزانات وبنود المتابعة.', 'en' => "Today's sales, open shifts, tanks and follow-up items."], self::SHIFT_VIEW, $f, $b, $m),
            new FuelReportDefinition('management.weekly', 'management', ['ar' => 'التقرير الأسبوعي', 'en' => 'Weekly report'], ['ar' => 'مبيعات آخر 7 أيام يوماً بيوم.', 'en' => 'Sales for the last 7 days, day by day.'], self::SHIFT_VIEW, $f, $b, $m),
            new FuelReportDefinition('management.monthly', 'management', ['ar' => 'التقرير الشهري', 'en' => 'Monthly report'], ['ar' => 'مبيعات الشهر الحالي حتى اليوم.', 'en' => 'Sales for the current month to date.'], self::SHIFT_VIEW, $f, $b, $m),
            new FuelReportDefinition('management.station_comparison', 'management', ['ar' => 'مقارنة المحطات', 'en' => 'Station comparison'], ['ar' => 'لترات وقيمة كل محطة في الفترة.', 'en' => 'Liters and value per station in the period.'], self::SHIFT_VIEW, $f, $b, $m),
            new FuelReportDefinition('management.product_comparison', 'management', ['ar' => 'مقارنة المنتجات', 'en' => 'Product comparison'], ['ar' => 'لترات وقيمة وحصة كل منتج.', 'en' => 'Liters, value and share per product.'], self::SHIFT_VIEW, $f, $b, $m),
            new FuelReportDefinition('management.trends', 'management', ['ar' => 'اتجاهات المبيعات والتحصيل', 'en' => 'Sales & collection trends'], ['ar' => 'مبيعات العدادات المجمَّدة والمُقَرّ بتحصيله يوماً بيوم.', 'en' => 'Frozen meter sales and declared collection, day by day.'], self::SHIFT_VIEW, ['station_id', 'from', 'to', 'status', 'date_basis'], $b, $ops),
            new FuelReportDefinition('management.employee_performance', 'management', ['ar' => 'أداء الموظفين', 'en' => 'Employee performance'], ['ar' => 'ورديات ولترات وقيمة كل موظف (المنفرد والمشترك منفصلان).', 'en' => 'Shifts, liters and value per employee (sole and shared kept apart).'], self::SHIFT_VIEW, [...$f, 'user_id'], $b, $m),
            new FuelReportDefinition('management.exceptions', 'management', ['ar' => 'تقارير الاستثناءات', 'en' => 'Exceptions report'], ['ar' => 'ملخص البنود المعلّقة: ورديات متأخرة، مسودات، مراجعات.', 'en' => 'Summary of pending items: overdue shifts, drafts, reviews.'], self::SHIFT_VIEW, ['station_id'], $b, $ops),
            new FuelReportDefinition('management.day_close', 'management', ['ar' => 'التقرير الموحَّد لإقفال اليوم', 'en' => 'Unified day close'], ['ar' => 'ورديات اليوم ولتراته وتحصيله وتسليمه والوقود المستلم لكل محطة.', 'en' => "The day's shifts, liters, collection, handover and fuel received per station."], self::SHIFT_VIEW, ['station_id', 'from', 'to', 'status', 'date_basis'], $b, $ops, 'landscape', true),
        ];
    }
}
