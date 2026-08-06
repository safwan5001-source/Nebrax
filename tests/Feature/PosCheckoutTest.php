<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبار إتمام بيع نقطة البيع بوسائل متعدّدة (POST /api/pos/checkout):
 * فاتورة آجلة مرحّلة + سندات قبض توجّه كل وسيلة لحسابها الصحيح
 * (نقد→1110، بطاقة/تحويل→1120)، والذمم 1130 تصفّى بما سُدِّد.
 * تشغيل: php artisan test --filter=PosCheckoutTest
 */
class PosCheckoutTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function balance(string $code): int
    {
        $account = Account::where('code', $code)->first();
        return $account?->balance?->balance ?? 0;
    }

    /** @test */
    public function mixed_cash_and_card_routes_to_1110_and_1120_and_settles_receivables(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];

        // بيع 115.00 (100 + 15% ضريبة): نقد 50 + بطاقة 65
        $res = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'    => ['cash' => 5000, 'card' => 6500, 'transfer' => 0, 'credit' => 0],
        ])->assertCreated();

        $this->assertSame('115.00', $res['data']['total']);
        $this->assertSame('paid', $res['data']['payment_status']);

        // النقد على الصندوق، البطاقة على البنك، الذمم صفر (سُدِّدت بالكامل)
        $this->assertSame(5000, $this->balance('1110')); // الصندوق
        $this->assertSame(6500, $this->balance('1120')); // البنك
        $this->assertSame(0, $this->balance('1130'));     // العملاء
        $this->assertSame(10000, $this->balance('4110')); // إيرادات المبيعات (رصيد دائن بطبيعته)
        $this->assertSame(1500, $this->balance('2120'));  // ضريبة المخرجات (رصيد دائن بطبيعته)
    }

    /** @test */
    public function pure_cash_sale_debits_only_the_cash_account(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'    => ['cash' => 11500],
        ])->assertCreated();

        $this->assertSame(11500, $this->balance('1110'));
        $this->assertSame(0, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1130'));
    }

    /** @test */
    public function partial_credit_leaves_the_unpaid_amount_on_receivables(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];

        // 115.00: نقد 65 + آجل 50
        $res = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'    => ['cash' => 6500, 'credit' => 5000],
        ])->assertCreated();

        $this->assertSame('partial', $res['data']['payment_status']);
        $this->assertSame(6500, $this->balance('1110'));
        $this->assertSame(5000, $this->balance('1130')); // المتبقّي على الذمم
    }

    /** @test */
    public function it_isolates_references_to_the_tenant(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $b = $this->registerTenant('globex', 'owner@globex.test');
        app(TenantContext::class)->set($a['tenant_id']);
        $partnerA = $this->withToken($a['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];

        // المستأجر B لا يستطيع البيع لعميل المستأجر A
        $this->withToken($b['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerA,
            'items'      => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'    => ['cash' => 11500],
        ])->assertNotFound();
    }
}
