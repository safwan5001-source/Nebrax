<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\ReturnDocument;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\ReturnService;
use App\Services\Accounting\StockPermitService;
use App\Services\Accounting\StocktakeService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-5 — Inventory / COGS Account Routing.
 *
 * الأدوار: `inventory_asset` · `cogs` · `inventory_count_variance` ·
 * `inventory_manual_adjustment` · `inventory_damage_loss`.
 *
 * الثلاثة الأخيرة تشترك اليوم في الحساب الافتراضي 5180، لكنها **هويّات
 * مستقلّة**: تعيين أحدها لا يمسّ الآخرَين. والتوجيه بالسبب التجاري لا
 * بإشارة المدين/الدائن — فلا دورَ «مكسب» وآخر «خسارة» لفرق الجرد.
 *
 * تشغيل: php artisan test --filter=InventoryCogsAccountRoutingTest
 */
class InventoryCogsAccountRoutingTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Warehouse $main;
    protected Partner $customer;
    protected Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-acc5',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->main = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->product = $this->trackedProduct('SKU-1');
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function customAccount(string $code, string $type = 'expense', bool $active = true, bool $group = false): Account
    {
        return Account::create([
            'tenant_id' => $this->tenant->id, 'code' => $code, 'name' => "حساب مخصص {$code}",
            'type' => $type, 'normal_balance' => in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'is_group' => $group, 'is_active' => $active,
        ]);
    }

    private function map(string $role, string $accountId): void
    {
        app(AccountRoutingService::class)->setMapping($role, $accountId, null);
    }

    private function trackedProduct(string $sku, int $salePrice = 20000): Product
    {
        return Product::create([
            'name' => "صنف {$sku}", 'sku' => $sku, 'type' => 'good',
            'sale_price' => $salePrice, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);
    }

    /** رصيد ابتدائي عبر مسار الاستلام (يولّد قيداً: مدين المخزون / دائن المقابل). */
    private function stockUp(Product $product, int $quantity = 100, int $unitCost = 10000, ?string $warehouseId = null): void
    {
        app(InventoryService::class)->receiveStock($product, $quantity, $unitCost, [
            'warehouse_id' => $warehouseId ?? $this->main->id,
        ]);
        $product->refresh();
    }

    private function lineFor(JournalEntry $entry, string $accountId): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account_id === $accountId);
    }

    private function lineForCode(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    private function entryOf(?string $entryId): JournalEntry
    {
        return JournalEntry::with('lines.account')->findOrFail($entryId);
    }

    private function postSale(Product $product, int $quantity = 2): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'warehouse_id' => $this->main->id],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => 20000, 'tax_rate' => 0]]
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function postSalesReturn(Product $product, int $quantity, ?bool $restock): ReturnDocument
    {
        $return = app(ReturnService::class)->create(
            [
                'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
                'warehouse_id' => $this->main->id, 'restock' => $restock,
            ],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => 20000, 'tax_rate' => 0]]
        );

        return app(ReturnService::class)->post($return);
    }

    private function postPermit(string $type, Product $product, int $quantity, array $overrides = []): \App\Models\StockPermit
    {
        $permit = app(StockPermitService::class)->create(array_merge([
            'type' => $type, 'warehouse_id' => $this->main->id, 'reason' => 'سبب حرّ',
        ], $overrides), [[
            'product_id' => $product->id, 'quantity' => $quantity, 'unit_cost' => 10000,
        ]]);

        return app(StockPermitService::class)->post($permit);
    }

    private function postStocktake(Product $product, int $countedQuantity): \App\Models\Stocktake
    {
        $stocktake = app(StocktakeService::class)->open(['warehouse_id' => $this->main->id]);
        app(StocktakeService::class)->count($stocktake, [$product->id => $countedQuantity]);

        return app(StocktakeService::class)->post($stocktake->fresh());
    }

    // ── 1. Unmapped paths keep the exact legacy accounts ────────────────────

    /** @test */
    public function unmapped_sale_cogs_uses_the_legacy_cogs_and_inventory_accounts(): void
    {
        $this->stockUp($this->product);
        $invoice = $this->postSale($this->product, 2);

        $entry = $this->entryOf($invoice->cogs_entry_id);
        $this->assertSame(20000, (int) $this->lineForCode($entry, '5110')->debit);
        $this->assertSame(20000, (int) $this->lineForCode($entry, '1140')->credit);
    }

    /** @test */
    public function unmapped_stocktake_manual_permit_and_damage_all_use_legacy_5180(): void
    {
        $this->stockUp($this->product);

        $shortage = $this->postStocktake($this->product, 95);
        $this->assertSame(50000, (int) $this->lineForCode($this->entryOf($shortage->journal_entry_id), '5180')->debit);

        $issue = $this->postPermit('issue', $this->product, 3);
        $this->assertSame(30000, (int) $this->lineForCode($this->entryOf($issue->journal_entry_id), '5180')->debit);

        $invoice = $this->postSale($this->product, 2);
        $damaged = $this->postSalesReturn($this->product, 1, restock: false);
        $this->assertSame(10000, (int) $this->lineForCode($this->entryOf($damaged->cogs_entry_id), '5180')->debit);
        $this->assertNotNull($invoice->cogs_entry_id);
    }

    /** @test */
    public function unmapped_inventory_receipt_debits_the_legacy_inventory_account(): void
    {
        $this->stockUp($this->product, 10, 5000);

        $movement = StockMovement::where('product_id', $this->product->id)->latest('id')->firstOrFail();
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', StockMovement::class)->where('source_id', $movement->id)->firstOrFail();

        $this->assertSame(50000, (int) $this->lineForCode($entry, '1140')->debit);
        $this->assertSame(50000, (int) $this->lineForCode($entry, '2110')->credit); // الطرف المقابل كما هو
    }

    // ── 2/3. Mapped inventory_asset + COGS with product override precedence ─

    /** @test */
    public function a_mapped_inventory_asset_is_used_by_receipt_sale_cogs_permit_and_stocktake(): void
    {
        $custom = $this->customAccount('1149', 'asset');
        $this->map('inventory_asset', $custom->id);

        // استلام
        $this->stockUp($this->product, 10, 5000);
        $movement = StockMovement::where('product_id', $this->product->id)->latest('id')->firstOrFail();
        $receipt = JournalEntry::with('lines.account')
            ->where('source_type', StockMovement::class)->where('source_id', $movement->id)->firstOrFail();
        $this->assertSame(50000, (int) $this->lineFor($receipt, $custom->id)->debit);
        $this->assertNull($this->lineForCode($receipt, '1140'));

        // بيع (تكلفة البضاعة المباعة)
        $invoice = $this->postSale($this->product, 2);
        $this->assertSame(10000, (int) $this->lineFor($this->entryOf($invoice->cogs_entry_id), $custom->id)->credit);

        // إذن إضافة
        $receiptPermit = $this->postPermit('receipt', $this->product, 4);
        $this->assertSame(40000, (int) $this->lineFor($this->entryOf($receiptPermit->journal_entry_id), $custom->id)->debit);

        // جرد بعجز — القيمة متوسط التكلفة الجاري (التوجيه لا يمسّ التقييم)
        $product = $this->product->fresh();
        $avg = (int) $product->avg_cost;
        $shortage = $this->postStocktake($product, (int) $product->quantity_on_hand - 1);
        $this->assertSame($avg, (int) $this->lineFor($this->entryOf($shortage->journal_entry_id), $custom->id)->credit);
    }

    /** @test */
    public function a_mapped_cogs_is_used_and_the_product_override_still_wins(): void
    {
        $mappedCogs = $this->customAccount('5119');
        $this->map('cogs', $mappedCogs->id);

        // منتج بلا تجاوز ⇒ يستعمل تعيين المستأجر
        $this->stockUp($this->product);
        $plain = $this->postSale($this->product, 2);
        $this->assertSame(20000, (int) $this->lineFor($this->entryOf($plain->cogs_entry_id), $mappedCogs->id)->debit);

        // منتج بتجاوز صريح ⇒ التجاوز أعلى أولوية من تعيين المستأجر
        $override = $this->customAccount('5118');
        $special = $this->trackedProduct('SKU-OVR');
        $special->update(['cogs_account_id' => $override->id]);
        $this->stockUp($special);

        $overridden = $this->postSale($special, 2);
        $entry = $this->entryOf($overridden->cogs_entry_id);
        $this->assertSame(20000, (int) $this->lineFor($entry, $override->id)->debit);
        $this->assertNull($this->lineFor($entry, $mappedCogs->id));
    }

    // ── 4. Count variance: one role for both directions ─────────────────────

    /** @test */
    public function count_shortage_and_surplus_share_one_role_and_only_the_sign_differs(): void
    {
        $variance = $this->customAccount('5181');
        $this->map('inventory_count_variance', $variance->id);
        $this->stockUp($this->product);

        $shortage = $this->postStocktake($this->product, 95);
        $shortageEntry = $this->entryOf($shortage->journal_entry_id);
        $this->assertSame(50000, (int) $this->lineFor($shortageEntry, $variance->id)->debit);

        $surplus = $this->postStocktake($this->product->fresh(), 100);
        $surplusEntry = $this->entryOf($surplus->journal_entry_id);
        // نفس الدور تماماً، والإشارة وحدها انقلبت.
        $this->assertSame(50000, (int) $this->lineFor($surplusEntry, $variance->id)->credit);
        $this->assertNull($this->lineForCode($shortageEntry, '5180'));
        $this->assertNull($this->lineForCode($surplusEntry, '5180'));
    }

    // ── 5. Manual permit: one role, sign preserved, reason cannot switch it ─

    /** @test */
    public function manual_receipt_and_issue_share_one_role_with_signs_preserved(): void
    {
        $manual = $this->customAccount('5182');
        $this->map('inventory_manual_adjustment', $manual->id);
        $this->stockUp($this->product);

        $receipt = $this->postPermit('receipt', $this->product, 4);
        $this->assertSame(40000, (int) $this->lineFor($this->entryOf($receipt->journal_entry_id), $manual->id)->credit);

        $issue = $this->postPermit('issue', $this->product, 3);
        $this->assertSame(30000, (int) $this->lineFor($this->entryOf($issue->journal_entry_id), $manual->id)->debit);
    }

    /** @test */
    public function a_free_text_reason_cannot_switch_the_manual_adjustment_role(): void
    {
        $manual = $this->customAccount('5183');
        $damage = $this->customAccount('5184');
        $this->map('inventory_manual_adjustment', $manual->id);
        $this->map('inventory_damage_loss', $damage->id);
        $this->stockUp($this->product);

        // سببٌ نصّه «تلف» — ومع ذلك يبقى الدور تسويةً يدوية لا تلفاً.
        $issue = $this->postPermit('issue', $this->product, 2, ['reason' => 'تلف وكسر ومخلفات']);
        $entry = $this->entryOf($issue->journal_entry_id);

        $this->assertSame(20000, (int) $this->lineFor($entry, $manual->id)->debit);
        $this->assertNull($this->lineFor($entry, $damage->id));
    }

    // ── 6. Damage/non-saleable return uses the damage role ──────────────────

    /** @test */
    public function a_non_saleable_return_uses_the_damage_role_while_a_restocked_one_uses_inventory_asset(): void
    {
        $damage = $this->customAccount('5185');
        $inventory = $this->customAccount('1150-INV', 'asset');
        $this->map('inventory_damage_loss', $damage->id);
        $this->map('inventory_asset', $inventory->id);

        $this->stockUp($this->product);
        $this->postSale($this->product, 4);

        $damaged = $this->postSalesReturn($this->product, 1, restock: false);
        $damagedEntry = $this->entryOf($damaged->cogs_entry_id);
        $this->assertSame(10000, (int) $this->lineFor($damagedEntry, $damage->id)->debit);
        $this->assertNull($this->lineFor($damagedEntry, $inventory->id));

        $restocked = $this->postSalesReturn($this->product, 1, restock: true);
        $restockedEntry = $this->entryOf($restocked->cogs_entry_id);
        $this->assertSame(10000, (int) $this->lineFor($restockedEntry, $inventory->id)->debit);
        $this->assertNull($this->lineFor($restockedEntry, $damage->id));
    }

    // ── Independent identities despite the shared 5180 default ──────────────

    /** @test */
    public function mapping_one_variance_role_never_moves_the_other_two(): void
    {
        $countVariance = $this->customAccount('5186');
        $this->map('inventory_count_variance', $countVariance->id);
        $this->stockUp($this->product);

        // الجرد يستعمل الدور المخصَّص…
        $shortage = $this->postStocktake($this->product, 95);
        $this->assertSame(50000, (int) $this->lineFor($this->entryOf($shortage->journal_entry_id), $countVariance->id)->debit);

        // …بينما التسوية اليدوية والتلف يبقيان على 5180 الافتراضي، بلا مساس.
        $issue = $this->postPermit('issue', $this->product->fresh(), 2);
        $issueEntry = $this->entryOf($issue->journal_entry_id);
        $this->assertSame(20000, (int) $this->lineForCode($issueEntry, '5180')->debit);
        $this->assertNull($this->lineFor($issueEntry, $countVariance->id));

        $this->postSale($this->product->fresh(), 2);
        $damaged = $this->postSalesReturn($this->product->fresh(), 1, restock: false);
        $damageEntry = $this->entryOf($damaged->cogs_entry_id);
        $this->assertSame(10000, (int) $this->lineForCode($damageEntry, '5180')->debit);
        $this->assertNull($this->lineFor($damageEntry, $countVariance->id));
    }

    /** @test */
    public function the_three_variance_roles_can_point_at_three_different_accounts_at_once(): void
    {
        $count = $this->customAccount('5187');
        $manual = $this->customAccount('5188');
        $damage = $this->customAccount('5189');
        $this->map('inventory_count_variance', $count->id);
        $this->map('inventory_manual_adjustment', $manual->id);
        $this->map('inventory_damage_loss', $damage->id);
        $this->stockUp($this->product);

        $shortage = $this->postStocktake($this->product, 98);
        $this->assertSame(20000, (int) $this->lineFor($this->entryOf($shortage->journal_entry_id), $count->id)->debit);

        $issue = $this->postPermit('issue', $this->product->fresh(), 2);
        $this->assertSame(20000, (int) $this->lineFor($this->entryOf($issue->journal_entry_id), $manual->id)->debit);

        $this->postSale($this->product->fresh(), 2);
        $damaged = $this->postSalesReturn($this->product->fresh(), 1, restock: false);
        $this->assertSame(10000, (int) $this->lineFor($this->entryOf($damaged->cogs_entry_id), $damage->id)->debit);
    }

    // ── 8/9. Transfers ───────────────────────────────────────────────────────

    /** @test */
    public function a_same_branch_transfer_still_creates_no_journal_after_routing(): void
    {
        $this->map('inventory_asset', $this->customAccount('1141', 'asset')->id);
        $this->stockUp($this->product);
        $second = Warehouse::create(['name' => 'مخزن ثانٍ', 'code' => 'WH-2']);

        $entriesBefore = JournalEntry::query()->count();
        $transfer = $this->postPermit('transfer', $this->product, 5, ['target_warehouse_id' => $second->id]);

        $this->assertNull($transfer->journal_entry_id);
        $this->assertSame($entriesBefore, JournalEntry::query()->count());
    }

    /** @test */
    public function a_cross_branch_transfer_uses_one_role_on_both_sides_with_branch_dimensions_preserved(): void
    {
        $custom = $this->customAccount('1142', 'asset');
        $this->map('inventory_asset', $custom->id);
        $this->stockUp($this->product);

        $otherBranch = Branch::create(['code' => '00002', 'name' => 'فرع ثانٍ', 'is_main' => false]);
        $target = Warehouse::create(['name' => 'مخزن الفرع الثاني', 'code' => 'WH-B2', 'branch_id' => $otherBranch->id]);
        $sourceBranch = Warehouse::findOrFail($this->main->id)->branch_id;

        $transfer = $this->postPermit('transfer', $this->product, 5, ['target_warehouse_id' => $target->id]);
        $entry = $this->entryOf($transfer->journal_entry_id);

        $debit = $entry->lines->first(fn (JournalLine $line) => (int) $line->debit > 0);
        $credit = $entry->lines->first(fn (JournalLine $line) => (int) $line->credit > 0);

        // نفس الحساب المخصَّص على الطرفين — بلا حساب تصفية وسيط.
        $this->assertSame($custom->id, $debit->account_id);
        $this->assertSame($custom->id, $credit->account_id);
        $this->assertSame(50000, (int) $debit->debit);
        $this->assertSame(50000, (int) $credit->credit);
        // وبُعدا الفرع كما هما تماماً.
        $this->assertSame($otherBranch->id, $debit->branch_id);
        $this->assertSame($sourceBranch, $credit->branch_id);
    }

    // ── 10. Fail closed with atomic rollback of stock + GL ──────────────────

    /** @test */
    public function an_invalid_inventory_asset_mapping_rolls_back_a_stocktake_with_no_journal_or_stock_change(): void
    {
        $custom = $this->customAccount('1143', 'asset');
        $this->map('inventory_asset', $custom->id);
        $this->stockUp($this->product);
        $custom->update(['is_active' => false]);

        $stocktake = app(StocktakeService::class)->open(['warehouse_id' => $this->main->id]);
        app(StocktakeService::class)->count($stocktake, [$this->product->id => 95]);

        $entriesBefore = JournalEntry::query()->count();
        $quantityBefore = (int) $this->product->fresh()->quantity_on_hand;
        $rowBefore = (int) ProductWarehouseStock::where('warehouse_id', $this->main->id)
            ->where('product_id', $this->product->id)->value('quantity');

        try {
            app(StocktakeService::class)->post($stocktake->fresh());
            $this->fail('كان يجب رفض الترحيل بتعيين معطّل.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $this->assertSame($entriesBefore, JournalEntry::query()->count());
        $this->assertSame($quantityBefore, (int) $this->product->fresh()->quantity_on_hand);
        $this->assertSame($rowBefore, (int) ProductWarehouseStock::where('warehouse_id', $this->main->id)
            ->where('product_id', $this->product->id)->value('quantity'));
        $this->assertSame('draft', $stocktake->fresh()->status);
    }

    /** @test */
    public function an_invalid_manual_adjustment_mapping_rolls_back_a_stock_permit_entirely(): void
    {
        $custom = $this->customAccount('5190');
        $this->map('inventory_manual_adjustment', $custom->id);
        $this->stockUp($this->product);
        $custom->update(['is_active' => false]);

        $permit = app(StockPermitService::class)->create([
            'type' => 'issue', 'warehouse_id' => $this->main->id, 'reason' => 'تسوية',
        ], [['product_id' => $this->product->id, 'quantity' => 2, 'unit_cost' => 10000]]);

        $entriesBefore = JournalEntry::query()->count();
        $quantityBefore = (int) $this->product->fresh()->quantity_on_hand;

        try {
            app(StockPermitService::class)->post($permit);
            $this->fail('كان يجب رفض الترحيل بتعيين معطّل.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $this->assertSame($entriesBefore, JournalEntry::query()->count());
        $this->assertSame($quantityBefore, (int) $this->product->fresh()->quantity_on_hand);
        $this->assertSame('draft', $permit->fresh()->status);
    }

    /** @test */
    public function a_missing_cogs_mapping_fails_closed_without_a_silent_legacy_fallback(): void
    {
        AccountRoleMapping::query()->where('role_key', 'cogs')->delete();
        $this->stockUp($this->product);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'warehouse_id' => $this->main->id],
            [['product_id' => $this->product->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 0]]
        );

        $entriesBefore = JournalEntry::query()->count();

        $this->expectException(RuntimeException::class);
        try {
            app(InvoiceService::class)->post($invoice);
        } finally {
            $this->assertSame($entriesBefore, JournalEntry::query()->count());
            $this->assertSame(100, (int) $this->product->fresh()->quantity_on_hand);
        }
    }

    // ── 11. Tenant isolation ─────────────────────────────────────────────────

    /** @test */
    public function tenant_a_inventory_mapping_does_not_leak_into_tenant_b(): void
    {
        $customA = $this->customAccount('5191');
        $this->map('inventory_count_variance', $customA->id);

        $tenantB = Tenant::create([
            'name' => 'مؤسسة أخرى', 'slug' => 'other-acc5',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);

        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'is_default' => true]);
        $productB = Product::create([
            'name' => 'صنف ب', 'sku' => 'SKU-B', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);
        app(InventoryService::class)->receiveStock($productB, 100, 10000, ['warehouse_id' => $warehouseB->id]);

        $stocktake = app(StocktakeService::class)->open(['warehouse_id' => $warehouseB->id]);
        app(StocktakeService::class)->count($stocktake, [$productB->id => 95]);
        $posted = app(StocktakeService::class)->post($stocktake->fresh());

        $entry = $this->entryOf($posted->journal_entry_id);
        $this->assertSame(50000, (int) $this->lineForCode($entry, '5180')->debit);
        $this->assertNull($this->lineFor($entry, $customA->id));
        $this->assertNull(Account::find($customA->id)); // حساب A غير مرئي أصلاً من B
    }

    // ── 12. Historical immutability + reversal on original accounts ─────────

    /** @test */
    public function remapping_after_posting_never_rewrites_an_existing_inventory_journal(): void
    {
        $this->stockUp($this->product);
        $shortage = $this->postStocktake($this->product, 95);
        $legacyVariance = Account::where('code', '5180')->first();

        $this->map('inventory_count_variance', $this->customAccount('5192')->id);

        $entry = $this->entryOf($shortage->fresh()->journal_entry_id);
        $this->assertSame($legacyVariance->id, $this->lineForCode($entry, '5180')->account_id);
        $this->assertSame(50000, (int) $this->lineForCode($entry, '5180')->debit);
    }

    /** @test */
    public function reversing_an_inventory_journal_uses_the_original_accounts_not_the_current_mapping(): void
    {
        $this->stockUp($this->product);
        $shortage = $this->postStocktake($this->product, 95);
        $legacyVariance = Account::where('code', '5180')->first();
        $legacyInventory = Account::where('code', '1140')->first();

        $newVariance = $this->customAccount('5193');
        $this->map('inventory_count_variance', $newVariance->id);
        $this->map('inventory_asset', $this->customAccount('1144', 'asset')->id);

        $reversal = app(LedgerService::class)->reverse(
            JournalEntry::with('lines')->findOrFail($shortage->journal_entry_id)
        );

        $reversedCredit = $reversal->lines->first(fn (JournalLine $line) => (int) $line->credit > 0);
        $reversedDebit = $reversal->lines->first(fn (JournalLine $line) => (int) $line->debit > 0);
        $this->assertSame($legacyVariance->id, $reversedCredit->account_id);
        $this->assertSame($legacyInventory->id, $reversedDebit->account_id);
        $this->assertNull($reversal->lines->first(fn (JournalLine $line) => $line->account_id === $newVariance->id));
    }

    // ── 13. Opening behaviour preserved (3130 stays out of routing) ─────────

    /** @test */
    public function opening_equity_stays_on_3130_even_when_inventory_asset_is_remapped(): void
    {
        $custom = $this->customAccount('1145', 'asset');
        $this->map('inventory_asset', $custom->id);

        $movement = app(InventoryService::class)->recordOpeningStock($this->product, 10);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', StockMovement::class)->where('source_id', $movement->id)->firstOrFail();

        // جانب الأصل يتبع التعيين…
        $this->assertSame(100000, (int) $this->lineFor($entry, $custom->id)->debit);
        // …والطرف الافتتاحي يبقى على 3130 بلا أي دور قابل للضبط.
        $this->assertSame(100000, (int) $this->lineForCode($entry, '3130')->credit);
    }

    /** @test */
    public function an_imported_inventory_opening_routes_the_asset_side_only(): void
    {
        $custom = $this->customAccount('1147', 'asset');
        $this->map('inventory_asset', $custom->id);

        $service = app(\App\Services\Accounting\InventoryOpeningService::class);
        $opening = $service->createDraft([], [[
            'product_id' => $this->product->id, 'warehouse_id' => $this->main->id,
            'quantity' => 10, 'unit_cost' => 5000,
        ]]);
        $opening = $service->post($opening);

        $entry = $this->entryOf($opening->journal_entry_id);
        $this->assertSame(50000, (int) $this->lineFor($entry, $custom->id)->debit);
        $this->assertNull($this->lineForCode($entry, '1140'));
        // 3130 محجوز خارج نطاق ACC-5 ولا يُعاد توظيفه.
        $this->assertSame(50000, (int) $this->lineForCode($entry, '3130')->credit);
    }

    // ── Amounts/directions/valuation untouched by routing ───────────────────

    /** @test */
    public function routing_changes_no_quantity_no_average_cost_and_no_direction(): void
    {
        $this->map('inventory_asset', $this->customAccount('1146', 'asset')->id);
        $this->map('cogs', $this->customAccount('5194')->id);
        $this->map('inventory_count_variance', $this->customAccount('5195')->id);

        $this->stockUp($this->product, 100, 10000);
        $this->assertSame(100, (int) $this->product->fresh()->quantity_on_hand);
        $this->assertSame(10000, (int) $this->product->fresh()->avg_cost);

        $this->postSale($this->product, 2);
        $this->assertSame(98, (int) $this->product->fresh()->quantity_on_hand);
        $this->assertSame(10000, (int) $this->product->fresh()->avg_cost); // المتوسط لا يتأثر بالبيع

        $shortage = $this->postStocktake($this->product->fresh(), 90);
        $this->assertSame(90, (int) $this->product->fresh()->quantity_on_hand);
        $this->assertSame(10000, (int) $this->product->fresh()->avg_cost);

        $entry = $this->entryOf($shortage->journal_entry_id);
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
    }
}
