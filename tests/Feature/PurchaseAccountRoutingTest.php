<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-4 — Purchase & Purchase Return Account Routing.
 *
 * Purchase posting (accounts_payable/inventory_asset/purchase_expense/
 * tax_input/document_adjustment) and Purchase Return's mirrored roles
 * (accounts_payable/inventory_asset/purchase_expense/tax_input) now consume
 * `AccountRoleResolver` instead of hardcoded ACC_* codes. LedgerService is
 * untouched; a purchase and its return must always agree on the tenant's
 * current mapping — receipt is never on a hardcoded account while its
 * return uses a different, mapped one.
 *
 * تشغيل: php artisan test --filter=PurchaseAccountRoutingTest
 */
class PurchaseAccountRoutingTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-acc4', 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
    }

    private function customAccount(string $code, string $type = 'liability', bool $group = false, bool $active = true): Account
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

    private function trackedProduct(string $code, int $qty = 100, int $avgCost = 0): Product
    {
        return Product::create([
            'tenant_id' => $this->tenant->id, 'name' => "صنف {$code}", 'sku' => $code,
            'type' => 'good', 'track_inventory' => true,
            'quantity_on_hand' => $qty, 'avg_cost' => $avgCost,
        ]);
    }

    private function nonTrackedProduct(string $code): Product
    {
        return Product::create([
            'tenant_id' => $this->tenant->id, 'name' => "خدمة {$code}", 'sku' => $code,
            'type' => 'service', 'track_inventory' => false,
        ]);
    }

    private function postPurchase(array $items, array $overrides = []): Purchase
    {
        $purchase = app(PurchaseService::class)->create(
            array_merge(['partner_id' => $this->supplier->id, 'payment_type' => 'credit'], $overrides),
            $items
        );

        return app(PurchaseService::class)->post($purchase);
    }

    private function postPurchaseReturn(array $items, array $overrides = []): ReturnDocument
    {
        $return = app(ReturnService::class)->create(
            array_merge(['type' => 'purchase', 'partner_id' => $this->supplier->id], $overrides),
            $items
        );

        return app(ReturnService::class)->post($return);
    }

    private function lineFor(JournalEntry $entry, string $accountId): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account_id === $accountId);
    }

    private function lineForCode(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    // ── 1. Unmapped Purchase resolves the exact legacy accounts ────────────

    /** @test */
    public function an_unmapped_tracked_purchase_matches_legacy_accounts_exactly(): void
    {
        $product = $this->trackedProduct('P1');
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(10000, (int) $this->lineForCode($entry, '1140')->debit);
        $this->assertSame(1500, (int) $this->lineForCode($entry, '1150')->debit);
        $payable = $this->lineForCode($entry, '2110');
        $this->assertSame(11500, (int) $payable->credit);
        $this->assertSame(Partner::class, $payable->partner_type);
        $this->assertSame($this->supplier->id, $payable->partner_id);
    }

    /** @test */
    public function an_unmapped_non_tracked_purchase_matches_legacy_expense_account(): void
    {
        $service = $this->nonTrackedProduct('S1');
        $purchase = $this->postPurchase([
            ['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(20000, (int) $this->lineForCode($entry, '5150')->debit);
        $this->assertNull($this->lineForCode($entry, '1140'));
        $this->assertSame(3000, (int) $this->lineForCode($entry, '1150')->debit);
    }

    // ── 2/4/5/6. Mapped roles change the account only ───────────────────────

    /** @test */
    public function a_mapped_accounts_payable_is_used_with_unchanged_amount_and_partner_dimension(): void
    {
        $custom = $this->customAccount('2119');
        $this->map('accounts_payable', $custom->id);

        $product = $this->trackedProduct('P2');
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 2000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $mapped = $this->lineFor($entry, $custom->id);
        $this->assertSame(11500, (int) $mapped->credit);
        $this->assertSame($this->supplier->id, $mapped->partner_id);
        $this->assertNull($this->lineForCode($entry, '2110'));
        // المبلغ الإجمالي والمخزون لم يتغيّرا بتغيّر مصدر الحساب فقط.
        $this->assertSame(10000, (int) $this->lineForCode($entry, '1140')->debit);
    }

    /** @test */
    public function a_mapped_inventory_asset_is_used_when_the_product_is_tracked(): void
    {
        $custom = $this->customAccount('1148', 'asset');
        $this->map('inventory_asset', $custom->id);

        $product = $this->trackedProduct('P3');
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 4, 'unit_price' => 5000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(20000, (int) $this->lineFor($entry, $custom->id)->debit);
        $this->assertNull($this->lineForCode($entry, '1140'));
    }

    /** @test */
    public function a_mapped_purchase_expense_is_used_for_non_tracked_lines(): void
    {
        $custom = $this->customAccount('5159', 'expense');
        $this->map('purchase_expense', $custom->id);

        $service = $this->nonTrackedProduct('S2');
        $purchase = $this->postPurchase([
            ['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 30000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $mapped = $this->lineFor($entry, $custom->id);
        $this->assertSame(30000, (int) $mapped->debit);
        $this->assertSame($purchase->cost_center_id, $mapped->cost_center_id);
        $this->assertNull($this->lineForCode($entry, '5150'));
    }

    /** @test */
    public function a_mapped_tax_input_is_used_with_the_vat_amount_unchanged(): void
    {
        $custom = $this->customAccount('1158', 'asset');
        $this->map('tax_input', $custom->id);

        $product = $this->trackedProduct('P4');
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(3000, (int) $this->lineFor($entry, $custom->id)->debit);
        $this->assertNull($this->lineForCode($entry, '1150'));
        $this->assertSame(20000, (int) $this->lineForCode($entry, '1140')->debit); // غير متأثر
    }

    /** @test */
    public function a_mapped_document_adjustment_preserves_the_sign_for_a_positive_and_negative_value(): void
    {
        $custom = $this->customAccount('5179', 'expense');
        $this->map('document_adjustment', $custom->id);

        $product = $this->trackedProduct('P5');
        $positive = $this->postPurchase(
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0]],
            ['adjustment' => 500]
        );
        $entryPositive = JournalEntry::with('lines.account')->findOrFail($positive->journal_entry_id);
        $this->assertSame(500, (int) $this->lineFor($entryPositive, $custom->id)->debit);

        $product2 = $this->trackedProduct('P6');
        $negative = $this->postPurchase(
            [['product_id' => $product2->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0]],
            ['adjustment' => -300]
        );
        $entryNegative = JournalEntry::with('lines.account')->findOrFail($negative->journal_entry_id);
        $this->assertSame(300, (int) $this->lineFor($entryNegative, $custom->id)->credit);
        $this->assertNull($this->lineForCode($entryNegative, '5170'));
    }

    // ── 6. Tracked/non-tracked split unchanged when mixed on one purchase ──

    /** @test */
    public function tracked_and_non_tracked_lines_split_correctly_regardless_of_mapping(): void
    {
        $custom = $this->customAccount('1147', 'asset');
        $this->map('inventory_asset', $custom->id);

        $tracked = $this->trackedProduct('P7');
        $service = $this->nonTrackedProduct('S3');
        $purchase = $this->postPurchase([
            ['product_id' => $tracked->id, 'quantity' => 2, 'unit_price' => 5000, 'tax_rate' => 0],
            ['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 3000, 'tax_rate' => 0],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(10000, (int) $this->lineFor($entry, $custom->id)->debit);
        $this->assertSame(3000, (int) $this->lineForCode($entry, '5150')->debit);
    }

    // ── 8. Stock/valuation unchanged by mapping ─────────────────────────────

    /** @test */
    public function stock_quantity_and_average_cost_are_unaffected_by_account_mapping(): void
    {
        $custom = $this->customAccount('1146', 'asset');
        $this->map('inventory_asset', $custom->id);

        $product = $this->trackedProduct('P8', qty: 0, avgCost: 0);
        $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 2500, 'tax_rate' => 0],
        ]);

        $product->refresh();
        $this->assertSame(10, $product->quantity_on_hand);
        $this->assertSame(2500, (int) $product->avg_cost);
    }

    // ── 7. Invalid mapping rolls back everything atomically ─────────────────

    /** @test */
    public function an_invalid_inventory_asset_mapping_blocks_posting_with_no_partial_effect(): void
    {
        // تعيينٌ صريح كان صالحاً وقت الإسناد، ثم أصبح الحساب معطّلاً لاحقاً —
        // بالضبط كما يحدث واقعياً عبر شاشة توجيه الحسابات ثم تعطيل الحساب.
        $custom = $this->customAccount('1145', 'asset');
        $this->map('inventory_asset', $custom->id);
        $custom->update(['is_active' => false]);

        $product = $this->trackedProduct('P9', qty: 5, avgCost: 1000);
        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 3, 'unit_price' => 1500, 'tax_rate' => 15]]
        );

        $journalsBefore = JournalEntry::query()->count();

        try {
            app(PurchaseService::class)->post($purchase);
            $this->fail('كان يجب رفض الترحيل بتعيين معطّل.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $this->assertSame($journalsBefore, JournalEntry::query()->count());
        $this->assertSame('draft', $purchase->fresh()->status);
        $this->assertNull($purchase->fresh()->journal_entry_id);
        // المخزون لم يتحرّك: لا كمية ولا متوسط تغيّرا.
        $this->assertSame(5, $product->fresh()->quantity_on_hand);
        $this->assertSame(1000, (int) $product->fresh()->avg_cost);
    }

    /** @test */
    public function an_invalid_accounts_payable_mapping_blocks_purchase_return_posting(): void
    {
        $custom = $this->customAccount('2117');
        $this->map('accounts_payable', $custom->id);
        $custom->update(['is_active' => false]);

        $product = $this->trackedProduct('P10', qty: 20, avgCost: 1000);
        $return = app(ReturnService::class)->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 1000, 'tax_rate' => 0]]
        );

        $journalsBefore = JournalEntry::query()->count();

        $this->expectException(RuntimeException::class);
        try {
            app(ReturnService::class)->post($return);
        } finally {
            $this->assertSame($journalsBefore, JournalEntry::query()->count());
            $this->assertSame(20, $product->fresh()->quantity_on_hand);
        }
    }

    // ── Purchase / Purchase Return symmetry (the deferred ACC-RET-1 concern) ─

    /** @test */
    public function a_custom_inventory_asset_mapping_is_used_identically_by_purchase_and_its_return(): void
    {
        $custom = $this->customAccount('1144', 'asset');
        $this->map('inventory_asset', $custom->id);

        $product = $this->trackedProduct('P11', qty: 0, avgCost: 0);
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 3000, 'tax_rate' => 0],
        ]);
        $receiptEntry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(30000, (int) $this->lineFor($receiptEntry, $custom->id)->debit);

        $return = $this->postPurchaseReturn([
            ['product_id' => $product->id, 'quantity' => 4, 'unit_price' => 3000, 'tax_rate' => 0],
        ]);
        $returnEntry = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);

        // نفس الحساب المخصَّص بالضبط على الجانبين — لا يفترقان أبداً.
        $this->assertSame(12000, (int) $this->lineFor($returnEntry, $custom->id)->credit);
        $this->assertNull($this->lineForCode($returnEntry, '1140'));
    }

    /** @test */
    public function purchase_expense_and_tax_input_mappings_are_shared_between_purchase_and_return(): void
    {
        $expenseAccount = $this->customAccount('5158', 'expense');
        $taxAccount = $this->customAccount('1157', 'asset');
        $this->map('purchase_expense', $expenseAccount->id);
        $this->map('tax_input', $taxAccount->id);

        $service = $this->nonTrackedProduct('S4');
        $purchase = $this->postPurchase([
            ['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15],
        ]);
        $receiptEntry = JournalEntry::with('lines.account')->findOrFail($purchase->journal_entry_id);
        $this->assertSame(10000, (int) $this->lineFor($receiptEntry, $expenseAccount->id)->debit);
        $this->assertSame(1500, (int) $this->lineFor($receiptEntry, $taxAccount->id)->debit);

        $return = $this->postPurchaseReturn([
            ['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15],
        ]);
        $returnEntry = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);
        $this->assertSame(10000, (int) $this->lineFor($returnEntry, $expenseAccount->id)->credit);
        $this->assertSame(1500, (int) $this->lineFor($returnEntry, $taxAccount->id)->credit);
    }

    /** @test */
    public function purchase_return_still_never_moves_cash_after_routing(): void
    {
        $product = $this->trackedProduct('P12', qty: 10, avgCost: 1000);
        $return = $this->postPurchaseReturn([
            ['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 1000, 'tax_rate' => 15],
        ]);

        $entry = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);
        $this->assertNull($this->lineForCode($entry, '1110'));
        $this->assertNull($this->lineForCode($entry, '1120'));
    }

    // ── 9. Tenant isolation ──────────────────────────────────────────────────

    /** @test */
    public function tenant_a_custom_mapping_does_not_affect_tenant_b_purchase_posting(): void
    {
        $customA = $this->customAccount('2116');
        $this->map('accounts_payable', $customA->id);

        $tenantB = Tenant::create(['name' => 'مؤسسة أخرى', 'slug' => 'other-acc4', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        $supplierB = Partner::create(['name' => 'مورد ب', 'type' => 'supplier']);
        $productB = Product::create([
            'tenant_id' => $tenantB->id, 'name' => 'صنف ب', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);

        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $supplierB->id, 'payment_type' => 'credit'],
            [['product_id' => $productB->id, 'quantity' => 1, 'unit_price' => 5000, 'tax_rate' => 0]]
        );
        $posted = app(PurchaseService::class)->post($purchase);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(5000, (int) $this->lineForCode($entry, '2110')->credit);
        $this->assertNull($this->lineFor($entry, $customA->id));
        // حساب المستأجر A غير مرئي أصلاً من سياق B.
        $this->assertNull(Account::find($customA->id));
    }

    // ── 10. Historical journals frozen + reversal uses original accounts ────

    /** @test */
    public function remapping_after_posting_never_changes_a_previously_posted_purchase_journal(): void
    {
        $product = $this->trackedProduct('P13', qty: 0, avgCost: 0);
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 4000, 'tax_rate' => 0],
        ]);
        $originalPayable = Account::where('code', '2110')->first();

        $custom = $this->customAccount('2115');
        $this->map('accounts_payable', $custom->id);

        $entry = JournalEntry::with('lines.account')->findOrFail($purchase->fresh()->journal_entry_id);
        $this->assertSame($originalPayable->id, $this->lineForCode($entry, '2110')->account_id);
        $this->assertNull($this->lineFor($entry, $custom->id));
    }

    /** @test */
    public function reversing_a_posted_purchase_journal_uses_the_original_account_not_the_current_mapping(): void
    {
        $product = $this->trackedProduct('P14', qty: 0, avgCost: 0);
        $purchase = $this->postPurchase([
            ['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 6000, 'tax_rate' => 0],
        ]);
        $originalPayable = Account::where('code', '2110')->first();
        $entry = $purchase->fresh()->journalEntry()->with('lines')->first();

        $custom = $this->customAccount('2114');
        $this->map('accounts_payable', $custom->id);

        $reversal = app(LedgerService::class)->reverse($entry);

        $reversedDebit = $reversal->lines->first(fn (JournalLine $line) => $line->debit > 0 && $line->partner_id === $this->supplier->id);
        $this->assertSame($originalPayable->id, $reversedDebit->account_id);
        $this->assertNull($reversal->lines->first(fn (JournalLine $line) => $line->account_id === $custom->id));
    }

    /** @test */
    public function resolver_has_no_disabled_purchase_specific_fallback_and_fails_closed_on_a_missing_mapping(): void
    {
        AccountRoleMapping::query()->where('role_key', 'purchase_expense')->delete();

        $this->expectException(RuntimeException::class);
        app(AccountRoleResolver::class)->resolve('purchase_expense');
    }
}
