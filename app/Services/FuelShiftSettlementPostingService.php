<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\User;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Support\SettlementPostingBlocked;
use App\Support\SettlementPostingResult;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * محرك ترحيل تسوية وردية الوقود (P1-3b-2b) — **الكاتب الوحيد** لجداول التسوية (الرأس والأسطر وتاريخ المجمّع المفتوح) وللفواتير/COGS/المخزون الناتجة عنها.
 *
 * ⚠ **غير موصول بأي مسار إنتاجي**: لا الإغلاق ولا مهمة التسوية ولا أي نقطة نهاية تستدعيه (يحرسه اختبار ساكن). يُستدعى في الاختبارات على بيانات معزولة فقط، خلف ثلاثة شروط نشر
 * مستقلة: البوابة العامة + مرجع الرأي الضريبي (`FuelShiftSettlementReadiness::enabled()`)، سياسة المحطة `post_on_close`، وإعلان تفصيل الفواتير `per_nozzle`
 * (`granularityDeclared()`، T-1 غير محسوم). غياب أيٍّ منها ⇒ `blocked` بلا أي كتابة.
 *
 * ═══ نطاق هذه الشريحة ═══
 *  J1 فاتورة لكل فوهة (آجلة للعميل النقدي للمحطة) + J2 تكلفة البضاعة + حركة مخزون خارجة + سجل تشغيلي، عبر الخدمات القائمة فقط (`InvoiceService`/`LedgerService`/`InventoryService`/`FuelCostBasisService`).
 *  **خارجها:** التخصيص والسندات J3/J4 والفروق (2c)، توصيل المهمة (2d)، حسم المحجوب (P1-3c). فالذمة 1130 تبقى مفتوحة بعد هذه الشريحة بقدر الفواتير.
 *
 * ═══ الضمانات ═══
 *  - **ذرّية بصفر أثر**: كل شيء في معاملة واحدة؛ أي استثناء/حجب بعد أول كتابة يُرجعها كاملةً (لا رأس ولا فاتورة ولا قيد ولا ICV ولا حركة).
 *  - **لا ترحيل مكرر**: رأس فريد لكل وردية + قفل الوردية `FOR UPDATE`؛ المحاولة الثانية تُعاد نتيجتها الأولى (`replayed`).
 *  - **ترتيب الأقفال** (يوافق ERP، يمنع الجمود): المحطة NO KEY UPDATE ← الوردية ← (الفوهات/المضخات/الخزانات + **كل الترقيم**: بيع وفاتورة) ← مِرساة المستأجر ← إعادة التقييم ← الترحيل.
 *    (الترقيم قبل المِرساة لا بعدها: وإلا عاكس ترتيب ERP «ترقيم ثم ترحيل» وجمد مع بيع متزامن.)
 *  - **التاريخ**: الفاتورة والقيد والحركة بتاريخ التوريد (يوم إغلاق الوردية بتقويم المحطة)؛ فترة/سنة مقفلة ⇒ `blocked`، لا تاريخ بديل (D-P).
 *  - **السعر**: من تقييم التسوية عند لحظة الإغلاق؛ **التكلفة** عند الترحيل بمتوسط المجمّع الراهن (نافذة التعرّض الممتدة إلى الترحيل تحجب السطر عند حدث تكلفة).
 */
class FuelShiftSettlementPostingService
{
    public function __construct(
        private FuelShiftSettlementEvaluator $evaluator,
        private FuelShiftSettlementReadiness $readiness,
        private FuelSaleService $sales,
        private AccountingDateGuard $dateGuard,
    ) {}

    public function post(FuelShift $shift, User $actor): SettlementPostingResult
    {
        // شروط النشر الثلاثة قبل أي استعلام أو قفل.
        if (! FuelShiftSettlementReadiness::enabled()) {
            return SettlementPostingResult::blocked(['FUEL_SETTLEMENT_GATE_CLOSED']);
        }
        if (! FuelShiftSettlementReadiness::granularityDeclared()) {
            return SettlementPostingResult::blocked(['FUEL_SETTLEMENT_GRANULARITY_NOT_DECLARED']);
        }

        try {
            return DB::transaction(fn () => $this->postInTransaction($shift, $actor));
        } catch (SettlementPostingBlocked $blocked) {
            return SettlementPostingResult::blocked($blocked->reasons);
        } catch (AccountingPeriodLockedException) {
            return SettlementPostingResult::blocked(['FUEL_SETTLEMENT_PERIOD_LOCKED']);
        }
    }

