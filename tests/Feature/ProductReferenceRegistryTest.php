<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\DeliveryNote;
use App\Models\DeliveryNoteLine;
use App\Models\InventoryOpening;
use App\Models\InventoryOpeningLine;
use App\Models\InventoryStockAlert;
use App\Models\InvoiceLine;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\ProcurementDocument;
use App\Models\ProcurementLine;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\ProductBarcode;
use App\Models\ProductWarehouseStock;
use App\Models\PurchaseLine;
use App\Models\QuoteLine;
use App\Models\RecurringInvoice;
use App\Models\RecurringInvoiceLine;
use App\Models\ReturnLine;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\StockPermitLine;
use App\Models\Stocktake;
use App\Models\StocktakeLine;
use App\Models\Warehouse;
use App\Services\ProductLifecycleService;
use App\Support\ProductReferenceRegistry;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-PROD-LIFE-1 — سجلّ مراجع المنتج: منع الحذف وحارس هوية المخزون
 * ═══════════════════════════════════════════════════════════════
 *  العلّة المؤكَّدة: حماية دورة الحياة كانت قائمةً مُعدَّدة يدوياً، فأغفلت
 *  `DeliveryNoteLine` و`InventoryOpeningLine`؛ وأغفل حارس هوية المخزون
 *  `InventoryOpeningLine` فصار رصيدٌ افتتاحي بحالة مسودة لا يمنع تغيير
 *  `type`/`track_inventory`.
 *
 *  تشغيل: php artisan test --filter=ProductReferenceRegistryTest
 */
class ProductReferenceRegistryTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'صنف دورة الحياة', 'sku' => 'PRL-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 12000, 'track_inventory' => false,
        ], $overrides))->assertCreated()['data'];
    }

    private function partner(string $token): string
    {
        return $this->withToken($token)
            ->postJson('/api/partners', ['name' => 'طرف', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
    }

    private function warehouse(string $tenantId): Warehouse
    {
        return Warehouse::withoutGlobalScopes()->where('tenant_id', $tenantId)->firstOrFail();
    }

    private function deleteProduct(string $token, string $productId)
    {
        return $this->withToken($token)->deleteJson("/api/products/{$productId}");
    }

    /** محاولة تغيير هوية المخزون (النوع/التتبّع) عبر مسار التعديل الرسمي. */
    private function mutateIdentity(string $token, array $product, array $change)
    {
        return $this->withToken($token)->putJson("/api/products/{$product['id']}", array_merge([
            'name' => $product['name'], 'type' => 'good', 'unit' => 'piece', 'sale_price' => 12000,
        ], $change));
    }

    // ═══════════════════════════════════════════════════════════
    //  ١) الفجوتان المعروفتان في العقد — انحدار صريح لكلٍّ منهما
    // ═══════════════════════════════════════════════════════════

    /** سند تسليم يشير إلى المنتج يمنع الحذف — الفجوة الأولى في العقد. */
    /** @test */
    public function a_delivery_note_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $warehouse = $this->warehouse($auth['tenant_id']);

        $note = DeliveryNote::create([
            'tenant_id' => $auth['tenant_id'],
            'branch_id' => $warehouse->branch_id,
            'number' => 'DN-TEST-1',
            'customer_id' => $this->partner($auth['token']),
            'warehouse_id' => $warehouse->id,
            'delivery_date' => now()->toDateString(),
            'status' => 'draft',
            'version' => 1,
        ]);
        DeliveryNoteLine::create([
            'tenant_id' => $auth['tenant_id'],
            'branch_id' => $note->branch_id,
            'delivery_note_id' => $note->id,
            'line_number' => 1,
            'product_id' => $product['id'],
            'product_name_snapshot' => 'صنف دورة الحياة',
            'unit_name' => 'piece',
            'unit_factor' => 1,
            'quantity' => 3,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->assertNotNull(Product::find($product['id']), 'المنتج لم يُحذف.');
    }

    /** سطر رصيد افتتاحي يمنع الحذف — الفجوة الثانية، شقّها التاريخي. */
    /** @test */
    public function an_inventory_opening_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->openingLineFor($auth, $product['id']);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->assertNotNull(Product::find($product['id']));
    }

    /**
     * ورصيدٌ افتتاحي **بحالة مسودة** يمنع تغيير `type`/`track_inventory` —
     * شقّها المخزنيّ، وهو ما أغفله الحارس القديم تحديداً.
     */
    /** @test */
    public function a_draft_inventory_opening_blocks_inventory_identity_mutation(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $opening = $this->openingLineFor($auth, $product['id']);

        $this->assertSame('draft', $opening->status, 'المستند مسودة لم يُرحَّل بعد.');

        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertStatus(422);
        $this->mutateIdentity($auth['token'], $product, ['track_inventory' => true])->assertStatus(422);

        $fresh = Product::findOrFail($product['id']);
        $this->assertSame('good', $fresh->type);
        $this->assertFalse((bool) $fresh->track_inventory);
    }

    private function openingLineFor(array $auth, string $productId): InventoryOpening
    {
        $warehouse = $this->warehouse($auth['tenant_id']);
        $opening = InventoryOpening::create([
            'tenant_id' => $auth['tenant_id'],
            'number' => 'OPN-TEST-'.uniqid(),
            'opening_date' => now()->toDateString(),
            'status' => 'draft',
        ]);
        InventoryOpeningLine::create([
            'tenant_id' => $auth['tenant_id'],
            'inventory_opening_id' => $opening->id,
            'product_id' => $productId,
            'warehouse_id' => $warehouse->id,
            'quantity' => 5,
            'unit_cost' => 1000,
            'total_cost' => 5000,
            'position' => 1,
        ]);

        return $opening;
    }

    // ═══════════════════════════════════════════════════════════
    //  ٢) كل فئة مانعة على حدة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_invoice_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $this->partner($auth['token']), 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]],
        ])->assertCreated();

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function a_purchase_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $supplier = $this->withToken($auth['token'])
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplier, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]],
        ])->assertCreated();

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function a_quote_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $this->partner($auth['token']),
            'items' => [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]],
        ])->assertCreated();

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function a_credit_note_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $note = CreditNote::create([
            'tenant_id' => $auth['tenant_id'], 'number' => 'CN-TEST-1',
            'partner_id' => $this->partner($auth['token']), 'note_date' => now()->toDateString(),
        ]);
        CreditNoteLine::create([
            'tenant_id' => $auth['tenant_id'], 'credit_note_id' => $note->id,
            'product_id' => $product['id'], 'quantity' => 1,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function a_recurring_invoice_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $recurring = RecurringInvoice::create([
            'tenant_id' => $auth['tenant_id'], 'partner_id' => $this->partner($auth['token']),
            'start_date' => now()->toDateString(), 'next_run_date' => now()->toDateString(),
        ]);
        RecurringInvoiceLine::create([
            'tenant_id' => $auth['tenant_id'], 'recurring_invoice_id' => $recurring->id,
            'product_id' => $product['id'], 'quantity' => 1,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function a_procurement_line_blocks_destructive_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $doc = ProcurementDocument::create([
            'tenant_id' => $auth['tenant_id'], 'type' => 'request', 'number' => 'PR-TEST-1',
            'doc_date' => now()->toDateString(), 'status' => 'draft',
        ]);
        ProcurementLine::create([
            'tenant_id' => $auth['tenant_id'], 'procurement_document_id' => $doc->id,
            'product_id' => $product['id'], 'quantity' => 1,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
    }

    /** @test */
    public function a_stock_movement_blocks_deletion_and_identity_mutation(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        StockMovement::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product['id'],
            'warehouse_id' => $this->warehouse($auth['tenant_id'])->id,
            'type' => 'in', 'quantity' => 5, 'unit_cost' => 100, 'total_cost' => 500,
            'balance_quantity' => 5, 'movement_date' => now()->toDateString(),
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertStatus(422);
    }

    /** @test */
    public function a_stock_permit_line_blocks_deletion_and_identity_mutation(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $warehouse = $this->warehouse($auth['tenant_id']);
        $permit = StockPermit::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $warehouse->branch_id,
            'type' => 'receipt', 'number' => 'SP-TEST-1', 'warehouse_id' => $warehouse->id,
            'permit_date' => now()->toDateString(), 'status' => 'draft',
        ]);
        StockPermitLine::create([
            'tenant_id' => $auth['tenant_id'], 'stock_permit_id' => $permit->id,
            'product_id' => $product['id'], 'quantity' => 2,
            'unit_name' => 'piece', 'unit_factor' => 1, 'base_quantity' => 2,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->mutateIdentity($auth['token'], $product, ['track_inventory' => true])->assertStatus(422);
    }

    /** @test */
    public function a_stocktake_line_blocks_deletion_and_identity_mutation(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $warehouse = $this->warehouse($auth['tenant_id']);
        $stocktake = Stocktake::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $warehouse->branch_id,
            'number' => 'ST-TEST-1', 'warehouse_id' => $warehouse->id,
            'stocktake_date' => now()->toDateString(), 'status' => 'draft',
        ]);
        StocktakeLine::create([
            'tenant_id' => $auth['tenant_id'], 'stocktake_id' => $stocktake->id,
            'product_id' => $product['id'], 'system_quantity' => 0, 'counted_quantity' => 1,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertStatus(422);
    }

    /** @test */
    public function a_warehouse_stock_row_blocks_deletion_and_identity_mutation(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        ProductWarehouseStock::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product['id'],
            'warehouse_id' => $this->warehouse($auth['tenant_id'])->id, 'quantity' => 0,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertStatus(422);
    }

    /**
     * بند قائمة أسعار يمنع الحذف (سياسة العقد الحالية) لكنه **ليس** هوية
     * مخزون — فلا يجمّد `type`/`track_inventory`. الفرق مقصود ومُختبَر.
     */
    /** @test */
    public function a_price_list_item_blocks_deletion_but_never_freezes_inventory_identity(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $list = PriceList::create(['tenant_id' => $auth['tenant_id'], 'name' => 'قائمة الجملة']);
        PriceListItem::create([
            'tenant_id' => $auth['tenant_id'], 'price_list_id' => $list->id,
            'product_id' => $product['id'], 'unit_name' => 'piece', 'price' => 9000,
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        // تجاريٌّ حيّ لا مخزنيّ: تغيير الهوية يبقى مسموحاً بلا أثرٍ مخزني.
        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  ٣) ما يجب ألّا يمنع: التدقيق والتوابع المملوكة
    // ═══════════════════════════════════════════════════════════

    /**
     * سجلّ التدقيق وحده لا يجعل منتجاً غير مستعمَل غير قابلٍ للحذف — صفّ
     * «أُنشئ» موجود لكل منتج بلا استثناء.
     */
    /** @test */
    public function product_activity_alone_never_blocks_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $this->assertGreaterThan(0, ProductActivity::where('product_id', $product['id'])->count());

        $this->deleteProduct($auth['token'], $product['id'])->assertOk();
        $this->assertNull(Product::find($product['id']));
    }

    /** ويبقى سجلّ التدقيق بعد الحذف — الحذف نفسه حدثٌ يجب أن يظلّ مدوَّناً. */
    /** @test */
    public function audit_history_is_retained_after_a_true_delete(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->deleteProduct($auth['token'], $product['id'])->assertOk();

        $actions = ProductActivity::where('product_id', $product['id'])->pluck('action')->all();
        $this->assertContains('created', $actions);
        $this->assertContains('deleted', $actions, 'حدث الحذف نفسه مدوَّن.');
    }

    /** توابع مملوكة (باركود بديل/تنبيه) لا تمنع الحذف، وتُنظَّف ضمنه وحده. */
    /** @test */
    public function owned_children_never_block_and_are_cleaned_only_on_a_valid_true_delete(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'OWNED-1', 'unit_name' => 'piece'])
            ->assertCreated();
        InventoryStockAlert::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product['id'],
            'status' => InventoryStockAlert::STATUS_ACTIVE, 'type' => InventoryStockAlert::TYPE_LOW_STOCK,
            'quantity_on_hand' => 0, 'reorder_level' => 5,
            'first_detected_at' => now(), 'last_detected_at' => now(),
        ]);

        $this->deleteProduct($auth['token'], $product['id'])->assertOk();

        $this->assertSame(0, ProductBarcode::where('product_id', $product['id'])->count());
        $this->assertSame(0, InventoryStockAlert::where('product_id', $product['id'])->count());
    }

    /** ولا تُنظَّف حين يُرفض الحذف — التراجع كامل، لا تنظيفٌ جزئي. */
    /** @test */
    public function owned_children_survive_a_rejected_delete_with_no_partial_write(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'OWNED-2', 'unit_name' => 'piece'])
            ->assertCreated();
        $this->openingLineFor($auth, $product['id']); // مانع

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);

        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count(), 'الباركود البديل باقٍ.');
        $this->assertNotNull(Product::find($product['id']));
        $this->assertSame(0, ProductActivity::where('product_id', $product['id'])->where('action', 'deleted')->count(), 'لا سجلّ حذفٍ لعمليةٍ تراجعت.');
    }

    // ═══════════════════════════════════════════════════════════
    //  ٤) الحذف المسموح، وتكامل PR-UOM-1
    // ═══════════════════════════════════════════════════════════

    /** بلا أي مانع: الحذف يمرّ ويحرّر الباركود لإعادة الاستخدام. */
    /** @test */
    public function an_unblocked_delete_succeeds_and_releases_the_barcode_namespace(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'FREE-ME']);

        $this->deleteProduct($auth['token'], $product['id'])->assertOk();

        $this->product($auth['token'], ['barcode' => 'FREE-ME']); // يُقبل — تحرَّر فعلاً
    }

    /** ومع وجود مانع، لا يتحرّر الباركود إطلاقاً — هوية تاريخية محفوظة. */
    /** @test */
    public function a_blocked_delete_never_releases_the_barcode_namespace(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'KEEP-ME']);
        $this->openingLineFor($auth, $product['id']);

        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'آخر', 'sku' => 'PRL-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 1000, 'barcode' => 'KEEP-ME',
        ])->assertStatus(422);
    }

    // ═══════════════════════════════════════════════════════════
    //  ٥) العزل: الفرع لا يُخفي مرجعاً، والمستأجر حاجزٌ صارم
    // ═══════════════════════════════════════════════════════════

    /**
     * مرجعٌ في فرعٍ آخر يُحتسب رغم اختلاف الفرع النشط. لو صفّى نطاق الفرع
     * الفحصَ لصار الحذف مسموحاً بحسب ما يصادف المستخدم أن يتصفّحه.
     */
    /** @test */
    public function a_reference_in_another_branch_still_blocks_deletion(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $other = Branch::create([
            'tenant_id' => $auth['tenant_id'], 'code' => 'BR-2', 'name' => 'فرع ثانٍ', 'is_active' => true,
        ]);
        $otherWarehouse = Warehouse::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $other->id,
            'code' => 'WH-2', 'name' => 'مخزن الفرع الثاني', 'is_active' => true,
        ]);
        StockMovement::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $other->id,
            'product_id' => $product['id'], 'warehouse_id' => $otherWarehouse->id,
            'type' => 'in', 'quantity' => 1, 'unit_cost' => 100, 'total_cost' => 100,
            'balance_quantity' => 1, 'movement_date' => now()->toDateString(),
        ]);

        // الفرع النشط هو الرئيسي، والمرجع في الفرع الثاني — ومع ذلك يمنع.
        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertStatus(422);
    }

    /**
     * إثباتٌ مباشر لآلية التجاوز نفسها، لا لنتيجتها فقط.
     *
     * كل النماذج المصنَّفة اليوم `CompanyWide` أو موسومة بلا Scope، فالاختبار
     * السابق يمرّ حتى بلا `BranchScope::reference()`. هنا يُضاف `BranchScope`
     * إلى `StockMovement` **وقت التشغيل** لمحاكاة تحوّلٍ مستقبلي إلى نموذج
     * معزول بالفرع: أولاً يُثبَت أن الخطر حقيقي (الاستعلام العادي يُخفي الحركة
     * فعلاً)، ثم يُثبَت أن فحص دورة الحياة يراها رغم ذلك ويمنع الحذف.
     *
     * الحالة العامة (`Model::$globalScopes`) تُحفظ وتُستعاد بالانعكاس، فلا
     * يتسرّب النطاق المضاف إلى أي اختبارٍ آخر في العملية نفسها.
     */
    /** @test */
    public function the_lifecycle_check_sees_through_a_branch_scope_that_would_hide_a_reference(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $mainBranch = Branch::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $other = Branch::create([
            'tenant_id' => $auth['tenant_id'], 'code' => 'BR-9', 'name' => 'فرع بعيد', 'is_active' => true,
        ]);
        $otherWarehouse = Warehouse::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $other->id,
            'code' => 'WH-9', 'name' => 'مخزن بعيد', 'is_active' => true,
        ]);
        StockMovement::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $other->id,
            'product_id' => $product['id'], 'warehouse_id' => $otherWarehouse->id,
            'type' => 'in', 'quantity' => 1, 'unit_cost' => 100, 'total_cost' => 100,
            'balance_quantity' => 1, 'movement_date' => now()->toDateString(),
        ]);

        $scopes = new \ReflectionProperty(Model::class, 'globalScopes');
        $saved = $scopes->getValue();

        try {
            StockMovement::addGlobalScope(new BranchScope);
            app(BranchContext::class)->set($mainBranch->id);

            // ١) الخطر حقيقي: الاستعلام العادي لم يعد يرى الحركة إطلاقاً.
            $this->assertSame(0, StockMovement::where('product_id', $product['id'])->count(), 'النطاق يُخفي الحركة فعلاً — وهذا هو الخطر.');
            // ٢) ومع ذلك يراها فحص دورة الحياة فيمنع الحذف وتغيير الهوية.
            $this->assertSame(1, BranchScope::reference(StockMovement::class)->where('product_id', $product['id'])->count());
            $this->assertTrue(app(ProductLifecycleService::class)->hasInventoryFootprint(Product::findOrFail($product['id'])));
        } finally {
            $scopes->setValue(null, $saved);
            app(BranchContext::class)->forget();
        }
    }

    /** ومرجع مستأجرٍ آخر لا يمنع شيئاً هنا — حاجز المستأجر يبقى صارماً. */
    /** @test */
    public function a_reference_owned_by_another_tenant_never_blocks_this_tenant(): void
    {
        $mine = $this->registerTenant('acme', 'a@acme.test');
        $theirs = $this->registerTenant('other', 'b@other.test');

        $myProduct = $this->product($mine['token']);
        $theirProduct = $this->product($theirs['token']);

        // مرجعٌ حقيقي على منتج المستأجر الآخر.
        StockMovement::create([
            'tenant_id' => $theirs['tenant_id'], 'product_id' => $theirProduct['id'],
            'warehouse_id' => $this->warehouse($theirs['tenant_id'])->id,
            'type' => 'in', 'quantity' => 1, 'unit_cost' => 100, 'total_cost' => 100,
            'balance_quantity' => 1, 'movement_date' => now()->toDateString(),
        ]);

        // منتجي بلا مراجع: يُحذف بلا تأثّر بالمستأجر الآخر إطلاقاً.
        $this->deleteProduct($mine['token'], $myProduct['id'])->assertOk();
        // ومنتجهم يبقى ممنوعاً عندهم.
        $this->deleteProduct($theirs['token'], $theirProduct['id'])->assertStatus(422);
    }

    // ═══════════════════════════════════════════════════════════
    //  ٦) التزامن والذرّية: مرجعٌ يظهر أثناء المعاملة يُلغي الحذف كاملاً
    // ═══════════════════════════════════════════════════════════

    /**
     * نافذة TOCTOU: مرجعٌ مانع يصبح مرئياً **بعد** الفحص الأول وقبل الـcommit.
     *
     * تُحاكى بكاتبٍ يُدرج بند تسعيرٍ من داخل حدث `ProductActivity::created` —
     * وهو حدثٌ يقع في قلب معاملة الحذف، بين الفحص الأول والحذف الفعلي. هذا
     * يعيد إنتاج **أثر** التزامن (ظهور صفٍّ مانع أثناء المعاملة) لا سباقاً
     * حقيقياً بين اتصالين؛ والفحص الثاني قبل الـcommit هو ما يلتقطه.
     *
     * ويثبت في الوقت نفسه ذرّية العملية متعددة الكتابات: سجلّ النشاط وتحرير
     * الباركود وحذف التوابع وحذف المنتج — كلها تتراجع معاً أو لا شيء منها.
     */
    /** @test */
    public function a_blocking_reference_appearing_mid_transaction_rolls_the_whole_delete_back(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'RACE-KEEP']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'RACE-ALT', 'unit_name' => 'piece'])
            ->assertCreated();
        $list = PriceList::create(['tenant_id' => $auth['tenant_id'], 'name' => 'قائمة متسابقة']);

        $injected = false;
        ProductActivity::created(function (ProductActivity $activity) use (&$injected, $list, $auth, $product): void {
            if ($injected || $activity->action !== 'deleted') {
                return;
            }
            $injected = true;
            PriceListItem::create([
                'tenant_id' => $auth['tenant_id'], 'price_list_id' => $list->id,
                'product_id' => $product['id'], 'unit_name' => 'piece', 'price' => 500,
            ]);
        });

        try {
            $this->deleteProduct($auth['token'], $product['id'])->assertStatus(422);
        } finally {
            ProductActivity::flushEventListeners();
        }

        $this->assertTrue($injected, 'المرجع المانع أُدرج فعلاً داخل المعاملة.');
        // كل كتابةٍ من العملية متعددة الأجزاء تراجعت — لا نصف حذف.
        $this->assertNotNull(Product::find($product['id']), 'المنتج لم يُحذف.');
        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count(), 'الباركود البديل باقٍ.');
        $this->assertSame(0, ProductActivity::where('product_id', $product['id'])->where('action', 'deleted')->count(), 'سجلّ الحذف تراجع معها.');
        $this->assertSame(0, PriceListItem::where('product_id', $product['id'])->count(), 'حتى الصفّ المُدرَج داخل المعاملة تراجع.');
        // وفضاء الباركود لم يتحرّر: بطاقةٌ لم تُحذف لا تُعاد هويتها.
        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'آخر', 'sku' => 'PRL-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 1000, 'barcode' => 'RACE-KEEP',
        ])->assertStatus(422);
    }

    /** وعمليتا دورة حياة على نفس البطاقة تتسلسلان بقفل الصفّ لا تتداخلان. */
    /** @test */
    public function lifecycle_operations_serialize_on_the_product_row(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $this->deleteProduct($auth['token'], $product['id'])->assertOk();
        // الثانية لا تجد بطاقةً قائمة — الحذف الناعم يُخرجها من النطاق الافتراضي.
        $this->deleteProduct($auth['token'], $product['id'])->assertStatus(404);
        $this->mutateIdentity($auth['token'], $product, ['type' => 'service'])->assertStatus(404);
    }

    // ═══════════════════════════════════════════════════════════
    //  ٧) عقد السجلّ نفسه
    // ═══════════════════════════════════════════════════════════

    /** التصنيف يطابق تعداد العقد حرفياً — لا نموذج يسقط ولا فئة تنزلق. */
    /** @test */
    public function the_registry_matches_the_contracts_classification(): void
    {
        $blockers = array_keys(ProductReferenceRegistry::deletionBlockers());
        foreach ([
            InvoiceLine::class, PurchaseLine::class, ReturnLine::class,
            CreditNoteLine::class, QuoteLine::class, RecurringInvoiceLine::class,
            ProcurementLine::class, DeliveryNoteLine::class, InventoryOpeningLine::class,
            StockMovement::class, StockPermitLine::class, StocktakeLine::class,
            ProductWarehouseStock::class, PriceListItem::class,
        ] as $model) {
            $this->assertContains($model, $blockers, "{$model} يجب أن يمنع الحذف.");
        }

        $semantic = array_keys(ProductReferenceRegistry::inventorySemantic());
        $this->assertEqualsCanonicalizing([
            InventoryOpeningLine::class, StockMovement::class, StockPermitLine::class,
            StocktakeLine::class, ProductWarehouseStock::class,
        ], $semantic, 'تصنيف "مخزنيّ الدلالة" مطابقٌ للعقد.');

        // ولا يتسرّب تابعٌ مملوك أو سجلّ تدقيق إلى الموانع أبداً.
        foreach (array_keys(ProductReferenceRegistry::ownedChildren()) as $owned) {
            $this->assertNotContains($owned, $blockers, "{$owned} تابعٌ مملوك ولا يمنع الحذف.");
        }
        foreach (array_keys(ProductReferenceRegistry::auditHistory()) as $audit) {
            $this->assertNotContains($audit, $blockers, "{$audit} سجلّ تدقيق ولا يمنع الحذف.");
        }
    }
}
