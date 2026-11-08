<?php

namespace App\Services\Reporting;

use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftCollectionDeclaration;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable as T;

/**
 * العائلة المالية والمحاسبية (F): **قراءة فقط** من السجلات الرسمية — بيع الوقود النهائي (`FuelSale`) وفاتورته وإيصالات تحصيله وقيود COGS —
 * لا حساب مالي جديد ولا كتابة محاسبية. مصدرها `finalized_sales` (غير مبيعات العدادات التشغيلية) ما عدا المطابقة التي تقارن الثلاثة صراحةً.
 *
 * - الإيراد الصافي = `subtotal` الفاتورة (قبل الضريبة)؛ الإجمالي = `total` الفاتورة (شامل الضريبة)؛ الضريبة من الفاتورة نفسها (لا إعادة احتساب).
 * - **التكلفة والربح من COGS الرسمي فقط:** بيع بلا `cogs_minor` ⇒ «بيانات التكلفة غير متاحة» (`null`) ولا تقدير؛ الإجمالي `null` إن غاب أي سطر.
 * - المبالغ حسّاسة `sales`، والتكلفة والربح حسّاسان `cost` (`products.view_cost`) فتُحذف من الحمولة لغير المخوَّل.
 */
final class FuelFinancialReportBuilder implements FuelReportBuilder
{
    private const ROW_CAP = 5000;

    public function __construct(private FuelReportShiftFacts $facts) {}

    public function build(FuelReportDefinition $definition, FuelReportContext $context): array
    {
        return match ($definition->key) {
            'financial.reconciliations' => $this->reconciliations($context),
            'financial.payment_methods' => $this->paymentMethods($context),
            default => $this->bySales($definition->key, $context),
        };
    }

    /** @return array{sales:\Illuminate\Support\Collection<int,FuelSale>,truncated:bool} */
    private function sales(FuelReportContext $context): array
    {
        $query = $context->scoped(FuelSale::query()->with(['invoice:id,number,status,subtotal,tax_amount,total,journal_entry_id', 'fuelProduct:id,name'])->where('status', FuelSale::STATUS_FINALIZED));
        $context->constrainPeriod($query, 'finalized_at');
        if ($context->filter('product_id') !== null) {
            $query->where('fuel_product_id', $context->filter('product_id'));
        }
        $rows = $query->orderBy('finalized_at')->orderBy('id')->limit(self::ROW_CAP + 1)->get();

        return ['sales' => $rows->take(self::ROW_CAP), 'truncated' => $rows->count() > self::ROW_CAP];
    }

    /** @return list<array{ar:string,en:string}> */
    private function notes(bool $truncated, bool $cost = false): array
    {
        $notes = [['ar' => 'المصدر: بيع الوقود النهائي (فواتير وقيود رسمية)، وليس تقدير العدادات التشغيلي.', 'en' => 'Source: finalized fuel sales (official invoices and entries), not the operational meter estimate.']];
        if ($cost) {
            $notes[] = ['ar' => 'التكلفة من COGS الرسمي فقط؛ حيث لا تتوفر تكلفة موثوقة تظهر «غير متاحة» ولا تُقدَّر.', 'en' => 'Cost comes from the official COGS only; where no reliable cost exists it is shown as unavailable, never estimated.'];
        }
        if ($truncated) {
            $notes[] = ['ar' => 'تجاوز عدد المبيعات '.self::ROW_CAP.'؛ ضيّق الفترة.', 'en' => 'Sales exceed '.self::ROW_CAP.'; narrow the period.'];
        }

        return $notes;
    }

    /** @param array<string,array<string,mixed>> $groups */
    private function add(array &$groups, string $key, array $init, FuelSale $s): void
    {
        $g = &$groups[$key];
        $g ??= $init + ['sales' => 0, 'liters' => 0, 'gross' => 0, 'net' => 0, 'tax' => 0, 'cogs' => 0, 'uncosted' => 0, 'no_invoice' => 0];
        $g['sales']++;
        $g['liters'] += (int) $s->quantity_milliliters;
        if ($s->invoice === null) {
            $g['no_invoice']++;
            $g['gross'] = null;
            $g['net'] = null;
            $g['tax'] = null;
        } else {
            // الإجمالي من الفاتورة الرسمية (شامل الضريبة)؛ gross_minor = كمية×سعر فيكون الصافي نفسه في نمط «غير شامل».
            $g['gross'] = $g['gross'] === null ? null : $g['gross'] + (int) $s->invoice->total;
            $g['net'] = $g['net'] === null ? null : $g['net'] + (int) $s->invoice->subtotal;
            $g['tax'] = $g['tax'] === null ? null : $g['tax'] + (int) $s->invoice->tax_amount;
        }
        if ($s->cogs_minor === null) {
            $g['uncosted']++;
            $g['cogs'] = null;
        } else {
            $g['cogs'] = $g['cogs'] === null ? null : $g['cogs'] + (int) $s->cogs_minor;
        }
        unset($g);
    }

