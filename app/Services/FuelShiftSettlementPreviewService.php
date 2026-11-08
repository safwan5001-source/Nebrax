<?php

namespace App\Services;

use App\Models\AccountingPeriodLock;
use App\Models\FiscalYear;
use App\Models\FuelCostPoolOpenHistory;
use App\Models\FuelInventoryCostMovement;
use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\FuelStation;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Models\Warehouse;
use App\Support\FuelCostVisibility;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * معاينة تسوية وردية وقود (P1-3a) — **قراءة فقط بالكامل**.
 *
 * تحسب ما *سيحدث* لو أُغلقت الوردية الآن بسياسة `post_on_close` (البقية غير الموثَّقة بفواتير ERP، قيمتها، تخصيص المُقَرّ به على الفواتير، الفروق،
 * القيود المتوقعة) **دون** إنشاء فاتورة أو سند أو قيد أو حركة مخزون أو حالة تكلفة أو قفل مِرساة أو أي صف. ليست التزاماً: الترحيل يعيد الحساب تحت
 * الأقفال في P1-3b ويقارن البصمة (`preview_hash`). يحرس عدم الكتابة اختبار ساكن + اختبار عدّ صفوف الجداول المتأثرة قبل المعاينة وبعدها.
 *
 * طبقات الإفصاح (مفتاح محذوف لا قيمة مُخفاة): الأساسية `fuel.shift.close` (البصمة والجاهزية ورموز مانعة غير مالية) ← المالية `fuel.sale.view`
 * (مبالغ/فواتير/تخصيص/فروق/قيود) ← التكلفة `products.view_cost` (تكلفة السطر وقيد COGS). الحقيقة المالية المانعة تُختزل لمن لا يرى المبيعات إلى
 * `FUEL_SETTLEMENT_SUPERVISOR_ATTENTION` (قاعدة D8). البصمة HMAC بمفتاح مشتق لكل مستأجر/وردية لا SHA-256 مجرداً، فلا تُخمَّن منها المبالغ.
 */
class FuelShiftSettlementPreviewService
{
    /** رموز مانعة تكشف حقيقة مالية: تُختزل لمن لا يملك `fuel.sale.view`. */
    private const FINANCIAL_BLOCKERS = [
        'FUEL_SETTLEMENT_ERP_EXCEEDS_METER', 'FUEL_SETTLEMENT_DECLARATION_BELOW_RECEIPTS', 'FUEL_SETTLEMENT_PRICE_CHANGED',
    ];

    public function __construct(
        private FuelShiftSalesCalculator $calculator,
        private FuelShiftSettlementReadiness $readiness,
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costs,
        private FuelShiftCashExpectationService $expectation,
        private FuelStationPaymentMethods $methods,
    ) {}

