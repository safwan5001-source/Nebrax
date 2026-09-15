<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\InventoryState;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductVariant;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Models\Quote;
use App\Models\QuoteLine;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Services\ProductVariantService;
use App\Support\DocumentLineVariantResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-DOC-1 — هويّة المتغيّر في سطور المستندات + لقطة تاريخية ثابتة
 * ═══════════════════════════════════════════════════════════════
 *  يغطّي: التوافق الرجعي للمنتج البسيط، تخزين `product_variant_id`،
 *  الحواجز (انتماء/مستأجر/تركيبة خاطئة)، توجيه الترحيل المخزني إلى
 *  `InventoryState` الصحيحة (منتج بسيط أو متغيّر بعينه)، اللقطة التاريخية
 *  الحتمية وثباتها بعد الترحيل رغم إعادة تسمية المنتج/الخيار/تعطيل
 *  المتغيّر/تغيير السعر، وحارس حذف المتغيّر المرجَع في مستندٍ تجاري.
 */
class VariantDocumentLineTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;

    protected Partner $customer;

    protected InvoiceService $invoices;

    protected PurchaseService $purchases;

    protected ReturnService $returns;

    protected InventoryService $inventory;

    protected ProductVariantService $variants;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        $this->invoices = app(InvoiceService::class);
        $this->purchases = app(PurchaseService::class);
        $this->returns = app(ReturnService::class);
        $this->inventory = app(InventoryService::class);
        $this->variants = app(ProductVariantService::class);
    }

    private function simpleProduct(array $overrides = []): Product
    {
        return Product::create(array_merge([
            'name' => 'صنفٌ بسيط', 'sku' => 'SIMPLE-1', 'sale_price' => 10000, 'track_inventory' => true,
        ], $overrides));
    }

    /** منتجٌ متعدد الخيارات بمتغيّرين: أسود/كبير وأبيض/صغير. */
    private function variantManagedProduct(string $sku = 'SHIRT-1'): array
    {
        $tenantId = app(TenantContext::class)->id();
        $product = Product::create([
            'name' => 'قميص', 'sku' => $sku, 'sale_price' => 20000, 'track_inventory' => true,
        ]);

        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $size = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $large = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'كبير', 'value_key' => 'كبير', 'sort_order' => 0]);
        $small = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'صغير', 'value_key' => 'صغير', 'sort_order' => 1]);

        $this->variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $black1 = $this->variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $white1 = $this->variants->createSingleVariant($product, [$white->id, $small->id], null)['variant'];

        return [$product->fresh(), $black1, $white1];
    }

    // ───────────────────────── ١) توافقٌ رجعي ─────────────────────────

    /** @test */
    public function a_simple_product_invoice_line_remains_backward_compatible(): void
    {
        $product = $this->simpleProduct();

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        );

        $line = $invoice->lines()->first();
        $this->assertSame($product->id, $line->product_id);
        $this->assertNull($line->product_variant_id);
        $this->assertNull($line->variant_descriptor_snapshot);
    }

    // ───────────────────────── ٢) تخزين هويّة المتغيّر ─────────────────────────

    /** @test */
    public function a_variant_managed_line_stores_product_id_and_product_variant_id(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );

        $line = $invoice->lines()->first();
        $this->assertSame($product->id, $line->product_id);
        $this->assertSame($black1->id, $line->product_variant_id);
    }

    /** @test — لقطةٌ حتمية «أسود / كبير» بترتيب الخيار لا القيمة. */
    public function the_snapshot_stores_a_deterministic_variant_descriptor(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );

        $line = $invoice->lines()->first();
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
    }

    // ───────────────────────── ٣) حواجز الصحة ─────────────────────────

    /** @test */
    public function a_variant_must_belong_to_the_stated_product(): void
    {
        [$productA] = $this->variantManagedProduct('SHIRT-A');
        [, , $whiteOfB] = $this->variantManagedProduct('SHIRT-B'); // متغيّرٌ من منتجٍ آخر

        $this->expectException(RuntimeException::class);
        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $productA->id, 'product_variant_id' => $whiteOfB->id, 'quantity' => 1, 'unit_price' => 20000]]
        );
    }

    /** @test */
    public function a_cross_tenant_variant_is_denied(): void
    {
        [$product] = $this->variantManagedProduct();

        $other = Tenant::create(['name' => 'مستأجرٌ آخر', 'slug' => 'other', 'vat_number' => '300000000000099', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        [, $foreignVariant] = $this->variantManagedProduct();
        app(TenantContext::class)->set($this->tenant->id);

        $this->expectException(RuntimeException::class);
        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $foreignVariant->id, 'quantity' => 1, 'unit_price' => 20000]]
        );
    }

    /** @test — منتجٌ بسيط لا يقبل متغيّراً. */
    public function a_simple_product_rejects_an_explicit_variant_id(): void
    {
        $product = $this->simpleProduct();
        [, $someVariant] = $this->variantManagedProduct();

        $this->expectException(RuntimeException::class);
        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $someVariant->id, 'quantity' => 1, 'unit_price' => 10000]]
        );
    }

    /** @test — منتجٌ متعدد الخيارات بلا متغيّرٍ محدَّد: لا مسار بيع غامض على الأب. */
    public function a_variant_managed_product_without_a_variant_id_is_rejected(): void
    {
        [$product] = $this->variantManagedProduct();

        $this->expectException(RuntimeException::class);
        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000]]
        );
    }

    // ───────────────────────── ٤) المخزون يستهدف الهويّة الصحيحة ─────────────────────────

    /** @test */
    public function posting_an_invoice_targets_the_variants_own_inventory_state(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 3, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);

        $state = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black1->id)->firstOrFail();
        $this->assertSame(7, $state->quantity_on_hand);

        $movement = StockMovement::where('source_type', Invoice::class)->where('source_id', $invoice->id)->firstOrFail();
        $this->assertSame($black1->id, $movement->product_variant_id);
    }

    /** @test — الأخ في التركيبة الأخرى لا يتأثر إطلاقاً. */
    public function sibling_variant_inventory_remains_unchanged_after_a_sale(): void
    {
        [$product, $black1, $white1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);
        $this->inventory->receiveStock($product, 5, 9000, variant: $white1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 3, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);

        $blackState = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black1->id)->firstOrFail();
        $whiteState = InventoryState::where('product_id', $product->id)->where('product_variant_id', $white1->id)->firstOrFail();
        $this->assertSame(7, $blackState->quantity_on_hand);
        $this->assertSame(5, $whiteState->quantity_on_hand, 'الأخ الشقيق يجب ألّا يتأثر.');
        $this->assertSame(9000, $whiteState->avg_cost);
    }

    /** @test — الشراء (استلامٌ) يستهدف نفس هويّة المخزون الصحيحة. */
    public function purchase_receiving_targets_the_variants_own_inventory_state(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $supplier = Partner::create(['name' => 'مورّد', 'type' => 'supplier']);

        $purchase = $this->purchases->create(
            ['partner_id' => $supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]]
        );
        $this->purchases->post($purchase);

        $state = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black1->id)->firstOrFail();
        $this->assertSame(10, $state->quantity_on_hand);
        $this->assertSame(4000, $state->avg_cost);

        $line = PurchaseLine::where('purchase_id', $purchase->id)->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
    }

    /** @test — لا سعرٌ مشتقٌّ من عامل الوحدة: السعر المُدخَل هو المخزَّن حرفياً. */
    public function no_factor_derived_price_is_introduced_for_a_variant_line(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15]]
        );

        $line = $invoice->lines()->first();
        $this->assertSame(20000, $line->unit_price);
        $this->assertSame(1, $line->unit_factor);
    }

    // ───────────────────────── ٥) الحقيقة المجمَّدة بعد الترحيل ─────────────────────────

    /** @test */
    public function renaming_the_product_after_posting_does_not_change_the_historical_line(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);
        $line = $invoice->lines()->first();
        $originalName = $line->product_name_snapshot;

        $product->update(['name' => 'اسمٌ جديد تماماً']);

        $line->refresh();
        $this->assertSame($originalName, $line->product_name_snapshot);
        $this->assertNotSame('اسمٌ جديد تماماً', $line->product_name_snapshot);
    }

    /** @test */
    public function renaming_an_option_value_after_posting_does_not_change_the_historical_descriptor(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);
        $line = $invoice->lines()->first();
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);

        $black1->optionValues()->first()->update(['value' => 'كحلي']);

        $line->refresh();
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot, 'اللقطة لا تُعاد اشتقاقها من المتغيّر الحيّ.');
    }

    /** @test */
    public function sku_and_barcode_changes_after_posting_do_not_change_the_historical_line(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);
        $line = $invoice->lines()->first();
        $originalSku = $line->product_sku_snapshot;

        $product->update(['sku' => 'CHANGED-SKU', 'barcode' => '6280000099999']);

        $line->refresh();
        $this->assertSame($originalSku, $line->product_sku_snapshot);
    }

    /** @test */
    public function price_changes_after_posting_do_not_change_the_historical_unit_price_or_totals(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);
        $line = $invoice->lines()->first();
        $originalTotal = $line->line_total;

        $black1->unitPrices()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id,
            'unit_name' => $product->unit ?? 'piece', 'price' => 99999,
        ]);

        $line->refresh();
        $this->assertSame(20000, $line->unit_price);
        $this->assertSame($originalTotal, $line->line_total);
    }

    /** @test */
    public function deactivating_a_variant_after_posting_does_not_corrupt_the_historical_document(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);

        $black1->update(['is_active' => false]);

        $line = $invoice->fresh()->lines()->first();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
        $this->assertSame(20000, $line->unit_price);
    }

    // ───────────────────────── ٦) حارس دورة الحياة ─────────────────────────

    /** @test */
    public function a_variant_referenced_by_a_business_document_cannot_be_hard_deleted(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1, 'unit_price' => 20000]]
        );

        $this->expectException(RuntimeException::class);
        $this->variants->deleteVariant($black1, null);
    }

    /** @test — نفس الحارس يمنع كذلك مرجعاً في مستندٍ أخف (عرض سعر مثلاً). */
    public function a_variant_referenced_only_by_a_quote_still_blocks_hard_delete(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        QuoteLine::create([
            'quote_id' => Quote::create([
                'partner_id' => $this->customer->id, 'quote_date' => now()->toDateString(),
                'number' => 'Q-TEST-1', 'status' => 'draft',
            ])->id,
            'product_id' => $product->id,
            'product_variant_id' => $black1->id,
            'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            'line_subtotal' => 20000, 'line_tax' => 3000, 'line_total' => 23000,
        ]);

        $this->expectException(RuntimeException::class);
        $this->variants->deleteVariant($black1, null);
    }

    // ───────────────────────── ٧) المرتجع يستهدف نفس الهويّة ─────────────────────────

    /** @test */
    public function a_sales_return_restocks_the_correct_variant_identity(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->inventory->receiveStock($product, 10, 4000, variant: $black1);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 5, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $invoice = $this->invoices->post($invoice);
        $invoiceLine = $invoice->lines()->first();

        $return = $this->returns->create([
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'cash',
            'return_date' => now()->toDateString(), 'original_id' => $invoice->id,
        ], [[
            'product_id' => $product->id, 'product_variant_id' => $black1->id,
            'source_line_id' => $invoiceLine->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15,
        ]]);
        $this->returns->post($return);

        $state = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black1->id)->firstOrFail();
        // 10 استلام − 5 بيع + 2 مرتجع = 7
        $this->assertSame(7, $state->quantity_on_hand);

        $line = ReturnLine::where('return_id', $return->id)->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
    }
}
