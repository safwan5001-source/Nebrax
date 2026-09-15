<?php

namespace Tests\Feature;

use App\Models\CreditNoteLine;
use App\Models\DeliveryNoteLine;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\ProcurementLine;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\PurchaseLine;
use App\Models\QuoteLine;
use App\Models\RecurringInvoiceLine;
use App\Models\ReturnLine;
use App\Models\Tenant;
use App\Services\Accounting\InventoryService;
use App\Services\EntitlementGrantService;
use App\Services\ProductVariantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-FU-1 — إكمال HTTP لدعم المتغيّرات عبر مستندات ERP العادية
 * ═══════════════════════════════════════════════════════════════
 *  يغطّي: قبول `items.*.product_variant_id` فعلياً عبر الطلبات الحقيقية
 *  (لا خدمةً مباشرة) لكل نوع مستندٍ ذُكر في GAP-01 — الفاتورة، المشترى،
 *  عرض السعر، إشعار الدائن، الفاتورة المتكررة، مستند التوريد، سند
 *  التسليم، والمرتجع — وأن التمرير يصل سليماً إلى `DocumentLineVariantResolver`
 *  (VAR-DOC-1) بلا أي منطق تحقّقٍ جديد هنا. لا يعيد اختبار المحلِّل نفسه
 *  (`VariantDocumentLineTest` يغطّيه من الخدمة مباشرة) بل يثبت أن طبقة HTTP
 *  لا تُسقط الحقل ولا تُضعف عزل المستأجر.
 */
class DocumentHttpVariantsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;

    private string $customerId;

    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('var-fu-1', 'owner@var-fu-1.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);

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

    /** سند التسليم يحتاج استحقاقاً تجارياً منفصلاً لـ`sales.invoicing` — لا يكفي تفعيل الكتالوج وحده. */
    private function grantSalesInvoicing(): void
    {
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->auth['tenant_id']),
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            now()->subMinute(),
            null,
            'var-fu-1-test',
            $this->auth['tenant_id'],
        );
    }

    // ───────────────────────── ١) الفاتورة ─────────────────────────

    /** @test */
    public function invoice_simple_product_create_via_http(): void
    {
        $product = $this->simpleProduct();
        $this->receive($product, 10, 4000);

        $res = $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertNull($res['data']['lines'][0]['product_variant_id']);
    }

    /** @test */
    public function invoice_variant_create_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->receive($product, 10, 4000, $black1);

        $res = $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);
        $this->assertSame('أسود / كبير', $res['data']['lines'][0]['variant_descriptor']);
    }

    /** @test */
    public function invoice_wrong_product_variant_rejected_via_http(): void
    {
        [$productA] = $this->variantManagedProduct('SHIRT-A');
        [, , $whiteOfB] = $this->variantManagedProduct('SHIRT-B');

        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $productA->id, 'product_variant_id' => $whiteOfB->id,
                'quantity' => 1, 'unit_price' => 20000,
            ]],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function invoice_cross_tenant_variant_rejected_via_http(): void
    {
        [$product] = $this->variantManagedProduct();

        $other = Tenant::create(['name' => 'مستأجرٌ آخر', 'slug' => 'other-var-fu-1', 'vat_number' => '300000000000099', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        [, $foreignVariant] = $this->variantManagedProduct();
        app(TenantContext::class)->set($this->auth['tenant_id']);

        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $foreignVariant->id,
                'quantity' => 1, 'unit_price' => 20000,
            ]],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::count());
    }

    /** @test — تحديث مسوّدةٍ يمرّر المتغيّر عبر نفس مسار HTTP. */
    public function invoice_update_draft_propagates_variant_via_http(): void
    {
        $simple = $this->simpleProduct();
        $this->receive($simple, 5, 4000);
        [$product, $black1] = $this->variantManagedProduct();
        $this->receive($product, 10, 4000, $black1);

        $invoiceId = $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [['product_id' => $simple->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $updated = $this->withToken($this->token())->putJson("/api/invoices/{$invoiceId}", [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertOk();

        $this->assertSame($black1->id, $updated['data']['lines'][0]['product_variant_id']);
    }

    // ───────────────────────── ٢) المشتريات ─────────────────────────

    /** @test */
    public function purchase_variant_create_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $res = $this->withToken($this->token())->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);

        $line = PurchaseLine::where('purchase_id', $res['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
    }

    // ───────────────────────── ٣) عرض السعر ─────────────────────────

    /** @test */
    public function quote_variant_create_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $res = $this->withToken($this->token())->postJson('/api/quotes', [
            'partner_id' => $this->customerId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);
        $this->assertSame('أسود / كبير', $res['data']['lines'][0]['variant_descriptor']);
    }

    // ───────────────────────── ٤) إشعار الدائن ─────────────────────────

    /** @test */
    public function credit_note_variant_path_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $res = $this->withToken($this->token())->postJson('/api/credit-notes', [
            'partner_id' => $this->customerId, 'type' => 'sales',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);

        $line = CreditNoteLine::where('credit_note_id', $res['data']['id'])->firstOrFail();
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
    }

    // ───────────────────────── ٥) الفاتورة المتكررة ─────────────────────────

    /** @test */
    public function recurring_invoice_variant_path_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $res = $this->withToken($this->token())->postJson('/api/recurring-invoices', [
            'partner_id' => $this->customerId, 'frequency' => 'monthly', 'start_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);

        $line = RecurringInvoiceLine::where('recurring_invoice_id', $res['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
    }

    // ───────────────────────── ٦) مستند التوريد ─────────────────────────

    /** @test */
    public function procurement_variant_path_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();

        $res = $this->withToken($this->token())->postJson('/api/procurement', [
            'type' => 'request', 'partner_id' => $this->supplierId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 5, 'unit_price' => 4000,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);

        $line = ProcurementLine::where('procurement_document_id', $res['data']['id'])->firstOrFail();
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);

        // تحديث المستند (مسودة) يمرّر المتغيّر بنفس المسار — لا يُسقط عند التعديل.
        [, , $white1] = $this->variantManagedProduct('SHIRT-PROC-2');
        $updated = $this->withToken($this->token())->putJson("/api/procurement/{$res['data']['id']}", [
            'partner_id' => $this->supplierId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 3, 'unit_price' => 4000,
            ]],
        ])->assertOk();

        $this->assertSame($black1->id, $updated['data']['lines'][0]['product_variant_id']);
    }

    // ───────────────────────── ٧) سند التسليم ─────────────────────────

    /** @test */
    public function delivery_note_variant_path_via_http(): void
    {
        $this->grantSalesInvoicing();
        [$product, $black1] = $this->variantManagedProduct();
        $this->receive($product, 10, 4000, $black1);
        $warehouseId = $this->withToken($this->token())->postJson('/api/warehouses', [
            'name' => 'مخزن التسليم', 'code' => 'DN-W-1', 'is_active' => true,
        ])->assertCreated()['data']['id'];

        $res = $this->withToken($this->token())->postJson('/api/delivery-notes', [
            'customer_id' => $this->customerId, 'warehouse_id' => $warehouseId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 2,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);
        $this->assertSame('أسود / كبير', $res['data']['lines'][0]['variant_descriptor']);

        $line = DeliveryNoteLine::where('delivery_note_id', $res['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);

        // التعديل (مسودة) يمرّر المتغيّر بنفس المسار.
        $updated = $this->withToken($this->token())->putJson("/api/delivery-notes/{$res['data']['id']}", [
            'expected_version' => $res['data']['version'],
            'customer_id' => $this->customerId, 'warehouse_id' => $warehouseId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id, 'quantity' => 1,
            ]],
        ])->assertOk();

        $this->assertSame($black1->id, $updated['data']['lines'][0]['product_variant_id']);
    }

    // ───────────────────────── ٨) المرتجع ─────────────────────────

    /** @test */
    public function return_variant_path_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->receive($product, 10, 4000, $black1);

        $invoice = $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 5, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()['data'];
        $this->withToken($this->token())->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();
        $invoiceLineId = $invoice['lines'][0]['id'];

        $res = $this->withToken($this->token())->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'original_id' => $invoice['id'],
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'source_line_id' => $invoiceLineId, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $this->assertSame($black1->id, $res['data']['lines'][0]['product_variant_id']);

        $line = ReturnLine::where('return_id', $res['data']['id'])->firstOrFail();
        $this->assertSame($black1->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
    }

    // ───────────────────────── ٩) توافقٌ رجعي وتحقّقٌ بنيويّ ─────────────────────────

    /** @test — حذف الحقل تماماً (لا `null` صريح) لمنتجٍ بسيط يبقى يعمل بلا كسر. */
    public function field_omitted_backward_compatibility_across_document_types(): void
    {
        $product = $this->simpleProduct('SIMPLE-BC-1');
        $this->receive($product, 20, 4000);

        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->withToken($this->token())->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 4000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->withToken($this->token())->postJson('/api/quotes', [
            'partner_id' => $this->customerId,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();
    }

    /** @test */
    public function malformed_uuid_rejected_at_http_layer(): void
    {
        $product = $this->simpleProduct();

        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => 'not-a-uuid',
                'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertStatus(422)->assertJsonValidationErrors(['items.0.product_variant_id']);

        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function inactive_variant_fails_closed_via_http(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $black1->update(['is_active' => false]);

        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000,
            ]],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::count());
    }

    /** @test — منتجٌ متعدد الخيارات بلا متغيّرٍ محدَّد عبر HTTP: فشلٌ مغلَق، لا مسار غامض على الأب. */
    public function variant_managed_product_without_variant_id_fails_closed_via_http(): void
    {
        [$product] = $this->variantManagedProduct();

        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000]],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::count());
    }

    /** @test — اللقطة التاريخية تُكتب بشكلٍ صحيح عبر مسار HTTP، وتبقى ثابتة بعد الترحيل. */
    public function snapshots_persisted_correctly_through_http_path(): void
    {
        [$product, $black1] = $this->variantManagedProduct();
        $this->receive($product, 10, 4000, $black1);

        $invoiceId = $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black1->id,
                'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()['data']['id'];
        $this->withToken($this->token())->postJson("/api/invoices/{$invoiceId}/post")->assertOk();

        $line = InvoiceLine::where('invoice_id', $invoiceId)->firstOrFail();
        $this->assertSame($product->id, $line->product_id);
        $this->assertSame($black1->id, $line->product_variant_id);
        $originalName = $line->product_name_snapshot;
        $this->assertSame($product->name, $originalName);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);

        // إعادة تسمية المنتج/المتغيّر بعد الترحيل لا تُعيد كتابة اللقطة.
        $product->update(['name' => 'اسمٌ جديد بعد الترحيل']);
        $black1->optionValues()->first()->update(['value' => 'كحلي']);

        $line->refresh();
        $this->assertSame($originalName, $line->product_name_snapshot);
        $this->assertNotSame('اسمٌ جديد بعد الترحيل', $line->product_name_snapshot);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot, 'اللقطة لا تُعاد اشتقاقها من المتغيّر الحيّ.');
    }

    /** @test — متغيّرٌ يخصّ منتجاً آخر لا يُقبَل بديلاً حتى لو نفس المستأجر (لا استبدالٍ عبر المنتجات). */
    public function no_sibling_variant_substitution_across_products_is_possible(): void
    {
        [$productA, $blackOfA] = $this->variantManagedProduct('SHIRT-SIB-A');
        [$productB, $blackOfB] = $this->variantManagedProduct('SHIRT-SIB-B');
        $this->receive($productA, 5, 4000, $blackOfA);

        // محاولة بيع منتج A لكن بمتغيّرٍ يخصّ منتج B فعلياً — يُرفض مغلَقاً.
        $this->withToken($this->token())->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [[
                'product_id' => $productA->id, 'product_variant_id' => $blackOfB->id,
                'quantity' => 1, 'unit_price' => 20000,
            ]],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::count());
    }

    /** @test — عزلٌ سلبيّ إضافي: نفس السيناريو على المشتريات (مستندٌ مختلف، نفس السلطة). */
    public function purchase_cross_tenant_variant_rejected_via_http(): void
    {
        [$product] = $this->variantManagedProduct('SHIRT-PUR-1');

        $other = Tenant::create(['name' => 'مستأجرٌ آخر للمشتريات', 'slug' => 'other-var-fu-1-purchase', 'vat_number' => '300000000000098', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        [, $foreignVariant] = $this->variantManagedProduct('SHIRT-PUR-2');
        app(TenantContext::class)->set($this->auth['tenant_id']);

        $this->withToken($this->token())->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $foreignVariant->id,
                'quantity' => 1, 'unit_price' => 4000,
            ]],
        ])->assertStatus(422);

        $this->assertSame(0, PurchaseLine::count());
    }
}