    /** @return array<string,mixed> */
    public function preview(FuelShift $shift, User $viewer): array
    {
        if (! $shift->isOpen()) {
            throw new RuntimeException('FUEL_SETTLEMENT_SHIFT_NOT_OPEN: المعاينة تخص وردية مفتوحة فقط.');
        }

        $station = FuelStation::findOrFail($shift->fuel_station_id);
        $financeVisible = $viewer->hasPermission('fuel.sale.view');
        $costVisible = $financeVisible && FuelCostVisibility::canSeeCost($viewer);
        $now = now();

        $sales = $this->calculator->compute($shift, $now);
        $walkIn = $this->readiness->walkInPartner($station);
        $blockers = $this->readiness->stationBlockers($station);

        // ───── العدّادات و ERP لكل فوهة ─────
        $erpByNozzle = FuelSale::query()
            ->where('fuel_shift_id', $shift->id)->where('status', FuelSale::STATUS_FINALIZED)
            ->selectRaw('fuel_nozzle_id, SUM(quantity_milliliters) AS qty')->groupBy('fuel_nozzle_id')->pluck('qty', 'fuel_nozzle_id');
        $products = collect($sales['products'])->keyBy('fuel_product_id');
        $fuelProducts = FuelProduct::query()->whereIn('id', $products->keys()->all())->get()->keyBy('id');
        $warehouse = Warehouse::query()->find($station->warehouse_id);
        $taxMode = $sales['tax_mode'];

        if (! $sales['milliliters_complete']) {
            $blockers[] = 'FUEL_SETTLEMENT_METER_INCOMPLETE';
        }

        $lines = [];
        $residualByProduct = [];
        foreach ($sales['nozzles'] as $nozzle) {
            $metered = $nozzle['milliliters'];
            $erp = (int) ($erpByNozzle[$nozzle['nozzle_id']] ?? 0);
            $line = [
                'nozzle_id' => $nozzle['nozzle_id'], 'nozzle_number' => $nozzle['nozzle_number'], 'fuel_product_id' => $nozzle['fuel_product_id'],
                'metered_milliliters' => $metered, 'erp_milliliters' => $erp, 'residual_milliliters' => null,
                'price_per_liter_minor' => null, 'expected_gross_minor' => null, 'state' => 'unavailable', 'withheld_reason' => null,
                'cost_minor' => null, 'cost_blocked' => null,
            ];
            if ($metered === null) {
                $lines[] = $line;
                continue;
            }
            $residual = $metered - $erp;
            if ($residual < 0) {
                $blockers[] = 'FUEL_SETTLEMENT_ERP_EXCEEDS_METER';
                $line['residual_milliliters'] = $residual;
                $line['state'] = 'blocked_erp_exceeds_meter';
                $lines[] = $line;
                continue;
            }
            $line['residual_milliliters'] = $residual;
            $residualByProduct[$nozzle['fuel_product_id']] = ($residualByProduct[$nozzle['fuel_product_id']] ?? 0) + $residual;
            if ($residual === 0) {
                $line['state'] = 'no_residual';
                $lines[] = $line;
                continue;
            }

            $productRow = $products->get($nozzle['fuel_product_id']);
            $price = $productRow['price_per_liter_minor'] ?? null;
            foreach ((array) ($productRow['gaps'] ?? []) as $gap) {
                $blockers[] = match ($gap) {
                    FuelShiftSalesCalculator::GAP_PRICE_CHANGED => 'FUEL_SETTLEMENT_PRICE_CHANGED',
                    FuelShiftSalesCalculator::GAP_PRICE_UNAVAILABLE => 'FUEL_SETTLEMENT_PRICE_UNAVAILABLE',
                    FuelShiftSalesCalculator::GAP_TAX_MODE_UNSET => 'FUEL_SETTLEMENT_NOT_READY_TAX_MODE_UNSET',
                    default => null,
                };
            }
            if ($price !== null) {
                $line['price_per_liter_minor'] = (int) $price;
                $line['expected_gross_minor'] = $this->calculator->amountFor($residual, (int) $price, $taxMode);
            }
            $lines[] = $line;
        }
        $blockers = array_values(array_filter($blockers));

        // ───── الحالة المتوقعة لكل سطر (حجب التكلفة/الفترة) والتكلفة المعاينة ─────
        // التكلفة المعاينة بالتتابع لكل مجمّع بترتيب الفوهات (كما سيُرحَّل لاحقاً) بحالة تُحاكى في الذاكرة فيُحمل الباقي الكسري بين الفوهات.
        $stock = [];
        $quotable = [];
        foreach ($lines as $index => &$line) {
            if (($line['residual_milliliters'] ?? 0) <= 0 || $line['expected_gross_minor'] === null) {
                continue;
            }
            $product = $fuelProducts->get($line['fuel_product_id']);
            $withheld = $product !== null && $warehouse !== null ? $this->withholdReason($shift, $station, $product, $now) : null;
            if ($withheld !== null) {
                $line['state'] = $withheld;
                $line['withheld_reason'] = $withheld;

                continue;
            }
            $line['state'] = 'posted';
            if ($product !== null && $warehouse !== null) {
                $quotable[$product->id][] = $index;
                $stock[$product->id] = ($stock[$product->id] ?? 0) + (int) $line['residual_milliliters'];
            }
        }
        unset($line);
        foreach ($quotable as $productId => $indexes) {
            $quotes = $this->costs->previewIssueSequence($fuelProducts->get($productId), $warehouse, array_map(fn ($i) => (int) $lines[$i]['residual_milliliters'], $indexes));
            foreach ($indexes as $position => $index) {
                $lines[$index]['cost_minor'] = $quotes[$position]['posted_cost_minor'] ?? null;
                $lines[$index]['cost_blocked'] = $quotes[$position]['blocked'] ?? null;
            }
        }

        foreach ($stock as $productId => $liters) {
            $product = $fuelProducts->get($productId);
            $onHand = (int) (ProductWarehouseStock::query()->where('warehouse_id', $station->warehouse_id)->where('product_id', $product?->product_id)->value('quantity') ?? 0);
            if ($liters > $onHand) {
                $blockers[] = 'FUEL_SETTLEMENT_INSUFFICIENT_STOCK';
            }
        }

        if ($this->periodLocked($this->settings->businessDate($station, $now))) {
            $blockers[] = 'FUEL_SETTLEMENT_PERIOD_LOCKED';
        }
        if ((int) ($this->expectation->live($shift, FuelShiftCashExpectationService::BASIS_DECLARED_COLLECTION)['unattributed_count'] ?? 0) > 0) {
            $blockers[] = 'FUEL_SETTLEMENT_RECEIPTS_UNATTRIBUTED';
        }

        // ───── المرجع والإقرار والتخصيص ─────
        $finance = $this->finance($shift, $station, $walkIn?->id, $lines, $blockers);
        $blockers = $finance['blockers'];
        $blockers = array_values(array_unique($blockers));

        $hash = $this->hash($shift, $lines, $finance, $taxMode);

        $visibleBlockers = $financeVisible ? $blockers : array_values(array_unique(array_map(
            fn (string $code) => in_array($code, self::FINANCIAL_BLOCKERS, true) ? 'FUEL_SETTLEMENT_SUPERVISOR_ATTENTION' : $code,
            $blockers,
        )));

        $payload = [
            'enabled' => true,
            'writes_nothing' => true,
            'shift' => ['id' => $shift->id, 'number' => $shift->number, 'status' => $shift->status],
            'policy' => ['mode' => $this->readiness->mode($station), 'sales_basis' => 'per_invoice'],
            'ready' => $visibleBlockers === [],
            'blockers' => $visibleBlockers,
            'preview_hash' => $hash,
            'evaluated_at' => $now->toIso8601String(),
            'lines' => array_map(fn (array $line) => $this->presentLine($line, $financeVisible, $costVisible), $lines),
            'disclaimers' => ['preview_only_no_postings', 'operational_not_financial_proof', 'credit_sales_excluded', 'estimate_until_p1_3b_validation'],
        ];

        if ($financeVisible) {
            $payload['reference'] = $finance['reference'];
            $payload['declaration'] = $finance['declaration'];
            $payload['allocation'] = $finance['allocation'];
            $payload['variances'] = $finance['variances'];
            $payload['journal'] = $this->journal($lines, $finance['allocation'], $costVisible);
        }

        return $payload;
    }

