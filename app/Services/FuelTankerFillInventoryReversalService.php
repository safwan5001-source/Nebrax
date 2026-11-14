<?php

namespace App\Services;

use App\Models\FuelInventoryCostMovement;
use App\Models\FuelOperationalLedger;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankerFill;
use App\Models\JournalEntry;
use App\Models\User;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * TANKER-PR6B-4 — **العكس المخزني والمحاسبي بالتكلفة التاريخية** لسند تعبئة صهريج مرحَّل (الكاتب الوحيد لحالة `reversed` ولحركتَي العكس).
 * خلف البوابات الثلاث نفسها (PR-1 وPR-4 وبوابة الترحيل `FUEL_TANKER_INVENTORY_POSTING_ENABLED` المغلقة افتراضياً) وصلاحية `fuel.tanker.fill.inventory.reverse`.
 *
 * ## ما يُعكس وبأي قيمة (D-6B-3 — توصية مستند المراجعة المرجعي، لا اعتماد محاسبي نهائي ولا إذن تفعيل إنتاجي)
 * - **الكمية والتكلفة من صف الترحيل الثابت ومن حركة الصرف الأصلية** (مُشغّلات PR-6B-2 تحرسهما)، **لا** من متوسط اليوم ولا من أي قيمة يرسلها العميل (الجسم `reason` فقط).
 * - **القيد:** `LedgerService::reverse` على القيد الأصلي ⇒ **الحسابات والمبلغ التاريخيان نفسهما** (مدين مخزون الوقود / دائن الحساب الوسيط) حتى لو تغيّر تعيين الحساب الوسيط أو تعطّل بعد الترحيل؛
 *   يُؤرَّخ بتاريخ العكس (يوم المحطة الآن) فيُرفض إن وقع في فترة/سنة مقفلة، ولا يحتاج فتح فترة القيد الأصلي. القيد الأصلي لا يُعدَّل (حالته فقط `reversed` عبر المحرك).
 * - **المخزون:** حركة وارد (`in`) بقيمة الصرف الأصلية (`applyReceipt` بوسم المجمّع)، و**المجمّع:** `FuelCostBasisService::recordIssueReversal` (حركة `issue_reversal` مستقلة، الباقي الكسري المحمول لا يُمسّ).
 *
 * ## الضوابط
 * ترحيل أصلي صحيح فقط (لا عكس بلا ترحيل) · مرة واحدة (idempotent بالمفتاح الحتمي `tanker-fill-reverse:{fill_id}` وبقيد القاعدة) · سبب إلزامي · لا عكس لسند له ربط لاحق (فوترة/توريد/تسوية — الأعمدة المستقبلية تُفحص إن وُجدت) ·
 * محطة `post_on_close` محجوبة (C-1: لا تزدوج الإرجاعات مع التسوية قبل PR-8) · سياسة مطابقة المجمّع والأستاذ نفسها · أي فشل يُرجع **كل** المعاملة (لا عودة جزئية للمخزون).
 *
 * ## ترتيب الأقفال (مطابق للترحيل ولمسار الفقد)
 * محطة `FOR NO KEY UPDATE` ← السند `FOR UPDATE` ← صف الترحيل `FOR UPDATE` ← الخزان `FOR KEY SHARE` ← المنتج `FOR NO KEY UPDATE` ← مِرساة المستأجر ← رصيد المخزن (+ حالة التكلفة داخل `FuelCostBasisService`).
 *
 * ## ترتيب الكتابة (تفرضه مُشغّلات PR-6B-2)
 * حركة المخزون `in` ← قيد العكس ← حركة التكلفة `issue_reversal` (مربوطة بقيد العكس) ← **تحويل صف الترحيل إلى `reversed`** (المُشغّل يحوّل السند `reversed` ذرّياً ويتحقق من تطابق الحركتين) ← صف الدفتر التشغيلي `tanker_fill_reversal` ← التدقيق ← محاولة ناجحة.
 */
class FuelTankerFillInventoryReversalService
{
    use FuelTankerFillInventorySupport;

    public const KEY_PREFIX = 'tanker-fill-reverse:';

    private const REASON_MAX = 500;

