<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PosDevice;
use App\Models\PosSessionEvent;
use App\Models\Tenant;
use App\Services\Pos\Hardware\LocalBridgeCashDrawerAdapter;
use App\Support\PosSettings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Tests\TestCase;

class CashDrawerBridgeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function deviceAndSession(array $auth): array
    {
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن جسر الدرج', 'code' => 'DRAWER-BRIDGE-W', 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => 'كاشير الجسر', 'code' => 'DRAWER-BRIDGE', 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $session = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()['data'];

        return [$device, $session, $warehouse];
    }

    private function configureBridge(array $auth, string $deviceId): string
    {
        $secret = str_repeat('s', 48);
        $device = PosDevice::findOrFail($deviceId);
        $device->update(['cash_drawer_config' => [
            'bridge_url' => 'http://127.0.0.1:17463',
            'pairing_secret' => Crypt::encryptString($secret),
            'printer_identifier' => 'Test ESC/POS',
            'drawer_channel' => 0,
            'pulse_on_ms' => 120,
            'pulse_off_ms' => 240,
            'paired_at' => now()->toIso8601String(),
        ]]);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $settings = $tenant->settings ?? [];
        $settings['sales_config']['pos'] = array_merge($settings['sales_config']['pos'] ?? [], [
            'cash_drawer_enabled' => true,
            'cash_drawer_driver' => PosSettings::CASH_DRAWER_DRIVER_LOCAL_BRIDGE,
            'cash_drawer_auto_open_after_cash' => true,
        ]);
        $tenant->update(['settings' => $settings]);

        return $secret;
    }

    private function receipt(array $action, string $secret, string $status, ?string $errorCode = null): array
    {
        $requestId = 'receipt-'.bin2hex(random_bytes(6));
        $canonical = implode('|', [
            $action['action_id'],
            $action['bridge']['request']['device_id'],
            $status,
            $errorCode ?? '',
            $requestId,
        ]);

        return [
            'ok' => $status === 'opened',
            'status' => $status,
            'error_code' => $errorCode,
            'device' => 'Test ESC/POS',
            'request_id' => $requestId,
            'receipt' => hash_hmac('sha256', $canonical, $secret),
        ];
    }

    /** @test */
    public function manual_open_requires_a_signed_bridge_receipt_before_reporting_opened(): void
    {
        $auth = $this->registerTenant('cash-drawer-bridge', 'owner@cash-drawer-bridge.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        [$device, $session] = $this->deviceAndSession($auth);
        $secret = $this->configureBridge($auth, $device['id']);

        $action = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session['id']}/cash-drawer/open", [
            'reason' => 'اختبار فتح فعلي',
        ])->assertStatus(202)->assertJsonPath('data.status', 'pending')['data'];
        $this->assertSame('http://127.0.0.1:17463/v1/cash-drawer/open', $action['bridge']['url']);
        $this->assertSame(1, PosSessionEvent::where('pos_session_id', $session['id'])->where('type', PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT)->count());

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session['id']}/cash-drawer/complete", [
            'action_id' => $action['action_id'],
            'result' => $this->receipt($action, $secret, 'opened'),
        ])->assertOk()->assertJsonPath('data.status', 'opened');
        $this->assertSame(2, PosSessionEvent::where('pos_session_id', $session['id'])->where('type', PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT)->count());
    }

    /** @test */
    public function forged_opened_result_is_rejected_and_audited_without_fake_success(): void
    {
        $auth = $this->registerTenant('cash-drawer-forged', 'owner@cash-drawer-forged.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        [$device, $session] = $this->deviceAndSession($auth);
        $this->configureBridge($auth, $device['id']);
        $action = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session['id']}/cash-drawer/open")
            ->assertStatus(202)['data'];

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session['id']}/cash-drawer/complete", [
            'action_id' => $action['action_id'],
            'result' => ['status' => 'opened', 'error_code' => null, 'device' => 'forged', 'request_id' => 'forged', 'receipt' => 'not-valid'],
        ])->assertStatus(409)->assertJsonPath('data.status', 'permission_denied');
        $event = PosSessionEvent::where('pos_session_id', $session['id'])->latest('created_at')->firstOrFail();
        $this->assertSame('permission_denied', $event->payload['status']);
        $this->assertSame('cash_drawer_bridge_receipt_invalid', $event->payload['error_code']);
    }

    /** @test */
    public function auto_open_is_queued_after_cash_checkout_and_bridge_failure_never_rolls_back_the_sale(): void
    {
        $auth = $this->registerTenant('cash-drawer-auto', 'owner@cash-drawer-auto.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        [$device, $session, $warehouse] = $this->deviceAndSession($auth);
        $secret = $this->configureBridge($auth, $device['id']);
        $partner = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل الدرج', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $checkout = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            'partner_id' => $partner,
            'pos_session_id' => $session['id'],
            'warehouse_id' => $warehouse['id'],
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 115000],
        ])->assertCreated()->assertJsonPath('cash_drawer_action.status', 'pending');
        $action = $checkout['cash_drawer_action'];
        $invoiceId = $checkout['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session['id']}/cash-drawer/complete", [
            'action_id' => $action['action_id'],
            'result' => $this->receipt($action, $secret, 'printer_unavailable', 'printer_write_failed'),
        ])->assertStatus(409)->assertJsonPath('data.status', 'printer_unavailable');

        $this->assertSame('posted', Invoice::findOrFail($invoiceId)->status);
        $this->assertSame(1, Payment::where('invoice_id', $invoiceId)->where('status', 'posted')->count());
        $event = PosSessionEvent::where('pos_session_id', $session['id'])->latest('created_at')->firstOrFail();
        $this->assertSame('automatic', $event->payload['mode']);
        $this->assertSame($invoiceId, $event->payload['invoice_id']);
        $this->assertSame('printer_unavailable', $event->payload['status']);
    }

    /** @test */
    public function local_bridge_adapter_never_accepts_a_non_local_url(): void
    {
        $auth = $this->registerTenant('cash-drawer-url', 'owner@cash-drawer-url.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        [$device, $session] = $this->deviceAndSession($auth);
        $this->configureBridge($auth, $device['id']);
        PosDevice::findOrFail($device['id'])->update(['cash_drawer_config' => [
            'bridge_url' => 'http://192.168.1.50:17463',
            'pairing_secret' => Crypt::encryptString(str_repeat('s', 48)),
        ]]);

        $result = (new LocalBridgeCashDrawerAdapter())->open(\App\Models\PosSession::findOrFail($session['id'])->load('posDevice'), []);
        $this->assertSame('not_configured', $result['status']);
        $this->assertSame('cash_drawer_bridge_not_paired', $result['error_code']);
    }
}
