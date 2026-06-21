<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات endpoints التقارير التفصيلية عبر API (كشف الأستاذ + الأعمار).
 * تشغيل:  php artisan test --filter=ApiReportsTest
 */
class ApiReportsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function reports_require_authentication(): void
    {
        $this->getJson('/api/reports/aging/receivable')->assertUnauthorized();
    }

    /** @test */
    public function account_ledger_endpoint_returns_running_balance_in_riyal(): void
    {
        $token = $this->registerTenant()['token'];

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])['data']['id'];

        $invoiceId = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];
        $this->withToken($token)->postJson("/api/invoices/{$invoiceId}/post")->assertOk();

        // معرّف حساب الصندوق 1110 من قائمة الحسابات
        $accounts = $this->withToken($token)->getJson('/api/accounts')->assertOk()['data'];
        $cashId = collect($accounts)->firstWhere('code', '1110')['id'];

        $res = $this->withToken($token)->getJson("/api/reports/account-ledger/{$cashId}")->assertOk();

        $this->assertSame('1110', $res['account']['code']);
        $this->assertCount(1, $res['rows']);
        $this->assertSame('1150.00', $res['rows'][0]['debit']);
        $this->assertSame('1150.00', $res['rows'][0]['balance']);
        $this->assertSame('1150.00', $res['closing_balance']);
    }

    /** @test */
    public function aging_endpoint_returns_buckets(): void
    {
        $token = $this->registerTenant()['token'];

        $res = $this->withToken($token)->getJson('/api/reports/aging/receivable')->assertOk();
        $res->assertJsonStructure(['type', 'as_of', 'rows', 'totals' => ['b0_30', 'b31_60', 'b61_90', 'b90_plus', 'total']]);
        $this->assertSame('receivable', $res['type']);
    }

    /** @test */
    public function invalid_aging_type_returns_404(): void
    {
        $token = $this->registerTenant()['token'];

        $this->withToken($token)->getJson('/api/reports/aging/foo')->assertNotFound();
    }
}