    // ═══════════ الحجب (تكلفة/فترة ضريبية) ═══════════

    /**
     * سبب حجب الترحيل لمنتج، أو null إن أمكن ترحيله بالتكلفة الراهنة. بالترتيب: عبور حدّ شهر (T-3) ← تاريخ مفتوح للمجمّع ← حدث تكلفة داخل نافذة التعرّض.
     * نافذة التعرّض تبدأ من أقدم وردية غير مسوّاة على أي محطة تشترك في المجمّع وتتقاطع مع هذه (وردية مفتوحة اليوم؛ لا تسويات محجوبة قبل P1-3b).
     */
    private function withholdReason(FuelShift $shift, FuelStation $station, FuelProduct $product, $now): ?string
    {
        $tz = $this->settings->operatingTimezone($station);
        $opened = \Carbon\CarbonImmutable::instance($shift->opened_at ?? $now)->setTimezone($tz);
        $current = \Carbon\CarbonImmutable::instance($now)->setTimezone($tz);
        if ($opened->format('Y-m') !== $current->format('Y-m')) {
            return 'withheld_period_boundary';
        }

        $pool = fn ($query) => $query->where('warehouse_id', $station->warehouse_id)->where('fuel_product_id', $product->id);
        if ($pool(FuelCostPoolOpenHistory::query())->whereNull('resolved_at')->exists()) {
            return 'withheld_pool_history_open';
        }

        $exposureStart = $shift->opened_at;
        $sharing = FuelShift::query()
            ->where('status', FuelShift::STATUS_OPEN)->where('id', '!=', $shift->id)
            ->whereIn('fuel_station_id', FuelStation::query()->where('warehouse_id', $station->warehouse_id)->select('id'))
            ->whereIn('fuel_station_id', \App\Models\FuelTank::query()->where('fuel_product_id', $product->id)->select('fuel_station_id'))
            ->min('opened_at');
        if ($sharing !== null && $exposureStart !== null && \Carbon\CarbonImmutable::parse($sharing)->lt($exposureStart)) {
            $exposureStart = \Carbon\CarbonImmutable::parse($sharing);
        }

        $event = $pool(FuelInventoryCostMovement::query())
            ->where('movement_type', '!=', 'issue')
            ->where('occurred_at', '>=', $exposureStart ?? $shift->opened_at)
            ->exists();

        return $event ? 'withheld_cost_pool_changed' : null;
    }

