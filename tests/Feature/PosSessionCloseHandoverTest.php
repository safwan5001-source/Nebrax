<?php

namespace Tests\Feature;

use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\PosSessionReconciliation;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class PosSessionCloseHandoverTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    private function device(string $token): string
    {
        $n = ++$this->sequence;
        $warehouse = $this->withToken($token)->postJson('/api/warehouses', [
            'name' => "مخزن تسليم {$n}", 'code' => "HANDOVER-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data'];

        return $this->withToken($token)->postJson('/api/pos-devices', [
            'name' => "جهاز تسليم {$n}", 'code' => "HANDOVER-D-{$n}",
            'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data']['id'];
    }

    private function open(string $token, string $deviceId, int $opening = 0): string
    {
        return $this->withToken($token)->postJson('/api/pos-sessions/open', [
            'opening_balance' => $opening,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];
    }

    /** @return array{cash:array,bank:array} */
    private function methods(string $token): array
    {
        $methods = $this->withToken($token)->getJson('/api/payment-methods')->assertOk()['data'];
        $byType = collect($methods)->keyBy('settlement_type');

        return ['cash' => $byType->get('cash'), 'bank' => $byType->get('bank')];
    }

    /** @test */
    public function one_cashier_cannot_open_sessions_on_two_devices_while_another_cashier_can(): void
    {
        $auth = $this->registerTenant('pos-one-session', 'owner@pos-one-session.test');
        $first = $this->device($auth['token']);
        $second = $this->device($auth['token']);
        $this->open($auth['token'], $first);

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $second,
        ])->assertUnprocessable();

        $other = $this->tokenForRole($auth['tenant_id'], 'admin', 'cashier-two@pos-one-session.test');
        $this->open($other, $second);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(2, PosSession::where('status', 'open')->count());
    }

    /** @test */
    public function close_snapshots_cash_and_non_cash_counts_then_waits_for_handover(): void
    {
        $auth = $this->registerTenant('pos-handover', 'owner@pos-handover.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->open($auth['token'], $this->device($auth['token']), 5000);
        $partner = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل تسليم', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $methods = $this->methods($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partner,
            'pos_session_id' => $sessionId,
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => [
                ['payment_method_id' => $methods['cash']['id'], 'amount' => 5000],
                ['payment_method_id' => $methods['bank']['id'], 'amount' => 6500],
            ],
        ])->assertCreated();

        $preview = $this->withToken($auth['token'])
            ->getJson("/api/pos-sessions/{$sessionId}/closing-preview")
            ->assertOk()
            ->assertJsonPath('data.cash_drawer.expected_amount', '100.00')
            ->assertJsonPath('data.payment_methods.0.payment_method_id', $methods['bank']['id'])['data'];

        $this->assertSame('65.00', $preview['payment_methods'][0]['expected_amount']);

        $closed = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/close", [
            'closing_balance' => 10000,
            'payment_counts' => [[
                'payment_method_id' => $methods['bank']['id'],
                'counted_amount' => 6400,
            ]],
            'handover_note' => 'تم تسليم النقد وإيصال الشبكة.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.handover_status', 'pending');

        $this->assertCount(2, $closed['data']['reconciliations']);
        $bank = PosSessionReconciliation::where('payment_method_id', $methods['bank']['id'])->sole();
        $this->assertSame(6500, $bank->expected_amount);
        $this->assertSame(6400, $bank->counted_amount);
        $this->assertSame(-100, $bank->difference);
        $this->assertSame('operator', $bank->count_source);
        $this->assertSame(1, PosSessionEvent::where('pos_session_id', $sessionId)
            ->where('type', PosSessionEvent::TYPE_SESSION_HANDOVER_SUBMITTED)->count());
    }

    /** @test */
    public function handover_requires_a_second_authorized_user_and_a_resolved_cash_variance(): void
    {
        $auth = $this->registerTenant('pos-handover-control', 'owner@pos-handover-control.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->open($auth['token'], $this->device($auth['token']), 5000);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/close", [
            'closing_balance' => 4900,
        ])->assertOk()->assertJsonPath('data.difference_status', 'pending');

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/confirm-handover", [
            'note' => 'استلام ذاتي غير مسموح.',
        ])->assertUnprocessable();

        $receiver = $this->tokenForRole($auth['tenant_id'], 'admin', 'receiver@pos-handover-control.test');
        $this->withToken($receiver)->postJson("/api/pos-sessions/{$sessionId}/confirm-handover", [
            'note' => 'استلام قبل اعتماد الفرق.',
        ])->assertUnprocessable();

        $this->withToken($receiver)->postJson("/api/pos-sessions/{$sessionId}/acknowledge-difference", [
            'note' => 'تم التحقق من عجز ريال واحد.',
        ])->assertOk();

        $this->withToken($receiver)->postJson("/api/pos-sessions/{$sessionId}/confirm-handover", [
            'note' => 'تم استلام العهدة والمستندات.',
        ])->assertOk()
            ->assertJsonPath('data.handover_status', 'confirmed')
            ->assertJsonPath('data.handover_receiver.name', 'admin');

        $session = PosSession::findOrFail($sessionId);
        $this->assertNotNull($session->handover_confirmed_at);
        $this->assertSame(1, PosSessionEvent::where('pos_session_id', $sessionId)
            ->where('type', PosSessionEvent::TYPE_SESSION_HANDOVER_CONFIRMED)->count());
    }

    /** @test */
    public function session_detail_returns_the_branch_scoped_operational_snapshot(): void
    {
        $auth = $this->registerTenant('pos-session-detail', 'owner@pos-session-detail.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->open($auth['token'], $this->device($auth['token']), 5000);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/close", [
            'closing_balance' => 5000,
            'handover_note' => 'تم تسليم عهدة المطابقة كاملة.',
        ])->assertOk();

        $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$sessionId}")
            ->assertOk()
            ->assertJsonPath('data.id', $sessionId)
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.handover_status', 'pending')
            ->assertJsonPath('data.difference_status', 'not_required')
            ->assertJsonPath('data.handover_note', 'تم تسليم عهدة المطابقة كاملة.')
            ->assertJsonPath('data.reconciliations.0.reconciliation_key', 'cash_drawer')
            ->assertJsonPath('data.reconciliations.0.expected_amount', '50.00')
            ->assertJsonPath('data.reconciliations.0.counted_amount', '50.00');

        $other = $this->registerTenant('pos-session-detail-other', 'owner@pos-session-detail-other.test');
        $this->withToken($other['token'])->getJson("/api/pos-sessions/{$sessionId}")->assertNotFound();
    }
}
