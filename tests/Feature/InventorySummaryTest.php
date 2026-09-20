<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\ProductVariantService;
use App\Services\Reporting\InventoryReportService;
use App\Support\BranchSettings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * AWJ-PERF-4 — مجمَّع قيمة المخزون للوحة التحكم (`GET /api/inventory/summary`).
 *
 * الهدف: رقمٌ واحد (قيمة المخزون الإجمالية) باستعلامٍ تجميعي، بلا تحميل
 * الكتالوج الكامل ولا مناداة أدوات `Product::quantity_on_hand`/`avg_cost`
 * المحسوبة (accessors تقرأ `inventory_states` — كل قراءة استعلامٌ مستقل).
 *
 * تشغيل: php artisan test --filter=InventorySummaryTest
 */
class InventorySummaryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_returns_total_value_matching_legacy_endpoint_for_simple_products(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);

        Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز قياس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 50000, // 500.00 للوحدة
        ]);
        Product::create([
            'tenant_id' => $tid, 'name' => 'أداة', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 3, 'avg_cost' => 20000,
        ]);
        Product::create([
            'tenant_id' => $tid, 'name' => 'خدمة استشارية', 'type' => 'service', 'track_inventory' => false,
        ]);

        $legacy = $this->withToken($token)->getJson('/api/inventory')->assertOk();
        $summary = $this->withToken($token)->getJson('/api/inventory/summary')->assertOk();

        $this->assertSame($legacy['total_value'], $summary['total_value']);
        $this->assertSame('5600.00', $summary['total_value']); // 10×500 + 3×200
    }

    /** @test */
    public function it_returns_zero_for_a_tenant_with_no_tracked_inventory(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->getJson('/api/inventory/summary')
            ->assertOk()
            ->assertJsonPath('total_value', '0.00');
    }

    /** @test */
    public function tenant_a_cannot_see_tenant_b_inventory_value(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['tenant_id' => $bId] = $this->registerTenant('globex', 'owner@globex.test');

        app(TenantContext::class)->set($bId);
        Product::create([
            'tenant_id' => $bId, 'name' => 'صنف غلوبكس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 100, 'avg_cost' => 900000,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($aToken)->getJson('/api/inventory/summary')
            ->assertOk()
            ->assertJsonPath('total_value', '0.00');
    }

    /** @test */
    public function staff_without_view_cost_receives_null_total_value(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);
        Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 50000,
        ]);

        $staff = User::create([
            'tenant_id' => $tid, 'name' => 'موظف', 'email' => 'staff@nibras.test',
            'password' => 'password123', 'role' => 'staff', 'is_active' => true,
        ]);
        $token = $staff->createToken('api')->plainTextToken;

        $this->withToken($token)->getJson('/api/inventory/summary')
            ->assertOk()
            ->assertJsonPath('total_value', null);
    }

    /** @test */
    public function unauthenticated_and_unpermitted_users_are_rejected(): void
    {
        $this->getJson('/api/inventory/summary')->assertUnauthorized();

        ['token' => $ownerToken, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);
        $noPerm = User::create([
            'tenant_id' => $tid, 'name' => 'خدمة ذاتية', 'email' => 'self@nibras.test',
            'password' => 'password123', 'role' => 'self_service', 'is_active' => true,
        ]);
        $token = $noPerm->createToken('api')->plainTextToken;

        $this->withToken($token)->getJson('/api/inventory/summary')->assertForbidden();
    }

    /** @test */
    public function branch_scope_is_preserved_when_product_sharing_is_disabled(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');

        $branchA = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع ألفا'])->assertCreated()['data'];
        $branchB = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع بيتا'])->assertCreated()['data'];

        app(TenantContext::class)->set($tid);
        BranchSettings::merge(['share_products' => false]);
        app(TenantContext::class)->forget();

        $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchA['id']])->postJson('/api/products', [
            'name' => 'صنف ألفا', 'type' => 'good', 'sale_price' => 20000, 'purchase_price' => 10000,
            'track_inventory' => true, 'initial_quantity' => 4,
        ])->assertCreated();
        $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchB['id']])->postJson('/api/products', [
            'name' => 'صنف بيتا', 'type' => 'good', 'sale_price' => 20000, 'purchase_price' => 10000,
            'track_inventory' => true, 'initial_quantity' => 9,
        ])->assertCreated();

        // المالك مقيَّدٌ بفرع ألفا فقط لهذا الطلب — لا يرى قيمة صنف بيتا.
        $scopedA = $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchA['id']])
            ->getJson('/api/inventory/summary')->assertOk();
        $scopedB = $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchB['id']])
            ->getJson('/api/inventory/summary')->assertOk();

        $this->assertNotSame($scopedA['total_value'], $scopedB['total_value']);

        // يطابق ما يراه `/inventory` القديم لنفس الفرع تماماً — التصفّح نفسه، رقمٌ واحد بدل قائمة.
        $legacyA = $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchA['id']])->getJson('/api/inventory')->assertOk();
        $this->assertSame($legacyA['total_value'], $scopedA['total_value']);
    }

    /**
     * AWJ-PERF-4 — إغلاق فجوة الصلاحية: `ReportWarehouseScope` يفرض
     * `allowedWarehouseIds()` كحدٍّ أمني (كما في `InventoryWorkspaceQuery`
     * و`InventoryReportService::inventoryValue()`) — مستخدمٌ `admin` يملك
     * `products.view_cost` لكنه مقيَّدٌ بمخزنٍ واحد يجب ألا يرى قيمة مخزنٍ آخر
     * عبر هذا الملخّص، حتى لو ملك صلاحية التكلفة كاملةً.
     */
    /** @test */
    public function warehouse_scope_hides_unassigned_warehouses(): void
    {
        ['token' => $ownerToken, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');

        $warehouseA = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن ألفا'])->assertCreated()['data'];
        $warehouseB = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن بيتا'])->assertCreated()['data'];

        app(TenantContext::class)->set($tid);
        $simple = Product::create(['tenant_id' => $tid, 'name' => 'إسمنت', 'type' => 'good', 'track_inventory' => true]);
        app(InventoryService::class)->receiveStock($simple->fresh(), 5, 30000, ['warehouse_id' => $warehouseA['id']]); // 5×300=1500.00
        app(InventoryService::class)->receiveStock($simple->fresh(), 7, 30000, ['warehouse_id' => $warehouseB['id']]); // 7×300=2100.00
        app(TenantContext::class)->forget();

        // مستخدم admin يملك التكلفة كاملة (owner/admin عبر `*`) لكنه مقيَّد بمخزن ألفا فقط.
        $this->withToken($ownerToken)->postJson('/api/users', [
            'name' => 'مدير مقيَّد', 'email' => 'admin-a@nibras.test', 'password' => 'password123',
            'role' => 'admin', 'warehouse_ids' => [$warehouseA['id']],
        ])->assertCreated();
        $scopedToken = $this->postJson('/api/login', ['email' => 'admin-a@nibras.test', 'password' => 'password123'])->assertOk()['token'];

        $ownerRes = $this->withToken($ownerToken)->getJson('/api/inventory/summary')->assertOk();
        $scopedRes = $this->withToken($scopedToken)->getJson('/api/inventory/summary')->assertOk();

        // غير المقيَّد يرى المجموع الكامل (١٥٠٠ + ٢١٠٠ = ٣٦٠٠)؛ المقيَّد يرى مخزنه فقط (١٥٠٠).
        $this->assertSame('3600.00', $ownerRes['total_value']);
        $this->assertSame('1500.00', $scopedRes['total_value']);
        $this->assertNotSame($ownerRes['total_value'], $scopedRes['total_value']);
    }

    /**
     * نفس السيناريو أعلاه، مع منتج `variant_managed` — يثبت أن إغلاق فجوة
     * المخزن لم يُعِد مشكلة تبسيط `variant_managed` القديمة (تصفير القيمة):
     * المتغيّر النشط في مخزن المستخدم المقيَّد يُحتسب، والمتغيّر المُعطَّل لا
     * يُحتسب مطلقاً — بصرف النظر عن المخزن.
     */
    /** @test */
    public function warehouse_scope_correctly_values_active_variants_and_excludes_disabled_ones(): void
    {
        ['token' => $ownerToken, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');

        $warehouseA = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن ألفا'])->assertCreated()['data'];
        $warehouseB = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن بيتا'])->assertCreated()['data'];

        app(TenantContext::class)->set($tid);
        $product = Product::create(['tenant_id' => $tid, 'name' => 'قميص', 'sku' => 'SHIRT-1', 'sale_price' => 20000, 'track_inventory' => true]);
        $color = $product->options()->create(['tenant_id' => $tid, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tid, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tid, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();
        $blackVariant = $variants->createSingleVariant($product, [$black->id], null)['variant'];
        $whiteVariant = $variants->createSingleVariant($product, [$white->id], null)['variant'];

        // الأسود (نشط) في مخزن ألفا: ٦×١.٠٠ = ٦.٠٠. الأبيض (سيُعطَّل) في مخزن ألفا أيضاً: ٤×١.٥٠ = ٦.٠٠ — لا يُحتسب.
        app(InventoryService::class)->receiveStock($product->fresh(), 6, 100, ['warehouse_id' => $warehouseA['id']], $blackVariant);
        app(InventoryService::class)->receiveStock($product->fresh(), 4, 150, ['warehouse_id' => $warehouseA['id']], $whiteVariant);
        // أسود إضافي في مخزن بيتا — خارج نطاق المستخدم المقيَّد، يجب ألا يُحتسب له.
        app(InventoryService::class)->receiveStock($product->fresh(), 10, 100, ['warehouse_id' => $warehouseB['id']], $blackVariant);
        $whiteVariant->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->withToken($ownerToken)->postJson('/api/users', [
            'name' => 'مدير مقيَّد', 'email' => 'admin-a2@nibras.test', 'password' => 'password123',
            'role' => 'admin', 'warehouse_ids' => [$warehouseA['id']],
        ])->assertCreated();
        $scopedToken = $this->postJson('/api/login', ['email' => 'admin-a2@nibras.test', 'password' => 'password123'])->assertOk()['token'];

        $scopedRes = $this->withToken($scopedToken)->getJson('/api/inventory/summary')->assertOk();
        $ownerRes = $this->withToken($ownerToken)->getJson('/api/inventory/summary')->assertOk();

        // المقيَّد بمخزن ألفا: الأسود النشط فقط هناك (٦×١.٠٠=٦.٠٠)؛ الأبيض معطَّل فلا يُحتسب رغم وجوده في نفس المخزن.
        $this->assertSame('6.00', $scopedRes['total_value']);
        // غير المقيَّد: الأسود في كلا المخزنين (٦+١٠=١٦ × ١.٠٠ = ١٦.٠٠)؛ الأبيض معطَّل فلا يُحتسب رغم كميته.
        $this->assertSame('16.00', $ownerRes['total_value']);

        // Parity مع `InventoryReportService::inventoryValue()` المقيَّد بنفس المخزن.
        app(TenantContext::class)->set($tid);
        $authoritativeScoped = app(InventoryReportService::class)
            ->report('value', ['warehouse_id' => [$warehouseA['id']]])['totals']['stock_value'];
        app(TenantContext::class)->forget();
        $this->assertSame(600, $authoritativeScoped); // ٦.٠٠ بالهللات
    }

    /** @test */
    public function it_matches_the_authoritative_inventory_report_value_including_variant_managed_products(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);

        // منتج بسيط.
        Product::create([
            'tenant_id' => $tid, 'name' => 'إسمنت', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 5, 'avg_cost' => 30000,
        ]);

        // منتج متعدد الخيارات — متغيّران، أحدهما مُعطَّل فلا يُحسب.
        $product = Product::create(['tenant_id' => $tid, 'name' => 'قميص', 'sku' => 'SHIRT-1', 'sale_price' => 20000, 'track_inventory' => true]);
        $color = $product->options()->create(['tenant_id' => $tid, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tid, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tid, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();
        $blackVariant = $variants->createSingleVariant($product, [$black->id], null)['variant'];
        $whiteVariant = $variants->createSingleVariant($product, [$white->id], null)['variant'];

        $warehouse = Warehouse::default() ?? Warehouse::create(['tenant_id' => $tid, 'code' => '00001', 'name' => 'رئيسي', 'is_default' => true]);
        app(InventoryService::class)->receiveStock($product->fresh(), 6, 10000, ['warehouse_id' => $warehouse->id], $blackVariant);
        app(InventoryService::class)->receiveStock($product->fresh(), 4, 15000, ['warehouse_id' => $warehouse->id], $whiteVariant);

        // تعطيل المتغيّر الأبيض — قيمته يجب ألا تُحسب بعد التعطيل.
        $whiteVariant->update(['is_active' => false]);

        $authoritative = app(InventoryReportService::class)->report('value', [])['totals']['stock_value'];

        $summaryMinor = (int) round(((float) $this->withToken($token)->getJson('/api/inventory/summary')->assertOk()['total_value']) * 100);

        $this->assertSame($authoritative, $summaryMinor);
        // إسمنت (5×300=1500.00) + أسود (6×100=600.00) فقط — الأبيض مُعطَّل.
        $this->assertSame(150000 + 60000, $authoritative);
    }

    /** @test */
    public function summary_endpoint_does_not_return_the_full_catalog_payload(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);
        Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 1, 'avg_cost' => 1000,
        ]);

        $res = $this->withToken($token)->getJson('/api/inventory/summary')->assertOk();

        $res->assertJsonStructure(['total_value']);
        $body = $res->json();
        $this->assertArrayNotHasKey('data', $body);
        $this->assertCount(1, $body); // مفتاحٌ واحدٌ فقط — لا قائمة، لا صفوف.
    }

    /** @test */
    public function legacy_inventory_endpoint_contract_is_unchanged(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);
        Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز قياس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 50000,
        ]);

        $this->withToken($token)->getJson('/api/inventory')
            ->assertOk()
            ->assertJsonStructure(['data' => [['id', 'sku', 'name', 'unit', 'quantity_on_hand', 'avg_cost', 'stock_value']], 'total_value'])
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.quantity_on_hand', 10)
            ->assertJsonPath('data.0.avg_cost', '500.00')
            ->assertJsonPath('total_value', '5000.00');
    }

    /**
     * دليل أداء: عدد الاستعلامات لا يتناسب مع حجم الكتالوج — على خلاف
     * `/inventory` القديم الذي يستدعي `quantity_on_hand`/`avg_cost` (أدواتٌ
     * محسوبة تقرأ `inventory_states`) لكل منتجٍ على حدة.
     */
    private function seedProducts(string $tid, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            Product::create([
                'tenant_id' => $tid, 'name' => "صنف {$i}", 'type' => 'good',
                'track_inventory' => true, 'quantity_on_hand' => 2, 'avg_cost' => 1000,
            ]);
        }
    }

    /** @test */
    public function query_count_does_not_grow_with_catalog_size(): void
    {
        ['token' => $tokenSmall, 'tenant_id' => $tidSmall] = $this->registerTenant('nibras-small', 'owner@small.test');
        app(TenantContext::class)->set($tidSmall);
        $this->seedProducts($tidSmall, 5);
        app(TenantContext::class)->forget();

        ['token' => $tokenBig, 'tenant_id' => $tidBig] = $this->registerTenant('nibras-big', 'owner@big.test');
        app(TenantContext::class)->set($tidBig);
        $this->seedProducts($tidBig, 40);
        app(TenantContext::class)->forget();

        DB::enableQueryLog();

        DB::flushQueryLog();
        $this->withToken($tokenSmall)->getJson('/api/inventory/summary')->assertOk();
        $summaryQueriesSmall = count(DB::getQueryLog());

        DB::flushQueryLog();
        $this->withToken($tokenBig)->getJson('/api/inventory/summary')->assertOk();
        $summaryQueriesBig = count(DB::getQueryLog());

        DB::flushQueryLog();
        $this->withToken($tokenBig)->getJson('/api/inventory')->assertOk();
        $legacyQueriesBig = count(DB::getQueryLog());

        DB::disableQueryLog();

        // الدليل الحقيقي: عدد الاستعلامات **لا يتغيّر** بين ٥ و٤٠ منتجاً — لا
        // رقمٌ سحري مفترَض. المسار القديم على العكس تماماً: كل قراءة
        // `quantity_on_hand`/`avg_cost` (أدواتٌ محسوبة على `inventory_states`)
        // تُستعلَم من جديد لكل صفّ.
        $this->assertSame(
            $summaryQueriesSmall,
            $summaryQueriesBig,
            'summary query count must stay flat between 5 and 40 tracked products'
        );
        $this->assertGreaterThan(
            $summaryQueriesBig * 3,
            $legacyQueriesBig,
            'legacy path must show clear N+1 growth by comparison, for the same 40-product tenant'
        );
    }

    /**
     * AWJ-PERF-4 (إغلاق الفجوة): مسار المستخدم المقيَّد بمخزن يبقى استعلاماً
     * تجميعياً واحداً أيضاً — لا يتحوّل إلى N+1 بإضافة فرع `product_warehouse_stock`.
     */
    /** @test */
    public function warehouse_scoped_query_count_also_stays_flat_with_catalog_size(): void
    {
        ['token' => $ownerSmall, 'tenant_id' => $tidSmall] = $this->registerTenant('nibras-wh-small', 'owner@wh-small.test');
        $warehouseSmall = $this->withToken($ownerSmall)->postJson('/api/warehouses', ['name' => 'مخزن'])->assertCreated()['data'];
        app(TenantContext::class)->set($tidSmall);
        for ($i = 0; $i < 5; $i++) {
            $p = Product::create(['tenant_id' => $tidSmall, 'name' => "صنف {$i}", 'type' => 'good', 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($p->fresh(), 2, 1000, ['warehouse_id' => $warehouseSmall['id']]);
        }
        app(TenantContext::class)->forget();
        $this->withToken($ownerSmall)->postJson('/api/users', [
            'name' => 'مقيَّد', 'email' => 'scoped@wh-small.test', 'password' => 'password123',
            'role' => 'admin', 'warehouse_ids' => [$warehouseSmall['id']],
        ])->assertCreated();
        $scopedTokenSmall = $this->postJson('/api/login', ['email' => 'scoped@wh-small.test', 'password' => 'password123'])->assertOk()['token'];

        ['token' => $ownerBig, 'tenant_id' => $tidBig] = $this->registerTenant('nibras-wh-big', 'owner@wh-big.test');
        $warehouseBig = $this->withToken($ownerBig)->postJson('/api/warehouses', ['name' => 'مخزن'])->assertCreated()['data'];
        app(TenantContext::class)->set($tidBig);
        for ($i = 0; $i < 30; $i++) {
            $p = Product::create(['tenant_id' => $tidBig, 'name' => "صنف {$i}", 'type' => 'good', 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($p->fresh(), 2, 1000, ['warehouse_id' => $warehouseBig['id']]);
        }
        app(TenantContext::class)->forget();
        $this->withToken($ownerBig)->postJson('/api/users', [
            'name' => 'مقيَّد', 'email' => 'scoped@wh-big.test', 'password' => 'password123',
            'role' => 'admin', 'warehouse_ids' => [$warehouseBig['id']],
        ])->assertCreated();
        $scopedTokenBig = $this->postJson('/api/login', ['email' => 'scoped@wh-big.test', 'password' => 'password123'])->assertOk()['token'];

        DB::enableQueryLog();

        DB::flushQueryLog();
        $this->withToken($scopedTokenSmall)->getJson('/api/inventory/summary')->assertOk();
        $small = count(DB::getQueryLog());

        DB::flushQueryLog();
        $this->withToken($scopedTokenBig)->getJson('/api/inventory/summary')->assertOk();
        $big = count(DB::getQueryLog());

        DB::disableQueryLog();

        $this->assertSame($small, $big, 'warehouse-scoped summary query count must stay flat between 5 and 30 tracked products');
    }
}