    private function periodLocked(string $date): bool
    {
        $tenantId = app(\App\Tenancy\TenantContext::class)->id();
        if ($tenantId === null) {
            return false;
        }
        // قراءة بلا قفل مِرساة المستأجر عمداً (المعاينة لا تقفل شيئاً)؛ الفحص الحاسم في الترحيل (`AccountingDateGuard::assertOpen`) يبقى كما هو.
        $lock = AccountingPeriodLock::query()->where('tenant_id', $tenantId)->where('status', 'active')
            ->whereDate('start_date', '<=', $date)->whereDate('end_date', '>=', $date)->exists();

        return $lock || FiscalYear::query()->where('tenant_id', $tenantId)->where('status', FiscalYear::STATUS_CLOSED)
            ->whereDate('start_date', '<=', $date)->whereDate('end_date', '>=', $date)->exists();
    }

    // ═══════════ المرجع والتخصيص (طبقة مالية) ═══════════

    /**
     * @param  list<array<string,mixed>>  $lines
     * @param  list<string>  $blockers
     * @return array{reference:array<string,mixed>,declaration:array<string,mixed>,allocation:array<string,mixed>,variances:array<string,mixed>,blockers:list<string>}
     */
    private function finance(FuelShift $shift, FuelStation $station, ?string $walkInId, array $lines, array $blockers): array
    {
        // المبيعات النهائية للوردية (كل الشرائح: عميل المحطة، مسمّون، عقود) بفواتيرها.
        $sales = FuelSale::query()->where('fuel_shift_id', $shift->id)->where('status', FuelSale::STATUS_FINALIZED)
            ->whereNotNull('invoice_id')->orderBy('finalized_at')->orderBy('id')->get();
        $invoices = Invoice::query()->whereIn('id', $sales->pluck('invoice_id'))->get()->keyBy('id');

        $walkInSales = $sales->filter(fn (FuelSale $s) => $walkInId !== null && $s->partner_id === $walkInId && $s->corporate_fuel_contract_id === null);
        $walkInInvoiceTotal = (int) $walkInSales->sum(fn (FuelSale $s) => (int) $invoices[$s->invoice_id]->total);

        // إيصالات هذه الوردية المختومة (سندها مرحَّل): R لكل طريقة + تصنيفها في المرجع مرة واحدة.
        $receipts = FuelSalePaymentReceipt::query()->where('fuel_shift_id', $shift->id)
            ->whereIn('payment_id', Payment::query()->select('id')->where('status', 'posted'))->get();
        $payments = Payment::query()->whereIn('id', $receipts->pluck('payment_id'))->get()->keyBy('id');
        $receiptSales = FuelSale::query()->whereIn('id', $receipts->pluck('fuel_sale_id'))->get()->keyBy('id');

        $rByMethod = [];
        $named = 0;
        $earlierWalkIn = 0;
        $corporate = 0;
        foreach ($receipts as $receipt) {
            $sale = $receiptSales->get($receipt->fuel_sale_id);
            $amount = (int) $receipt->amount_minor;
            $method = $payments->get($receipt->payment_id)?->payment_method_id;
            $rByMethod[$method] = ($rByMethod[$method] ?? 0) + $amount;
            if ($sale === null) {
                continue;
            }
            if ($sale->corporate_fuel_contract_id !== null) {
                $corporate += $amount;
            } elseif ($walkInId !== null && $sale->partner_id === $walkInId) {
                // فاتورة عميل المحطة من هذه الوردية تُعدّ بإجماليها (مكوّن 2)؛ من وردية سابقة تُعدّ بالإيصال وحده (مكوّن 3b).
                if ($sale->fuel_shift_id !== $shift->id) {
                    $earlierWalkIn += $amount;
                }
            } else {
                $named += $amount;
            }
        }

        $postedLines = array_values(array_filter($lines, fn ($l) => $l['state'] === 'posted' && $l['expected_gross_minor'] !== null));
        $settlementTotal = (int) array_sum(array_column($postedLines, 'expected_gross_minor'));
        $pendingLines = array_values(array_filter($lines, fn ($l) => str_starts_with((string) $l['state'], 'withheld_') && $l['expected_gross_minor'] !== null));
        $pending = (int) array_sum(array_column($pendingLines, 'expected_gross_minor'));

        $reference = [
            'basis' => 'per_invoice',
            'components' => [
                'settlement_invoices_minor' => $settlementTotal,
                'walk_in_erp_invoices_minor' => $walkInInvoiceTotal,
                'named_customer_receipts_minor' => $named,
                'earlier_shift_walk_in_collections_minor' => $earlierWalkIn,
                'corporate_receipts_minor' => $corporate,
                'withheld_pending_minor' => $pending,
            ],
            'total_minor' => $settlementTotal + $walkInInvoiceTotal + $named + $earlierWalkIn + $corporate + $pending,
        ];

        // ───── الإقرار ─────
        $declaration = FuelShiftCollectionDeclaration::query()->where('fuel_shift_id', $shift->id)->first();
        $allowed = $this->methods->allowedFor($station)->keyBy('id');
        $dByMethod = [];
        foreach ((array) ($declaration?->lines ?? []) as $declared) {
            $dByMethod[$declared['payment_method_id']] = (int) $declared['amount_minor'];
        }
        if ($declaration === null) {
            $blockers[] = 'FUEL_SETTLEMENT_DECLARATION_MISSING';
        }

        // اتحاد طرق الإقرار والمقبوضات: طريقة فُعِّلت بعد حفظ الإقرار وسُجِّل عليها مقبوض تُعدّ مُقَرّاً بها صفراً (فيُكشف D < R) بدل أن تُتجاهل.
        $u = [];
        foreach (array_unique(array_merge(array_keys($dByMethod), array_map('strval', array_keys($rByMethod)))) as $methodId) {
            $declared = (int) ($dByMethod[$methodId] ?? 0);
            $remaining = $declared - (int) ($rByMethod[$methodId] ?? 0);
            if ($remaining < 0) {
                $blockers[] = 'FUEL_SETTLEMENT_DECLARATION_BELOW_RECEIPTS';
                $remaining = 0;
            }
            $u[$methodId] = $remaining;
        }

        // ───── التخصيص §5.4: الشبكة أولاً ثم النقد؛ أهداف (أ) فواتير عميل المحطة غير المسدَّدة (الأقدم) ثم (ب) فواتير التسوية بترتيب الفوهة ─────
        $targets = [];
        foreach ($walkInSales as $sale) {
            $invoice = $invoices[$sale->invoice_id];
            $left = (int) $invoice->total - (int) $invoice->paid_amount;
            if ($left > 0) {
                $targets[] = ['kind' => 'erp_walk_in', 'ref' => $sale->number, 'invoice_id' => $invoice->id, 'remaining' => $left];
            }
        }
        foreach ($postedLines as $line) {
            $targets[] = ['kind' => 'settlement', 'ref' => 'nozzle:'.$line['nozzle_number'], 'invoice_id' => null, 'remaining' => (int) $line['expected_gross_minor']];
        }
        $heldCap = $pending;

        $order = collect($dByMethod)->keys()->sortBy(fn ($id) => [($allowed->get($id)?->settlement_type === 'bank') ? 0 : 1, (string) $allowed->get($id)?->name])->values();
        $rows = [];
        $held = [];
        $surplus = [];
        foreach ($order as $methodId) {
            $left = (int) ($u[$methodId] ?? 0);
            foreach ($targets as &$target) {
                if ($left <= 0) {
                    break;
                }
                $pay = min($left, $target['remaining']);
                if ($pay > 0) {
                    $rows[] = ['payment_method_id' => $methodId, 'method' => $allowed->get($methodId)?->name, 'settlement_type' => $allowed->get($methodId)?->settlement_type,
                        'target_kind' => $target['kind'], 'target_ref' => $target['ref'], 'invoice_id' => $target['invoice_id'], 'amount_minor' => $pay];
                    $target['remaining'] -= $pay;
                    $left -= $pay;
                }
            }
            unset($target);
            $toHeld = min($left, $heldCap);
            if ($toHeld > 0) {
                $held[$methodId] = $toHeld;
                $heldCap -= $toHeld;
                $left -= $toHeld;
            }
            if ($left > 0) {
                $surplus[$methodId] = $left;
            }
        }
        $shortage = (int) array_sum(array_column($targets, 'remaining'));

        $variances = ['shortage_minor' => $shortage, 'surplus' => [], 'held_for_withheld' => []];
        foreach ($surplus as $methodId => $amount) {
            $variances['surplus'][] = ['payment_method_id' => $methodId, 'method' => $allowed->get($methodId)?->name, 'amount_minor' => $amount];
        }
        foreach ($held as $methodId => $amount) {
            $variances['held_for_withheld'][] = ['payment_method_id' => $methodId, 'method' => $allowed->get($methodId)?->name, 'amount_minor' => $amount];
        }

        $declaredTotal = (int) array_sum($dByMethod);

        return [
            'reference' => $reference,
            'declaration' => [
                'present' => $declaration !== null,
                'revision' => $declaration?->revision,
                'declared_total_minor' => $declaredTotal,
                'by_method' => array_map(fn ($id) => ['payment_method_id' => $id, 'method' => $allowed->get($id)?->name, 'declared_minor' => $dByMethod[$id],
                    'receipts_minor' => (int) ($rByMethod[$id] ?? 0), 'unallocated_minor' => (int) ($u[$id] ?? 0)], array_keys($dByMethod)),
                'difference_vs_reference_minor' => $declaration === null ? null : $declaredTotal - $reference['total_minor'],
            ],
            'allocation' => ['rows' => $rows, 'allocated_total_minor' => (int) array_sum(array_column($rows, 'amount_minor'))],
            'variances' => $variances,
            'blockers' => $blockers,
        ];
    }

