<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\ImportPreview;
use App\Models\PriceListItem;
use App\Models\ProductCategory;
use App\Models\Role;
use App\Models\UnitTemplate;
use App\Services\AiActionRegistry;
use App\Services\ImportDomainRegistry;
use App\Support\ImportJobDomain;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H4-S5 — نقاط استيراد التصنيفات/العلامات وأسعار القوائم وقوالب الوحدات (قالب/حقول/فحص/معاينة) ومجالاتها الثلاثة في المحرك الدائم.
 * بلا تطبيق متزامن، وبوابات كل مجال تطابق واجهته المباشرة، وقوالب الوحدات بلا مسار ذكاء اصطناعي (D-08).
 *
 * تشغيل: php artisan test --filter=H4ImportEndpointsTest
 */
class H4ImportEndpointsTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows, string $name = 'import.csv'): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($keys, $table));
    }

    private function customRole(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    private function upload(string $token, string $uri, array $body)
    {
        return $this->withToken($token)->post($uri, $body, ['Accept' => 'application/json']);
    }

    private function priceList(string $token, string $name = 'قائمة'): string
    {
        return $this->withToken($token)->postJson('/api/price-lists', ['name' => $name])->assertCreated()['data']['id'];
    }

    /** يشغّل التشغيلة حتى تكتمل ويعيد حالتها. */
    private function runJob(string $token, string $id, array $body = []): string
    {
        $status = null;
        for ($i = 0; $i < 12 && $status !== 'completed'; $i++) {
            $status = $this->withToken($token)->postJson("/api/import-jobs/{$id}/apply", $body)->assertOk()->json('data.status');
        }

        return (string) $status;
    }

    // ═══════════════════════════════ التسجيل والحدود ═══════════════════════════════

    /** @test */
    public function the_three_domains_are_registered_with_their_direct_api_gates_and_unit_templates_have_no_ai_action(): void
    {
        foreach ([ImportJobDomain::PRODUCT_TAXONOMY, ImportJobDomain::PRICE_LIST_ITEMS, ImportJobDomain::UNIT_TEMPLATES] as $domain) {
            $this->assertContains($domain, ImportJobDomain::values());
            $this->assertTrue(app(ImportDomainRegistry::class)->has($domain), $domain);
        }
        $this->assertSame(['view' => 'products.view', 'manage' => 'products.manage', 'app' => null], ImportJobDomain::authorization(ImportJobDomain::PRODUCT_TAXONOMY));
        $this->assertSame(['view' => 'invoices.view', 'manage' => 'company.manage', 'app' => null], ImportJobDomain::authorization(ImportJobDomain::PRICE_LIST_ITEMS));
        $this->assertSame(['view' => 'products.view', 'manage' => 'products.manage', 'app' => null], ImportJobDomain::authorization(ImportJobDomain::UNIT_TEMPLATES));
        // D-08: لا نوع إجراء مساعد لقوالب الوحدات (المعامل يضرب كميات المخزون).
        $this->assertSame([AiActionRegistry::PRODUCT_IMPORT], app(AiActionRegistry::class)->types());
    }

    /** @test */
    public function there_is_no_synchronous_apply_for_any_of_the_three(): void
    {
        $auth = $this->registerTenant();
        foreach (['product-taxonomy', 'unit-templates', 'price-lists'] as $prefix) {
            $this->upload($auth['token'], "/api/{$prefix}/import/apply", ['file' => $this->file([['name' => 'أ']]), 'kind' => 'brand'])->assertStatus(404);
        }
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame([0, 0, 0], [Brand::count(), UnitTemplate::count(), PriceListItem::count()]);
    }

    // ═══════════════════════════════ التصنيفات والعلامات ═══════════════════════════════

    /** @test */
    public function taxonomy_template_fields_inspect_and_preview_serve_the_kind_and_write_nothing(): void
    {
        $auth = $this->registerTenant();

        $template = $this->withToken($auth['token'])->get('/api/product-taxonomy/import/template?kind=category')->assertOk()->streamedContent();
        $this->assertStringContainsString('مسار التصنيف الأب', $template);
        $this->withToken($auth['token'])->getJson('/api/product-taxonomy/import/template')->assertUnprocessable();
        $this->withToken($auth['token'])->getJson('/api/product-taxonomy/import/template?kind=product')->assertUnprocessable();

        $keys = array_column($this->withToken($auth['token'])->getJson('/api/product-taxonomy/import/fields?kind=brand')->assertOk()->json('data.fields'), 'key');
        $this->assertSame(['nebrax_id', 'name', 'is_active'], $keys);

        $rows = [['name' => 'زيوت'], ['name' => 'فلاتر', 'parent_path' => 'زيوت']];
        $inspect = $this->upload($auth['token'], '/api/product-taxonomy/import/inspect', ['file' => $this->file($rows), 'kind' => 'category'])->assertOk()->json('data');
        $this->assertSame(['name', 'parent_path'], array_column($inspect['columns'], 'suggested_field'));

        $preview = $this->upload($auth['token'], '/api/product-taxonomy/import/preview', ['file' => $this->file($rows), 'kind' => 'category'])->assertOk()->json('data');
        $this->assertSame([2, 0], [$preview['create_rows'], $preview['error_rows']]);
        $binding = ImportPreview::query()->whereKey($preview['binding']['id'])->firstOrFail();
        $this->assertSame('product_taxonomy', $binding->domain);
        $this->assertSame(['category', 'create', 'error'], [$binding->options['kind'], $binding->options['mode'], $binding->options['parent_policy']]);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, ProductCategory::count());
    }

    /** @test */
    public function a_bound_taxonomy_job_creates_the_hierarchy_with_missing_parents_on_request(): void
    {
        $auth = $this->registerTenant();
        $rows = [['name' => 'فلاتر هواء', 'parent_path' => 'زيوت > فلاتر'], ['name' => 'زيوت محرك', 'parent_path' => 'زيوت']];
        $options = ['kind' => 'category', 'mode' => 'create', 'parent_policy' => 'create_missing'];

        $binding = $this->upload($auth['token'], '/api/product-taxonomy/import/preview', ['file' => $this->file($rows)] + $options)->assertOk()->json('data.binding');
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'product_taxonomy', 'file' => $this->file($rows), 'options' => $options, 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');
        $this->assertSame(2, $job['row_count']);

        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(['زيوت', 'زيوت محرك', 'فلاتر', 'فلاتر هواء'], ProductCategory::query()->orderBy('name')->pluck('name')->all());
    }

    /** @test */
    public function a_taxonomy_job_requires_its_kind_and_follows_the_products_gates(): void
    {
        $auth = $this->registerTenant();
        $tid = $auth['tenant_id'];
        $rows = [['name' => 'تويوتا']];

        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'product_taxonomy', 'file' => $this->file($rows)])->assertUnprocessable();
        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'product_taxonomy', 'file' => $this->file($rows), 'options' => ['kind' => 'product']])->assertUnprocessable();

        $viewer = $this->customRole($tid, 'tax_viewer', ['products.view'], 'v@h4.test');
        $this->upload($viewer, '/api/product-taxonomy/import/preview', ['file' => $this->file($rows), 'kind' => 'brand'])->assertForbidden();
        $this->upload($viewer, '/api/import-jobs', ['domain' => 'product_taxonomy', 'file' => $this->file($rows), 'options' => ['kind' => 'brand']])->assertForbidden();

        $manager = $this->customRole($tid, 'tax_manager', ['products.view', 'products.manage'], 'm@h4.test');
        $this->upload($manager, '/api/product-taxonomy/import/preview', ['file' => $this->file($rows), 'kind' => 'brand'])->assertOk();
        $this->upload($manager, '/api/import-jobs', ['domain' => 'product_taxonomy', 'file' => $this->file($rows), 'options' => ['kind' => 'brand']])->assertCreated();
    }

    // ═══════════════════════════════ قوالب الوحدات ═══════════════════════════════

    /** @test */
    public function unit_templates_preview_and_a_bound_file_atomic_job_create_the_templates(): void
    {
        $auth = $this->registerTenant();
        $rows = [
            ['template_name' => 'كرتون', 'base_unit' => 'قطعة', 'unit_name' => 'كرتون', 'factor' => '12'],
            ['template_name' => 'كرتون', 'base_unit' => 'قطعة', 'unit_name' => 'دزينة', 'factor' => '12'],
        ];

        $keys = array_column($this->withToken($auth['token'])->getJson('/api/unit-templates/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertSame(['template_name', 'base_unit', 'unit_name', 'factor', 'is_active'], $keys);
        $this->withToken($auth['token'])->get('/api/unit-templates/import/template')->assertOk();

        $preview = $this->upload($auth['token'], '/api/unit-templates/import/preview', ['file' => $this->file($rows)])->assertOk()->json('data');
        $this->assertSame([1, 2, 0], [$preview['create_templates'], $preview['create_units'], $preview['error_rows']]);
        $binding = $preview['binding'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, UnitTemplate::count());

        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'unit_templates', 'file' => $this->file($rows), 'options' => ['existing_policy' => 'error'], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(['قطعة', 2], [UnitTemplate::first()->base_unit, UnitTemplate::first()->units()->count()]);
    }

    /** @test */
    public function an_invalid_unit_template_file_fails_the_job_and_writes_nothing(): void
    {
        $auth = $this->registerTenant();
        $rows = [
            ['template_name' => 'سليم', 'base_unit' => 'قطعة', 'unit_name' => 'كرتون', 'factor' => '12'],
            ['template_name' => 'سيئ', 'base_unit' => 'قطعة', 'unit_name' => 'علبة', 'factor' => '1'],
        ];
        $job = $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'unit_templates', 'file' => $this->file($rows)])->assertCreated()->json('data');

        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, UnitTemplate::count());
    }

    // ═══════════════════════════════ أسعار القوائم ═══════════════════════════════

    /** @test */
    public function price_list_items_need_a_list_preview_shows_current_prices_and_a_bound_job_writes_them(): void
    {
        $auth = $this->registerTenant();
        $list = $this->priceList($auth['token']);
        $this->withToken($auth['token'])->postJson('/api/products', ['name' => 'منتج', 'sku' => 'PL-1', 'type' => 'good', 'sale_price' => 1000])->assertCreated();
        $rows = [['sku' => 'PL-1', 'price' => '25.50']];

        $this->withToken($auth['token'])->get('/api/price-lists/import/template')->assertOk();
        $keys = array_column($this->withToken($auth['token'])->getJson('/api/price-lists/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertSame(['nebrax_id', 'sku', 'unit_name', 'price'], $keys);

        $this->upload($auth['token'], '/api/price-lists/import/preview', ['file' => $this->file($rows)])->assertUnprocessable();   // القائمة إلزامية
        $preview = $this->upload($auth['token'], '/api/price-lists/import/preview', ['file' => $this->file($rows), 'price_list_id' => $list])->assertOk()->json('data');
        $this->assertSame([1, 0, $list], [$preview['create_rows'], $preview['error_rows'], $preview['price_list_id']]);
        $binding = $preview['binding'];

        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'price_list_items', 'file' => $this->file($rows)])->assertUnprocessable();
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'price_list_items', 'file' => $this->file($rows), 'options' => ['price_list_id' => $list],
            'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(2550, (int) PriceListItem::first()->price);
    }

    /** @test */
    public function another_tenants_price_list_is_refused_at_preview_and_at_job_run(): void
    {
        $a = $this->registerTenant('h4-a', 'owner@h4-a.test');
        $b = $this->registerTenant('h4-b', 'owner@h4-b.test');
        $theirs = $this->priceList($b['token'], 'قائمتهم');
        $rows = [['sku' => 'X', 'price' => '1']];

        $this->upload($a['token'], '/api/price-lists/import/preview', ['file' => $this->file($rows), 'price_list_id' => $theirs])->assertUnprocessable();

        $job = $this->upload($a['token'], '/api/import-jobs', ['domain' => 'price_list_items', 'file' => $this->file($rows), 'options' => ['price_list_id' => $theirs]])->assertCreated()->json('data');
        $this->withToken($a['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertStatus(422);
        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame(0, PriceListItem::count());
    }

    /** @test */
    public function the_price_list_gate_is_company_manage_not_the_products_gate(): void
    {
        $auth = $this->registerTenant();
        $tid = $auth['tenant_id'];
        $list = $this->priceList($auth['token']);
        $rows = [['sku' => 'X', 'price' => '1']];

        $productsManager = $this->customRole($tid, 'products_mgr', ['products.view', 'products.manage', 'invoices.view'], 'pm@h4.test');
        $this->upload($productsManager, '/api/price-lists/import/preview', ['file' => $this->file($rows), 'price_list_id' => $list])->assertForbidden();
        $this->upload($productsManager, '/api/import-jobs', ['domain' => 'price_list_items', 'file' => $this->file($rows), 'options' => ['price_list_id' => $list]])->assertForbidden();

        $companyManager = $this->customRole($tid, 'company_mgr', ['company.manage', 'invoices.view'], 'cm@h4.test');
        $this->upload($companyManager, '/api/price-lists/import/preview', ['file' => $this->file($rows), 'price_list_id' => $list])->assertOk();
        $this->upload($companyManager, '/api/import-jobs', ['domain' => 'price_list_items', 'file' => $this->file($rows), 'options' => ['price_list_id' => $list]])->assertCreated();

        $this->flushHeaders()->getJson('/api/price-lists/import/fields')->assertUnauthorized();
    }
}
