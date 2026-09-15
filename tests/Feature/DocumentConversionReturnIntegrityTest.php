<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryNote;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\ProcurementLine;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\PurchaseLine;
use App\Models\QuoteLine;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\DeliveryNoteService;
use App\Services\Accounting\DeliveryNoteSalesInvoiceDraftBuilder;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\EntitlementGrantService;
use App\Services\ProductVariantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-FU-2 — نقل هويّة المتغيّر عبر تحويل المستندات + سلامة مصدر المرتجع
 * ═══════════════════════════════════════════════════════════════
 *  GAP-07: التحويل (عرض سعر ← فاتورة، مستند توريد ← فاتورة مشتريات، سند
 *  تسليم ← مسودة فاتورة) ينقل `product_variant_id` حرفياً من سطر المصدر —
 *  لا استنتاجاً من الكتالوج الحيّ ولا إدخالاً من العميل.
 *  GAP-08: `ReturnService::assertWithinSource()` يربط هويّة سطر المرتجع
 *  (منتج + متغيّرٌ اختياري) بهويّة سطر المصدر المُعلَن حرفياً — لا يكفي أن
 *  يكون المتغيّر صالحاً بمعزلٍ عن مطابقته الفعلية لما بِيع.
 */
class DocumentConversionReturnIntegrityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;

    private string $customerId;

    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('var-fu-2', 'owner@var-fu-2.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        app(BranchContext::class)->set(Branch::query()->firstOrFail()->id);

        $this->customerId = Partner::create(['name' => 'عميل', 'type' => 'customer'])->id;
        $this->supplierId = Partner::create(['name' => 'مورّد', 'type' => 'supplier'])->id;
    }

    private function token(): string
    {
        return $this->auth['token'];
    }

    private function simpleProduct(string $sku = 'SIMPLE-1'): Product
    {
        return Product::create([
            'name' => 'صنفٌ بسيط', 'sku' => $sku, 'sale_price' => 10000, 'track_inventory' => true,
        ]);
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

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $black1 = $variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $white1 = $variants->createSingleVariant($product, [$white->id, $small->id], null)['variant'];

        return [$product->fresh(), $black1->fresh(), $white1->fresh()];
    }

    private function receive(Product $product, int $qty, int $unitCost, ?ProductVariant $variant = null): void
    {
        app(InventoryService::class)->receiveStock($product, $qty, $unitCost, variant: $variant);
    }

    private function grantSalesInvoicing(): void
    {
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->auth['tenant_id']),
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            now()->subMinute(),
            null,
            'var-fu-2-test',
            $this->auth['tenant_id'],
        );
    }

    // ═══════════════════════════════ GAP-07 — عرض السعر ═══════════════════════════════

    /** @test */
    public function quote_conversion_simple_product_remains_unchanged(): void
    {
        $product = $this->simpleProduct();
        $this->receive($product, 5, 4000);

        $quoteId = $this->withToken($this->token())->postJson('/api/quotes', [
            'partner_id' => $this->customerId,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $invoice = $this->withToken($this->token())
            ->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated();

        $this->assertNull($invoice['data']['lines'][0]['product_variant_id']);
    }

    /** @test */
    public function quote_conversion_preserves_variant_identity(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->receive($product, 5, 4000, $black1);

        $quoteId = $this->withToken($this->token())->postJson('/api/quotes', [
            'partner_id' => $this->customerId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()['data']['id'];

        $invoice = $this->withToken($this->token())
            ->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated();

        $this->assertSame($black1->id, $invoice['data']['lines'][0]['product_variant_id']);
        $this->assertSame('أسود / كبير', $invoice['data']['lines'][0]['variant_descriptor']);

        $line = InvoiceLine::where('invoice_id', $invoice['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot, 'اللقطة الجديدة تُشتقّ من نفس المتغيّر عند إنشاء الفاتورة، لا تُنسَخ حرفياً من عرض السعر.');
    }

    /** @test — التحويل لا يستبدل الشقيق: عرض السعر لمتغيّر أسود ينتج فاتورةً لنفس الأسود لا الأبيض. */
    public function quote_conversion_does_not_substitute_a_sibling_variant(): void
    {
        [$product, $black1, $white1] = $this->variantManagedProduct();
        $this->receive($product, 5, 4000, $black1);
        $this->receive($product, 5, 9000, $white1);

        $quoteId = $this->withToken($this->token())->postJson('/api/quotes', [
            'partner_id' => $this->customerId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()['data']['id'];

        $invoice = $this->withToken($this->token())
            ->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated();

        $this->assertSame($black1->id, $invoice['data']['lines'][0]['product_variant_id']);
        $this->assertNotSame($white1->id, $invoice['data']['lines'][0]['product_variant_id']);
    }

    // ═══════════════════════════════ GAP-07 — مستند التوريد ═══════════════════════════════

    /** @test */
    public function procurement_conversion_simple_product_remains_unchanged(): void
    {
        $product = $this->simpleProduct('SIMPLE-PROC-1');

        $orderId = $this->withToken($this->token())->postJson('/api/procurement', [
            'type' => 'order', 'partner_id' => $this->supplierId,
            'items' => [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 4000]],
        ])->assertCreated()['data']['id'];
        $this->withToken($this->token())->postJson("/api/procurement/{$orderId}/transition", ['status' => 'submitted'])->assertOk();
        $this->withToken($this->token())->postJson("/api/procurement/{$orderId}/transition", ['status' => 'approved'])->assertOk();

        $purchase = $this->withToken($this->token())
            ->postJson("/api/procurement/{$orderId}/convert", ['target' => 'purchase'])
            ->assertCreated();

        $this->assertNull($purchase['data']['lines'][0]['product_variant_id']);
    }

    /** @test — تغطي كلا موقعَي itemsOf(): سلسلة التحويل (طلب ← أمر) ثم التحويل إلى فاتورة مشتريات. */
    public function procurement_chain_conversion_preserves_variant_identity_through_both_steps(): void
    {
        [$product, $black1] = $this->variantManagedProduct('SHIRT-PROC-1');

        $requestId = $this->withToken($this->token())->postJson('/api/procurement', [
            'type' => 'request',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 5, 'unit_price' => 4000,
            ]],
        ])->assertCreated()['data']['id'];
        $this->withToken($this->token())->postJson("/api/procurement/{$requestId}/transition", ['status' => 'submitted'])->assertOk();
        $this->withToken($this->token())->postJson("/api/procurement/{$requestId}/transition", ['status' => 'approved'])->assertOk();

        // الخطوة الأولى: طلب ← أمر شراء (ProcurementService::convert() → itemsOf()).
        $order = $this->withToken($this->token())
            ->postJson("/api/procurement/{$requestId}/convert", ['target' => 'order', 'partner_id' => $this->supplierId])
            ->assertCreated();
        $this->assertSame($black1->id, $order['data']['lines'][0]['product_variant_id']);
        $this->assertSame('أسود / كبير', $order['data']['lines'][0]['variant_descriptor']);

        $orderId = $order['data']['id'];
        $this->withToken($this->token())->postJson("/api/procurement/{$orderId}/transition", ['status' => 'submitted'])->assertOk();
        $this->withToken($this->token())->postJson("/api/procurement/{$orderId}/transition", ['status' => 'approved'])->assertOk();

        // الخطوة الثانية: أمر ← فاتورة مشتريات (ProcurementService::convertToPurchase() → itemsOf()).
        $purchase = $this->withToken($this->token())
            ->postJson("/api/procurement/{$orderId}/convert", ['target' => 'purchase'])
            ->assertCreated();
        $this->assertSame($black1->id, $purchase['data']['lines'][0]['product_variant_id']);

        $line = PurchaseLine::where('purchase_id', $purchase['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);

        $orderLine = ProcurementLine::where('procurement_document_id', $orderId)->firstOrFail();
        $this->assertSame($black1->id, $orderLine->product_variant_id, 'سطر الأمر نفسه يحمل هويّة المتغيّر — لا فقط الفاتورة النهائية.');
    }

    // ═══════════════════════════════ GAP-07 — سند التسليم ═══════════════════════════════

    /** @test */
    public function delivery_note_invoice_draft_preserves_variant_identity(): void
    {
        $this->grantSalesInvoicing();
        [$product, $black1] = $this->variantManagedProduct('SHIRT-DN-1');
        $this->receive($product, 5, 4000, $black1);
        $warehouse = Warehouse::create(['name' => 'مخزن التسليم', 'code' => 'DN-W-VFU2-1', 'branch_id' => Branch::query()->firstOrFail()->id, 'is_active' => true]);
        $owner = User::query()->where('email', 'owner@var-fu-2.test')->firstOrFail();

        $deliveryNotes = app(DeliveryNoteService::class);
        $note = $deliveryNotes->create([
            'customer_id' => $this->customerId, 'warehouse_id' => $warehouse->id,
            'delivery_date' => now()->toDateString(), 'created_by' => $owner->id,
        ], [['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 2]]);
        $note = $deliveryNotes->confirm($note, $note->version, $owner->id, 'تأكيد للفوترة.');

        $builder = app(DeliveryNoteSalesInvoiceDraftBuilder::class);
        $line = $note->fresh('lines')->lines->sole();
        $result = $builder->build([
            'delivery_note_ids' => [$note->id],
            'expected_versions' => [$note->id => $note->version],
            'idempotency_key' => 'var-fu-2-dn-variant-0001',
            'reason' => 'اختبار نقل هويّة المتغيّر عبر تحويل سند التسليم.',
            'invoice_date' => now()->toDateString(),
            'tax_inclusive' => false,
            'line_pricing' => [[
                'delivery_note_line_id' => $line->id, 'unit_price' => 20000, 'tax_rate' => 15, 'discount' => 0,
            ]],
            'actor_id' => $owner->id,
        ]);

        $invoiceLine = $result->invoice->lines->sole();
        $this->assertSame($black1->id, $invoiceLine->product_variant_id);
        $this->assertSame('أسود / كبير', $invoiceLine->variant_descriptor_snapshot);
    }

    /** @test — متغيّران شقيقان بنفس الوحدة/السعر/الضريبة يبقيان سطرَي فاتورةٍ منفصلين، لا يندمجان. */
    public function delivery_note_invoice_draft_keeps_sibling_variants_as_separate_lines(): void
    {
        $this->grantSalesInvoicing();
        [$product, $black1, $white1] = $this->variantManagedProduct('SHIRT-DN-2');
        $this->receive($product, 5, 4000, $black1);
        $this->receive($product, 5, 4000, $white1);
        $warehouse = Warehouse::create(['name' => 'مخزن التسليم ٢', 'code' => 'DN-W-VFU2-2', 'branch_id' => Branch::query()->firstOrFail()->id, 'is_active' => true]);
        $owner = User::query()->where('email', 'owner@var-fu-2.test')->firstOrFail();

        $deliveryNotes = app(DeliveryNoteService::class);
        $note = $deliveryNotes->create([
            'customer_id' => $this->customerId, 'warehouse_id' => $warehouse->id,
            'delivery_date' => now()->toDateString(), 'created_by' => $owner->id,
        ], [
            ['product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1],
            ['product_id' => $product->id, 'product_variant_id' => $white1->id, 'quantity' => 1],
        ]);
        $note = $deliveryNotes->confirm($note, $note->version, $owner->id, 'تأكيد للفوترة.');

        $builder = app(DeliveryNoteSalesInvoiceDraftBuilder::class);
        $lines = $note->fresh('lines')->lines;
        // نفس سعر الوحدة والضريبة عمداً لكلا السطرين — لو كان مفتاح التجميع
        // يتجاهل المتغيّر لاندمجا في سطر فاتورةٍ واحد فاقدٍ للهويّة.
        $result = $builder->build([
            'delivery_note_ids' => [$note->id],
            'expected_versions' => [$note->id => $note->version],
            'idempotency_key' => 'var-fu-2-dn-sibling-0001',
            'reason' => 'اختبار عدم دمج متغيّرين شقيقين في سطر فاتورةٍ واحد.',
            'invoice_date' => now()->toDateString(),
            'tax_inclusive' => false,
            'line_pricing' => $lines->map(fn ($l) => [
                'delivery_note_line_id' => $l->id, 'unit_price' => 20000, 'tax_rate' => 15, 'discount' => 0,
            ])->all(),
            'actor_id' => $owner->id,
        ]);

        $this->assertCount(2, $result->invoice->lines, 'متغيّران شقيقان لا يندمجان في سطرٍ واحد.');
        $variantIds = $result->invoice->lines->pluck('product_variant_id')->sort()->values()->all();
        $this->assertEqualsCanonicalizing([$black1->id, $white1->id], $variantIds);
    }

    /** @test */
    public function delivery_note_invoice_draft_simple_product_remains_unchanged(): void
    {
        $this->grantSalesInvoicing();
        $product = $this->simpleProduct('SIMPLE-DN-1');
        $warehouse = Warehouse::create(['name' => 'مخزن التسليم ٣', 'code' => 'DN-W-VFU2-3', 'branch_id' => Branch::query()->firstOrFail()->id, 'is_active' => true]);
        $owner = User::query()->where('email', 'owner@var-fu-2.test')->firstOrFail();

        $deliveryNotes = app(DeliveryNoteService::class);
        $note = $deliveryNotes->create([
            'customer_id' => $this->customerId, 'warehouse_id' => $warehouse->id,
            'delivery_date' => now()->toDateString(), 'created_by' => $owner->id,
        ], [['product_id' => $product->id, 'quantity' => 2]]);
        $note = $deliveryNotes->confirm($note, $note->version, $owner->id, 'تأكيد للفوترة.');

        $builder = app(DeliveryNoteSalesInvoiceDraftBuilder::class);
        $line = $note->fresh('lines')->lines->sole();
        $result = $builder->build([
            'delivery_note_ids' => [$note->id],
            'expected_versions' => [$note->id => $note->version],
            'idempotency_key' => 'var-fu-2-dn-simple-0001',
            'reason' => 'توافقٌ رجعي لمنتجٍ بسيط.',
            'invoice_date' => now()->toDateString(),
            'tax_inclusive' => false,
            'line_pricing' => [[
                'delivery_note_line_id' => $line->id, 'unit_price' => 10000, 'tax_rate' => 15, 'discount' => 0,
            ]],
            'actor_id' => $owner->id,
        ]);

        $this->assertNull($result->invoice->lines->sole()->product_variant_id);
    }

    // ═══════════════════════════════ GAP-08 — سلامة مصدر المرتجع ═══════════════════════════════

    private function postedInvoice(Product $product, ?ProductVariant $variant, int $qty, int $unitPrice): array
    {
        $this->receive($product, $qty + 20, 4000, $variant);
        $items = [array_filter([
            'product_id' => $product->id,
            'product_variant_id' => $variant?->id,
            'quantity' => $qty,
            'unit_price' => $unitPrice,
            'tax_rate' => 15,
        ], fn ($v) => $v !== null)];

        $invoice = $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash', 'items' => $items,
        ])->assertCreated()['data'];
        $this->withToken($this->token())->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        return $this->withToken($this->token())->getJson("/api/invoices/{$invoice['id']}")->assertOk()['data'];
    }

    private function attemptReturn(array $invoice, array $itemOverrides): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($this->token())->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'original_id' => $invoice['id'],
            'items' => [array_merge([
                'source_line_id' => $invoice['lines'][0]['id'],
                'quantity' => 1, 'unit_price' => $invoice['lines'][0]['unit_price_before_tax'] ?? 0,
                'tax_rate' => 15,
            ], $itemOverrides)],
        ]);
    }

    /** @test */
    public function return_same_simple_product_source_line_succeeds(): void
    {
        $product = $this->simpleProduct('SIMPLE-RET-1');
        $invoice = $this->postedInvoice($product, null, 5, 20000);

        $res = $this->attemptReturn($invoice, ['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 20000])
            ->assertCreated();

        $return = ReturnLine::where('return_id', $res['data']['id'])->firstOrFail();
        $this->assertSame($product->id, $return->product_id);
        $this->assertNull($return->product_variant_id);

        $this->withToken($this->token())->postJson("/api/returns/{$res['data']['id']}/post")->assertOk();
    }

    /** @test */
    public function return_different_product_against_source_line_fails(): void
    {
        $product = $this->simpleProduct('SIMPLE-RET-2A');
        $other = $this->simpleProduct('SIMPLE-RET-2B');
        $invoice = $this->postedInvoice($product, null, 5, 20000);

        $this->attemptReturn($invoice, ['product_id' => $other->id, 'quantity' => 1, 'unit_price' => 20000])
            ->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
        $this->assertSame(0, ReturnLine::count());
    }

    /** @test */
    public function return_variant_source_same_variant_succeeds(): void
    {
        [$product, $black1] = $this->variantManagedProduct('SHIRT-RET-1');
        $invoice = $this->postedInvoice($product, $black1, 5, 20000);

        $res = $this->attemptReturn($invoice, [
            'product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 2, 'unit_price' => 20000,
        ])->assertCreated();

        $return = ReturnLine::where('return_id', $res['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $return->product_variant_id);

        $this->withToken($this->token())->postJson("/api/returns/{$res['data']['id']}/post")->assertOk();
    }

    /** @test — الشقيق لا يُقبَل بديلاً عن المتغيّر الذي بِيع فعلياً على هذا السطر. */
    public function return_variant_source_sibling_variant_fails(): void
    {
        [$product, $black1, $white1] = $this->variantManagedProduct('SHIRT-RET-2');
        $invoice = $this->postedInvoice($product, $black1, 5, 20000);
        $this->receive($product, 20, 9000, $white1);

        $this->attemptReturn($invoice, [
            'product_id' => $product->id, 'product_variant_id' => $white1->id, 'quantity' => 1, 'unit_price' => 20000,
        ])->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
        $this->assertSame(0, ReturnLine::count());
        // الأخ الشقيق لا يتأثر — لا خصمٌ ولا إرجاعٌ مخزنيٌّ حدث أصلاً.
        $whiteState = \App\Models\InventoryState::where('product_id', $product->id)->where('product_variant_id', $white1->id)->firstOrFail();
        $this->assertSame(20, $whiteState->quantity_on_hand);
    }

    /** @test — سطرٌ باع متغيّراً بعينه لا يُرَدّ بلا تحديد متغيّرٍ إطلاقاً. */
    public function return_variant_source_null_variant_fails(): void
    {
        [$product, $black1] = $this->variantManagedProduct('SHIRT-RET-3');
        $invoice = $this->postedInvoice($product, $black1, 5, 20000);

        $this->attemptReturn($invoice, ['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000])
            ->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test — سطرٌ باع منتجاً بسيطاً لا يُرَدّ بمتغيّرٍ مُقحَم. */
    public function return_simple_source_injected_variant_fails(): void
    {
        $product = $this->simpleProduct('SIMPLE-RET-3');
        [, $someVariant] = $this->variantManagedProduct('SHIRT-RET-4');
        $invoice = $this->postedInvoice($product, null, 5, 10000);

        $this->attemptReturn($invoice, [
            'product_id' => $product->id, 'product_variant_id' => $someVariant->id, 'quantity' => 1, 'unit_price' => 10000,
        ])->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test — متغيّرٌ صالحٌ لكن يخصّ منتجاً مختلفاً تماماً عن سطر المصدر. */
    public function return_variant_from_another_product_fails(): void
    {
        [$productA, $blackOfA] = $this->variantManagedProduct('SHIRT-RET-5A');
        [$productB, $blackOfB] = $this->variantManagedProduct('SHIRT-RET-5B');
        $invoice = $this->postedInvoice($productA, $blackOfA, 5, 20000);

        $this->attemptReturn($invoice, [
            'product_id' => $productA->id, 'product_variant_id' => $blackOfB->id, 'quantity' => 1, 'unit_price' => 20000,
        ])->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function return_variant_from_another_tenant_fails(): void
    {
        [$product, $black1] = $this->variantManagedProduct('SHIRT-RET-6');
        $invoice = $this->postedInvoice($product, $black1, 5, 20000);

        $other = Tenant::create(['name' => 'مستأجرٌ آخر', 'slug' => 'other-var-fu-2', 'vat_number' => '300000000000097', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        [, $foreignVariant] = $this->variantManagedProduct('SHIRT-RET-6-FOREIGN');
        app(TenantContext::class)->set($this->auth['tenant_id']);

        $this->attemptReturn($invoice, [
            'product_id' => $product->id, 'product_variant_id' => $foreignVariant->id, 'quantity' => 1, 'unit_price' => 20000,
        ])->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test — source_line_id مصطنَعٌ من فاتورةٍ حقيقية لكنه لا يخصّ original_id المُعلَن. */
    public function crafted_source_line_id_cannot_cross_tenant_boundary(): void
    {
        [$product, $black1] = $this->variantManagedProduct('SHIRT-RET-7');
        $myInvoice = $this->postedInvoice($product, $black1, 5, 20000);

        $other = Tenant::create(['name' => 'مستأجرٌ آخر ٢', 'slug' => 'other-var-fu-2-b', 'vat_number' => '300000000000096', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $foreignCustomer = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);
        [$foreignProduct, $foreignVariant] = $this->variantManagedProduct('SHIRT-RET-7-FOREIGN');
        app(InventoryService::class)->receiveStock($foreignProduct, 20, 4000, variant: $foreignVariant);
        $foreignInvoice = app(InvoiceService::class)->create(
            ['partner_id' => $foreignCustomer->id, 'payment_type' => 'cash'],
            [['product_id' => $foreignProduct->id, 'product_variant_id' => $foreignVariant->id, 'quantity' => 5, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $foreignInvoice = app(InvoiceService::class)->post($foreignInvoice);
        $foreignLineId = $foreignInvoice->lines()->first()->id;
        app(TenantContext::class)->set($this->auth['tenant_id']);

        // original_id يشير لفاتورتي الحقيقية، لكن source_line_id مُصطنَعٌ من سطر
        // فاتورة مستأجرٍ آخر تماماً — يجب أن يُرفَض، لا أن "يعمل" بمصادفة هوية.
        $this->withToken($this->token())->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'original_id' => $myInvoice['id'],
            'items' => [[
                'source_line_id' => $foreignLineId,
                'product_id' => $foreignProduct->id, 'product_variant_id' => $foreignVariant->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
    }
}