    /** @return array<string,mixed> */
    private function bySales(string $key, FuelReportContext $context): array
    {
        $loaded = $this->sales($context);
        $groups = [];
        foreach ($loaded['sales'] as $s) {
            match ($key) {
                'financial.revenue', 'financial.vat' => $this->add($groups, $s->fuel_station_id.'|'.($key === 'financial.vat' ? (string) $s->fuel_price_tax_mode : ''), ['station' => $context->stationName((string) $s->fuel_station_id), 'tax_mode' => $s->fuel_price_tax_mode], $s),
                'financial.accounting_links', 'financial.exceptions' => null,
                default => $this->add($groups, (string) $s->fuel_product_id, ['product' => $s->fuelProduct?->name], $s),
            };
        }
        ksort($groups);
        $rows = array_values($groups);
        $gaps = [];
        if ($key === 'financial.revenue' || $key === 'financial.vat') {
            if (array_filter($rows, fn ($r) => $r['no_invoice'] > 0)) {
                $gaps[] = 'invoice_missing';
            }
        } elseif (array_filter($rows, fn ($r) => $r['uncosted'] > 0)) {
            $gaps[] = 'cost_unavailable';
        }

        return match ($key) {
            'financial.revenue' => $this->revenue($rows, $loaded['truncated'], $gaps),
            'financial.vat' => $this->vat($rows, $loaded['truncated'], $gaps),
            'financial.cogs' => $this->cogs($rows, $loaded['truncated'], $gaps),
            'financial.gross_profit' => $this->profit($rows, $loaded['truncated'], $gaps),
            'financial.accounting_links' => $this->links($loaded['sales'], $loaded['truncated']),
            'financial.exceptions' => $this->exceptions($context, $loaded['sales'], $loaded['truncated']),
        };
    }