    public function __construct(
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private InventoryService $inventory,
        private LedgerService $ledger,
        private FuelQuantity $quantity,
        private FuelTankerFillInventoryReadiness $readiness,
        private FuelInventoryLedgerReconciliation $reconciliation,
        private FuelStationAuditTrail $audit,
        private TenantContext $tenant,
    ) {}

    private function attemptOperation(): string
    {
        return 'reverse';
    }

    private function attemptKeyPrefix(): string
    {
        return self::KEY_PREFIX;
    }

    /** البوابات الثلاث نفسها للترحيل (PR-1 وPR-4 والترحيل). */
    public static function enabled(): bool
    {
        return FuelTankerFillInventoryPostingService::enabled();
    }

    /**
     * @param  array{reason?: ?string}  $options
     * @return array{fill: FuelTankerFill, posting: array<string, mixed>, replayed: bool}
     *
     * @throws FuelTankerFillException
     */
    public function reverse(FuelTankerFill $fill, User $actor, array $options = []): array
    {
        $this->assertEnabled();
        $this->requirePermission($actor, 'fuel.tanker.fill.inventory.reverse');
        $reason = $this->cleanReason($options['reason'] ?? null);
        if ($reason === null) {
            throw new FuelTankerFillException(FuelTankerFillException::REVERSAL_REASON_REQUIRED, 'سبب العكس إلزامي.');
        }

        /** @var array{fill: FuelTankerFill, station: FuelStation}|null $context يُملأ بعد تحديد السند ونطاقه (لتسجيل المحاولة المرفوضة) */
        $context = null;

        try {
            return DB::transaction(function () use ($fill, $actor, $reason, &$context) {
                return $this->reverseInTransaction($fill, $actor, $reason, $context);
            });
        } catch (Throwable $exception) {
            $domain = $this->toDomain($exception);
            if ($context !== null) {
                $this->recordFailedAttempt($context['fill'], $context['station'], $actor, $domain);
            }
            throw $domain;
        }
    }

    /**
     * معاينة أثر العكس (قراءة فقط، بلا قفل ولا كتابة): حالة الترحيل الأصلي والموانع وتاريخ العكس والقيد العكسي المقترح بـ**حسابات القيد الأصلي ومبلغه**.
     * معرّفات الحسابات لمن يملك `accounts.view` والمبلغ ومعرّف القيد لمن يملك `products.view_cost` (شرطان مستقلان).
     *
     * @return array<string, mixed>
     *
     * @throws FuelTankerFillException
     */
    public function preview(FuelTankerFill $fill, User $actor): array
    {
        $this->assertEnabled();
        $this->requirePermission($actor, 'fuel.tanker.fill.inventory.view');
        $station = FuelStation::query()->find($fill->fuel_station_id);
        if ($station === null || ! $this->accessible($station, $actor)) {
            throw $this->notFound();
        }

        $posting = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $fill->tenant_id)->where('fuel_tanker_fill_id', $fill->id)->first();
        $blockers = [];
        $entry = null;
        $reversalDate = $this->settings->businessDate($station, now());
        $canSeeCost = $actor->hasPermission('products.view_cost');
        $canSeeAccounts = $actor->hasPermission('accounts.view');

        if ($posting === null || $posting->status !== 'posted') {
            $blockers[] = $posting === null ? 'not_posted' : 'already_reversed';
        } else {
            $blockers = [...$blockers, ...$this->downstreamBlockers($posting)];
            if ($this->settings->get($station, 'shift_settlement_mode') === FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
                $blockers[] = FuelTankerFillInventoryReadiness::B_SETTLEMENT_MODE_CONFLICT;
            }
            if ($this->readiness->dateClosed((string) $fill->tenant_id, $reversalDate)) {
                $blockers[] = FuelTankerFillInventoryReadiness::B_PERIOD_LOCKED;
            }
            $original = $this->originalEntry($posting, $fill);
            if ($original === null) {
                $blockers[] = 'original_entry_invalid';
            } else {
                $lines = $original->lines->map(fn ($line) => [
                    'side' => (int) $line->credit > 0 ? 'debit' : 'credit', // العكس يقلب الجانب
                    'account_id' => $canSeeAccounts ? $line->account_id : null,
                ])->values()->all();
                $entry = ['lines' => $lines, 'entry_date' => $reversalDate, 'amount_minor' => $canSeeCost ? (int) $posting->posted_cost_minor : null];
            }
        }

