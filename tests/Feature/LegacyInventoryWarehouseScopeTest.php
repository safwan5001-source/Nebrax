<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\Accounting\InventoryService;
use App\Services\ProductVariantService;
use App\Support\BranchSettings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * SEC-INV-1 — إغلاق فجوة صلاحية المخزن في `GET /api/inventory` القديم.
 *
 * نفس الفجوة التي أُغلقت لـ`/api/inventory/summary` في AWJ-PERF-4، ولم تُلمَس
 * هنا من قبل: `ReportWarehouseScope` يفرض `User::allowedWarehouseIds()` كحدٍّ
 * أمني، لا فلتر عرضٍ اختيارياً.
 *
 * تشغيل: php artisan test --filter=LegacyInventoryWarehouseScopeTest
 */
class LegacyInventoryWarehouseScopeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function restrictedAdmin(string $ownerToken, string $email, string $warehouseId): string
    {
        $this->withToken($ownerToken)->postJson('/api/users', [
            'name' => 'مدير مقيَّد', 'email' => $email, 'password' => 'password123',
            'role' => 'admin', 'warehouse_ids' => [$warehouseId],
        ])->assertCreated();

        return $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];
    }

    /** @test */
    public function unrestricted_user_sees_the_same_total_as_before_the_fix(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);
        Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز قياس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 50000,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($token)->getJson('/api/inventory')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.quantity_on_hand', 10)
            ->assertJsonPath('data.0.avg_cost', '500.00')
            ->assertJsonPath('data.0.stock_value', '5000.00')
            ->assertJsonPath('total_value', '5000.00');
    }

    /** @test */
    public function warehouse_restricted_admin_sees_only_allowed_warehouse_quantity_and_value(): void
    {
        ['token' => $ownerToken, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $warehouseA = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن ألفا'])->assertCreated()['data'];
        $warehouseB = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن بيتا'])->assertCreated()['data'];

        app(TenantContext::class)->set($tid);
        $product = Product::create(['tenant_id' => $tid, 'name' => 'إسمنت', 'type' => 'good', 'track_inventory' => true]);
        app(InventoryService::class)->receiveStock($product->fresh(), 5, 30000, ['warehouse_id' => $warehouseA['id']]); // 5×300=1500.00
        app(InventoryService::class)->receiveStock($product->fresh(), 7, 30000, ['warehouse_id' => $warehouseB['id']]); // 7×300=2100.00
        app(TenantContext::class)->forget();

        $scopedToken = $this->restrictedAdmin($ownerToken, 'admin-a@nibras.test', $warehouseA['id']);

        $ownerRes = $this->withToken($ownerToken)->getJson('/api/inventory')->assertOk();
        $scopedRes = $this->withToken($scopedToken)->getJson('/api/inventory')->assertOk();

        // غير المقيَّد: المجموع الكامل عبر المخزنين (٥+٧=١٢ × ٣٠٠.٠٠ = ٣٦٠٠.٠٠).
        $this->assertSame(12, $ownerRes->json('data.0.quantity_on_hand'));
        $this->assertSame('3600.00', $ownerRes->json('total_value'));

        // المقيَّد بألفا: كميته وقيمته فقط (٥ × ٣٠٠.٠٠ = ١٥٠٠.٠٠) — لا أثر لبيتا.
        $this->assertSame(5, $scopedRes->json('data.0.quantity_on_hand'));
        $this->assertSame('1500.00', $scopedRes->json('data.0.stock_value'));
        $this->assertSame('1500.00', $scopedRes->json('total_value'));
    }

    /** @test */
    public function out_of_scope_warehouse_inventory_never_enters_the_restricted_users_totals(): void
    {
        ['token' => $ownerToken, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $warehouseA = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن ألفا'])->assertCreated()['data'];
        $warehouseB = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن بيتا'])->assertCreated()['data'];

        app(TenantContext::class)->set($tid);
        // صنفٌ بكامل رصيده في مخزنٍ خارج نطاق المستخدم المقيَّد — يجب أن يظهر بكمية/قيمة صفر له.
        $productBOnly = Product::create(['tenant_id' => $tid, 'name' => 'صنفٌ في بيتا فقط', 'type' => 'good', 'track_inventory' => true]);
        app(InventoryService::class)->receiveStock($productBOnly->fresh(), 20, 10000, ['warehouse_id' => $warehouseB['id']]);
        app(TenantContext::class)->forget();

        $scopedToken = $this->restrictedAdmin($ownerToken, 'admin-a2@nibras.test', $warehouseA['id']);

        $scopedRes = $this->withToken($scopedToken)->getJson('/api/inventory')->assertOk();

        $this->assertSame(0, $scopedRes->json('data.0.quantity_on_hand'));
        $this->assertSame('0.00', $scopedRes->json('data.0.stock_value'));
        $this->assertSame('0.00', $scopedRes->json('total_value'));
    }

    /** @test */
    public function tenant_a_cannot_see_tenant_b_inventory(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['tenant_id' => $bId] = $this->registerTenant('globex', 'owner@globex.test');

        app(TenantContext::class)->set($bId);
        Product::create([
            'tenant_id' => $bId, 'name' => 'صنف غلوبكس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 100, 'avg_cost' => 900000,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($aToken)->getJson('/api/inventory')
            ->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('total_value', '0.00');
    }

    /** @test */
    public function branch_scope_is_unaffected_by_the_warehouse_fix(): void
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

        $scopedA = $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchA['id']])->getJson('/api/inventory')->assertOk();
        $scopedB = $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchB['id']])->getJson('/api/inventory')->assertOk();

        $this->assertCount(1, $scopedA->json('data'));
        $this->assertCount(1, $scopedB->json('data'));
        $this->assertNotSame($scopedA['total_value'], $scopedB['total_value']);
    }

    /** @test */
    public function user_without_view_cost_never_sees_cost_or_value_but_quantity_stays_scoped(): void
    {
        ['token' => $ownerToken, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $warehouseA = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن ألفا'])->assertCreated()['data'];
        $warehouseB = $this->withToken($ownerToken)->postJson('/api/warehouses', ['name' => 'مخزن بيتا'])->assertCreated()['data'];

        app(TenantContext::class)->set($tid);
        $product = Product::create(['tenant_id' => $tid, 'name' => 'جهاز', 'type' => 'good', 'track_inventory' => true]);
        app(InventoryService::class)->receiveStock($product->fresh(), 5, 30000, ['warehouse_id' => $warehouseA['id']]);
        app(InventoryService::class)->receiveStock($product->fresh(), 7, 30000, ['warehouse_id' => $warehouseB['id']]);
        app(TenantContext::class)->forget();

        // staff بلا view_cost، ومقيَّد بمخزن ألفا.
        $this->withToken($ownerToken)->postJson('/api/users', [
            'name' => 'موظف مقيَّد', 'email' => 'staff-a@nibras.test', 'password' => 'password123',
            'role' => 'staff', 'warehouse_ids' => [$warehouseA['id']],
        ])->assertCreated();
        $staffToken = $this->postJson('/api/login', ['email' => 'staff-a@nibras.test', 'password' => 'password123'])->assertOk()['token'];

        $res = $this->withToken($staffToken)->getJson('/api/inventory')->assertOk();

        $this->assertNull($res->json('data.0.avg_cost'));
        $this->assertNull($res->json('data.0.stock_value'));
        $this->assertNull($res->json('total_value'));
        // الكمية ليست تكلفة — تبقى ظاهرة، ومقاطَعة بمخزنه المسموح فقط (٥ لا ١٢).
        $this->assertSame(5, $res->json('data.0.quantity_on_hand'));
    }

    /**
     * منتجٌ `variant_managed`: يثبت أن إغلاق فجوة المخزن **لم يُغيّر** دلالة
     * التقييم الحالية — `avg_cost`/`stock_value` يبقيان صفراً دوماً لهذا
     * المنتج (`Product::avgCost()` القائمة، بلا تغيير)، بصرف النظر عن حالة
     * تفعيل المتغيّرات أو نطاق المخزن؛ والكمية المعروضة (غير حسّاسة تكلفةً)
     * مجموعٌ عبر متغيّراته **ضمن المخزن المسموح فقط** — نفس دلالة «مجموعٍ عبر
     * كل المتغيّرات» الموثَّقة في `Product::quantityOnHand()` حرفياً، مُقاطَعةً
     * بالمخزن فقط لا أكثر.
     */
    /** @test */
    public function variant_managed_product_keeps_existing_zero_valuation_while_quantity_is_warehouse_scoped(): void
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

        // أسود (نشط) في ألفا: ٦. أبيض (سيُعطَّل) في ألفا أيضاً: ٤. أسود إضافي في بيتا: ١٠ (خارج النطاق).
        app(InventoryService::class)->receiveStock($product->fresh(), 6, 100, ['warehouse_id' => $warehouseA['id']], $blackVariant);
        app(InventoryService::class)->receiveStock($product->fresh(), 4, 150, ['warehouse_id' => $warehouseA['id']], $whiteVariant);
        app(InventoryService::class)->receiveStock($product->fresh(), 10, 100, ['warehouse_id' => $warehouseB['id']], $blackVariant);
        $whiteVariant->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $scopedToken = $this->restrictedAdmin($ownerToken, 'admin-a3@nibras.test', $warehouseA['id']);

        $ownerRes = $this->withToken($ownerToken)->getJson('/api/inventory')->assertOk();
        $scopedRes = $this->withToken($scopedToken)->getJson('/api/inventory')->assertOk();

        // القيمة تبقى صفراً دوماً لهذا المنتج — دلالة `Product::avgCost()` القائمة، بلا تغيير.
        $this->assertSame('0.00', $ownerRes->json('data.0.avg_cost'));
        $this->assertSame('0.00', $ownerRes->json('data.0.stock_value'));
        $this->assertSame('0.00', $scopedRes->json('data.0.avg_cost'));
        $this->assertSame('0.00', $scopedRes->json('data.0.stock_value'));

        // الكمية: غير المقيَّد = مجموع كل المتغيّرات في كل المخازن (٦+٤+١٠=٢٠) — دلالة قائمة بلا تغيير.
        $this->assertSame(20, $ownerRes->json('data.0.quantity_on_hand'));
        // المقيَّد بألفا: مجموع متغيّراته في ألفا فقط (٦+٤=١٠) — لا أثر لأسود بيتا (١٠ إضافية).
        $this->assertSame(10, $scopedRes->json('data.0.quantity_on_hand'));
    }

    /**
     * دليل أداء: مسار المستخدم المقيَّد يبقى استعلاماً تجميعياً واحداً إضافياً
     * فوق استعلام الكتالوج (لا N+1 جديد) — لا يتناسب عدد الاستعلامات مع حجم
     * الكتالوج.
     */
    /** @test */
    public function warehouse_scoping_does_not_introduce_new_n_plus_one(): void
    {
        ['token' => $ownerSmall, 'tenant_id' => $tidSmall] = $this->registerTenant('nibras-wh-small', 'owner@wh-small.test');
        $warehouseSmall = $this->withToken($ownerSmall)->postJson('/api/warehouses', ['name' => 'مخزن'])->assertCreated()['data'];
        app(TenantContext::class)->set($tidSmall);
        for ($i = 0; $i < 5; $i++) {
            $p = Product::create(['tenant_id' => $tidSmall, 'name' => "صنف {$i}", 'type' => 'good', 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($p->fresh(), 2, 1000, ['warehouse_id' => $warehouseSmall['id']]);
        }
        app(TenantContext::class)->forget();
        $scopedSmall = $this->restrictedAdmin($ownerSmall, 'scoped@wh-small.test', $warehouseSmall['id']);

        ['token' => $ownerBig, 'tenant_id' => $tidBig] = $this->registerTenant('nibras-wh-big', 'owner@wh-big.test');
        $warehouseBig = $this->withToken($ownerBig)->postJson('/api/warehouses', ['name' => 'مخزن'])->assertCreated()['data'];
        app(TenantContext::class)->set($tidBig);
        for ($i = 0; $i < 25; $i++) {
            $p = Product::create(['tenant_id' => $tidBig, 'name' => "صنف {$i}", 'type' => 'good', 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($p->fresh(), 2, 1000, ['warehouse_id' => $warehouseBig['id']]);
        }
        app(TenantContext::class)->forget();
        $scopedBig = $this->restrictedAdmin($ownerBig, 'scoped@wh-big.test', $warehouseBig['id']);

        DB::enableQueryLog();

        DB::flushQueryLog();
        $this->withToken($scopedSmall)->getJson('/api/inventory')->assertOk();
        $small = count(DB::getQueryLog());

        DB::flushQueryLog();
        $this->withToken($scopedBig)->getJson('/api/inventory')->assertOk();
        $big = count(DB::getQueryLog());

        DB::disableQueryLog();

        // الفارق الوحيد المسموح به هو تكلفة الأدوات المحسوبة الموجودة أصلاً
        // (avg_cost لكل صفّ — N+1 قديم غير مُدخَل هنا) لا استعلام نطاق المخزن
        // الجديد، الذي يبقى واحداً بصرف النظر عن حجم الكتالوج. الفارق بين
        // ٥ و٢٥ منتجاً يجب ألا يتجاوز الفارق في عدد المنتجات نفسه (استعلامٌ
        // واحدٌ لكل صفّ من الـ`avg_cost` accessor القائم، لا أكثر).
        $this->assertLessThanOrEqual(($big - $small), 25 - 5 + 1, 'no NEW N+1 beyond the pre-existing avg_cost accessor cost per row');
    }
}
