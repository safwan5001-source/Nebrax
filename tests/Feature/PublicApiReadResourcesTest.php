<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-3: موارد الـ Public API القرائية (Partners · Products · Invoices).
 * يغطّي: المصادقة، الـ scopes، عزل المستأجر، الاستحقاق، العقود، التقسيم/الفرز/
 * التصفية، دقّة النقود، واستبعاد الحقول الحسّاسة.
 * تشغيل: php artisan test --filter=PublicApiReadResourcesTest
 */
class PublicApiReadResourcesTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, partner: Partner, product: Product, invoice: Invoice} */
    private function seedTenant(string $slug, ?\Closure $tenantTweak = null): array
    {
        $tenant = Tenant::create(['name' => $slug, 'slug' => $slug.'-'.Str::random(6)]);
        if ($tenantTweak) {
            $tenantTweak($tenant);
        }

        app(TenantContext::class)->set($tenant->id);

        $partner = Partner::create([
            'code' => 'C-'.Str::random(5), 'type' => 'customer', 'entity_type' => 'commercial',
            'name' => "عميل {$slug}", 'name_en' => "Client {$slug}", 'vat_number' => '300000000000003',
            'email' => "c@{$slug}.test", 'is_active' => true,
        ]);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'barcode' => '628'.random_int(1000000, 9999999),
            'name' => "منتج {$slug}", 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 132250, 'tax_rate' => 15, 'is_active' => true,
        ]);
        $invoice = Invoice::create([
            'number' => 'INV-'.strtoupper(Str::random(6)), 'partner_id' => $partner->id,
            'type' => 'sale', 'payment_type' => 'cash', 'status' => 'posted',
            'invoice_date' => now()->toDateString(),
            'subtotal' => 115000, 'tax_amount' => 17250, 'total' => 132250, 'paid_amount' => 0,
            'payment_status' => 'unpaid',
        ]);
        InvoiceLine::create([
            'invoice_id' => $invoice->id, 'product_id' => $product->id,
            'product_name_snapshot' => $product->name, 'product_sku_snapshot' => $product->sku,
            'product_barcode_snapshot' => $product->barcode, 'description' => 'بند',
            'quantity' => 1, 'unit_name' => 'piece', 'unit_price' => 115000, 'tax_rate' => 15,
            'line_subtotal' => 115000, 'line_discount' => 0, 'line_tax' => 17250, 'line_total' => 132250,
        ]);

        app(TenantContext::class)->forget();

        return compact('tenant', 'partner', 'product', 'invoice');
    }

    private function key(Tenant $tenant, array $scopes): string
    {
        $client = $this->service()->createClient($tenant, 'integration');

        return $this->service()->issueKey($client, 'k', $scopes)->plainTextToken;
    }

    // ── Authentication ────────────────────────────────────────────────

    /** @test */
    public function no_api_key_is_denied(): void
    {
        $this->seedTenant('a');
        $this->getJson('/api/v1/partners')->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function a_human_user_token_is_denied(): void
    {
        $user = $this->registerTenant('internal', 'u@internal.test');
        $this->withToken($user['token'])->getJson('/api/v1/partners')
            ->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function a_valid_api_key_reads_each_resource(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['partners:read', 'products:read', 'invoices:read']);

        $this->withToken($token)->getJson('/api/v1/partners')->assertOk();
        $this->withToken($token)->getJson('/api/v1/products')->assertOk();
        $this->withToken($token)->getJson('/api/v1/invoices')->assertOk();
    }

    // ── Scopes ────────────────────────────────────────────────────────

    /** @test */
    public function each_resource_requires_its_exact_scope(): void
    {
        $s = $this->seedTenant('a');
        $partnersOnly = $this->key($s['tenant'], ['partners:read']);

        $this->withToken($partnersOnly)->getJson('/api/v1/partners')->assertOk();
        $this->withToken($partnersOnly)->getJson('/api/v1/products')
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
        $this->withToken($partnersOnly)->getJson('/api/v1/invoices')
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function a_products_scope_cannot_read_invoices(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['products:read']);

        $this->withToken($token)->getJson('/api/v1/products')->assertOk();
        $this->withToken($token)->getJson('/api/v1/invoices')
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
    }

    // ── Tenant isolation ──────────────────────────────────────────────

    /** @test */
    public function lists_never_return_another_tenants_records(): void
    {
        $a = $this->seedTenant('alpha');
        $b = $this->seedTenant('beta');
        $token = $this->key($a['tenant'], ['partners:read', 'products:read', 'invoices:read']);

        $partners = $this->withToken($token)->getJson('/api/v1/partners')->assertOk()->json('data');
        $this->assertCount(1, $partners);
        $this->assertSame($a['partner']->id, $partners[0]['id']);

        $invoices = $this->withToken($token)->getJson('/api/v1/invoices')->assertOk()->json('data');
        $this->assertCount(1, $invoices);
        $this->assertSame($a['invoice']->id, $invoices[0]['id']);
    }

    /** @test */
    public function detail_cannot_retrieve_another_tenants_record(): void
    {
        $a = $this->seedTenant('alpha');
        $b = $this->seedTenant('beta');
        $token = $this->key($a['tenant'], ['partners:read', 'products:read', 'invoices:read']);

        $this->withToken($token)->getJson("/api/v1/partners/{$b['partner']->id}")
            ->assertStatus(404)->assertJsonPath('error.code', 'not_found');
        $this->withToken($token)->getJson("/api/v1/products/{$b['product']->id}")
            ->assertStatus(404)->assertJsonPath('error.code', 'not_found');
        $this->withToken($token)->getJson("/api/v1/invoices/{$b['invoice']->id}")
            ->assertStatus(404)->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function spoofed_tenant_in_header_or_query_cannot_switch_context(): void
    {
        $a = $this->seedTenant('alpha');
        $b = $this->seedTenant('beta');
        $token = $this->key($a['tenant'], ['partners:read']);

        // ترويسة
        $data = $this->withToken($token)->withHeaders(['X-Tenant-Id' => $b['tenant']->id])
            ->getJson('/api/v1/partners')->assertOk()->json('data');
        $this->assertCount(1, $data);
        $this->assertSame($a['partner']->id, $data[0]['id']);

        // معامل استعلام
        $data = $this->withToken($token)->getJson('/api/v1/partners?tenant_id='.$b['tenant']->id)
            ->assertOk()->json('data');
        $this->assertSame($a['partner']->id, $data[0]['id']);
    }

    // ── Entitlement (active subscription) ─────────────────────────────

    /** @test */
    public function a_scope_without_an_active_subscription_is_denied(): void
    {
        // اشتراك منتهٍ (تجربة ماضية) + مستأجر نشط → EnsureActiveSubscription يرفض.
        $s = $this->seedTenant('expired', fn (Tenant $t) => $t->forceFill([
            'trial_ends_at' => now()->subDay(),
        ])->save());
        $token = $this->key($s['tenant'], ['partners:read']);

        $this->withToken($token)->getJson('/api/v1/partners')
            ->assertStatus(403)->assertJsonPath('error.code', 'forbidden');
    }

    // ── Contracts + sensitive fields ──────────────────────────────────

    /** @test */
    public function list_envelope_carries_data_and_pagination_meta_with_request_id(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['partners:read']);

        $res = $this->withToken($token)->withHeaders(['X-Request-Id' => 'req_abc12345'])->getJson('/api/v1/partners');
        $res->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'code', 'type', 'name', 'is_active']],
                'meta' => ['request_id', 'pagination' => ['page', 'per_page', 'total', 'last_page', 'has_more']],
            ])
            ->assertJsonPath('meta.request_id', 'req_abc12345')
            ->assertHeader('X-Request-Id', 'req_abc12345');
    }

    /** @test */
    public function invoice_contract_excludes_zatca_ledger_and_internal_fields(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['invoices:read']);

        $body = $this->withToken($token)->getJson("/api/v1/invoices/{$s['invoice']->id}")->assertOk()->getContent();

        foreach (['zatca', 'journal_entry_id', 'cogs_entry_id', 'branch_id', 'warehouse_id',
                  'template_revision', 'zatca_qr', 'zatca_hash', 'zatca_uuid', 'zatca_icv', 'cash_account_id'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, "الفاتورة العامة يجب ألّا تكشف: {$needle}");
        }

        // تحتوي السطور المُنتقاة وحقول الملخّص.
        $this->withToken($token)->getJson("/api/v1/invoices/{$s['invoice']->id}")
            ->assertJsonStructure(['data' => ['id', 'number', 'status', 'total_minor', 'currency',
                'lines' => [['product_id', 'quantity', 'line_total_minor']]], 'meta' => ['request_id']]);
    }

    /** @test */
    public function product_contract_excludes_cost_and_inventory_internals(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['products:read']);

        $body = $this->withToken($token)->getJson("/api/v1/products/{$s['product']->id}")->assertOk()->getContent();
        foreach (['avg_cost', 'purchase_price', 'quantity_on_hand', 'cogs_account_id', 'sales_account_id',
                  'min_sale_price', 'profit_margin', 'internal_notes'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, "المنتج العام يجب ألّا يكشف: {$needle}");
        }
    }

    /** @test */
    public function partner_contract_excludes_credit_policy(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['partners:read']);
        $body = $this->withToken($token)->getJson("/api/v1/partners/{$s['partner']->id}")->assertOk()->getContent();
        foreach (['credit_limit', 'credit_period', 'classification_id'] as $needle) {
            $this->assertStringNotContainsString($needle, $body);
        }
    }

    /** @test */
    public function not_found_uses_the_stable_error_contract(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['partners:read']);
        $this->withToken($token)->getJson('/api/v1/partners/'.Str::uuid())
            ->assertStatus(404)
            ->assertJsonStructure(['error' => ['code', 'message'], 'meta' => ['request_id']])
            ->assertJsonPath('error.code', 'not_found');
    }

    // ── Pagination / sorting / filtering ──────────────────────────────

    /** @test */
    public function pagination_is_bounded_and_reports_metadata(): void
    {
        $tenant = Tenant::create(['name' => 'p', 'slug' => 'p-'.Str::random(6)]);
        app(TenantContext::class)->set($tenant->id);
        foreach (range(1, 3) as $i) {
            Partner::create(['code' => "P{$i}", 'type' => 'customer', 'name' => "عميل {$i}", 'is_active' => true]);
        }
        app(TenantContext::class)->forget();
        $token = $this->key($tenant, ['partners:read']);

        $res = $this->withToken($token)->getJson('/api/v1/partners?per_page=2')->assertOk();
        $this->assertCount(2, $res->json('data'));
        $this->assertSame(3, $res->json('meta.pagination.total'));
        $this->assertSame(2, $res->json('meta.pagination.per_page'));
        $this->assertTrue($res->json('meta.pagination.has_more'));
    }

    /** @test */
    public function per_page_above_the_maximum_is_rejected(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['partners:read']);
        $this->withToken($token)->getJson('/api/v1/partners?per_page=1000')
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
    }

    /** @test */
    public function an_unsupported_sort_field_is_rejected_not_passed_to_sql(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['products:read']);
        $this->withToken($token)->getJson('/api/v1/products?sort=avg_cost')
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
    }

    /** @test */
    public function allowed_filters_and_sorting_work_deterministically(): void
    {
        $tenant = Tenant::create(['name' => 'f', 'slug' => 'f-'.Str::random(6)]);
        app(TenantContext::class)->set($tenant->id);
        Product::create(['sku' => 'B', 'name' => 'Banana', 'type' => 'good', 'sale_price' => 200, 'tax_rate' => 15, 'is_active' => true]);
        Product::create(['sku' => 'A', 'name' => 'Apple', 'type' => 'service', 'sale_price' => 100, 'tax_rate' => 15, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $token = $this->key($tenant, ['products:read']);

        // فرز بالاسم تصاعديًا
        $names = collect($this->withToken($token)->getJson('/api/v1/products?sort=name')->assertOk()->json('data'))
            ->pluck('name')->all();
        $this->assertSame(['Apple', 'Banana'], $names);

        // تصفية بالنوع
        $filtered = $this->withToken($token)->getJson('/api/v1/products?type=service')->assertOk()->json('data');
        $this->assertCount(1, $filtered);
        $this->assertSame('Apple', $filtered[0]['name']);
    }

    // ── Money precision ───────────────────────────────────────────────

    /** @test */
    public function money_is_exposed_as_exact_integer_minor_units_with_currency(): void
    {
        $s = $this->seedTenant('a');
        $token = $this->key($s['tenant'], ['products:read', 'invoices:read']);

        $product = $this->withToken($token)->getJson("/api/v1/products/{$s['product']->id}")->assertOk();
        $this->assertSame(132250, $product->json('data.sale_price_minor'));
        $this->assertIsInt($product->json('data.sale_price_minor'));
        $this->assertSame('SAR', $product->json('data.currency'));

        $invoice = $this->withToken($token)->getJson("/api/v1/invoices/{$s['invoice']->id}")->assertOk();
        $this->assertSame(132250, $invoice->json('data.total_minor'));
        $this->assertSame(115000, $invoice->json('data.lines.0.unit_price_minor'));
        $this->assertIsInt($invoice->json('data.total_minor'));
    }

    // ── Regression ────────────────────────────────────────────────────

    /** @test */
    public function health_endpoint_remains_public_and_safe(): void
    {
        $this->getJson('/api/v1/health')->assertOk()->assertJsonPath('data.status', 'ok');
    }
}