        return [
            'fill_id' => $fill->id,
            'status' => $posting !== null && $posting->status === 'posted' ? ($blockers === [] ? 'reversible' : 'blocked') : 'not_applicable',
            'posting_status' => $posting?->status,
            'blockers' => array_values(array_unique($blockers)),
            'quantity_milliliters' => $posting === null ? null : (int) $posting->quantity_milliliters,
            'reversal_date' => $reversalDate,
            'valuation' => 'historical_cost',
            'requires' => ['permission' => 'fuel.tanker.fill.inventory.reverse', 'reason' => true],
            'entry' => $entry,
        ];
    }

    // ───────────────────────── المعاملة ─────────────────────────

    /**
     * @param  array{fill: FuelTankerFill, station: FuelStation}|null  $context
     * @return array{fill: FuelTankerFill, posting: array<string, mixed>, replayed: bool}
     */
    private function reverseInTransaction(FuelTankerFill $fill, User $actor, string $reason, ?array &$context): array
    {
        $tenantId = (string) $this->tenant->id();

        // ① المحطة ثم السند ثم صف الترحيل (ترتيب الترحيل/الإلغاء نفسه).
        $station = FuelStation::query()->lock('for no key update')->find($fill->fuel_station_id);
        if ($station === null || ! $this->accessible($station, $actor)) {
            throw $this->notFound();
        }
        $locked = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->lockForUpdate()->find($fill->id);
        if ($locked === null || $locked->fuel_station_id !== $station->id) {
            throw $this->notFound();
        }
        $context = ['fill' => $locked, 'station' => $station];

        $posting = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $tenantId)->where('fuel_tanker_fill_id', $locked->id)->lockForUpdate()->first();
        if ($posting === null) {
            throw new FuelTankerFillException(FuelTankerFillException::FILL_NOT_POSTED, 'لا ترحيل أصلي لهذا السند؛ لا يُعكس ما لم يُرحَّل.', 409);
        }
        // الإعادة بالمفتاح الحتمي تُحسم قبل أي تقييم جديد (الفترة قد أُقفلت والإعدادات تغيّرت): تعيد العكس الأول بلا أثر.
        if ($posting->status === 'reversed') {
            return ['fill' => $locked->fresh(), 'posting' => $this->postingSummary($posting), 'replayed' => true];
        }
        if ($posting->status !== 'posted' || $locked->inventory_status !== FuelTankerFill::INVENTORY_POSTED) {
            throw new FuelTankerFillException(FuelTankerFillException::FILL_NOT_POSTED, 'السند ليس في حالة «مرحَّل».', 409);
        }
        $downstream = $this->downstreamBlockers($posting);
        if ($downstream !== []) {
            throw new FuelTankerFillException(FuelTankerFillException::REVERSAL_BLOCKED, 'السند مرتبط بعملية لاحقة (فوترة/توريد/تسوية) تمنع عكسه مخزنياً.', 422, ['blockers' => $downstream]);
        }
        if ($this->settings->get($station, 'shift_settlement_mode') === FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
            throw new FuelTankerFillException(FuelTankerFillException::REVERSAL_BLOCKED, 'محطة بوضع التسوية عند الإغلاق: يُحجب العكس لمنع الخصم/الإرجاع المزدوج حتى حل PR-8.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_SETTLEMENT_MODE_CONFLICT]]);
        }

        // الحقائق التاريخية من صف الترحيل نفسه لا من إعدادات المحطة الحالية.
        $quantity = (int) $posting->quantity_milliliters;
        $cost = (int) $posting->posted_cost_minor;
        $warehouse = \App\Models\Warehouse::query()->whereKey($posting->warehouse_id)->first();
        $fuelProduct = \App\Models\FuelProduct::query()->find($posting->fuel_product_id);
        $product = $fuelProduct?->product_id === null ? null : BranchScope::reference(\App\Models\Product::class)->find($fuelProduct->product_id);
        if ($warehouse === null || $fuelProduct === null || $product === null || ! $product->track_inventory) {
            throw new FuelTankerFillException(FuelTankerFillException::REVERSAL_BLOCKED, 'مخزن/منتج الترحيل الأصلي غير متاح للعكس.', 422);
        }
        $this->quantity->assertFuelUnitMapping($fuelProduct, $product);

        // ② الأقفال: الخزان ← المنتج ← مِرساة المستأجر ← رصيد المخزن.
        FuelTank::query()->whereKey($locked->fuel_tank_id)->lock('for key share')->first();
        BranchScope::reference(\App\Models\Product::class)->lock('for no key update')->findOrFail($product->id);
        $guard = app(AccountingDateGuard::class);
        $guard->lockLedgerAnchor();
        $this->lockBookStock($warehouse->id, $product->id);

        // ③ التاريخ والفترة (تحت المِرساة): يوم المحطة الآن؛ فترة/سنة مقفلة ⇒ رفض كامل بلا أثر.
        $date = $this->settings->businessDate($station, now());
        $guard->assertOpen($date, 'عكس ترحيل سند تعبئة صهريج');

        // ④ القيد الأصلي (مصدر الحسابات والمبلغ التاريخيين) والحركة الأصلية.
        $originalEntry = $this->originalEntry($posting, $locked);
        if ($originalEntry === null) {
            throw new FuelTankerFillException(FuelTankerFillException::ORIGINAL_ENTRY_INVALID, 'قيد الترحيل الأصلي غير سليم أو سبق عكسه خارج مسار العكس.', 422);
        }
        $originalCost = FuelInventoryCostMovement::query()->whereKey($posting->cost_movement_id)->first();
        if ($originalCost === null) {
            throw new FuelTankerFillException(FuelTankerFillException::ORIGINAL_ENTRY_INVALID, 'حركة تكلفة الترحيل الأصلية مفقودة.', 422);
        }

        // ⑤ سياسة مطابقة المجمّع والأستاذ (كالترحيل).
        $this->assertLedgerVariancePolicy($this->settings->tankerInventoryPostingConfig($station)['variance_policy'], $warehouse, $fuelProduct, $station);

        // ⑥ الكتابة بترتيب المُشغّلات.
        $unitCost = intdiv($cost, $quantity);
        $stockMovement = $this->inventory->applyReceipt($product, $quantity, $unitCost, [
            'warehouse_id' => $warehouse->id, 'date' => $date, 'source_type' => FuelTankerFill::class, 'source_id' => $locked->id,
            'notes' => 'عكس ترحيل سند تعبئة صهريج ' . $locked->number, InventoryService::FUEL_POOL_META => true,
        ], $cost);

        $reversalEntry = $this->ledger->reverse($originalEntry, $date, 'عكس ترحيل سند تعبئة صهريج ' . $locked->number . ': ' . $reason);
        // نسب القيد العكسي إلى السند (للتتبع والمطابقة)؛ لا يمسّ سطوره ولا مبالغه.
        $reversalEntry->forceFill(['source_type' => FuelTankerFill::class, 'source_id' => $locked->id, 'created_by' => $actor->id])->save();

        $reversalCost = $this->costBasis->recordIssueReversal($fuelProduct, $warehouse, $stockMovement, $originalCost, $reversalEntry);

        $now = now();
        $updated = DB::table('fuel_tanker_fill_inventory_postings')->where('id', $posting->id)->where('tenant_id', $tenantId)->where('status', 'posted')->update([
            'status' => 'reversed', 'reversal_stock_movement_id' => $stockMovement->id, 'reversal_cost_movement_id' => $reversalCost->id,
            'reversed_by' => $actor->id, 'reversed_at' => $now, 'reversal_reason' => $reason, 'updated_at' => $now,
        ]);
        if ($updated !== 1) {
            throw new FuelTankerFillException(FuelTankerFillException::FILL_NOT_POSTED, 'تغيّرت حالة الترحيل أثناء العكس.', 409);
        }

        FuelOperationalLedger::create([
            'branch_id' => $posting->branch_id, 'fuel_station_id' => $station->id, 'fuel_tank_id' => $locked->fuel_tank_id, 'fuel_product_id' => $fuelProduct->id,
            'warehouse_id' => $warehouse->id, 'stock_movement_id' => $stockMovement->id, 'movement_type' => FuelOperationalLedger::TYPE_TANKER_FILL_REVERSAL,
            'quantity_milliliters' => $quantity, 'book_balance_milliliters' => $this->bookBalance($warehouse->id, $product->id),
            'unit_cost_minor' => $unitCost, 'value_minor' => $cost, 'idempotency_key' => self::KEY_PREFIX . $locked->id . ':ledger',
            'source_type' => FuelTankerFill::class, 'source_id' => $locked->id, 'occurred_at' => $now,
            'notes' => 'عكس ترحيل سند تعبئة صهريج ' . $locked->number,
        ]);

        // ⑦ التدقيق (بلا مبالغ) والمحاولة الناجحة.
        $before = $this->audit->snapshot($locked);
        $after = $locked->fresh();
        $this->audit->record('tanker_fill.inventory_reversed', $after, $before, $this->audit->snapshot($after), $actor, $reason);
        DB::table('fuel_tanker_fill_inventory_posting_attempts')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'branch_id' => $posting->branch_id, 'fuel_tanker_fill_id' => $locked->id,
            'fuel_station_id' => $station->id, 'posting_id' => $posting->id, 'operation_type' => 'reverse', 'outcome' => 'succeeded', 'reason_code' => null,
            'idempotency_key' => self::KEY_PREFIX . $locked->id, 'actor_id' => $actor->id, 'attempted_at' => $now, 'created_at' => $now,
        ]);

        $fresh = DB::table('fuel_tanker_fill_inventory_postings')->where('id', $posting->id)->first();

        return ['fill' => $after, 'posting' => $this->postingSummary($fresh), 'replayed' => false];
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /**
     * روابط لاحقة تمنع العكس (أعمدة الفوترة/التسوية تُبنى في PR-8/PR-9): تُفحص **إن وُجدت** على صف الترحيل ولا تُفترض حالياً.
     *
     * @return list<string>
     */
    private function downstreamBlockers(object $posting): array
    {
        $blockers = [];
        foreach (['invoiced_invoice_id', 'invoiced_at', 'settlement_id', 'settled_at', 'supply_id'] as $column) {
            if (property_exists($posting, $column) && $posting->{$column} !== null) {
                $blockers[] = 'downstream_link:' . $column;
            }
        }

        return $blockers;
    }

    /**
     * قيد الترحيل الأصلي بشرط سلامته: مصدره هذا السند، بحالة `posted`، سطران بمدين ودائن مساويَين تماماً لتكلفة الترحيل المثبَّتة.
     * القراءة بلا قفل إضافي (القيد يُقفل داخل `LedgerService::reverse`).
     */
    private function originalEntry(object $posting, FuelTankerFill $fill): ?JournalEntry
    {
        $entryId = DB::table('fuel_inventory_cost_movements')->where('id', $posting->cost_movement_id)->value('journal_entry_id');
        $entry = $entryId === null ? null : JournalEntry::query()->with('lines')->whereKey($entryId)->first();
        if ($entry === null || $entry->source_type !== FuelTankerFill::class || $entry->source_id !== $fill->id || $entry->status !== 'posted') {
            return null;
        }
        $cost = (int) $posting->posted_cost_minor;
        if ($entry->lines->count() !== 2 || (int) $entry->lines->sum('debit') !== $cost || (int) $entry->lines->sum('credit') !== $cost) {
            return null;
        }

        return $entry;
    }

    /** @return array<string, mixed> */
    private function postingSummary(object $row): array
    {
        $postingJournal = DB::table('fuel_inventory_cost_movements')->where('id', $row->cost_movement_id)->value('journal_entry_id');
        $reversalJournal = $row->reversal_cost_movement_id === null ? null : DB::table('fuel_inventory_cost_movements')->where('id', $row->reversal_cost_movement_id)->value('journal_entry_id');

        return [
            'id' => $row->id, 'status' => $row->status, 'quantity_milliliters' => (int) $row->quantity_milliliters, 'posted_cost_minor' => (int) $row->posted_cost_minor,
            'stock_movement_id' => $row->stock_movement_id, 'cost_movement_id' => $row->cost_movement_id, 'journal_entry_id' => $postingJournal,
            'posted_by' => $row->posted_by, 'posted_at' => (string) $row->posted_at,
            'reversal_stock_movement_id' => $row->reversal_stock_movement_id, 'reversal_cost_movement_id' => $row->reversal_cost_movement_id,
            'reversal_journal_entry_id' => $reversalJournal, 'reversed_by' => $row->reversed_by,
            'reversed_at' => $row->reversed_at === null ? null : (string) $row->reversed_at, 'reversal_reason' => $row->reversal_reason,
        ];
    }
}