    // ═══════════ القيود المتوقعة (وصف بالأدوار لا ترحيل) ═══════════

    /**
     * @param  list<array<string,mixed>>  $lines
     * @param  array<string,mixed>  $allocation
     * @return list<array<string,mixed>>
     */
    private function journal(array $lines, array $allocation, bool $costVisible): array
    {
        $entries = [];
        foreach ($lines as $line) {
            if ($line['state'] !== 'posted' || $line['expected_gross_minor'] === null) {
                continue;
            }
            $entries[] = ['id' => 'J1', 'document' => 'settlement_invoice', 'nozzle' => $line['nozzle_number'], 'estimate' => true,
                'lines' => [['side' => 'debit', 'account' => '1130 العملاء', 'amount_minor' => $line['expected_gross_minor']],
                    ['side' => 'credit', 'account' => '4110 الإيراد + 2120 ضريبة المخرجات', 'amount_minor' => $line['expected_gross_minor']]]];
            if ($costVisible && $line['cost_minor'] !== null) {
                $entries[] = ['id' => 'J2', 'document' => 'cogs', 'nozzle' => $line['nozzle_number'], 'estimate' => true,
                    'lines' => [['side' => 'debit', 'account' => '5110 تكلفة البضاعة', 'amount_minor' => $line['cost_minor']],
                        ['side' => 'credit', 'account' => '1140 المخزون', 'amount_minor' => $line['cost_minor']]]];
            }
        }
        foreach ($allocation['rows'] as $row) {
            $entries[] = ['id' => $row['settlement_type'] === 'bank' ? 'J4' : 'J3', 'document' => 'receipt_voucher', 'target' => $row['target_ref'], 'estimate' => true,
                'lines' => [['side' => 'debit', 'account' => ($row['settlement_type'] === 'bank' ? 'حساب بنك الطريقة: ' : 'خزينة الطريقة: ').$row['method'], 'amount_minor' => $row['amount_minor']],
                    ['side' => 'credit', 'account' => '1130 العملاء', 'amount_minor' => $row['amount_minor']]]];
        }

        return $entries;
    }

