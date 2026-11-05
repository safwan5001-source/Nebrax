<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ AI API — أول تكامل عملي: كشف حساب طرف عبر الـ Public API (قراءة فقط) +
 * تدفّق وكيل خارجي كامل (بحث ← إنشاء منتج ← فاتورة مسودة ← كشف حساب).
 * تشغيل: php artisan test --filter=PublicApiPartnerStatementTest
 */
class PublicApiPartnerStatementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function key(string $tenantId, array $scopes): string
    {
        // مسارات الـ Internal تستدعي `Auth::shouldUse('sanctum')` فيبقى الحارس الافتراضي
        // sanctum لبقية العملية. في الإنتاج كل طلب عملية مستقلة (الافتراضي `web`)، فنعيد
        // الوضع الإنتاجي هنا قبل أي نداء للـ Public API ضمن الاختبار نفسه.
        $this->app['auth']->shouldUse('web');
        $this->app['auth']->forgetGuards();

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient(Tenant::findOrFail($tenantId), 'agent');

        return $service->issueKey($client, 'k', $scopes)->plainTextToken;
    }

    /** مستأجر حقيقي (دليل حسابات) بعميل وفاتورة آجلة مرحَّلة: مدين 1130 بـ 115000 هللة. */
    private function tenantWithPostedInvoice(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);

        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل الكشف', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $invoiceId = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id'   => $partnerId,
            'payment_type' => 'credit',
            'invoice_date' => '2026-03-10',
            'items'        => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk();

        return $auth + ['partner_id' => $partnerId, 'invoice_id' => $invoiceId];
    }

    private function uri(string $partnerId, string $query = ''): string
    {
        return "/api/v1/partners/{$partnerId}/statement".$query;
    }

    // ── المصادقة والـ scope ──────────────────────────────────────────

    /** @test */
    public function unauthenticated_requests_are_rejected(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $this->getJson($this->uri($s['partner_id']))->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function other_read_scopes_do_not_grant_the_statement(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['partners:read', 'invoices:read', 'products:read']);

        $this->withToken($token)->getJson($this->uri($s['partner_id']))
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function a_human_user_token_cannot_use_the_public_statement(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $this->withToken($s['token'])->getJson($this->uri($s['partner_id']))->assertStatus(401);
    }

    // ── القراءة والدقة ───────────────────────────────────────────────

    /** @test */
    public function it_returns_the_statement_in_exact_minor_units(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['statements:read']);

        $res = $this->withToken($token)->getJson($this->uri($s['partner_id']))
            ->assertOk()
            ->assertJsonPath('data.partner.id', $s['partner_id'])
            ->assertJsonPath('data.currency', 'SAR')
            ->assertJsonPath('data.opening_balance_minor', 0)
            ->assertJsonPath('data.closing_balance_minor', 115000)
            ->assertJsonCount(1, 'data.rows')
            ->assertJsonPath('data.rows.0.debit_minor', 115000)
            ->assertJsonPath('data.rows.0.credit_minor', 0)
            ->assertJsonPath('data.rows.0.balance_minor', 115000)
            ->assertJsonPath('data.rows.0.source.id', $s['invoice_id']);

        $this->assertIsInt($res->json('data.closing_balance_minor'));
        $this->assertNotEmpty($res->json('meta.request_id'));
    }

    /** @test */
    public function period_filter_rolls_earlier_movements_into_the_opening_balance(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['statements:read']);

        $this->withToken($token)->getJson($this->uri($s['partner_id'], '?from=2026-04-01'))
            ->assertOk()
            ->assertJsonPath('data.opening_balance_minor', 115000)
            ->assertJsonCount(0, 'data.rows')
            ->assertJsonPath('data.closing_balance_minor', 115000)
            ->assertJsonPath('data.from', '2026-04-01');
    }

    /** @test */
    public function invalid_filters_are_rejected_with_422(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['statements:read']);

        foreach (['?from=10/03/2026', '?from=2026-05-01&to=2026-04-01', '?role=admin'] as $query) {
            $this->withToken($token)->getJson($this->uri($s['partner_id'], $query))->assertStatus(422);
        }
    }

    /** @test */
    public function a_non_uuid_partner_id_is_not_routed(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['statements:read']);

        $this->withToken($token)->getJson('/api/v1/partners/not-a-uuid/statement')->assertStatus(404);
    }

    /** @test */
    public function the_statement_surface_is_get_only(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['statements:read', 'partners:write']);

        $this->withToken($token)->postJson($this->uri($s['partner_id']), [])->assertStatus(405);
    }

    // ── عزل المستأجر ─────────────────────────────────────────────────

    /** @test */
    public function a_foreign_tenants_partner_is_not_found_and_not_leaked(): void
    {
        $a = $this->tenantWithPostedInvoice('alpha', 'a@alpha.test');
        $b = $this->tenantWithPostedInvoice('beta', 'b@beta.test');

        $tokenB = $this->key($b['tenant_id'], ['statements:read']);

        $this->withToken($tokenB)->getJson($this->uri($a['partner_id']))
            ->assertStatus(404)
            ->assertJsonMissingPath('data');

        // وكل مستأجر يرى كشفه هو.
        $this->withToken($tokenB)->getJson($this->uri($b['partner_id']))
            ->assertOk()->assertJsonPath('data.closing_balance_minor', 115000);
    }

    // ── سقف الصفوف ───────────────────────────────────────────────────

    /** @test */
    public function an_oversized_statement_is_refused_not_truncated(): void
    {
        $s = $this->tenantWithPostedInvoice();
        $token = $this->key($s['tenant_id'], ['statements:read']);

        $row = ['date' => '2026-03-10', 'number' => 'X', 'description' => null, 'debit' => 1, 'credit' => 0, 'balance' => 1, 'source' => null];
        $fake = \Mockery::mock(ReportService::class);
        $fake->shouldReceive('partnerStatement')->once()->andReturn([
            'partner'         => ['id' => $s['partner_id'], 'name' => 'x', 'type' => 'customer'],
            'opening_balance' => 0,
            'rows'            => array_fill(0, 2001, $row),
            'closing_balance' => 2001,
        ]);
        $this->app->instance(ReportService::class, $fake);

        $this->withToken($token)->getJson($this->uri($s['partner_id']))->assertStatus(422);
    }

    // ── تدفّق الوكيل الكامل (الإثبات العملي) ─────────────────────────

    /** @test */
    public function an_external_agent_can_search_create_a_product_draft_an_invoice_and_read_the_statement(): void
    {
        $auth = $this->registerTenant('agentco', 'owner@agentco.test');
        $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'شركة النور', 'type' => 'customer'])->assertCreated();

        $token = $this->key($auth['tenant_id'], [
            'partners:read', 'products:read', 'products:write', 'invoices:write', 'invoices:read', 'statements:read',
        ]);

        // 1) بحث عن العميل
        $partner = $this->withToken($token)->getJson('/api/v1/partners?search='.urlencode('النور').'&type=customer')
            ->assertOk()->assertJsonCount(1, 'data')->json('data.0');

        // 2) إنشاء منتج (idempotent: إعادة المفتاح لا تُكرّر)
        $idem = ['Idempotency-Key' => 'agent-product-1'];
        $body = ['name' => 'منتج الوكيل', 'sku' => 'AGENT-001', 'sale_price_minor' => 10000, 'tax_rate' => 15];
        $product = $this->withToken($token)->postJson('/api/v1/products', $body, $idem)->assertStatus(201)->json('data');
        $this->withToken($token)->postJson('/api/v1/products', $body, $idem)
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');
        $this->withToken($token)->getJson('/api/v1/products?search=AGENT-001')->assertJsonCount(1, 'data');

        // 3) فاتورة مسودة — لا قيد ولا ترحيل
        $before = JournalEntry::withoutGlobalScopes()->count();
        $invoice = $this->withToken($token)->postJson('/api/v1/invoices', [
            'partner_id' => $partner['id'],
            'items'      => [['product_id' => $product['id'], 'quantity' => 2, 'unit_price_minor' => 10000, 'tax_rate' => 15]],
        ], ['Idempotency-Key' => 'agent-invoice-1'])->assertStatus(201)->assertJsonPath('data.status', 'draft')->json('data');
        $this->assertSame(23000, $invoice['total_minor']);
        $this->assertSame($before, JournalEntry::withoutGlobalScopes()->count(), 'المسودة لا تولّد قيداً.');

        // 4) كشف الحساب: المسودة لا تظهر (لا أثر دفتري)
        $this->withToken($token)->getJson("/api/v1/partners/{$partner['id']}/statement")
            ->assertOk()->assertJsonCount(0, 'data.rows')->assertJsonPath('data.closing_balance_minor', 0);
    }
}
