<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\Invoice;
use App\Models\User;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\PaymentService;
use App\Support\SettlementPostingBlocked;
use App\Support\SettlementPostingResult;
use App\Tenancy\BranchContext;
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
        private PaymentService $payments,
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

        // تنافس عابر على المِرساة (`LOCK_BUSY`): محاولتان إضافيتان بمهلة عشوائية قصيرة داخل العملية نفسها قبل أن يعود الحجب (فلا تُرحَّل الوردية بتأخير 10 دقائق لتنافس لحظي).
        $attempts = 3;
        for ($i = 1; $i <= $attempts; $i++) {
            try {
                return DB::transaction(fn () => $this->postInTransaction($shift, $actor));
            } catch (SettlementPostingBlocked $blocked) {
                if ($i < $attempts && $blocked->reasons === ['FUEL_SETTLEMENT_LOCK_BUSY']) {
                    usleep(random_int(50_000, 250_000));

                    continue;
                }

                return SettlementPostingResult::blocked($blocked->reasons);
            } catch (AccountingPeriodLockedException) {
                return SettlementPostingResult::blocked(['FUEL_SETTLEMENT_PERIOD_LOCKED']);
            }
        }

        return SettlementPostingResult::blocked(['FUEL_SETTLEMENT_LOCK_BUSY']);
    }

    private function postInTransaction(FuelShift $shift, User $actor): SettlementPostingResult
    {
        // ① المحطة ثم ② الوردية.
        $station = FuelStation::query()->lock('for no key update')->findOrFail($shift->fuel_station_id);
        $shift = FuelShift::query()->lockForUpdate()->findOrFail($shift->id);
        if ($shift->fuel_station_id !== $station->id) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_SHIFT_STATION_MISMATCH']);
        }

        // ③ التفويض قبل أي شيء آخر (حتى الإعادة): مستخدم من المؤسسة نفسها ونطاقه يشمل المحطة، والمحطة نشطة وضمن الفرع النشط.
        if ($actor->tenant_id !== $shift->tenant_id || ! $actor->canAccessFuelStation($station)) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_ACTOR_OUT_OF_SCOPE']);
        }
        $activeBranch = app(BranchContext::class)->id();
        if ($station->status !== FuelStation::STATUS_ACTIVE || ($activeBranch !== null && $station->branch_id !== $activeBranch)) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_STATION_UNAVAILABLE']);
        }

        // ④ إعادة آمنة: تسوية هذه الوردية موجودة ⇒ نتيجتها الأولى بلا أي أثر (قبل فحص السياسة: تغيّر السياسة لاحقاً لا يحوّل ترحيلاً قائماً إلى «محجوب»).
        $existing = DB::table('fuel_shift_settlements')->where('tenant_id', $shift->tenant_id)->where('fuel_shift_id', $shift->id)->first();
        if ($existing !== null) {
            return SettlementPostingResult::replayed((string) $existing->id, (string) $existing->status);
        }
        if ($this->readiness->mode($station) !== FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_POLICY_NOT_POST_ON_CLOSE']);
        }
        if ($shift->status !== FuelShift::STATUS_CLOSED && $shift->status !== FuelShift::STATUS_APPROVED) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_SHIFT_NOT_CLOSED']);
        }

        // ⑤ التقييم الأول (قبل المِرساة): أي حجب ⇒ لا كتابة.
        $first = $this->evaluator->evaluate($shift, now());
        if ($first['blockers'] !== []) {
            throw new SettlementPostingBlocked($first['blockers']);
        }
        $walkIn = $this->readiness->walkInPartner($station);
        if ($walkIn === null) {
            throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_WALK_IN_REQUIRED']);
        }

        // ⑥ أقفال الصفوف الخارجية **قبل المِرساة ودون أي إدراج**: كل إدراج يأخذ KEY SHARE على صف المستأجر (مفتاح أجنبي) وهو يتعارض مع قفل المِرساة FOR UPDATE ⇒
        //    إدراج مبكر في معاملتين من فرعين مختلفين = جمود متبادل (أثبتته اختبارات PostgreSQL). لذلك: صفوف (فوهات/مضخات/خزانات) ثم بيوع وفواتير ERP المستهدفة
        //    (الترتيب نفسه لتحصيل ERP: بيع ← فاتورة) ثم ترقيم الفرع ثم المِرساة؛ وكل الإدراجات بعدها.
        $this->sales->lockSettlementRows($shift, $first['lines'], array_values(array_unique(array_column($first['finance']['allocation']['rows'] ?? [], 'payment_method_id'))));
        $this->lockErpTargets($first['finance']['allocation']['rows'] ?? []);
        Branch::query()->whereKey($station->branch_id)->lock('for no key update')->first();

        // ⑦ مِرساة المستأجر ثم فحص الفترات (تاريخ التوريد وتاريخ التحصيل كلٌّ على حدة) وإعادة التقييم تحت الأقفال؛ أي اختلاف ⇒ تراجع كامل وحجب.
        $this->lockAnchorOrYield();
        $this->dateGuard->assertOpen($first['supply']['business_date'], 'ترحيل تسوية الوردية');
        $hasAllocation = ($first['finance']['allocation']['rows'] ?? []) !== [];
        if ($hasAllocation && $first['collection']['collection_date'] !== null) {
            $this->dateGuard->assertOpen($first['collection']['collection_date'], 'تحصيل تسوية الوردية');
        }
        $second = $this->evaluator->evaluate($shift, now());
        if ($second['hash'] !== $first['hash']) {
            throw new SettlementPostingBlocked($second['blockers'] !== [] ? $second['blockers'] : ['FUEL_SETTLEMENT_STATE_CHANGED']);
        }

        // ⑧ الكتابة: الرأس والأسطر وتاريخ المجمّع المفتوح (الأسطر تحمل ربط البيع لاحقاً بتحديث أحادي).
        $settlementId = (string) Str::uuid();
        $lineIds = [];
        foreach ($first['lines'] as $line) {
            $lineIds[$line['nozzle_id']] = (string) Str::uuid();
        }
        $this->insertSettlement($settlementId, $shift, $station, $first, $actor);
        $this->insertLines($lineIds, $settlementId, $shift, $station, $first);
        $this->insertPoolHistories($lineIds, $shift, $station, $first);

        // ⑨ الفواتير: مسودة ثم ترحيل لكل فوهة (ترتيب ثابت). الفاتورة والقيد والتكلفة والمخزون عبر الخدمات القائمة، ثم ربط السطر بالبيع (انتقال أحادي).
        $postedLines = 0;
        $invoiceByNozzle = [];
        foreach ($first['lines'] as $line) {
            if ($line['state'] !== 'posted') {
                continue;
            }
            $draft = $this->sales->prepareSettlementSale($line, $shift, $walkIn->id, $first['supply']['business_date'], $first['tax_mode'], $actor);
            try {
                $sale = $this->sales->postSettlementSale($draft['sale'], $draft['invoice'], $shift, (int) $line['price_per_liter_minor'], $first['tax_mode'], $actor);
            } catch (RuntimeException $e) {
                // رصيد المجمّع تغيّر بين التقييم والإخراج (إخراج ERP مواكب) ⇒ حجب مقروء بدل خطأ عام؛ التراجع كامل.
                if (str_contains($e->getMessage(), 'أقل من المطلوب')) {
                    throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_INSUFFICIENT_STOCK']);
                }
                throw $e;
            }
            if ((int) $sale->invoice->total !== (int) $line['expected_gross_minor']) {
                throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_INVOICE_TOTAL_MISMATCH']);
            }
            DB::table('fuel_shift_settlement_lines')->where('id', $lineIds[$line['nozzle_id']])->update(['fuel_sale_id' => $sale->id, 'updated_at' => now()]);
            $invoiceByNozzle[$line['nozzle_id']] = (string) $sale->invoice_id;
            $postedLines++;
        }

        // ⑩ السندات (J3 نقد / J4 شبكة) بتاريخ التحصيل الفعلي عبر `PaymentService`، ثم الفروق (سجل بلا قيد).
        $this->postCollections($settlementId, $shift, $station, $walkIn->id, $first, $invoiceByNozzle, $actor);
        $this->insertVariances($settlementId, $shift, $first);

        $withheld = count(array_filter($first['lines'], fn (array $l) => str_starts_with($l['state'], 'withheld_')));

        return SettlementPostingResult::posted($settlementId, $this->headerStatus($first['lines'], $hasAllocation), $postedLines, $withheld);
    }

    /**
     * بيوع وفواتير ERP المستهدفة بالتخصيص تُقفل بمعرّفات مرتَّبة (بيع ثم فاتورة) قبل المِرساة: يتسلسل التسوية مع تحصيل ERP اليدوي على الفاتورة نفسها دون جمود.
     *
     * @param  list<array<string,mixed>>  $rows
     */
    private function lockErpTargets(array $rows): void
    {
        $invoiceIds = collect($rows)->where('target_kind', 'erp_walk_in')->pluck('invoice_id')->filter()->unique()->sort()->values()->all();
        if ($invoiceIds === []) {
            return;
        }
        FuelSale::query()->whereIn('invoice_id', $invoiceIds)->orderBy('id')->lockForUpdate()->get();
        Invoice::query()->whereIn('id', $invoiceIds)->orderBy('id')->lockForUpdate()->get();
    }

    /**
     * @param  array<string,mixed>  $evaluation
     * @param  array<string,string>  $invoiceByNozzle  معرّف الفوهة ⇒ معرّف فاتورة التسوية (رقم الفوهة فريد لكل مضخة لا لكل محطة)
     */
    private function postCollections(string $settlementId, FuelShift $shift, FuelStation $station, string $walkInId, array $evaluation, array $invoiceByNozzle, User $actor): void
    {
        $collectionDate = $evaluation['collection']['collection_date'];
        $collectedAt = $evaluation['collection']['collected_at'];
        foreach ($evaluation['finance']['allocation']['rows'] ?? [] as $row) {
            $invoiceId = $row['invoice_id'] ?? $invoiceByNozzle[$row['nozzle_id'] ?? ''] ?? null;
            if ($invoiceId === null || $collectionDate === null || $collectedAt === null) {
                throw new RuntimeException('FUEL_SETTLEMENT_COLLECTION_TARGET_UNRESOLVED: تعذر تحديد فاتورة أو تاريخ تحصيل لتخصيص التسوية.');
            }
            try {
                $payment = $this->payments->post($this->payments->create([
                    'partner_id' => $walkInId,
                    'invoice_id' => $invoiceId,
                    'branch_id' => $station->branch_id,
                    'direction' => 'received',
                    'payment_method_id' => $row['payment_method_id'],
                    'amount' => (int) $row['amount_minor'],
                    'payment_date' => $collectionDate,            // تاريخ التحصيل الفعلي — لا تاريخ التوريد ولا تاريخ الترحيل
                    'notes' => "تحصيل تسوية وردية {$shift->number}",
                    'created_by' => $actor->id,
                ]), $actor);
            } catch (AccountingPeriodLockedException $e) {
                throw $e;
            } catch (RuntimeException $e) {
                // رفض خدمة السندات (خزينة/تخويل إيداع/طريقة غير صالحة…): حجب مقروء برمز ثابت بدل خطأ عام يعيده الطابور بلا نهاية؛ التراجع كامل. السبب في السجل لا في الرمز.
                report($e);
                throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_RECEIPT_REJECTED']);
            }
            DB::table('fuel_shift_settlement_collections')->insert([
                'id' => (string) Str::uuid(), 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_shift_settlement_id' => $settlementId,
                'payment_method_id' => $row['payment_method_id'], 'invoice_id' => $invoiceId, 'payment_id' => $payment->id,
                'target_kind' => $row['target_kind'], 'amount_minor' => (int) $row['amount_minor'],
                'collected_at' => $collectedAt, 'collection_date' => $collectionDate,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    /** @param array<string,mixed> $evaluation */
    private function insertVariances(string $settlementId, FuelShift $shift, array $evaluation): void
    {
        $variances = $evaluation['finance']['variances'] ?? [];
        $methodTypes = DB::table('payment_methods')->whereIn('id', array_merge(
            array_column($variances['surplus'] ?? [], 'payment_method_id'),
            array_column($variances['held_for_withheld'] ?? [], 'payment_method_id'),
        ))->pluck('settlement_type', 'id');
        $base = ['tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_shift_settlement_id' => $settlementId, 'created_at' => now(), 'updated_at' => now()];

        if ((int) ($variances['shortage_minor'] ?? 0) > 0) {
            DB::table('fuel_shift_settlement_variances')->insert($base + ['id' => (string) Str::uuid(), 'payment_method_id' => null, 'settlement_type' => null, 'kind' => 'shortage', 'amount_minor' => (int) $variances['shortage_minor']]);
        }
        foreach (['surplus' => 'surplus', 'held_for_withheld' => 'held_for_withheld'] as $key => $kind) {
            foreach ($variances[$key] ?? [] as $item) {
                DB::table('fuel_shift_settlement_variances')->insert($base + [
                    'id' => (string) Str::uuid(), 'payment_method_id' => $item['payment_method_id'], 'settlement_type' => $methodTypes[$item['payment_method_id']] ?? null,
                    'kind' => $kind, 'amount_minor' => (int) $item['amount_minor'],
                ]);
            }
        }
    }

    /**
     * المِرساة بمهلة قفل قصيرة (PostgreSQL): المحرك يمسك ترقيم الفرع **ثم** يطلب المِرساة، وفاتورة نقدية عامة مدفوعة تمسك المِرساة **ثم** ترقّم سندها على الفرع نفسه (ترتيب معاكس
     * سابق في ERP) ⇒ دورة حقيقية أثبتها اختبار PostgreSQL بخدمتين حقيقيتين (40P01). المحرك هو من يتنحّى: مهلة أقل من `deadlock_timeout` فلا يُختار مستند المستخدم ضحيةً أبداً؛
     * يعود حجباً مقروءاً `FUEL_SETTLEMENT_LOCK_BUSY` بلا أي كتابة وتعيده المهمة لاحقاً (لا يستهلك ميزانية الأخطاء). تنافس عادي أقصر من المهلة لا يتأثر.
     */
    private function lockAnchorOrYield(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->dateGuard->lockLedgerAnchor();

            return;
        }
        $previous = (string) (DB::selectOne("select current_setting('lock_timeout') as v")->v ?? '0');
        // المهلة لا تتجاوز نصف `deadlock_timeout` الفعلي (وإلا اختار كاشف الجمود مستند المستخدم ضحيةً) ولا تتجاوز مهلة خارجية أصرم إن وُجدت.
        $deadlockMs = (int) (DB::selectOne("select setting::int as v from pg_settings where name = 'deadlock_timeout'")->v ?? 1000);
        $waitMs = max(50, min((int) config('fuel_stations.settlement_job.anchor_wait_ms', 700), intdiv($deadlockMs, 2)));
        $outerMs = (int) (DB::selectOne("select setting::int as v from pg_settings where name = 'lock_timeout'")->v ?? 0);
        if ($outerMs > 0) {
            $waitMs = min($waitMs, $outerMs);
        }
        DB::select("select set_config('lock_timeout', ?, true)", [$waitMs.'ms']);
        try {
            $this->dateGuard->lockLedgerAnchor();
        } catch (\Illuminate\Database\QueryException $e) {
            if ((string) ($e->errorInfo[0] ?? '') === '55P03') {
                throw new SettlementPostingBlocked(['FUEL_SETTLEMENT_LOCK_BUSY']);
            }
            throw $e;
        }
        DB::select("select set_config('lock_timeout', ?, true)", [$previous]);
    }

    /** @param list<array<string,mixed>> $lines */
    private function headerStatus(array $lines, bool $hasAllocation = false): string
    {
        $states = array_column($lines, 'state');
        if (in_array('posted', $states, true)) {
            return 'posted';
        }
        if (array_filter($states, fn ($s) => str_starts_with($s, 'withheld_')) !== []) {
            return 'withheld';
        }

        return $hasAllocation ? 'allocation_only' : 'no_residual';
    }

    /** @param array<string,mixed> $evaluation */
    private function insertSettlement(string $id, FuelShift $shift, FuelStation $station, array $evaluation, User $actor): void
    {
        $lines = $evaluation['lines'];
        DB::table('fuel_shift_settlements')->insert([
            'id' => $id, 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_station_id' => $station->id, 'fuel_shift_id' => $shift->id,
            'status' => $this->headerStatus($lines, ($evaluation['finance']['allocation']['rows'] ?? []) !== []), 'sales_basis' => 'per_invoice', 'preview_hash' => $evaluation['hash'], 'tax_mode' => $evaluation['tax_mode'],
            'policy_snapshot' => json_encode(['mode' => FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE, 'granularity' => 'per_nozzle', 'engine' => 'p1-3b-2b'], JSON_UNESCAPED_UNICODE),
            'metered_milliliters' => (int) array_sum(array_column($lines, 'metered_milliliters')),
            'erp_milliliters' => (int) array_sum(array_column($lines, 'erp_milliliters')),
            'residual_milliliters' => (int) array_sum(array_column($lines, 'residual_milliliters')),
            'settled_invoice_total_minor' => (int) array_sum(array_map(fn ($l) => $l['state'] === 'posted' ? (int) $l['expected_gross_minor'] : 0, $lines)),
            'pending_value_minor' => (int) array_sum(array_map(fn ($l) => (int) ($l['pending_value_minor'] ?? 0), $lines)),
            'reference_total_minor' => $evaluation['finance']['reference']['total_minor'] ?? null,
            'created_by' => $actor->id, 'settled_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            // التواريخ 1 و2 (لقطة ثابتة)؛ التاريخان 3 و4 يُقرآن من الفاتورة والقيد لاحقاً (FuelShiftSettlementDates).
            'supply_started_at' => $evaluation['supply']['started_at'], 'supply_ended_at' => $evaluation['supply']['ended_at'],
            'supply_business_date' => $evaluation['supply']['business_date'], 'accounting_date' => $evaluation['supply']['business_date'],
        ]);
    }

    /**
     * @param  array<string,string>  $lineIds  معرّف السطر لكل فوهة (مولَّد مسبقاً)
     * @param  array<string,mixed>  $evaluation
     */
    private function insertLines(array $lineIds, string $settlementId, FuelShift $shift, FuelStation $station, array $evaluation): void
    {
        foreach ($evaluation['lines'] as $line) {
            $id = $lineIds[$line['nozzle_id']];
            DB::table('fuel_shift_settlement_lines')->insert([
                'id' => $id, 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_shift_settlement_id' => $settlementId,
                'fuel_nozzle_id' => $line['nozzle_id'], 'fuel_product_id' => $line['fuel_product_id'], 'warehouse_id' => $station->warehouse_id,
                'metered_milliliters' => (int) $line['metered_milliliters'], 'erp_milliliters' => (int) $line['erp_milliliters'], 'residual_milliliters' => (int) $line['residual_milliliters'],
                'price_per_liter_minor' => $line['price_per_liter_minor'], 'tax_mode' => $evaluation['tax_mode'], 'expected_gross_minor' => $line['expected_gross_minor'],
                'state' => $line['state'], 'withheld_reason' => $line['withheld_reason'], 'pending_value_minor' => $line['pending_value_minor'],
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
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
