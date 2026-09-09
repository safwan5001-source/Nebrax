<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * API contract للغة مستند فاتورة المشتريات — PR-LANG-2. نفس عقد
 * `InvoiceDocumentLanguageApiTest` حرفياً، بلا نقطة نهاية أو إعداد جديد
 * (`document-display-settings` مشترك بين كل أنواع المستندات).
 */
class PurchaseDocumentLanguageApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /**
     * ملاحظة: `registerTenant` تمرّ عبر `POST /api/register`، وهو يزرع دليل
     * الحسابات تلقائياً (`ChartOfAccountsSeeder::seed()` داخل معاملة الإنشاء).
     * فلا نُعيد الزرع هنا — تكراره يكسر الفريد `(tenant_id, code)` على `accounts`.
     */
    private function bootstrapTenant(string $slug = 'purchase-lang-api'): array
    {
        $out = $this->registerTenant($slug, "owner+{$slug}@acme.test");
        $tenantId = $out['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $product = Product::create([
            'name' => 'صنف', 'type' => 'good', 'track_inventory' => true,
            'purchase_price' => 10000, 'sale_price' => 15000, 'tax_rate' => 15,
        ]);

        return [
            'token' => $out['token'],
            'tenant_id' => $tenantId,
            'supplier_id' => $supplier->id,
            'product_id' => $product->id,
        ];
    }

    /** @test */
    public function store_accepts_language_enum_and_resource_exposes_all_three_fields(): void
    {
        ['token' => $token, 'supplier_id' => $supplierId, 'product_id' => $productId] = $this->bootstrapTenant();

        $res = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'language' => 'en',
            'items' => [[
                'product_id' => $productId,
                'quantity' => 1,
                'unit_price' => 10000,
                'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $data = $res->json('data');
        $this->assertSame('en', $data['language']);
        $this->assertNull($data['language_frozen']);
        $this->assertSame('en', $data['language_effective']);
    }

    /** @test */
    public function store_rejects_unknown_language_value(): void
    {
        ['token' => $token, 'supplier_id' => $supplierId, 'product_id' => $productId] = $this->bootstrapTenant();

        $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'language' => 'fr',
            'items' => [[
                'product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertStatus(422);
    }

    /** @test */
    public function omitting_language_and_no_tenant_default_yields_effective_ar(): void
    {
        ['token' => $token, 'supplier_id' => $supplierId, 'product_id' => $productId] = $this->bootstrapTenant();

        $res = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();

        $data = $res->json('data');
        $this->assertNull($data['language']);
        $this->assertNull($data['language_frozen']);
        $this->assertSame('ar', $data['language_effective']);
    }

    /** @test */
    public function tenant_default_flows_into_effective_when_draft_language_is_null(): void
    {
        ['token' => $token, 'supplier_id' => $supplierId, 'product_id' => $productId, 'tenant_id' => $tenantId] = $this->bootstrapTenant();

        // ضبط الافتراضي عبر endpoint إعدادات المستندات المشترك — نفس المسار
        // المكشوف للفواتير، بلا endpoint جديد خاص بالمشتريات.
        $this->withToken($token)->putJson('/api/document-display-settings', [
            'default_language' => 'bilingual',
        ])->assertOk();

        app(TenantContext::class)->set($tenantId);

        $res = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('bilingual', $res->json('data.language_effective'));
    }

    /** @test */
    public function posting_freezes_the_effective_language_and_update_after_post_is_rejected(): void
    {
        ['token' => $token, 'supplier_id' => $supplierId, 'product_id' => $productId] = $this->bootstrapTenant();

        $created = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'language' => 'bilingual',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data');

        $posted = $this->withToken($token)->postJson("/api/purchases/{$created['id']}/post")
            ->assertOk()->json('data');

        $this->assertSame('bilingual', $posted['language_frozen']);
        $this->assertSame('bilingual', $posted['language_effective']);

        // المرحّلة لا تُعدَّل — `PurchaseService::update` يرفضها، فلا مسار
        // يغيّر `language_frozen` بعد الترحيل.
        $this->withToken($token)->putJson("/api/purchases/{$created['id']}", [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'language' => 'ar',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertStatus(422);
    }

    /** @test */
    public function duplicate_does_not_carry_forward_language_from_a_posted_purchase(): void
    {
        ['token' => $token, 'supplier_id' => $supplierId, 'product_id' => $productId] = $this->bootstrapTenant();

        $created = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'payment_type' => 'credit',
            'language' => 'en',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data');

        $this->withToken($token)->postJson("/api/purchases/{$created['id']}/post")->assertOk();

        $duplicate = $this->withToken($token)->postJson("/api/purchases/{$created['id']}/duplicate")
            ->assertCreated()->json('data');

        $this->assertNull($duplicate['language']);
        $this->assertNull($duplicate['language_frozen']);
        $this->assertSame('ar', $duplicate['language_effective']);
    }

    /** @test */
    public function a_purchase_from_one_tenant_cannot_be_read_or_reused_by_another(): void
    {
        ['token' => $tokenA, 'supplier_id' => $supplierA, 'product_id' => $productA] = $this->bootstrapTenant('lang-tenant-a');
        ['token' => $tokenB] = $this->bootstrapTenant('lang-tenant-b');

        $created = $this->withToken($tokenA)->postJson('/api/purchases', [
            'partner_id' => $supplierA,
            'payment_type' => 'credit',
            'language' => 'en',
            'items' => [['product_id' => $productA, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data');

        // عزل المستأجر: عميل مستأجر آخر لا يرى فاتورة مشتريات B — 404 لا 403،
        // فلا يتسرّب حتى وجود المعرّف عبر الحدود.
        $this->withToken($tokenB)->getJson("/api/purchases/{$created['id']}")->assertStatus(404);
    }

    /** @test */
    public function tenant_default_language_is_never_read_from_another_tenant(): void
    {
        ['token' => $tokenA] = $this->bootstrapTenant('lang-default-a');
        ['token' => $tokenB, 'supplier_id' => $supplierB, 'product_id' => $productB, 'tenant_id' => $tenantB] = $this->bootstrapTenant('lang-default-b');

        // مستأجر A يضبط افتراضيه على bilingual — يجب ألا يتسرّب إلى B.
        $this->withToken($tokenA)->putJson('/api/document-display-settings', [
            'default_language' => 'bilingual',
        ])->assertOk();

        app(TenantContext::class)->set($tenantB);

        $res = $this->withToken($tokenB)->postJson('/api/purchases', [
            'partner_id' => $supplierB,
            'payment_type' => 'credit',
            'items' => [['product_id' => $productB, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('ar', $res->json('data.language_effective'));
    }
}
