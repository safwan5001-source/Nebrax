<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\PosSession;
use App\Tenancy\TenantContext;
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

    /** @test */
    public function recent_pos_invoices_require_invoice_management_and_enforce_branch_order_and_limit(): void
    {
        $auth = $this->registerTenant('recent-pos-scope', 'owner@recent-pos-scope.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $mainBranch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'recent-pos-staff@test.local');
        $this->withToken($staff)->getJson('/api/pos/recent-invoices')->assertForbidden();

        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن حد الفواتير', 'code' => 'RECENT-LIMIT-W', 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => 'كاشير الحد', 'code' => 'RECENT-LIMIT-1', 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $session = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()['data'];
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل الترتيب', 'type' => 'customer',
        ])->assertCreated()['data'];

        $checkout = function (string $description) use ($auth, $customer, $session, $warehouse): array {
            return $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
                'partner_id' => $customer['id'], 'pos_session_id' => $session['id'], 'warehouse_id' => $warehouse['id'],
                'items' => [['description' => $description, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
                'tenders' => ['cash' => 11500],
            ])->assertCreated()['data'];
        };
        $older = $checkout('بيع أقدم');
        $newer = $checkout('بيع أحدث');
        Invoice::whereKey($older['id'])->update(['invoice_date' => now()->subDay()->toDateString(), 'created_at' => now()->subDay()]);
        Invoice::whereKey($newer['id'])->update(['invoice_date' => now()->toDateString(), 'created_at' => now()]);

        $this->withToken($auth['token'])->getJson('/api/pos/recent-invoices?limit=1')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $newer['id']);
        $this->withToken($auth['token'])->getJson('/api/pos/recent-invoices?limit=0')->assertUnprocessable();
        $this->withToken($auth['token'])->getJson('/api/pos/recent-invoices?limit=51')->assertUnprocessable();

        // رقم جلسة الاختبار الثاني يحتاج تمييزاً صريحاً؛ قيد الرقم الحالي
        // على مستوى المستأجر وليس الفرع، وهذا الاختبار لا يغيّر مولد الإنتاج.
        PosSession::whereKey($session['id'])->update(['number' => 'POS-RECENT-MAIN-001']);

        $otherBranch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع فواتير آخر'])
            ->assertCreated()['data']['id'];
        $headers = ['X-Branch-Id' => $otherBranch];
        $otherWarehouse = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => 'مخزن الفرع الآخر', 'code' => 'RECENT-BRANCH-W', 'branch_id' => $otherBranch, 'is_active' => true,
        ])->assertCreated()['data'];
        $otherDevice = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => 'كاشير الفرع الآخر', 'code' => 'RECENT-BRANCH-1', 'warehouse_id' => $otherWarehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $otherSession = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $otherDevice['id'],
        ])->assertCreated()['data'];
        $otherInvoice = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos/checkout', [
            'partner_id' => $customer['id'], 'pos_session_id' => $otherSession['id'], 'warehouse_id' => $otherWarehouse['id'],
            'items' => [['description' => 'بيع فرع آخر', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 11500],
        ])->assertCreated()['data'];

        $mainIds = collect($this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $mainBranch])
            ->getJson('/api/pos/recent-invoices?limit=20')->assertOk()['data'])
            ->pluck('id')->all();
        $this->assertNotContains($otherInvoice['id'], $mainIds);
        $this->assertContains($newer['id'], $mainIds);
    }
}
