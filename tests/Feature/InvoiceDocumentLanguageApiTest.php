<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * API contract للغة مستند الفاتورة — Request rules، Resource shape، وعزل RBAC.
 */
class InvoiceDocumentLanguageApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function bootstrapTenant(string $slug = 'lang-api'): array
    {
        $out = $this->registerTenant($slug, "owner+{$slug}@acme.test");
        $tenantId = $out['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        app(ChartOfAccountsSeeder::class)->seed($tenantId);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        return ['token' => $out['token'], 'tenant_id' => $tenantId, 'customer_id' => $customer->id];
    }

    /** @test */
    public function store_accepts_language_enum_and_resource_exposes_all_three_fields(): void
    {
        ['token' => $token, 'customer_id' => $customerId] = $this->bootstrapTenant();

        $res = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'zatca_document_type' => 'standard',
            'payment_type' => 'cash',
            'language' => 'en',
            'items' => [[
                'quantity' => 1,
                'unit_price' => 100000,
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
        ['token' => $token, 'customer_id' => $customerId] = $this->bootstrapTenant();

        $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'zatca_document_type' => 'standard',
            'payment_type' => 'cash',
            'language' => 'fr',
            'items' => [[
                'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15,
            ]],
        ])->assertStatus(422);
    }

    /** @test */
    public function omitting_language_and_no_tenant_default_yields_effective_ar(): void
    {
        ['token' => $token, 'customer_id' => $customerId] = $this->bootstrapTenant();

        $res = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'zatca_document_type' => 'standard',
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $data = $res->json('data');
        $this->assertNull($data['language']);
        $this->assertNull($data['language_frozen']);
        $this->assertSame('ar', $data['language_effective']);
    }

    /** @test */
    public function tenant_default_flows_into_effective_when_draft_language_is_null(): void
    {
        ['token' => $token, 'customer_id' => $customerId, 'tenant_id' => $tenantId] = $this->bootstrapTenant();

        // ضبط الافتراضي عبر endpoint إعدادات المستندات — نفس المسار المكشوف للعميل.
        $this->withToken($token)->putJson('/api/document-display-settings', [
            'default_language' => 'bilingual',
        ])->assertOk();

        app(TenantContext::class)->set($tenantId);

        $res = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'zatca_document_type' => 'standard',
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('bilingual', $res->json('data.language_effective'));
    }

    /** @test */
    public function display_settings_endpoint_shows_supported_languages_and_current_default(): void
    {
        ['token' => $token] = $this->bootstrapTenant();

        $res = $this->withToken($token)->getJson('/api/document-display-settings')->assertOk();
        $data = $res->json('data');
        $this->assertNull($data['default_language']);
        $this->assertSame(['ar', 'en', 'bilingual'], $data['available_languages']);
    }

    /** @test */
    public function display_settings_endpoint_rejects_unknown_language(): void
    {
        ['token' => $token] = $this->bootstrapTenant();

        $this->withToken($token)->putJson('/api/document-display-settings', [
            'default_language' => 'fr',
        ])->assertStatus(422);
    }
}
