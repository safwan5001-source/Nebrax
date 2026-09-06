<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\StockMovement;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * PR-INV-1 — تفويض التكلفة الحسّاسة مركزياً: سعر الشراء، متوسط التكلفة، هامش
 * الربح، قيمة المخزون، تكلفة حركة المخزون (وحدة/إجمالي). سعر البيع ليس تكلفة.
 *
 * `staff`/`accountant` يملكان `products.view`/`products.manage` لكن ليس
 * `products.view_cost` افتراضياً — بالضبط الفجوة التي رصدها التدقيق: صلاحية
 * تشغيلية عادية كانت تكفي وحدها للوصول إلى بيانات تجارية حسّاسة.
 *
 * تشغيل: php artisan test --filter=SensitiveCostAuthorizationTest
 */
class SensitiveCostAuthorizationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createProduct(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'إسمنت', 'type' => 'good', 'sale_price' => 20000,
            'purchase_price' => 10000, 'track_inventory' => true,
        ], $overrides))->assertCreated()['data'];
    }

    /** دور مخصَّص بصلاحيات مُعطاة صراحةً — لاختبار منح/سحب `products.view_cost` بمعزل عن الأدوار النظامية. */
    private function customRoleToken(array $auth, string $slug, array $permissions, string $email): array
    {
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => $slug, 'permissions' => $permissions,
        ])->assertCreated()['data'];

        $token = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => $slug, 'email' => $email, 'password' => 'password123', 'role' => $role['slug'],
        ])->assertCreated();

        $login = $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])
            ->assertOk()['token'];

        return ['role_id' => $role['id'], 'role_slug' => $role['slug'], 'token' => $login];
    }

    /** @return array<int, array<int, string>> */
    private function readCsv(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'cost-export-csv-');
        file_put_contents($path, $response->streamedContent());
        $rows = SpreadsheetReader::read($path, 'csv', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @param array<int, array<int, string>> $rows @return array<int, string> */
    private function column(array $rows, string $header): array
    {
        $index = array_search($header, $rows[0], true);
        $this->assertNotFalse($index, "العمود «{$header}» غير موجود في الملف المصدَّر.");

        return array_map(static fn (array $row): string => (string) ($row[$index] ?? ''), array_slice($rows, 1));
    }

    /** @param array<int, string> $headers @param array<int, array<int, string>> $rows */
    private function csv(array $headers, array $rows, string $name = 'products.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($headers, $rows));
    }

    // ═══════════════════════════════════════════════════════════
    //  Product list/show
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_unauthorized_role_never_sees_cost_fields_in_the_list_or_show_response(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['profit_margin' => 50]);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        foreach ([
            $this->withToken($staff)->getJson('/api/products')->assertOk()->json('data.0'),
            $this->withToken($staff)->getJson("/api/products/{$product['id']}")->assertOk()->json('data'),
        ] as $data) {
            $this->assertArrayNotHasKey('purchase_price', $data);
            $this->assertArrayNotHasKey('avg_cost', $data);
            $this->assertArrayNotHasKey('profit_margin', $data);
            $this->assertSame('200.00', $data['sale_price'], 'سعر البيع ليس تكلفة — يبقى ظاهراً دائماً.');
        }
    }

    /** @test */
    public function an_authorized_role_sees_cost_fields_unchanged(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['profit_margin' => 50]);

        $data = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}")->assertOk()['data'];

        $this->assertSame('100.00', $data['purchase_price']);
        $this->assertSame(50, $data['profit_margin']);
    }

    // ═══════════════════════════════════════════════════════════
    //  Product activity/history
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function activity_diff_redacts_cost_fields_for_unauthorized_users_without_dropping_other_history(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => 'إسمنت مُعدَّل', 'type' => 'good', 'sale_price' => 20000,
            'purchase_price' => 15000, 'track_inventory' => true,
        ])->assertOk();

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');
        $activity = $this->withToken($staff)->getJson("/api/products/{$product['id']}/activity")->assertOk()['data'];

        $updated = collect($activity)->firstWhere('action', 'updated');
        $this->assertNotNull($updated, 'سجلّ التعديل يجب أن يبقى ظاهراً.');
        $this->assertArrayNotHasKey('purchase_price', $updated['diff'], 'قيمة سعر الشراء القديمة/الجديدة يجب ألّا تظهرا.');
        $this->assertArrayHasKey('name', $updated['diff'], 'الحقول غير الحسّاسة تبقى كما هي.');

        $ownerView = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/activity")->assertOk()['data'];
        $this->assertArrayHasKey('purchase_price', collect($ownerView)->firstWhere('action', 'updated')['diff']);
    }

    // ═══════════════════════════════════════════════════════════
    //  Product export catalog and round-trip
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function catalog_export_blanks_cost_columns_for_unauthorized_users_but_keeps_headers(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'EXP-1']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $rows = $this->readCsv(
            $this->withToken($staff)->get('/api/products/export?scope=all&format=csv&template=catalog')->assertOk()
        );

        $this->assertContains('avg_cost', $rows[0], 'الترويسة تبقى — عقد round-trip لا ينكسر.');
        $this->assertContains('purchase_price', $rows[0]);
        $this->assertSame([''], $this->column($rows, 'avg_cost'));
        $this->assertSame([''], $this->column($rows, 'purchase_price'));
    }

    /** @test */
    public function round_trip_export_blanks_purchase_price_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'RT-EXP-1']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $rows = $this->readCsv(
            $this->withToken($staff)->get('/api/products/export?scope=all&format=csv&template=round_trip')->assertOk()
        );

        $this->assertSame([''], $this->column($rows, 'purchase_price'));
    }

    /** @test */
    public function an_authorized_export_keeps_cost_values(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'EXP-OWNER']);

        $rows = $this->readCsv(
            $this->withToken($auth['token'])->get('/api/products/export?scope=all&format=csv&template=catalog')->assertOk()
        );

        $this->assertSame(['100.00'], $this->column($rows, 'purchase_price'));
    }

    // ═══════════════════════════════════════════════════════════
    //  Inventory list/valuation + export + movement cost fields
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function inventory_valuation_hides_avg_cost_and_stock_value_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $res = $this->withToken($staff)->getJson('/api/inventory')->assertOk();
        $this->assertNull($res->json('data.0.avg_cost'));
        $this->assertNull($res->json('data.0.stock_value'));
        $this->assertNull($res->json('total_value'));
        $this->assertSame(0, $res->json('data.0.quantity_on_hand'), 'الكمية ليست تكلفة — تبقى ظاهرة (منتج بلا رصيد بعد).');

        $ownerRes = $this->withToken($auth['token'])->getJson('/api/inventory')->assertOk();
        $this->assertNotNull($ownerRes->json('data.0.avg_cost'));
    }

    /** @test */
    public function inventory_export_blanks_avg_cost_and_stock_value_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $rows = $this->readCsv(
            $this->withToken($staff)->get('/api/inventory/export?scope=all&format=csv')->assertOk()
        );

        $this->assertSame([''], $this->column($rows, 'متوسط التكلفة'));
        $this->assertSame([''], $this->column($rows, 'قيمة المخزون'));
    }

    /** @test */
    public function movement_cost_fields_are_hidden_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        app(TenantContext::class)->set($auth['tenant_id']);
        StockMovement::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product['id'], 'type' => 'in',
            'quantity' => 5, 'unit_cost' => 10000, 'total_cost' => 50000,
            'balance_quantity' => 5, 'movement_date' => now(),
        ]);

        $res = $this->withToken($staff)->getJson("/api/inventory/{$product['id']}/movements")->assertOk();
        $this->assertNull($res->json('data.0.unit_cost'));
        $this->assertNull($res->json('data.0.total_cost'));
        $this->assertSame(5, $res->json('data.0.quantity'));

        $ownerRes = $this->withToken($auth['token'])->getJson("/api/inventory/{$product['id']}/movements")->assertOk();
        $this->assertSame('100.00', $ownerRes->json('data.0.unit_cost'));
    }

    // ═══════════════════════════════════════════════════════════
    //  cost/value filters and sorts
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function product_cost_filters_and_sorts_are_rejected_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->getJson('/api/products?purchase_price_eq=100.00')->assertForbidden();
        $this->withToken($staff)->getJson('/api/products?sort=purchase_price')->assertForbidden();
        $this->withToken($staff)->get('/api/products/export?scope=all&format=csv&purchase_price_gte=1')->assertForbidden();

        // غير المشتق من التكلفة يمرّ بلا قيد.
        $this->withToken($staff)->getJson('/api/products?sort=name')->assertOk();
        $this->withToken($staff)->getJson('/api/products?sale_price_gte=1')->assertOk();
    }

    /** @test */
    public function inventory_cost_filters_and_sorts_are_rejected_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->get('/api/inventory/export?scope=filtered&format=csv&avg_cost_min=10')->assertForbidden();
        $this->withToken($staff)->get('/api/inventory/export?scope=filtered&format=csv&stock_value_min=10')->assertForbidden();
        $this->withToken($staff)->get('/api/inventory/export?scope=all&format=csv&sort=avg_cost')->assertForbidden();

        $this->withToken($staff)->get('/api/inventory/export?scope=all&format=csv&sort=name')->assertOk();
    }

    /** @test */
    public function an_authorized_role_may_filter_and_sort_by_cost(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token']);

        $this->withToken($auth['token'])->getJson('/api/products?purchase_price_eq=100.00')->assertOk();
        $this->withToken($auth['token'])->getJson('/api/products?sort=purchase_price')->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  Product create/update with and without purchase_price changes
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function creating_a_product_with_a_nonzero_purchase_price_is_rejected_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        // `accountant`: يملك `products.manage` (فيتجاوز EnsurePermission) لكن ليس
        // `products.view_cost` — الحالة التي تعزل هذا الاختبار عن حارس الصلاحية العام.
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');

        $this->withToken($accountant)->postJson('/api/products', [
            'name' => 'محاولة', 'type' => 'good', 'sale_price' => 10000, 'purchase_price' => 5000,
        ])->assertForbidden();

        $this->assertSame(0, Product::count(), 'لا كتابة عند الرفض.');
    }

    /** @test */
    public function creating_a_product_without_a_purchase_price_succeeds_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');

        $this->withToken($accountant)->postJson('/api/products', [
            'name' => 'عادي', 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated();
    }

    /** @test */
    public function updating_a_product_without_touching_purchase_price_succeeds_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');

        $this->withToken($accountant)->putJson("/api/products/{$product['id']}", [
            'name' => 'اسم جديد', 'type' => 'good', 'sale_price' => 20000,
            'purchase_price' => 10000, // القيمة الحالية نفسها بالهللات — إعادة إرسال لا تغيير.
            'track_inventory' => true,
        ])->assertOk();
    }

    /** @test */
    public function updating_a_product_to_change_purchase_price_is_rejected_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');

        $this->withToken($accountant)->putJson("/api/products/{$product['id']}", [
            'name' => 'اسم جديد', 'type' => 'good', 'sale_price' => 20000,
            'purchase_price' => 999, 'track_inventory' => true,
        ])->assertForbidden();

        $this->assertSame(10000, Product::findOrFail($product['id'])->purchase_price, 'القيمة لم تتغيّر عند الرفض.');
    }

    /** @test */
    public function an_authorized_role_may_create_and_update_purchase_price_freely(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => 'اسم جديد', 'type' => 'good', 'sale_price' => 20000,
            'purchase_price' => 15000, 'track_inventory' => true,
        ])->assertOk();

        $this->assertSame(15000, Product::findOrFail($product['id'])->purchase_price);
    }

    // ═══════════════════════════════════════════════════════════
    //  import inspect/preview/apply as policy requires
    // ═══════════════════════════════════════════════════════════

    /**
     * الرفض هنا 422 لا 403: `preview`/`apply` يمرّان بالكامل عبر
     * `ApiController::domain()` الذي يحوّل كل رفض خدمة — بما فيه هذا — إلى 422
     * موحّد (نفس رمز "مطابقة تترك حقلاً مطلوباً بلا ربط" في `ProductImportV2Test`)؛
     * الجوهر المفحوص هو الرفض ذاته وعدم الكتابة، لا رمز HTTP بعينه.
     *
     * @test
     */
    public function importing_a_file_mapped_to_purchase_price_is_rejected_at_preview_and_apply_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');
        $file = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-1', 'منتج مستورد', '100.00', '50.00', 'good'],
        ]);

        $this->withToken($accountant)->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create',
        ])->assertStatus(422);

        $file2 = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-1', 'منتج مستورد', '100.00', '50.00', 'good'],
        ]);
        $this->withToken($accountant)->post('/api/products/import/apply', [
            'file' => $file2, 'mode' => 'create',
        ])->assertStatus(422);

        $this->assertSame(0, Product::count(), 'لا كتابة عند الرفض — حتى الأعمدة غير الحسّاسة في الملف نفسه.');
    }

    /** @test */
    public function importing_a_file_that_does_not_map_purchase_price_succeeds_for_unauthorized_users(): void
    {
        $auth = $this->registerTenant();
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');
        $file = $this->csv(['sku', 'name', 'sale_price', 'type'], [
            ['IMP-2', 'منتج بلا تكلفة', '100.00', 'good'],
        ]);

        $this->withToken($accountant)->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'create',
        ])->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame(0, Product::where('sku', 'IMP-2')->firstOrFail()->purchase_price);
    }

    /** @test */
    public function an_authorized_role_may_import_purchase_price(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-3', 'منتج مستورد', '100.00', '50.00', 'good'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'create',
        ])->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame(5000, Product::where('sku', 'IMP-3')->firstOrFail()->purchase_price);
    }

    // ═══════════════════════════════════════════════════════════
    //  permission revoked between preview and apply
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function revoking_view_cost_between_preview_and_apply_blocks_the_apply(): void
    {
        $auth = $this->registerTenant();
        $custom = $this->customRoleToken(
            $auth, 'مستورد تكلفة',
            ['products.view', 'products.manage', 'products.view_cost'],
            'cost-importer@acme.test'
        );

        $file = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-REVOKE', 'منتج', '100.00', '50.00', 'good'],
        ]);
        $this->withToken($custom['token'])->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create',
        ])->assertOk()->assertJsonPath('data.mapping.3', 'purchase_price');

        // السحب: تعديل الدور نفسه لإزالة `products.view_cost` — الجلسة والملف لم يتغيّرا.
        $this->withToken($auth['token'])->putJson("/api/roles/{$custom['role_id']}", [
            'name' => 'مستورد تكلفة', 'permissions' => ['products.view', 'products.manage'],
        ])->assertOk();

        $file2 = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-REVOKE', 'منتج', '100.00', '50.00', 'good'],
        ]);
        $this->withToken($custom['token'])->post('/api/products/import/apply', [
            'file' => $file2, 'mode' => 'create',
        ])->assertStatus(422);

        $this->assertSame(0, Product::where('sku', 'IMP-REVOKE')->count(), 'لا يُكتب المنتج بعد سحب الصلاحية.');
    }

    /** @test */
    public function granting_view_cost_between_preview_and_apply_allows_the_apply(): void
    {
        $auth = $this->registerTenant();
        $custom = $this->customRoleToken(
            $auth, 'بلا تكلفة',
            ['products.view', 'products.manage'],
            'no-cost@acme.test'
        );

        $file = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-GRANT', 'منتج', '100.00', '50.00', 'good'],
        ]);
        $this->withToken($custom['token'])->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create',
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/roles/{$custom['role_id']}", [
            'name' => 'بلا تكلفة', 'permissions' => ['products.view', 'products.manage', 'products.view_cost'],
        ])->assertOk();

        $file2 = $this->csv(['sku', 'name', 'sale_price', 'purchase_price', 'type'], [
            ['IMP-GRANT', 'منتج', '100.00', '50.00', 'good'],
        ]);
        $this->withToken($custom['token'])->post('/api/products/import/apply', [
            'file' => $file2, 'mode' => 'create',
        ])->assertOk()->assertJsonPath('data.created', 1);
    }

    // ═══════════════════════════════════════════════════════════
    //  انحدار: عزل المستأجر لا يزال قائماً فوق سياسة التكلفة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function cost_authorization_does_not_weaken_tenant_isolation(): void
    {
        $auth = $this->registerTenant('cost-tenant-a', 'owner@cost-tenant-a.test');
        $product = $this->createProduct($auth['token']);

        $other = $this->registerTenant('cost-tenant-b', 'owner@cost-tenant-b.test');
        $this->withToken($other['token'])->getJson("/api/products/{$product['id']}")->assertNotFound();
    }

    // ═══════════════════════════════════════════════════════════
    //  /api/reports/inventory — نفس السياسة المركزية، لا سياسة موازية
    // ═══════════════════════════════════════════════════════════
    //  `reports.view` وحدها كانت تكفي للوصول إلى avg_cost/stock_value/unit_cost/
    //  total_cost/in_cost/out_cost/difference_value في هذا التقرير التحليلي —
    //  نفس الفجوة المؤكدة في المنتج والمخزون، مُصلَحة بالسياسة نفسها لا بموازية.
    // ═══════════════════════════════════════════════════════════

    /**
     * @return array{owner_token:string, tenant_id:string, warehouse:string, product:string, permit:string, stocktake:string}
     */
    private function inventoryReportSetup(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $token = $auth['token'];
        $product = $this->createProduct($token, ['sku' => "{$slug}-PUMP"]);
        $warehouse = $this->withToken($token)->postJson('/api/warehouses', [
            'name' => 'مخزن التقارير',
        ])->assertCreated()['data']['id'];

        // إذن إضافة مرحّل: يولّد حركة مخزون (movements) ويصير هو نفسه عملية
        // مرحّلة (operations)، ويثبت avg_cost على المنتج (value).
        $permit = $this->withToken($token)->postJson('/api/stock-permits', [
            'type' => 'receipt', 'warehouse_id' => $warehouse,
            'items' => [['product_id' => $product['id'], 'quantity' => 10, 'unit_cost' => 10000]],
        ])->assertCreated()['data']['id'];
        $this->withToken($token)->postJson("/api/stock-permits/{$permit}/post")->assertOk();

        // جرد مرحَّل بفرقٍ فعلي: يثبت difference_value (stocktakes).
        $stocktake = $this->withToken($token)->postJson('/api/stocktakes', [
            'warehouse_id' => $warehouse,
        ])->assertCreated()['data']['id'];
        $this->withToken($token)->postJson("/api/stocktakes/{$stocktake}/count", [
            'counts' => [['product_id' => $product['id'], 'counted_quantity' => 8]],
        ])->assertOk();
        $this->withToken($token)->postJson("/api/stocktakes/{$stocktake}/post")->assertOk();

        return [
            'owner_token' => $token, 'tenant_id' => $auth['tenant_id'], 'warehouse' => $warehouse,
            'product' => $product['id'], 'permit' => $permit, 'stocktake' => $stocktake,
        ];
    }

    /** @test */
    public function the_value_view_hides_avg_cost_and_stock_value_for_unauthorized_users(): void
    {
        $s = $this->inventoryReportSetup('rpt-value');
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@rpt-value.test');

        $res = $this->withToken($staff)->getJson('/api/reports/inventory?view=value')->assertOk();
        $row = collect($res->json('data'))->firstWhere('sku', 'rpt-value-PUMP');
        $this->assertNotNull($row);
        $this->assertNull($row['avg_cost']);
        $this->assertNull($row['stock_value']);
        $this->assertSame(8, $row['quantity'], 'الكمية ليست تكلفة — تبقى ظاهرة (10 مستلمة، عجز 2 بالجرد).');
        $this->assertNull($res->json('totals.stock_value'));

        $ownerRes = $this->withToken($s['owner_token'])->getJson('/api/reports/inventory?view=value')->assertOk();
        $ownerRow = collect($ownerRes->json('data'))->firstWhere('sku', 'rpt-value-PUMP');
        $this->assertSame('100.00', $ownerRow['avg_cost']);
        $this->assertNotNull($ownerRes->json('totals.stock_value'));
    }

    /** @test */
    public function the_warehouses_view_is_unaffected_because_it_never_carried_cost(): void
    {
        $s = $this->inventoryReportSetup('rpt-warehouses');
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@rpt-warehouses.test');

        $res = $this->withToken($staff)->getJson('/api/reports/inventory?view=warehouses')->assertOk();
        $row = collect($res->json('data'))->first();
        $this->assertArrayNotHasKey('stock_value', $row, 'هذا العرض كميّ بالتصميم أصلاً — لا تغيير هنا.');
        $this->assertSame(8, $row['quantity']);
    }

    /** @test */
    public function the_movements_view_hides_unit_and_total_cost_for_unauthorized_users(): void
    {
        $s = $this->inventoryReportSetup('rpt-movements');
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@rpt-movements.test');

        // الحركات مرتَّبة بالأحدث أولاً: تعديل الجرد (صرف عجز) يسبق الاستلام
        // زمنياً في الاستجابة؛ نلتقط حركة الاستلام (in) صراحةً لا "الأولى".
        $res = $this->withToken($staff)->getJson('/api/reports/inventory?view=movements')->assertOk();
        $row = collect($res->json('data'))->firstWhere('type', 'in');
        $this->assertNotNull($row);
        $this->assertNull($row['unit_cost']);
        $this->assertNull($row['total_cost']);
        $this->assertSame(10, $row['quantity'], 'الكمية تبقى ظاهرة.');
        $this->assertNull($res->json('totals.in_cost'));
        $this->assertNull($res->json('totals.out_cost'));
        $this->assertNull($res->json('totals.total_cost'));

        $ownerRes = $this->withToken($s['owner_token'])->getJson('/api/reports/inventory?view=movements')->assertOk();
        $ownerRow = collect($ownerRes->json('data'))->firstWhere('type', 'in');
        $this->assertSame('100.00', $ownerRow['unit_cost']);
        $this->assertNotNull($ownerRes->json('totals.total_cost'));
    }

    /** @test */
    public function the_operations_view_hides_total_cost_for_unauthorized_users(): void
    {
        $s = $this->inventoryReportSetup('rpt-operations');
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@rpt-operations.test');

        $res = $this->withToken($staff)->getJson('/api/reports/inventory?view=operations')->assertOk();
        $row = collect($res->json('data'))->first();
        $this->assertNull($row['total_cost']);
        $this->assertSame(10, $row['quantity']);
        $this->assertNull($res->json('totals.total_cost'));

        $ownerRes = $this->withToken($s['owner_token'])->getJson('/api/reports/inventory?view=operations')->assertOk();
        $this->assertNotNull(collect($ownerRes->json('data'))->first()['total_cost']);
    }

    /** @test */
    public function the_stocktakes_view_hides_difference_value_for_unauthorized_users(): void
    {
        $s = $this->inventoryReportSetup('rpt-stocktakes');
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@rpt-stocktakes.test');

        $res = $this->withToken($staff)->getJson('/api/reports/inventory?view=stocktakes')->assertOk();
        $row = collect($res->json('data'))->first();
        $this->assertNull($row['difference_value']);
        $this->assertSame(-2, $row['quantity_difference'], 'فرق الكمية ليس تكلفة — يبقى ظاهراً.');
        $this->assertNull($res->json('totals.difference_value'));

        $ownerRes = $this->withToken($s['owner_token'])->getJson('/api/reports/inventory?view=stocktakes')->assertOk();
        $this->assertNotNull(collect($ownerRes->json('data'))->first()['difference_value']);
    }

    /** @test */
    public function an_authorized_role_may_still_use_the_report_without_products_view_cost_being_required_for_access(): void
    {
        // `reports.view` وحدها تكفي لفتح التقرير — الصلاحية الإضافية تُقصّ
        // الحقول الحسّاسة فقط، ولا تحجب التقرير نفسه عمّن لا يملكها.
        $s = $this->inventoryReportSetup('rpt-access');
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@rpt-access.test');

        $this->withToken($staff)->getJson('/api/reports/inventory?view=value')->assertOk();
        $this->withToken($staff)->getJson('/api/reports/inventory?view=movements')->assertOk();
        $this->withToken($staff)->getJson('/api/reports/inventory?view=operations')->assertOk();
        $this->withToken($staff)->getJson('/api/reports/inventory?view=stocktakes')->assertOk();
        $this->withToken($staff)->getJson('/api/reports/inventory?view=warehouses')->assertOk();
    }

    /** @test */
    public function the_inventory_report_still_enforces_tenant_isolation(): void
    {
        $a = $this->inventoryReportSetup('rpt-tenant-a');
        $b = $this->registerTenant('rpt-tenant-b', 'owner@rpt-tenant-b.test');

        $res = $this->withToken($b['token'])->getJson('/api/reports/inventory?view=value')->assertOk();
        $this->assertSame([], $res->json('data'), 'لا يجب أن يرى مستأجرٌ آخر أصناف مستأجرٍ غيره في التقرير.');
    }
}
