<?php

namespace App\Services;

use App\Models\Account;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankerFill;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * TANKER-PR6B-3 — **الترحيل المخزني والمحاسبي لسند تعبئة الصهريج في معاملة واحدة** (الكاتب الوحيد لجدولي الترحيل والمحاولات وللحالة `posted`).
 * مغلق خلف بوابة `FUEL_TANKER_INVENTORY_POSTING_ENABLED` (الافتراضي `false`) **وبوابتَي PR-1/PR-4**، ولا يرحّل جماعياً ولا تلقائياً ولا يعكس (العكس = PR-6B-4).
 *
 * ## الأثر المحاسبي (التكلفة التاريخية، لا السعر التعاقدي)
 * مدين **الحساب الوسيط المحدَّد صراحةً** (`tanker_issue_clearing_account_id`، بلا بديل) / دائن **حساب مخزون الوقود** (تجاوز المحطة ثم الدور `inventory_asset` — كمسار البيع والتسوية)
 * بقيمة `posted_cost_minor` من `FuelCostBasisService::quoteIssue` (المتوسط الدقيق + الباقي الكسري). **لا إيراد ولا ضريبة ولا ذمة ولا فاتورة ولا COGS ولا قيمة مسؤولية بالسعر التعاقدي**؛ لا ملكية تُفترض.
 * هذا القيد **ليس معالجة صالحة تلقائياً لكل عقود أصحاب الصهاريج**: لا يُفعَّل إنتاجياً قبل توثيق شروط الملكية والسيطرة والضريبة (C-3، قرار المالك).
 *
 * ## ترتيب الأقفال (مطابق لمسار الفقد في `FuelReconciliationService`، يمنع الجمود مع البيع/الاستلام/التسوية/الإلغاء)
 * محطة `FOR NO KEY UPDATE` ← السند `FOR UPDATE` (يتسلسل مع الإلغاء) ← الخزان `FOR KEY SHARE` ← المنتج `FOR NO KEY UPDATE` ← مِرساة المستأجر ← رصيد المخزن (+حالة التكلفة داخل `FuelCostBasisService`).
 *
 * ## ترتيب الكتابة (تفرضه مُشغّلات PR-6B-2)
 * حركة المخزون `out` ← القيد ← حركة مجمّع التكلفة (`issue`، مربوطة بالقيد) ← **صف الترحيل** (المُشغّل يحوّل السند `posted` ذرّياً) ← **صف الدفتر التشغيلي** `tanker_fill` (لا يُقبل إلا بعد الترحيل) ← التدقيق ← محاولة ناجحة.
 * أي فشل يُرجع المعاملة كلها (لا خصم جزئي ولا قيد منفرد)؛ المحاولات المرفوضة/الفاشلة تُسجَّل **بعد التراجع** في معاملة منفصلة لا تُفشل الرد ولا تحوي مبالغ.
 *
 * **idempotent:** مفتاح حتمي `tanker-fill-post:{fill_id}` + ترحيل واحد لكل سند (فهرس فريد)؛ إعادة الطلب تعيد الترحيل الأول (`replayed`) بلا أثر.
 */
class FuelTankerFillInventoryPostingService
{
    public const KEY_PREFIX = 'tanker-fill-post:';

    /** سقف `stock_movements.quantity` (integer 32 بت) — يطابق قيد القاعدة (PR-6B-2). */
    public const MAX_STOCK_QUANTITY = 2147483647;

    private const REASON_MAX = 500;

    public function __construct(
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private InventoryService $inventory,
        private LedgerService $ledger,
        private AccountRoleResolver $roles,
        private FuelQuantity $quantity,
        private FuelTankerFillInventoryReadiness $readiness,
        private FuelInventoryLedgerReconciliation $reconciliation,
        private FuelStationAuditTrail $audit,
        private FuelTankerClearingAccountGuard $clearingGuard,
        private TenantContext $tenant,
    ) {}

    /** البوابات الثلاث معاً (PR-1 وPR-4 والترحيل). أي مغلقة ⇒ لا تنفيذ. */
    public static function enabled(): bool
    {
        return (bool) config('fuel_stations.tanker_management_enabled', false)
            && (bool) config('fuel_stations.tanker_fills_enabled', false)
            && (bool) config('fuel_stations.tanker_inventory_posting_enabled', false);
    }