    private function postInTransaction(FuelShift $shift, User $actor): SettlementPostingResult
    {
        // ① المحطة ثم ② الوردية.
        $station = FuelStation::query()->lock('for no key update')->findOrFail($shift->fuel_station_id);
        $shift = FuelShift::query()->lockForUpdate()->findOrFail($shift->id);
        if ($shift->fuel_station_id !== $station->id) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_SHIFT_STATION_MISMATCH']);
        }
        if ($this->readiness->mode($station) !== FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_POLICY_NOT_POST_ON_CLOSE']);
        }
        if ($shift->status !== FuelShift::STATUS_CLOSED && $shift->status !== FuelShift::STATUS_APPROVED) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_SHIFT_NOT_CLOSED']);
        }

        // ③ إعادة آمنة: تسوية هذه الوردية موجودة ⇒ نتيجتها الأولى بلا أي أثر.
        $existing = DB::table('fuel_shift_settlements')->where('tenant_id', $shift->tenant_id)->where('fuel_shift_id', $shift->id)->first();
        if ($existing !== null) {
            return SettlementPostingResult::replayed((string) $existing->id, (string) $existing->status);
        }

        // ④ التقييم الأول (قبل المِرساة): أي حجب ⇒ لا كتابة.
        $first = $this->evaluator->evaluate($shift, now());
        if ($first['blockers'] !== []) {
            throw new SettlementPostingBlocked($first['blockers']);
        }
        $walkIn = $this->readiness->walkInPartner($station);
        if ($walkIn === null) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_WALK_IN_REQUIRED']);
        }

        // ⑤ الرأس والأسطر (جداول التسوية؛ بلا أي أثر محاسبي).
        $settlementId = $this->insertSettlement($shift, $station, $first, $actor);
        $lineIds = $this->insertLines($settlementId, $shift, $station, $first);

        // ⑥ المرحلة 1 قبل المِرساة: مسودات البيع والفواتير (الترقيم وحده). ترتيب ثابت بحسب رقم الفوهة.
        $prepared = [];
        foreach ($first['lines'] as $line) {
            if ($line['state'] !== 'posted') {
                continue;
            }
            $prepared[] = [
                'line' => $line,
                'line_id' => $lineIds[$line['nozzle_id']],
                'draft' => $this->sales->prepareSettlementSale($line, $shift, $walkIn->id, $first['supply']['business_date'], $first['tax_mode'], $actor),
            ];
        }

        // ⑦ مِرساة المستأجر ثم إعادة التقييم تحت الأقفال؛ أي اختلاف ⇒ تراجع كامل وحجب (لا ترحيل على لقطة قديمة).
        $this->dateGuard->lockLedgerAnchor();
        $this->dateGuard->assertOpen($first['supply']['business_date'], 'ترحيل تسوية الوردية');
        $second = $this->evaluator->evaluate($shift, now());
        if ($second['hash'] !== $first['hash']) {
            throw new SettlementPostingBlocked($second['blockers'] !== [] ? $second['blockers'] : ['FUEL_SETTLEMENT_STATE_CHANGED']);
        }

        $this->insertPoolHistories($lineIds, $shift, $station, $first);

        // ⑧ المرحلة 2: الترحيل. الفاتورة والقيد والتكلفة والمخزون عبر الخدمات القائمة، ثم ربط السطر بالبيع (انتقال أحادي).
        $postedLines = 0;
        foreach ($prepared as $item) {
            $sale = $this->sales->postSettlementSale($item['draft']['sale'], $item['draft']['invoice'], $shift, (int) $item['line']['price_per_liter_minor'], $first['tax_mode'], $actor);
            $invoiceTotal = (int) $sale->invoice->total;
            if ($invoiceTotal !== (int) $item['line']['expected_gross_minor']) {
                throw new RuntimeException('FUEL_SETTLEMENT_INVOICE_TOTAL_MISMATCH: إجمالي الفاتورة لا يطابق قيمة التسوية المتوقعة؛ تراجع كامل.');
            }
            DB::table('fuel_shift_settlement_lines')->where('id', $item['line_id'])->update(['fuel_sale_id' => $sale->id, 'updated_at' => now()]);
            $postedLines++;
        }

        $withheld = count(array_filter($first['lines'], fn (array $l) => str_starts_with($l['state'], 'withheld_')));

        return SettlementPostingResult::posted($settlementId, $this->headerStatus($first['lines']), $postedLines, $withheld);
    }

    /** @param list<array<string,mixed>> $lines */
    private function headerStatus(array $lines): string
    {
        $states = array_column($lines, 'state');
        if (in_array('posted', $states, true)) {
            return 'posted';
        }
        if (array_filter($states, fn ($s) => str_starts_with($s, 'withheld_')) !== []) {
            return 'withheld';
        }

        return 'no_residual';
    }

    /** @param array<string,mixed> $evaluation */
    private function insertSettlement(FuelShift $shift, FuelStation $station, array $evaluation, User $actor): string
    {
        $lines = $evaluation['lines'];
        $id = (string) Str::uuid();
        DB::table('fuel_shift_settlements')->insert([
            'id' => $id, 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_station_id' => $station->id, 'fuel_shift_id' => $shift->id,
            'status' => $this->headerStatus($lines), 'sales_basis' => 'per_invoice', 'preview_hash' => $evaluation['hash'], 'tax_mode' => $evaluation['tax_mode'],
            'policy_snapshot' => json_encode(['mode' => FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE, 'granularity' => 'per_nozzle', 'engine' => 'p1-3b-2b'], JSON_UNESCAPED_UNICODE),
            'metered_milliliters' => (int) array_sum(array_column($lines, 'metered_milliliters')),
            'erp_milliliters' => (int) array_sum(array_column($lines, 'erp_milliliters')),
            'residual_milliliters' => (int) array_sum(array_column($lines, 'residual_milliliters')),
            'settled_invoice_total_minor' => (int) array_sum(array_map(fn ($l) => $l['state'] === 'posted' ? (int) $l['expected_gross_minor'] : 0, $lines)),
            'pending_value_minor' => (int) array_sum(array_map(fn ($l) => (int) ($l['pending_value_minor'] ?? 0), $lines)),
            'reference_total_minor' => null,
            'created_by' => $actor->id, 'settled_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            // التواريخ 1 و2 (لقطة ثابتة)؛ التاريخان 3 و4 يُقرآن من الفاتورة والقيد لاحقاً (FuelShiftSettlementDates).
            'supply_started_at' => $evaluation['supply']['started_at'], 'supply_ended_at' => $evaluation['supply']['ended_at'],
            'supply_business_date' => $evaluation['supply']['business_date'], 'accounting_date' => $evaluation['supply']['business_date'],
        ]);

        return $id;
    }

    /**
     * @param  array<string,mixed>  $evaluation
     * @return array<string,string> معرّف السطر لكل فوهة
     */
    private function insertLines(string $settlementId, FuelShift $shift, FuelStation $station, array $evaluation): array
    {
        $ids = [];
        foreach ($evaluation['lines'] as $line) {
            $id = (string) Str::uuid();
            $ids[$line['nozzle_id']] = $id;
            DB::table('fuel_shift_settlement_lines')->insert([
                'id' => $id, 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_shift_settlement_id' => $settlementId,
                'fuel_nozzle_id' => $line['nozzle_id'], 'fuel_product_id' => $line['fuel_product_id'], 'warehouse_id' => $station->warehouse_id,
                'metered_milliliters' => (int) $line['metered_milliliters'], 'erp_milliliters' => (int) $line['erp_milliliters'], 'residual_milliliters' => (int) $line['residual_milliliters'],
                'price_per_liter_minor' => $line['price_per_liter_minor'], 'tax_mode' => $evaluation['tax_mode'], 'expected_gross_minor' => $line['expected_gross_minor'],
                'state' => $line['state'], 'withheld_reason' => $line['withheld_reason'], 'pending_value_minor' => $line['pending_value_minor'],
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        return $ids;
    }

    /**
     * تاريخ المجمّع المفتوح للأسطر المحجوبة. **بعد** إعادة التقييم لا قبلها: صفّه المفتوح يجعل التقييم يرى `withheld_pool_history_open` بدل السبب الأصلي فتتباين البصمتان
     * بفعلنا نحن (حالة ذاتية لا تغيّراً في الواقع).
     *
     * @param  array<string,string>  $lineIds
     * @param  array<string,mixed>  $evaluation
     */
    private function insertPoolHistories(array $lineIds, FuelShift $shift, FuelStation $station, array $evaluation): void
    {
        foreach ($evaluation['lines'] as $line) {
            if ($line['withheld_reason'] === null) {
                continue;
            }
            DB::table('fuel_cost_pool_open_histories')->insert([
                'id' => (string) Str::uuid(), 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_station_id' => $station->id,
                'warehouse_id' => $station->warehouse_id, 'fuel_product_id' => $line['fuel_product_id'], 'fuel_shift_settlement_line_id' => $lineIds[$line['nozzle_id']],
                'reason' => $line['withheld_reason'], 'opened_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }
}
