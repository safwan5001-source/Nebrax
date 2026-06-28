<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\PosSession;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات جلسات نقطة البيع (فتح/إغلاق). تشغيلي — لا قيود محاسبية.
 * تشغيل: php artisan test --filter=PosSessionTest
 */
class PosSessionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_opens_a_session_and_blocks_a_second_open(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 50000])
            ->assertCreated()->assertJsonPath('data.status', 'open')->assertJsonPath('data.opening_balance', '500.00');

        // لا يمكن فتح جلسة ثانية بينما واحدة مفتوحة
        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 10000])
            ->assertStatus(422);
    }

    /** @test */
    public function closing_computes_expected_and_difference_without_journal_entry(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $id = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 50000])
            ->assertCreated()['data']['id'];

        // بيع نقدي مرحّل خلال الجلسة عبر POS (فاتورة نقدية)
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];
        $invId = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$invId}/post")->assertOk();

        // إغلاق بمعدود 165,000 هللة (افتتاحي 50,000 + مبيعات 115,000 = متوقع)؛ الفرق 0
        $res = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 165000])
            ->assertOk();
        $this->assertSame('closed', $res['data']['status']);
        $this->assertSame('1650.00', $res['data']['expected_balance']);
        $this->assertSame('0.00', $res['data']['difference']);

        // الجلسة لا تولّد قيداً محاسبياً
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
    }

    /** @test */
    public function sessions_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 1000])->assertCreated();

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson('/api/pos-sessions')->assertOk()->assertJsonCount(0, 'data');
        // المستأجر B يستطيع فتح جلسته (عزل تام)
        $this->withToken($b['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 2000])->assertCreated();
    }
}