    /** @param list<array<string,mixed>> $rows @param list<string> $gaps @return array<string,mixed> */
    private function revenue(array $rows, bool $truncated, array $gaps): array
    {
        $sum = fn (string $k) => in_array(null, array_column($rows, $k), true) ? null : array_sum(array_column($rows, $k));

        return [
            'summary' => [
                T::item('gross', 'إجمالي الإيراد', 'Gross revenue', 'money', $sum('gross'), T::SALES),
                T::item('net', 'الصافي قبل الضريبة', 'Net before tax', 'money', $sum('net'), T::SALES),
                T::item('sales', 'عدد المبيعات', 'Sales', 'int', array_sum(array_column($rows, 'sales'))),
            ],
            'tables' => [T::table('revenue', 'إيرادات المحطات', 'Station revenue', [
                T::col('station', 'text', 'المحطة', 'Station'), T::col('sales', 'int', 'المبيعات', 'Sales', ['total' => 'sum']), T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('gross', 'money', 'الإجمالي', 'Gross', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('net', 'money', 'الصافي', 'Net', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('tax', 'money', 'الضريبة', 'Tax', ['total' => 'sum', 'sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
            'gaps' => $gaps, 'truncated' => $truncated, 'notes' => $this->notes($truncated),
        ];
    }

    /** @param list<array<string,mixed>> $rows @param list<string> $gaps @return array<string,mixed> */
    private function vat(array $rows, bool $truncated, array $gaps): array
    {
        $tax = in_array(null, array_column($rows, 'tax'), true) ? null : array_sum(array_column($rows, 'tax'));

        return [
            'summary' => [T::item('tax', 'ضريبة القيمة المضافة', 'VAT', 'money', $tax, T::SALES), T::item('sales', 'عدد المبيعات', 'Sales', 'int', array_sum(array_column($rows, 'sales')))],
            'tables' => [T::table('vat', 'ضريبة القيمة المضافة', 'VAT', [
                T::col('station', 'text', 'المحطة', 'Station'),
                T::col('tax_mode', 'status', 'نمط الضريبة', 'Tax mode', ['values' => ['tax_inclusive' => ['ar' => 'شامل الضريبة', 'en' => 'Tax inclusive'], 'tax_exclusive' => ['ar' => 'غير شامل', 'en' => 'Tax exclusive']]]),
                T::col('sales', 'int', 'المبيعات', 'Sales', ['total' => 'sum']),
                T::col('net', 'money', 'الوعاء الضريبي', 'Taxable base', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('tax', 'money', 'الضريبة', 'VAT', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('gross', 'money', 'الإجمالي', 'Gross', ['total' => 'sum', 'sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
            'gaps' => $gaps, 'truncated' => $truncated,
            'notes' => [...$this->notes($truncated), ['ar' => 'الضريبة من الفاتورة الرسمية كما رُحّلت؛ هذا ليس إقراراً ضريبياً.', 'en' => 'Tax is read from the posted official invoice; this is not a tax return.']],
        ];
    }

    /** @param list<array<string,mixed>> $rows @param list<string> $gaps @return array<string,mixed> */
    private function cogs(array $rows, bool $truncated, array $gaps): array
    {
        $total = in_array(null, array_column($rows, 'cogs'), true) ? null : array_sum(array_column($rows, 'cogs'));

        return [
            'summary' => [
                T::item('cogs', 'تكلفة الوقود المباع', 'Cost of fuel sold', 'money', $total, T::COST),
                T::item('uncosted', 'مبيعات بلا تكلفة', 'Sales without cost', 'int', array_sum(array_column($rows, 'uncosted')), T::COST),
            ],
            'tables' => [T::table('cogs', 'تكلفة الوقود المباع', 'Cost of fuel sold', [
                T::col('product', 'text', 'المنتج', 'Product'), T::col('sales', 'int', 'المبيعات', 'Sales', ['total' => 'sum']), T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('cogs', 'money', 'التكلفة', 'Cost', ['total' => 'sum', 'sensitivity' => T::COST]),
                T::col('uncosted', 'int', 'بلا تكلفة', 'Uncosted', ['total' => 'sum', 'sensitivity' => T::COST]),
            ], $rows, T::COST)],
            'gaps' => $gaps, 'truncated' => $truncated, 'notes' => $this->notes($truncated, true),
        ];
    }

    /** @param list<array<string,mixed>> $rows @param list<string> $gaps @return array<string,mixed> */
    private function profit(array $rows, bool $truncated, array $gaps): array
    {
        $out = array_map(function (array $r) {
            $net = $r['net'];
            $profit = ($net === null || $r['cogs'] === null) ? null : $net - $r['cogs'];

            return $r + ['profit' => $profit, 'margin_bp' => ($profit === null || $net === 0) ? null : intdiv(abs($profit) * 20000 + abs((int) $net), 2 * abs((int) $net)) * ($profit < 0 ? -1 : 1)];
        }, $rows);
        $profit = in_array(null, array_column($out, 'profit'), true) ? null : array_sum(array_column($out, 'profit'));

        return [
            'summary' => [T::item('profit', 'مجمل الربح', 'Gross profit', 'money', $profit, T::COST)],
            'tables' => [T::table('profit', 'مجمل الربح', 'Gross profit', [
                T::col('product', 'text', 'المنتج', 'Product'), T::col('liters', 'liters', 'اللترات', 'Liters', ['total' => 'sum']),
                T::col('net', 'money', 'الإيراد الصافي', 'Net revenue', ['total' => 'sum', 'sensitivity' => T::COST]),
                T::col('cogs', 'money', 'التكلفة', 'Cost', ['total' => 'sum', 'sensitivity' => T::COST]),
                T::col('profit', 'money', 'مجمل الربح', 'Gross profit', ['total' => 'sum', 'sensitivity' => T::COST]),
                T::col('margin_bp', 'bp', 'الهامش', 'Margin', ['sensitivity' => T::COST]),
            ], $out, T::COST)],
            'gaps' => array_values(array_unique([...$gaps, ...(in_array(null, array_column($rows, 'net'), true) ? ['invoice_missing'] : [])])), 'truncated' => $truncated,
            'notes' => [...$this->notes($truncated, true), ['ar' => 'ربح تشغيلي من الإيراد الصافي وCOGS الرسمي؛ ليس نتيجة محاسبية معتمدة.', 'en' => 'An operational profit from net revenue and official COGS; not an approved accounting result.']],
        ];
    }

    /** @param \Illuminate\Support\Collection<int,FuelSale> $sales @return array<string,mixed> */
    private function links($sales, bool $truncated): array
    {
        $rows = $sales->map(fn (FuelSale $s) => [
            'number' => $s->number, 'date' => $s->finalized_at?->toIso8601String(), 'invoice' => $s->invoice?->number, 'invoice_status' => $s->invoice?->status,
            'gross' => $s->invoice === null ? null : (int) $s->invoice->total, 'has_invoice' => $s->invoice_id === null ? 0 : 1, 'has_entry' => ($s->invoice?->journal_entry_id === null) ? 0 : 1,
            'has_cogs' => $s->cogs_journal_entry_id === null ? 0 : 1, 'has_stock' => $s->stock_movement_id === null ? 0 : 1,
        ])->all();
        $unlinked = count(array_filter($rows, fn ($r) => $r['has_invoice'] + $r['has_entry'] + $r['has_cogs'] + $r['has_stock'] < 4));

        return [
            'summary' => [T::item('sales', 'مبيعات نهائية', 'Finalized sales', 'int', count($rows)), T::item('unlinked', 'بارتباط ناقص', 'Incompletely linked', 'int', $unlinked)],
            'tables' => [T::table('links', 'الارتباطات المحاسبية', 'Accounting links', [
                T::col('number', 'text', 'البيع', 'Sale'), T::col('date', 'datetime', 'التاريخ', 'Date'), T::col('invoice', 'text', 'الفاتورة', 'Invoice'), T::col('invoice_status', 'text', 'حالتها', 'Status'),
                T::col('gross', 'money', 'الإجمالي', 'Gross', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('has_invoice', 'int', 'فاتورة (1/0)', 'Invoice (1/0)'), T::col('has_entry', 'int', 'قيد الإيراد (1/0)', 'Revenue entry (1/0)'),
                T::col('has_cogs', 'int', 'قيد COGS (1/0)', 'COGS entry (1/0)'), T::col('has_stock', 'int', 'حركة مخزون (1/0)', 'Stock movement (1/0)'),
            ], $rows, T::SALES)],
            'truncated' => $truncated, 'notes' => $this->notes($truncated),
        ];
    }

    /** @param \Illuminate\Support\Collection<int,FuelSale> $sales @return array<string,mixed> */
    private function exceptions(FuelReportContext $context, $sales, bool $truncated): array
    {
        $rows = [];
        foreach ($sales as $s) {
            $base = ['reference' => $s->number, 'date' => $s->finalized_at?->toIso8601String(), 'station' => $context->stationName((string) $s->fuel_station_id), 'amount' => $s->invoice === null ? null : (int) $s->invoice->total];
            if ($s->invoice_id === null) {
                $rows[] = ['type' => 'sale_without_invoice'] + $base;
            } elseif ($s->invoice?->journal_entry_id === null) {
                $rows[] = ['type' => 'invoice_not_posted'] + $base;
            }
            if ($s->cogs_minor === null || $s->cogs_journal_entry_id === null) {
                $rows[] = ['type' => 'sale_without_cogs'] + $base;
            }
        }
        $shiftIds = $this->facts->load($context, null, false);
        $ids = array_column($shiftIds['shifts'], 'id');
        $byId = collect($shiftIds['shifts'])->keyBy('id');
        if ($ids !== []) {
            foreach (FuelShiftCashVariance::query()->whereIn('fuel_shift_id', $ids)->where('status', FuelShiftCashVariance::STATUS_PENDING_REVIEW)->whereNull('reviewed_at')->get() as $v) {
                $s = $byId->get($v->fuel_shift_id);
                $rows[] = ['type' => 'cash_variance_pending', 'reference' => $s['number'], 'date' => $s['closed_at'], 'station' => $s['station_name'], 'amount' => (int) $v->variance_minor];
            }
            foreach (FuelShiftCollectionDeclaration::query()->whereIn('fuel_shift_id', $ids)->where('review_required', true)->whereNull('reviewed_at')->get() as $d) {
                $s = $byId->get($d->fuel_shift_id);
                $rows[] = ['type' => 'collection_review_pending', 'reference' => $s['number'], 'date' => $s['closed_at'], 'station' => $s['station_name'], 'amount' => $d->difference_minor === null ? null : (int) $d->difference_minor];
            }
        }
        return [
            'summary' => [T::item('exceptions', 'عدد الاستثناءات', 'Exceptions', 'int', count($rows), T::SALES)],
            'tables' => [T::table('exceptions', 'الفروقات والاستثناءات', 'Differences and exceptions', [
                T::col('type', 'status', 'النوع', 'Type', ['values' => [
                    'sale_without_invoice' => ['ar' => 'بيع بلا فاتورة', 'en' => 'Sale without invoice'], 'invoice_not_posted' => ['ar' => 'فاتورة غير مرحَّلة', 'en' => 'Invoice not posted'],
                    'sale_without_cogs' => ['ar' => 'بيع بلا تكلفة/قيد COGS', 'en' => 'Sale without cost/COGS entry'], 'cash_variance_pending' => ['ar' => 'فرق نقد بانتظار المراجعة', 'en' => 'Cash variance pending review'],
                    'collection_review_pending' => ['ar' => 'فرق تحصيل بانتظار المراجعة', 'en' => 'Collection difference pending review'],
                ]]),
                T::col('reference', 'text', 'المرجع', 'Reference'), T::col('date', 'datetime', 'التاريخ', 'Date'), T::col('station', 'text', 'المحطة', 'Station'),
                T::col('amount', 'money', 'المبلغ', 'Amount', ['sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
            'truncated' => $truncated || $shiftIds['truncated'], 'gaps' => $shiftIds['gaps'],
            'notes' => [...$this->notes($truncated), ['ar' => 'قواعد حتمية على الروابط والمراجعات المعلَّقة؛ لا عتبات مخترعة.', 'en' => 'Deterministic rules on links and pending reviews; no invented thresholds.']],
        ];
    }

    /** @return array<string,mixed> */
    private function paymentMethods(FuelReportContext $context): array
    {
        [$start, $end] = $context->utcEnvelope();
        $inScope = $context->scoped(FuelSale::query())->select('id');
        $all = FuelSalePaymentReceipt::query()->with('payment:id,payment_method_name,method,amount')->whereIn('fuel_sale_id', $inScope)
            ->whereIn('payment_id', \App\Models\Payment::query()->select('id')->where('status', 'posted')) // المعكوس لا يُحتسب محصَّلاً (كما FuelShiftCashExpectationService)
            ->where('recorded_at', '>=', $start)->where('recorded_at', '<', $end)->orderBy('recorded_at')->limit(self::ROW_CAP + 1)->get();
        $truncated = $all->count() > self::ROW_CAP;
        $stationOf = FuelSale::query()->whereIn('id', $all->pluck('fuel_sale_id')->unique()->all())->pluck('fuel_station_id', 'id');
        $receipts = $all->take(self::ROW_CAP)->filter(fn (FuelSalePaymentReceipt $r) => $context->inPeriod($r->recorded_at, (string) ($stationOf[$r->fuel_sale_id] ?? '')))->values();
        $groups = [];
        foreach ($receipts as $r) {
            $name = (string) ($r->payment?->payment_method_name ?: $r->payment?->method ?: '—');
            $g = &$groups[$name];
            $g ??= ['method' => $name, 'receipts' => 0, 'amount' => 0];
            $g['receipts']++;
            $g['amount'] += (int) ($r->amount_minor ?? $r->payment?->amount ?? 0);
            unset($g);
        }
        ksort($groups);
        $rows = array_values($groups);
        $total = array_sum(array_column($rows, 'amount'));
        $rows = array_map(fn ($g) => $g + ['share_bp' => $total > 0 ? intdiv($g['amount'] * 20000 + $total, 2 * $total) : null], $rows);

        return [
            'summary' => [T::item('amount', 'إجمالي المقبوض', 'Total received', 'money', $total, T::SALES), T::item('receipts', 'عدد القبوضات', 'Receipts', 'int', array_sum(array_column($rows, 'receipts')))],
            'tables' => [T::table('methods', 'المبيعات المحصَّلة حسب طريقة الدفع', 'Collected fuel sales by payment method', [
                T::col('method', 'text', 'طريقة الدفع', 'Payment method'), T::col('receipts', 'int', 'القبوضات', 'Receipts', ['total' => 'sum']),
                T::col('amount', 'money', 'المبلغ', 'Amount', ['total' => 'sum', 'sensitivity' => T::SALES]), T::col('share_bp', 'bp', 'الحصة', 'Share', ['sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
            'truncated' => $truncated,
            'notes' => [['ar' => 'قبوضات بيع الوقود المسجَّلة بسندات؛ المبيعات الآجلة غير المسدَّدة لا تظهر هنا.', 'en' => 'Receipts recorded against fuel sales; unpaid deferred sales do not appear here.']],
        ];
    }

    /** @return array<string,mixed> */
    private function reconciliations(FuelReportContext $context): array
    {
        $loaded = $this->facts->load($context, null, false);
        $byId = collect($loaded['shifts'])->keyBy('id');
        $ids = $byId->keys()->all();
        $decl = $ids === [] ? collect() : FuelShiftCollectionDeclaration::query()->whereIn('fuel_shift_id', $ids)->get()->keyBy('fuel_shift_id');
        $formal = $ids === [] ? collect() : FuelSale::query()->whereIn('fuel_shift_id', $ids)->where('status', FuelSale::STATUS_FINALIZED)
            ->selectRaw('fuel_shift_id, COALESCE(SUM(gross_minor), 0) as gross')->groupBy('fuel_shift_id')->pluck('gross', 'fuel_shift_id');

        $rows = [];
        $undeclared = 0;
        $incompleteSnapshots = 0;
        foreach ($byId as $id => $s) {
            $d = $decl->get($id);
            if ($s['status'] !== 'open') {
                if ($d === null) {
                    $undeclared++;
                } elseif ($d->sales_minor === null || ! $d->sales_complete) {
                    $incompleteSnapshots++;
                }
            }
            $meter = $d?->sales_minor === null ? null : (int) $d->sales_minor;
            $official = (int) ($formal[$id] ?? 0);
            $collected = $d === null ? null : (int) $d->collected_total_minor;
            $rows[] = [
                'shift' => $s['number'], 'station' => $s['station_name'], 'date' => $s['date'], 'meter' => $meter, 'formal' => $official, 'collected' => $collected,
                'meter_minus_formal' => $meter === null ? null : $meter - $official, 'collected_minus_meter' => ($meter === null || $collected === null) ? null : $collected - $meter,
            ];
        }

        return [
            'summary' => [T::item('shifts', 'الورديات', 'Shifts', 'int', count($rows))],
            'tables' => [T::table('reconciliation', 'المطابقات المالية', 'Financial reconciliation', [
                T::col('shift', 'text', 'الوردية', 'Shift'), T::col('station', 'text', 'المحطة', 'Station'), T::col('date', 'date', 'اليوم', 'Day'),
                T::col('meter', 'money', 'مبيعات العدادات', 'Meter sales', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('formal', 'money', 'المبيعات الرسمية', 'Formal sales', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('collected', 'money', 'المُقَرّ بتحصيله', 'Declared collection', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('meter_minus_formal', 'money', 'عدادات − رسمي', 'Meter − formal', ['total' => 'sum', 'sensitivity' => T::SALES]),
                T::col('collected_minus_meter', 'money', 'تحصيل − عدادات', 'Collected − meter', ['total' => 'sum', 'sensitivity' => T::SALES]),
            ], $rows, T::SALES)],
            'gaps' => array_values(array_unique([...$loaded['gaps'], ...($undeclared > 0 ? ['collection_not_declared'] : []), ...($incompleteSnapshots > 0 ? ['declaration_sales_incomplete'] : [])])), 'truncated' => $loaded['truncated'],
            'notes' => [['ar' => 'ثلاثة مصادر مفصولة: لقطة مبيعات العدادات المجمَّدة، بيع الوقود الرسمي، وإقرار التحصيل؛ الفرق بينها مؤشر مراجعة لا قيد.', 'en' => 'Three separate sources: the frozen meter-sales snapshot, official fuel sales and the collection declaration; their difference is a review signal, not an entry.']],
        ];
    }
}