    // ═══════════ التمثيل والبصمة ═══════════

    /** @param array<string,mixed> $line @return array<string,mixed> */
    private function presentLine(array $line, bool $finance, bool $cost): array
    {
        $base = [
            'nozzle_id' => $line['nozzle_id'], 'nozzle_number' => $line['nozzle_number'], 'fuel_product_id' => $line['fuel_product_id'],
            'metered_milliliters' => $line['metered_milliliters'], 'withheld' => str_starts_with((string) $line['state'], 'withheld_'),
        ];
        if (! $finance) {
            return $base;
        }
        $base += [
            'erp_milliliters' => $line['erp_milliliters'], 'residual_milliliters' => $line['residual_milliliters'],
            'price_per_liter_minor' => $line['price_per_liter_minor'], 'expected_gross_minor' => $line['expected_gross_minor'],
            'state' => $line['state'], 'withheld_reason' => $line['withheld_reason'],
        ];
        if ($cost) {
            $base['cost_minor'] = $line['cost_minor'];
            $base['cost_blocked'] = $line['cost_blocked'];
        }

        return $base;
    }

    /**
     * بصمة المعاينة (HMAC بمفتاح مشتق لكل مستأجر/وردية): تغطي كل ما يُبنى عليه الترحيل — وتدخل فيها التكلفة دائماً لأنها جزء مما سيُرحَّل، ولا تُكشف منها.
     *
     * @param  list<array<string,mixed>>  $lines
     * @param  array<string,mixed>  $finance
     */
    private function hash(FuelShift $shift, array $lines, array $finance, ?string $taxMode): string
    {
        $canonical = json_encode([
            'shift' => $shift->id, 'tax_mode' => $taxMode,
            'lines' => array_map(fn ($l) => [$l['nozzle_id'], $l['metered_milliliters'], $l['erp_milliliters'], $l['price_per_liter_minor'], $l['expected_gross_minor'], $l['state'], $l['cost_minor']], $lines),
            'declaration' => [$finance['declaration']['revision'], $finance['declaration']['declared_total_minor'], $finance['declaration']['by_method']],
            'allocation' => $finance['allocation']['rows'], 'variances' => $finance['variances'], 'reference' => $finance['reference'],
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        $key = hash_hmac('sha256', 'fuel-settlement-preview|'.$shift->tenant_id.'|'.$shift->id, (string) config('app.key'));

        return hash_hmac('sha256', $canonical, $key);
    }
}
