<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** آخر فواتير POS: استعلام محدود خادمياً ومقيد بسياق المستأجر. */
class PosRecentInvoicesTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function recent_pos_invoices_are_limited_to_pos_sales_and_the_current_tenant(): void
    {
        $auth = $this->registerTenant('recent-pos', 'recent-pos@nibras.test');
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن الكاشير', 'code' => 'RECENT-W', 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => 'كاشير الاختبار', 'code' => 'RECENT-1', 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $session = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()['data'];
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل آخر الفواتير', 'type' => 'customer',
        ])->assertCreated()['data'];

        $checkout = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $customer['id'],
            'pos_session_id' => $session['id'],
            'warehouse_id' => $warehouse['id'],
            'items' => [[
                'description' => 'بيع POS تجريبي', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            ]],
            'tenders' => ['cash' => 11500],
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->getJson('/api/pos/recent-invoices?limit=20')
            ->assertOk()
            ->assertJsonPath('data.0.id', $checkout['id'])
            ->assertJsonPath('data.0.number', $checkout['number'])
            ->assertJsonPath('data.0.customer_name', 'عميل آخر الفواتير');

        $other = $this->registerTenant('recent-pos-other', 'recent-pos-other@nibras.test');
        $this->withToken($other['token'])->getJson('/api/pos/recent-invoices?limit=20')
            ->assertOk()->assertJsonCount(0, 'data');
    }
}