    /**
     * @param  array{reason?: ?string, confirm_historical?: bool}  $options
     * @return array{fill: FuelTankerFill, posting: array<string, mixed>, replayed: bool}
     *
     * @throws FuelTankerFillException
     */
    public function post(FuelTankerFill $fill, User $actor, array $options = []): array
    {
        $this->assertEnabled();
        $this->requirePermission($actor, 'fuel.tanker.fill.inventory.post');
        $reason = $this->cleanReason($options['reason'] ?? null);
        $confirmHistorical = ($options['confirm_historical'] ?? false) === true;

        /** @var array{fill: FuelTankerFill, station: FuelStation}|null $context يُملأ بعد تحديد السند ونطاقه (لتسجيل المحاولة المرفوضة) */
        $context = null;

        try {
            return DB::transaction(function () use ($fill, $actor, $reason, $confirmHistorical, &$context) {
                return $this->postInTransaction($fill, $actor, $reason, $confirmHistorical, $context);
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
     * معاينة قراءة فقط: الموانع والتصنيف التاريخي والقيد المقترح (معرّفات الحسابات لمن يملك `accounts.view`، والمبلغ لمن يملك `products.view_cost` — شرطان مستقلان). **لا قفل ولا كتابة.**
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

        $item = $this->readiness->evaluate(collect([$fill]), false)['items'][$fill->id] ?? null;
        $blockers = array_values(array_filter($item['blockers'] ?? [], fn (string $code) => $code !== FuelTankerFillInventoryReadiness::B_INSUFFICIENT_BALANCE));
        $warehouse = $station->warehouse_id === null ? null : Warehouse::query()->find($station->warehouse_id);
        $fuelProduct = FuelProduct::query()->find($fill->fuel_product_id);
        $config = $this->settings->tankerInventoryPostingConfig($station);
        $stock = $warehouse === null || $fuelProduct === null ? null : (int) (ProductWarehouseStock::query()->where('warehouse_id', $warehouse->id)->where('product_id', $fuelProduct->product_id)->whereNull('product_variant_id')->value('quantity') ?? 0);
        $quantity = (int) $fill->quantity_milliliters;
        if ($quantity > self::MAX_STOCK_QUANTITY) {
            $blockers[] = FuelTankerFillException::QUANTITY_EXCEEDS_STOCK_LIMIT;
        }
        if ($stock !== null && $stock < $quantity) {
            $blockers[] = FuelTankerFillException::INSUFFICIENT_STOCK;
        }

        $canSeeCost = $actor->hasPermission('products.view_cost');
        $entry = null;
        if ($warehouse !== null && $fuelProduct !== null) {
            $inventoryAccount = $this->inventoryAccountId($station);
            // معرّفات الحسابات بحماية `accounts.view` (كمسار PR-6B-1)، والمبلغ بحماية `products.view_cost` — شرطان منفصلان.
            $canSeeAccounts = $actor->hasPermission('accounts.view');
            $entry = ['lines' => [
                ['side' => 'debit', 'account_id' => $canSeeAccounts ? $config['clearing_account']['account_id'] : null, 'role' => 'tanker_issue_clearing'],
                ['side' => 'credit', 'account_id' => $canSeeAccounts ? $inventoryAccount : null, 'role' => 'inventory'],
            ], 'entry_date' => $this->settings->businessDate($station, $fill->recorded_at), 'amount_minor' => null];
            if ($canSeeCost && $stock !== null && $stock >= $quantity && $quantity <= self::MAX_STOCK_QUANTITY) {
                $quote = $this->costBasis->previewIssue($fuelProduct, $warehouse, $quantity);
                $entry['amount_minor'] = $quote['posted_cost_minor'] ?? null;
                if (isset($quote['blocked'])) {
                    $blockers[] = (string) $quote['blocked'];
                }
            }
        }

        return [
            'fill_id' => $fill->id,
            'status' => $fill->status === FuelTankerFill::STATUS_RECORDED && $fill->inventory_status === FuelTankerFill::INVENTORY_PENDING_INTEGRATION ? ($blockers === [] ? 'postable' : 'blocked') : 'not_applicable',
            'blockers' => array_values(array_unique($blockers)),
            'historical' => (bool) ($item['historical'] ?? true),
            'requires' => ['permission' => 'fuel.tanker.fill.inventory.post', 'historical_permission' => 'fuel.tanker.fill.inventory.post_historical'],
            'cost_recognition' => $config['cost_recognition'],
            'variance_policy' => $config['variance_policy'],
            'entry' => $entry,
        ];
    }

    // ───────────────────────── المعاملة ─────────────────────────

    /**
     * @param  array{fill: FuelTankerFill, station: FuelStation}|null  $context
     * @return array{fill: FuelTankerFill, posting: array<string, mixed>, replayed: bool}
     */
    private function postInTransaction(FuelTankerFill $fill, User $actor, ?string $reason, bool $confirmHistorical, ?array &$context): array
    {
        $tenantId = (string) $this->tenant->id();

        // ① المحطة ثم السند (ترتيب الإلغاء نفسه: محطة FOR NO KEY UPDATE ← سند FOR UPDATE).
        $station = FuelStation::query()->lock('for no key update')->find($fill->fuel_station_id);
        if ($station === null || ! $this->accessible($station, $actor)) {
            throw $this->notFound();
        }
        $locked = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->lockForUpdate()->find($fill->id);
        if ($locked === null || $locked->fuel_station_id !== $station->id) {
            throw $this->notFound();
        }
        $context = ['fill' => $locked, 'station' => $station];

        // الإعادة بالمفتاح الحتمي تُحسم قبل أي تقييم جديد (الفترة قد أُقفلت والرصيد تغيّر): تعيد الترحيل الأول بلا أثر.
        $existing = $this->existingPosting($locked);
        if ($existing !== null) {
            return ['fill' => $locked->fresh(), 'posting' => $existing, 'replayed' => true];
        }

        if ($locked->status === FuelTankerFill::STATUS_VOIDED) {
            throw new FuelTankerFillException(FuelTankerFillException::FILL_VOIDED, 'السند ملغى ولا يُرحَّل.');
        }
        if ($locked->status !== FuelTankerFill::STATUS_RECORDED || $locked->inventory_status !== FuelTankerFill::INVENTORY_PENDING_INTEGRATION) {
            throw new FuelTankerFillException(FuelTankerFillException::FILL_NOT_PENDING, 'السند ليس في حالة «بانتظار الدمج».', 409);
        }
        $quantity = (int) $locked->quantity_milliliters;
        if ($quantity > self::MAX_STOCK_QUANTITY) {
            throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_EXCEEDS_STOCK_LIMIT, 'كمية السند تتجاوز سقف عمود حركة المخزون (2,147,483,647 مل) فلا يُرحَّل.');
        }
        try {
            $this->settings->assertDistinctApprover($station, $locked->recorded_by, $actor->id, 'ترحيل سند تعبئة صهريج');
        } catch (RuntimeException $e) {
            throw new FuelTankerFillException(FuelTankerFillException::DISTINCT_APPROVER_REQUIRED, 'سياسة المحطة تتطلب أن يرحّل السند مستخدمٌ غير الذي سجّله.');
        }

        $warehouse = $this->warehouse($station);
        $fuelProduct = $this->fuelProduct($locked->fuel_product_id);
        $product = $this->product($fuelProduct);
        $this->quantity->assertFuelUnitMapping($fuelProduct, $product);

        // ② الأقفال: الخزان ← المنتج ← مِرساة المستأجر ← رصيد المخزن (نمط FUEL-LOCK-ORDER-2 / مسار الفقد).
        FuelTank::query()->whereKey($locked->fuel_tank_id)->lock('for key share')->first();
        BranchScope::reference(\App\Models\Product::class)->lock('for no key update')->findOrFail($product->id);
        app(AccountingDateGuard::class)->lockLedgerAnchor();
        $this->lockBookStock($warehouse->id, $product->id);

        // ③ الموانع تحت الأقفال (الجاهزية نفسها التي تعرضها المراجعة): بوابات المحطة/المخزن/المخزون/التكلفة/السياسة/الفترة/الحساب الوسيط.
        $item = $this->readiness->evaluate(collect([$locked]), false)['items'][$locked->id] ?? null;
        // الرصيد غير الكافي يُحسم أدناه بالدقة (كمية هذا السند وحدها)؛ تراكمي المراجعة لا يمنع ترحيل سند يكفيه الرصيد.
        $blockers = array_values(array_filter($item['blockers'] ?? [], fn (string $code) => $code !== FuelTankerFillInventoryReadiness::B_INSUFFICIENT_BALANCE));
        if ($blockers !== []) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'السند محجوب عن الترحيل.', 422, ['blockers' => $blockers]);
        }
        $config = $this->settings->tankerInventoryPostingConfig($station);

        // ④ التاريخي: صلاحية إضافية + مراجعة معلنة بسبب مدوَّن (لا ترحيل تاريخي صامت).
        $historical = (bool) ($item['historical'] ?? true);
        if ($historical) {
            if (! $actor->hasPermission('fuel.tanker.fill.inventory.post_historical')) {
                throw new FuelTankerFillException(FuelTankerFillException::HISTORICAL_PERMISSION_REQUIRED, 'سند تاريخي (قبل بدء الترحيل) يتطلب صلاحية ترحيل التاريخي.', 403);
            }
            if (! $confirmHistorical || $reason === null) {
                throw new FuelTankerFillException(FuelTankerFillException::HISTORICAL_REVIEW_REQUIRED, 'ترحيل سند تاريخي يتطلب تأكيد المراجعة وسبباً مدوَّناً.');
            }
        }

        // ⑤ الرصيد الدقيق لكمية السند (لا سالب) + سياسة مطابقة المجمّع والأستاذ.
        $available = $this->bookBalance($warehouse->id, $product->id);
        if ($available < $quantity) {
            throw new FuelTankerFillException(FuelTankerFillException::INSUFFICIENT_STOCK, 'رصيد الوقود في مخزن المحطة لا يكفي كمية السند؛ يُعالج السبب بالمسارات المعتمدة (استلام/جرد/رصيد افتتاحي) ثم يُعاد الترحيل.', 422);
        }
        $this->assertLedgerVariancePolicy($config['variance_policy'], $warehouse, $fuelProduct, $station);

        // ⑥ الحسابات (بلا fallback للوسيط).
        $clearing = $this->clearingAccount($config);
        $inventoryAccount = $this->inventoryAccount($station);

        // ⑦ التسعير بالتكلفة الحالية للمجمّع ثم الخصم والقيد والتكلفة (ترتيب المُشغّلات).
        $quote = $this->costBasis->quoteIssue($fuelProduct, $warehouse, $quantity);
        $cost = (int) $quote['posted_cost_minor'];
        if ($cost <= 0) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTED_COST_ZERO, 'تكلفة المجمّع الحالية صفر؛ لا يُرحَّل قيد بلا قيمة. يُعالج أساس التكلفة أولاً.');
        }
        $date = $this->settings->businessDate($station, $locked->recorded_at);
        $unitCost = intdiv($cost, $quantity);

        $stockMovement = $this->inventory->applyIssue($product, $quantity, $unitCost, [
            'warehouse_id' => $warehouse->id, 'date' => $date, 'source_type' => FuelTankerFill::class, 'source_id' => $locked->id,
            'notes' => 'ترحيل سند تعبئة صهريج ' . $locked->number, InventoryService::FUEL_POOL_META => true, 'enforce_stock' => true,
        ], $cost);

        $branchId = $station->branch_id;
        $entry = $this->ledger->post([
            ['account_id' => $clearing->id, 'debit' => $cost, 'branch_id' => $branchId],
            ['account_id' => $inventoryAccount->id, 'credit' => $cost, 'branch_id' => $branchId],
        ], [
            'entry_date' => $date, 'description' => 'ترحيل سند تعبئة صهريج ' . $locked->number, 'source_type' => FuelTankerFill::class,
            'source_id' => $locked->id, 'created_by' => $actor->id,
        ]);
        $costMovement = $this->costBasis->recordIssue($fuelProduct, $warehouse, $stockMovement, $quantity, $cost, $entry);

        // ⑧ صف الترحيل (المُشغّل يحوّل السند `posted` ذرّياً) ثم الدفتر التشغيلي (لا يُقبل قبل الترحيل).
        $postingId = (string) Str::uuid();
        $now = now();
        DB::table('fuel_tanker_fill_inventory_postings')->insert([
            'id' => $postingId, 'tenant_id' => $tenantId, 'branch_id' => $branchId, 'fuel_tanker_fill_id' => $locked->id,
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id, 'warehouse_id' => $warehouse->id,
            'stock_movement_id' => $stockMovement->id, 'cost_movement_id' => $costMovement->id, 'quantity_milliliters' => $quantity,
            'posted_cost_minor' => $cost, 'idempotency_key' => self::KEY_PREFIX . $locked->id, 'status' => 'posted',
            'posted_by' => $actor->id, 'posted_at' => $now, 'created_at' => $now, 'updated_at' => $now,
        ]);

        FuelOperationalLedger::create([
            'branch_id' => $branchId, 'fuel_station_id' => $station->id, 'fuel_tank_id' => $locked->fuel_tank_id, 'fuel_product_id' => $fuelProduct->id,
            'warehouse_id' => $warehouse->id, 'stock_movement_id' => $stockMovement->id, 'movement_type' => FuelOperationalLedger::TYPE_TANKER_FILL,
            'quantity_milliliters' => -$quantity, 'book_balance_milliliters' => $this->bookBalance($warehouse->id, $product->id),
            'unit_cost_minor' => $unitCost, 'value_minor' => -$cost, 'idempotency_key' => self::KEY_PREFIX . $locked->id . ':ledger',
            'source_type' => FuelTankerFill::class, 'source_id' => $locked->id, 'occurred_at' => $now,
            'notes' => 'ترحيل سند تعبئة صهريج ' . $locked->number,
        ]);

        // ⑨ التدقيق (بلا مبالغ) والمحاولة الناجحة.
        $before = $this->audit->snapshot($locked);
        $after = $locked->fresh();
        $this->audit->record('tanker_fill.inventory_posted', $after, $before, $this->audit->snapshot($after), $actor, $reason);
        DB::table('fuel_tanker_fill_inventory_posting_attempts')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'branch_id' => $branchId, 'fuel_tanker_fill_id' => $locked->id,
            'fuel_station_id' => $station->id, 'posting_id' => $postingId, 'operation_type' => 'post', 'outcome' => 'succeeded', 'reason_code' => null,
            'idempotency_key' => self::KEY_PREFIX . $locked->id, 'actor_id' => $actor->id, 'attempted_at' => $now, 'created_at' => $now,
        ]);

        return ['fill' => $after, 'posting' => $this->existingPosting($after) ?? [], 'replayed' => false];
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array<string, mixed>|null */
    private function existingPosting(FuelTankerFill $fill): ?array
    {
        $row = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $fill->tenant_id)->where('fuel_tanker_fill_id', $fill->id)->first();
        if ($row === null) {
            return null;
        }
        $cost = DB::table('fuel_inventory_cost_movements')->where('id', $row->cost_movement_id)->value('journal_entry_id');

        return [
            'id' => $row->id, 'status' => $row->status, 'quantity_milliliters' => (int) $row->quantity_milliliters, 'posted_cost_minor' => (int) $row->posted_cost_minor,
            'stock_movement_id' => $row->stock_movement_id, 'cost_movement_id' => $row->cost_movement_id, 'journal_entry_id' => $cost,
            'posted_by' => $row->posted_by, 'posted_at' => (string) $row->posted_at,
        ];
    }

    private function assertEnabled(): void
    {
        if (! self::enabled()) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_DISABLED, 'ترحيل سندات التعبئة مخزنياً غير مفعَّل.', 404);
        }
    }

    private function requirePermission(User $actor, string $permission): void
    {
        if (! $actor->hasPermission($permission)) {
            throw new FuelTankerFillException(FuelTankerFillException::FORBIDDEN, 'لا تملك صلاحية تنفيذ هذه العملية.', 403);
        }
    }

    private function accessible(FuelStation $station, User $actor): bool
    {
        if (! $actor->canAccessFuelStation($station)) {
            return false;
        }
        $branchId = app(BranchContext::class)->id();

        return $branchId === null || $station->branch_id === $branchId;
    }

    private function notFound(): FuelTankerFillException
    {
        return new FuelTankerFillException(FuelTankerFillException::NOT_FOUND, 'السجل غير موجود.', 404);
    }

    private function cleanReason(mixed $reason): ?string
    {
        $reason = trim((string) $reason);
        if ($reason === '') {
            return null;
        }
        if (mb_strlen($reason) > self::REASON_MAX) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'السبب أطول من الحد المسموح (500 حرف).');
        }

        return $reason;
    }

    private function warehouse(FuelStation $station): Warehouse
    {
        if ($station->warehouse_id === null) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'المحطة بلا مخزن معيّن.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_WAREHOUSE_REQUIRED]]);
        }
        $warehouse = Warehouse::query()->whereKey($station->warehouse_id)->first();
        if ($warehouse === null || $warehouse->tenant_id !== $station->tenant_id || ! $warehouse->is_active || ($warehouse->branch_id !== null && $warehouse->branch_id !== $station->branch_id)) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'مخزن المحطة غير صالح.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_WAREHOUSE_UNAVAILABLE]]);
        }

        return $warehouse;
    }

    private function fuelProduct(string $id): FuelProduct
    {
        $fuelProduct = FuelProduct::query()->find($id);
        if ($fuelProduct === null || ! $fuelProduct->is_active || $fuelProduct->product_id === null) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'منتج الوقود غير صالح أو معطل.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_PRODUCT_UNAVAILABLE]]);
        }

        return $fuelProduct;
    }

    private function product(FuelProduct $fuelProduct): \App\Models\Product
    {
        $product = BranchScope::reference(\App\Models\Product::class)->find($fuelProduct->product_id);
        if ($product === null || ! $product->is_active || ! $product->track_inventory) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'منتج الوقود المرتبط يجب أن يكون نشطاً ومتابعاً مخزنياً.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_PRODUCT_UNAVAILABLE]]);
        }

        return $product;
    }

    private function lockBookStock(string $warehouseId, string $productId): void
    {
        // المنتج `NO KEY UPDATE` (لا `FOR UPDATE`: بيع ERP يأخذ KEY SHARE عليه بعد المِرساة) ثم صف الرصيد — كمسار التسوية.
        BranchScope::reference(\App\Models\Product::class)->lock('for no key update')->findOrFail($productId);
        ProductWarehouseStock::query()->where('warehouse_id', $warehouseId)->where('product_id', $productId)->whereNull('product_variant_id')->lockForUpdate()->first();
    }

    private function bookBalance(string $warehouseId, string $productId): int
    {
        return (int) (ProductWarehouseStock::query()->where('warehouse_id', $warehouseId)->where('product_id', $productId)->whereNull('product_variant_id')->value('quantity') ?? 0);
    }

    /**
     * `fuel_pool_ledger_variance_policy`: `block` (الافتراضي) يمنع الترحيل عند أي فرق مثبَّت بين المجمّع والأستاذ يخص هذا المجمّع أو فرعه (كمية المجمّع/حالته/تاريخ التكلفة المفتوح،
     * فرق قيمة الفرع، قيد لا يطابق حركاته)؛ `warn` يسمح بلا فحص (الانحراف سابق للترحيل ومستقل عنه: الترحيل يحرّك الطرفين بالمبلغ نفسه). المطابقة قراءة فقط تحت الأقفال نفسها.
     */
    private function assertLedgerVariancePolicy(string $policy, Warehouse $warehouse, FuelProduct $fuelProduct, FuelStation $station): void
    {
        if ($policy !== 'block') {
            return;
        }
        $report = $this->reconciliation->reconcile([$warehouse->id], [$station->branch_id], true, true);
        $relevant = collect($report['findings'])->filter(function (array $finding) use ($warehouse, $fuelProduct, $station) {
            $code = $finding['code'] ?? '';
            if (isset($finding['warehouse_id'])) {
                return $finding['warehouse_id'] === $warehouse->id && ($finding['fuel_product_id'] ?? null) === $fuelProduct->id;
            }

            // فرق قيمة الفرع (خطأ) وقيد لا يطابق حركاته (خطأ). **`movements_without_journal` تحذير لا يمنع**: حركة صفرية القيمة (فقد جزء من هللة) بلا قيد مشروعة، وأي حركة بقيمة غير صفرية بلا قيد
            // تُظهر `value_difference` فتُمنع به.
            return $code === FuelInventoryLedgerReconciliation::F_VALUE_DIFFERENCE
                ? ($finding['branch_id'] ?? null) === $station->branch_id
                : $code === FuelInventoryLedgerReconciliation::F_ENTRY_AMOUNT_DIFFERS;
        })->pluck('code')->unique()->values()->all();
        if ($relevant !== []) {
            throw new FuelTankerFillException(FuelTankerFillException::LEDGER_VARIANCE_BLOCKED, 'يوجد فرق بين مجمّع تكلفة الوقود والأستاذ؛ يُعالج قبل الترحيل (سياسة الانحراف: block).', 422, ['findings' => $relevant]);
        }
    }

    /** الحساب الوسيط الصريح فقط — لا بديل ولا افتراض ولا إنشاء. @param array<string, mixed> $config */
    private function clearingAccount(array $config): Account
    {
        $id = $config['clearing_account']['account_id'] ?? null;
        if (! $config['clearing_account']['configured'] || $id === null) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'الحساب الوسيط غير معيَّن.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_CLEARING_ACCOUNT_MISSING]]);
        }
        $reason = $this->clearingGuard->violation((string) $id);
        $account = $reason === null ? Account::query()->whereKey($id)->first() : null;
        if ($account === null || $account->is_group || ! $account->is_active) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'الحساب الوسيط غير صالح.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_CLEARING_ACCOUNT_INVALID], 'violation' => $reason]);
        }

        return $account;
    }

    /** حساب مخزون الوقود: تجاوز المحطة ثم الدور `inventory_asset` (أصل نشط غير تجميعي) — كمسار البيع والتسوية (C-2). */
    private function inventoryAccount(FuelStation $station): Account
    {
        $account = $station->default_inventory_account_id ? Account::query()->whereKey($station->default_inventory_account_id)->first() : $this->roles->resolve('inventory_asset');
        if ($account === null || $account->is_group || ! $account->is_active || $account->type !== 'asset') {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'حساب مخزون الوقود غير صالح للترحيل.', 422, ['blockers' => ['inventory_account_invalid']]);
        }

        return $account;
    }

    private function inventoryAccountId(FuelStation $station): ?string
    {
        try {
            return $this->inventoryAccount($station)->id;
        } catch (FuelTankerFillException) {
            return null;
        }
    }

    // ───────────────────────── الأخطاء والمحاولات ─────────────────────────

    private function toDomain(Throwable $exception): FuelTankerFillException
    {
        if ($exception instanceof FuelTankerFillException) {
            return $exception;
        }
        if ($exception instanceof AccountingPeriodLockedException) {
            return new FuelTankerFillException(FuelTankerFillException::PERIOD_LOCKED, $exception->getMessage() ?: 'الفترة المحاسبية مقفلة.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_PERIOD_LOCKED]]);
        }
        if ($exception instanceof RuntimeException) {
            $code = preg_match('/^([A-Z][A-Z0-9_]{3,}):/', $exception->getMessage(), $m) === 1 ? strtolower($m[1]) : null;

            return new FuelTankerFillException(FuelTankerFillException::POSTING_FAILED, $exception->getMessage(), 422, $code === null ? [] : ['code' => $code]);
        }
        // أخطاء غير متوقعة (قاعدة بيانات/برمجية): لا تُسرَّب تفاصيلها؛ تُسجَّل للتشخيص.
        Log::error('tanker fill inventory posting failed unexpectedly', ['exception' => $exception::class, 'message' => $exception->getMessage()]);

        return new FuelTankerFillException(FuelTankerFillException::POSTING_FAILED, 'تعذّر ترحيل السند؛ لم يُكتب أي أثر.', 500);
    }

    /** يُسجَّل بعد التراجع الكامل وفي معاملة منفصلة؛ لا يُفشل الرد ولا يحوي مبالغ. */
    private function recordFailedAttempt(FuelTankerFill $fill, FuelStation $station, User $actor, FuelTankerFillException $exception): void
    {
                if (in_array($exception->status, [403, 404], true)) {
            return; // لا صلاحية (بما فيها صلاحية التاريخي) أو خارج النطاق أو بوابة مغلقة: ليست محاولة ترحيل
        }
        try {
            DB::transaction(function () use ($fill, $station, $actor, $exception) {
                $now = now();
                DB::table('fuel_tanker_fill_inventory_posting_attempts')->insert([
                    'id' => (string) Str::uuid(), 'tenant_id' => $fill->tenant_id, 'branch_id' => $fill->branch_id, 'fuel_tanker_fill_id' => $fill->id,
                    'fuel_station_id' => $station->id, 'posting_id' => null, 'operation_type' => 'post',
                    'outcome' => $exception->status >= 500 || $exception->reason === FuelTankerFillException::POSTING_FAILED ? 'failed' : 'rejected',
                    'reason_code' => Str::limit(($exception->details['code'] ?? null) !== null ? (string) $exception->details['code'] : $exception->reason, 64, ''),
                    'idempotency_key' => self::KEY_PREFIX . $fill->id, 'actor_id' => $actor->id, 'attempted_at' => $now, 'created_at' => $now,
                ]);
            });
        } catch (Throwable $e) {
            Log::warning('tanker fill posting attempt could not be recorded', ['fill' => $fill->id, 'error' => $e::class]);
        }
    }
}
