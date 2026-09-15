<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\ProductVariantService;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-FU-3/GAP-04 — تصدير أرصدة المخزون بدلالة المتغيّرات
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن `InventoryBalanceExportService` يتبع الآن دلالة
 *  `InventoryReportService::inventoryValue()` (VAR-REPORT-1) حرفياً:
 *  منتجٌ بسيطٌ = صفٌّ واحد كما كان؛ منتجٌ متعدد الخيارات = صفٌّ لكل متغيّرٍ
 *  فعليٍّ بعينه، كميته ومتوسط تكلفته من `InventoryState` الخاصّة به وحده،
 *  بلا صفّ أبٍ مضلِّل وبلا دمج إخوة. تشغيل:
 *  php artisan test --filter=InventoryBalanceExportVariantTest
 */
class InventoryBalanceExportVariantTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{0: Product, 1: ProductVariant, 2: ProductVariant} أسود/كبير + أبيض/صغير. */
    private function variantManagedProduct(string $tenantId, string $sku = 'SHIRT-1'): array
    {
        app(TenantContext::class)->set($tenantId);
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

        app(TenantContext::class)->forget();

        return [$product->fresh(), $black1, $white1];
    }

    /** يستقبل مخزوناً حقيقياً عبر `InventoryService` — لا كتابة مباشرة. */
    private function receive(string $tenantId, Product $product, ?ProductVariant $variant, int $qty, int $unitCost, ?string $warehouseId = null): void
    {
        if ($qty <= 0) {
            return;
        }
        app(TenantContext::class)->set($tenantId);
        app(InventoryService::class)->receiveStock(
            $product->fresh(),
            $qty,
            $unitCost,
            ['warehouse_id' => $warehouseId ?? Warehouse::default()?->id],
            $variant
        );
        app(TenantContext::class)->forget();
    }

    /** @return array<int, array<int, string>> */
    private function readCsv(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'inv-var-export-');
        file_put_contents($path, $response->streamedContent());
        $rows = SpreadsheetReader::read($path, 'csv', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @param array<int, array<int, string>> $rows @return array<string, string>[] صفوفٌ مفتاحُها اسم العمود. */
    private function assoc(array $rows): array
    {
        $headers = $rows[0];

        return array_map(
            static fn (array $row): array => array_combine($headers, array_pad($row, count($headers), '')),
            array_slice($rows, 1)
        );
    }

    private function export(string $token, string $query = 'scope=all&format=csv'): array
    {
        return $this->assoc($this->readCsv(
            $this->withToken($token)->get("/api/inventory/export?{$query}")->assertOk()
        ));
    }

    // ═══════════════════ ١) توافقٌ رجعي — منتجٌ بسيط ═══════════════════

    /** @test */
    public function simple_product_export_is_unchanged(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'أسمنت', 'sku' => 'CEM-1', 'sale_price' => 3000, 'track_inventory' => true]);
        app(TenantContext::class)->forget();
        $this->receive($auth['tenant_id'], $product, null, 15, 1200);

        $rows = $this->export($auth['token']);
        $this->assertCount(1, $rows);
        $this->assertSame('CEM-1', $rows[0]['رمز الصنف']);
        $this->assertSame('15', $rows[0]['الكمية']);
        $this->assertSame('12.00', $rows[0]['متوسط التكلفة']);
        $this->assertSame($product->id, $rows[0]['معرّف الصنف']);
        $this->assertSame('', $rows[0]['معرّف المتغيّر']);
        $this->assertSame('', $rows[0]['وصف المتغيّر']);
    }

    // ═══════════════════ ٢-٤) صفوفٌ مستقلّة بهويّةٍ صحيحة ═══════════════════

    /** @test */
    public function variant_managed_product_exports_a_separate_row_per_sibling_variant(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = $this->export($auth['token']);
        $this->assertCount(2, $rows, 'صفٌّ لكل متغيّرٍ فعليّ — لا صفّ أبٍ إضافي.');
    }

    /** @test */
    public function each_row_carries_its_own_product_variant_id(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = collect($this->export($auth['token']))->keyBy('معرّف المتغيّر');
        $this->assertTrue($rows->has($black->id));
        $this->assertTrue($rows->has($white->id));
        $this->assertSame($product->id, $rows[$black->id]['معرّف الصنف']);
        $this->assertSame($product->id, $rows[$white->id]['معرّف الصنف']);
    }

    /** @test */
    public function descriptor_and_sku_are_populated_per_variant(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = collect($this->export($auth['token']))->keyBy('معرّف المتغيّر');
        $this->assertSame('أسود / كبير', $rows[$black->id]['وصف المتغيّر']);
        $this->assertSame('أبيض / صغير', $rows[$white->id]['وصف المتغيّر']);
        $this->assertSame($black->sku, $rows[$black->id]['رمز الصنف']);
        $this->assertSame($white->sku, $rows[$white->id]['رمز الصنف']);
        $this->assertNotSame($rows[$black->id]['رمز الصنف'], $rows[$white->id]['رمز الصنف']);
    }

    // ═══════════════════ ٥-٨) استقلال الكمية/المتوسط/القيمة ═══════════════════

    /** @test */
    public function variant_quantities_are_independent(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = collect($this->export($auth['token']))->keyBy('معرّف المتغيّر');
        $this->assertSame('10', $rows[$black->id]['الكمية']);
        $this->assertSame('20', $rows[$white->id]['الكمية']);
    }

    /** @test */
    public function variant_avg_costs_are_independent(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = collect($this->export($auth['token']))->keyBy('معرّف المتغيّر');
        $this->assertSame('40.00', $rows[$black->id]['متوسط التكلفة']);
        $this->assertSame('50.00', $rows[$white->id]['متوسط التكلفة']);
    }

    /** @test */
    public function inventory_value_equals_quantity_times_that_variants_avg_cost(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = collect($this->export($auth['token']))->keyBy('معرّف المتغيّر');
        // 10 × 40.00 = 400.00 — لا 10 × متوسطٍ مُشتقٍّ من الإخوة.
        $this->assertSame('400.00', $rows[$black->id]['قيمة المخزون']);
        // 20 × 50.00 = 1000.00
        $this->assertSame('1000.00', $rows[$white->id]['قيمة المخزون']);

        // لا احتسابٌ مزدوج ولا تلوّث بين الصفوف: مجموع القيم = مجموع كل صفٍّ بمعزل.
        $sum = array_sum(array_map(static fn (array $r): float => (float) $r['قيمة المخزون'], $rows->values()->all()));
        $this->assertEqualsWithDelta(1400.0, $sum, 0.001);
    }

    /** @test */
    public function parent_product_row_is_never_emitted_for_variant_managed_products(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000);

        $rows = collect($this->export($auth['token']))->where('معرّف الصنف', $product->id);
        $this->assertCount(2, $rows, 'صفّان فقط لهذا المنتج — لا صفّ أبٍ ثالث بمعرّف متغيّرٍ فارغ.');
        $this->assertTrue($rows->every(fn (array $r) => $r['معرّف المتغيّر'] !== ''), 'كل صفٍّ لهذا المنتج يحمل معرّف متغيّرٍ فعلي.');
    }

    // ═══════════════════ ٩-١٠) نطاق المخزن مقابل التكلفة العالمية (D-07) ═══════════════════
    //
    // `warehouse_id` ليس مرشِّحاً يقبله عقد هذا التصدير أصلاً (غائبٌ عن
    // `InventoryBalanceFilters::rules()`، فلا يُمرَّر إلى `ReportWarehouseScope::resolve()`
    // إطلاقاً — قيمة استعلامٍ لا تصل حتى إلى `$filters`). النطاق الفعّال
    // الوحيد اليوم مصدره `auth()->user()->allowedWarehouseIds()` — تماماً كما
    // في تقارير المخزون الأخرى. فيُختبَر عبر مستخدمٍ مقيَّدٍ بمخزن، لا عبر
    // مُعامل استعلامٍ لمالكٍ غير مقيَّد.

    private function warehouseRestrictedUser(string $tenantId, string $branchId, string $warehouseId, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        $user = User::create([
            'tenant_id' => $tenantId, 'name' => 'موظفٌ مقيَّد بمخزن',
            'email' => $email, 'password' => 'password123', 'role' => 'admin',
        ]);
        $user->branches()->sync([$branchId]);
        $user->warehouses()->sync([$warehouseId]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    /** @test */
    public function warehouse_scoped_quantities_reflect_only_that_warehouse(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $wh1 = Warehouse::create(['name' => 'مخزن أ', 'code' => 'VFU3-WH1', 'branch_id' => $branchId, 'is_active' => true])->id;
        $wh2 = Warehouse::create(['name' => 'مخزن ب', 'code' => 'VFU3-WH2', 'branch_id' => $branchId, 'is_active' => true])->id;
        app(TenantContext::class)->forget();

        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        // أسود: ٦ في مخزن أ + ٤ في مخزن ب = ١٠ إجمالاً.
        $this->receive($auth['tenant_id'], $product, $black, 6, 4000, $wh1);
        $this->receive($auth['tenant_id'], $product, $black, 4, 4000, $wh2);
        // أبيض: ٢٠ في مخزن أ فقط.
        $this->receive($auth['tenant_id'], $product, $white, 20, 5000, $wh1);

        $restrictedToken = $this->warehouseRestrictedUser($auth['tenant_id'], $branchId, $wh1, 'wh-scope-9@vfu3.test');
        $scoped = collect($this->export($restrictedToken))->keyBy('معرّف المتغيّر');
        $this->assertSame('6', $scoped[$black->id]['الكمية'], 'أسود ضمن مخزن أ وحده = ٦ لا ١٠.');
        $this->assertSame('20', $scoped[$white->id]['الكمية']);
    }

    /** @test */
    public function tenant_wide_cost_is_used_not_a_per_warehouse_invented_cost(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $wh1 = Warehouse::create(['name' => 'مخزن أ', 'code' => 'VFU3-WHA', 'branch_id' => $branchId, 'is_active' => true])->id;
        $wh2 = Warehouse::create(['name' => 'مخزن ب', 'code' => 'VFU3-WHB', 'branch_id' => $branchId, 'is_active' => true])->id;
        app(TenantContext::class)->forget();

        [$product, $black] = $this->variantManagedProduct($auth['tenant_id']);
        // دفعتان بتكلفتين مختلفتين في مخزنين مختلفين → متوسطٌ متحركٌ واحدٌ للمنشأة.
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000, $wh1);
        $this->receive($auth['tenant_id'], $product, $black, 10, 6000, $wh2);

        $wh1Token = $this->warehouseRestrictedUser($auth['tenant_id'], $branchId, $wh1, 'wh-scope-10a@vfu3.test');
        $wh2Token = $this->warehouseRestrictedUser($auth['tenant_id'], $branchId, $wh2, 'wh-scope-10b@vfu3.test');

        $unscoped = collect($this->export($auth['token']))->keyBy('معرّف المتغيّر');
        $scopedWh1 = collect($this->export($wh1Token))->keyBy('معرّف المتغيّر');
        $scopedWh2 = collect($this->export($wh2Token))->keyBy('معرّف المتغيّر');

        // نفس متوسط التكلفة (50.00) بصرف النظر عن نطاق المخزن — لا تكلفة مخترَعة لكل مخزن.
        $this->assertSame('50.00', $unscoped[$black->id]['متوسط التكلفة']);
        $this->assertSame('50.00', $scopedWh1[$black->id]['متوسط التكلفة']);
        $this->assertSame('50.00', $scopedWh2[$black->id]['متوسط التكلفة']);
        // الكمية وحدها تتغيّر بنطاق المخزن.
        $this->assertSame('10', $scopedWh1[$black->id]['الكمية']);
        $this->assertSame('10', $scopedWh2[$black->id]['الكمية']);
        $this->assertSame('20', $unscoped[$black->id]['الكمية']);
    }

    // ═══════════════════ ١١) الرصيد الصفري ═══════════════════

    /** @test */
    public function zero_stock_variant_behavior_matches_the_include_zero_flag(): void
    {
        $auth = $this->registerTenant();
        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 10, 4000);
        // أبيض بلا استلامٍ إطلاقاً — رصيده صفرٌ حقيقي.

        $withZero = collect($this->export($auth['token'], 'scope=all&format=csv&include_zero=1'))->keyBy('معرّف المتغيّر');
        $this->assertTrue($withZero->has($black->id));
        $this->assertTrue($withZero->has($white->id), 'include_zero=1 يُبقي المتغيّر الصفري.');
        $this->assertSame('0', $withZero[$white->id]['الكمية']);

        $withoutZero = collect($this->export($auth['token'], 'scope=all&format=csv&include_zero=0'))->keyBy('معرّف المتغيّر');
        $this->assertTrue($withoutZero->has($black->id));
        $this->assertFalse($withoutZero->has($white->id), 'include_zero=0 يُسقط المتغيّر الصفري فقط.');
    }

    // ═══════════════════ ١٢) عزل المستأجر ═══════════════════

    /** @test */
    public function tenant_isolation_negative_control(): void
    {
        $first = $this->registerTenant('vfu3-a', 'owner-a@vfu3.test');
        [$product, $black] = $this->variantManagedProduct($first['tenant_id']);
        $this->receive($first['tenant_id'], $product, $black, 10, 4000);

        $second = $this->registerTenant('vfu3-b', 'owner-b@vfu3.test');
        $rows = $this->export($second['token']);
        $this->assertCount(0, $rows, 'مستأجرٌ آخر لا يرى صفّاً واحداً من كتالوج الأول.');
    }

    // ═══════════════════ ١٣-١٤) عزل الفرع والمخزن لمستخدمٍ مقيَّد ═══════════════════

    /** @test */
    public function warehouse_restricted_user_never_sees_quantity_from_a_forbidden_warehouse(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $allowedWarehouse = Warehouse::create(['name' => 'مخزنٌ مسموح', 'code' => 'VFU3-ALLOWED', 'branch_id' => $branchId, 'is_active' => true]);
        $forbiddenWarehouse = Warehouse::create(['name' => 'مخزنٌ محظور', 'code' => 'VFU3-FORBIDDEN', 'branch_id' => $branchId, 'is_active' => true]);

        $restrictedUser = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'موظفٌ مقيَّد',
            'email' => 'restricted@vfu3.test', 'password' => 'password123', 'role' => 'admin',
        ]);
        $restrictedUser->branches()->sync([$branchId]);
        $restrictedUser->warehouses()->sync([$allowedWarehouse->id]);
        $restrictedToken = $restrictedUser->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        [$product, $black, $white] = $this->variantManagedProduct($auth['tenant_id']);
        $this->receive($auth['tenant_id'], $product, $black, 6, 4000, $allowedWarehouse->id);
        $this->receive($auth['tenant_id'], $product, $black, 4, 4000, $forbiddenWarehouse->id);
        $this->receive($auth['tenant_id'], $product, $white, 9, 5000, $forbiddenWarehouse->id);

        // بلا `warehouse_id` صراحةً: النطاق الفعّال يتقاطع تلقائياً مع مخازن المستخدم المسموحة.
        $rows = collect($this->export($restrictedToken))->keyBy('معرّف المتغيّر');
        $this->assertSame('6', $rows[$black->id]['الكمية'], 'المقيَّد يرى نصيب مخزنه المسموح فقط لا الإجمالي (١٠).');

        // طلبٌ صريحٌ للمخزن المحظور لا يُفلت شيئاً: يبقى مقصوراً على تقاطع النطاقين.
        $rowsExplicit = collect($this->export($restrictedToken, "scope=all&format=csv&warehouse_id={$forbiddenWarehouse->id}"))
            ->keyBy('معرّف المتغيّر');
        $this->assertSame('6', $rowsExplicit[$black->id]['الكمية'], 'طلب مخزنٍ محظورٍ صراحةً لا يتجاوز النطاق الفعّال.');
    }
}
