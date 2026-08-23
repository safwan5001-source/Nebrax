<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\PosCashMovement;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * جلسة POS وردية كاشير لجهاز ومخزن محددين. تثبت الاختبارات أن تقرير المطابقة
 * لا يعتمد على نافذة زمنية وأن الجهاز لا يصبح طريقاً لتجاوز عزل الفرع أو المخزن.
 */
class PosSessionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    /** @return array{id:string,warehouse_id:string} */
    private function device(array $auth): array
    {
        $n = ++$this->deviceSequence;
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name'      => "مخزن POS {$n}",
            'code'      => "POS-W-{$n}",
            'is_active' => true,
        ])->assertCreated()['data'];

        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name'         => "كاشير {$n}",
            'code'         => "POS-{$n}",
            'warehouse_id' => $warehouse['id'],
            'is_active'    => true,
        ])->assertCreated()['data'];

        return ['id' => $device['id'], 'warehouse_id' => $warehouse['id']];
    }

    private function openSession(array $auth, int $openingBalance = 0, ?string $deviceId = null, ?string $shiftId = null): string
    {
        $deviceId ??= $this->device($auth)['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
            'pos_device_id'  => $deviceId,
            'shift_id'       => $shiftId,
        ])->assertCreated()['data']['id'];
    }

    private function customer(string $token, string $name = 'عميل نقدي'): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'customer',
        ])['data']['id'];
    }

    private function checkout(string $token, string $partnerId, string $sessionId, int $unitPrice = 100000, ?string $warehouseId = null): void
    {
        $this->withToken($token)->postJson('/api/pos/checkout', [
            'partner_id'     => $partnerId,
            'pos_session_id' => $sessionId,
            'warehouse_id'   => $warehouseId,
            'items'          => [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            'tenders'        => ['cash' => $unitPrice + intdiv($unitPrice * 15, 100)],
        ])->assertCreated();
    }

    /** @test */
    public function it_requires_a_device_and_blocks_a_second_open_on_the_same_device(): void
    {
        $auth = $this->registerTenant();
        $device = $this->device($auth);

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 50000])
            ->assertUnprocessable()->assertJsonValidationErrors('pos_device_id');

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 50000,
            'pos_device_id'  => $device['id'],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.opening_balance', '500.00')
            ->assertJsonPath('data.pos_device_id', $device['id'])
            ->assertJsonPath('data.warehouse_id', $device['warehouse_id']);

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 10000,
            'pos_device_id'  => $device['id'],
        ])->assertStatus(422);
    }

    /** @test */
    public function it_allows_parallel_sessions_on_distinct_devices_and_snapshots_an_optional_work_shift(): void
    {
        $auth = $this->registerTenant();
        $first = $this->device($auth);
        $second = $this->device($auth);
        $shift = $this->withToken($auth['token'])->postJson('/api/shifts', [
            'name'          => 'وردية الصباح',
            'start_time'    => '08:00',
            'end_time'      => '16:00',
            'break_minutes' => 30,
            'work_days'     => [0, 1, 2, 3, 4],
            'is_active'     => true,
        ])->assertCreated()['data'];

        $a = $this->openSession($auth, 0, $first['id'], $shift['id']);
        $b = $this->openSession($auth, 0, $second['id']);

        $this->assertNotSame($a, $b);
        $this->assertDatabaseHas('pos_sessions', [
            'id'            => $a,
            'pos_device_id' => $first['id'],
            'warehouse_id'  => $first['warehouse_id'],
            'shift_id'      => $shift['id'],
            'status'        => 'open',
        ]);
        $this->assertDatabaseHas('pos_sessions', [
            'id'            => $b,
            'pos_device_id' => $second['id'],
            'warehouse_id'  => $second['warehouse_id'],
            'shift_id'      => null,
            'status'        => 'open',
        ]);
    }

    /** @test */
    public function checkout_uses_the_session_device_warehouse_and_rejects_an_override(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $device = $this->device($auth);
        $sessionId = $this->openSession($auth, 0, $device['id']);
        $otherWarehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن آخر', 'code' => 'OTHER-W', 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $partnerId = $this->customer($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerId, 'pos_session_id' => $sessionId, 'warehouse_id' => $otherWarehouse,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]], 'tenders' => ['cash' => 115000],
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());

        $this->checkout($auth['token'], $partnerId, $sessionId);
        $this->assertSame($device['warehouse_id'], Invoice::where('pos_session_id', $sessionId)->sole()->warehouse_id);
    }

    /** @test */
    public function closing_computes_expected_and_difference_from_linked_cash_receipts_without_journal_entry(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);
        $partnerId = $this->customer($auth['token']);

        $this->checkout($auth['token'], $partnerId, $id);

        $res = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 165000])
            ->assertOk();
        $this->assertSame('closed', $res['data']['status']);
        $this->assertSame('1650.00', $res['data']['expected_balance']);
        $this->assertSame('0.00', $res['data']['difference']);
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
    }

    /** @test */
    public function report_uses_only_pos_documents_linked_to_its_session(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);
        $partnerId = $this->customer($auth['token']);

        $this->checkout($auth['token'], $partnerId, $id);
        $this->checkout($auth['token'], $partnerId, $id);

        $ordinaryInvoiceId = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$ordinaryInvoiceId}/post")->assertOk();
        $this->assertNull(Invoice::findOrFail($ordinaryInvoiceId)->pos_session_id);

        $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$id}/report")
            ->assertOk()
            ->assertJsonPath('report.cash_sales', '2300.00')
            ->assertJsonPath('report.sales_count', 2)
            ->assertJsonPath('report.average', '1150.00')
            ->assertJsonPath('report.expected', '2800.00')
            ->assertJsonPath('session.status', 'open');
    }

    /** @test */
    public function another_cashier_cannot_checkout_against_someone_elses_open_session(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $otherToken = $this->tokenForRole($auth['tenant_id'], 'admin', 'cashier@acme.test');

        $this->withToken($otherToken)->postJson('/api/pos/checkout', [
            'partner_id'     => $partnerId,
            'pos_session_id' => $id,
            'items'          => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            'tenders'        => ['cash' => 115000],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::where('pos_session_id', $id)->count());
    }

    /** @test */
    public function pos_devices_and_sessions_are_isolated_by_active_branch(): void
    {
        $auth = $this->registerTenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع جهاز POS'])->assertCreated()['data']['id'];
        $headers = ['X-Branch-Id' => $other];
        $warehouseId = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => 'مخزن الفرع', 'code' => 'BRANCH-POS-W', 'branch_id' => $other, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => 'كاشير الفرع', 'code' => 'BRANCH-POS', 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/pos-devices')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($auth['token'])->withHeaders($headers)
            ->getJson('/api/pos-devices')->assertOk()->assertJsonCount(1, 'data');

        $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $deviceId,
        ])->assertCreated();

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/pos-sessions')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($auth['token'])->withHeaders($headers)
            ->getJson('/api/pos-sessions')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function drawer_movements_adjust_expected_cash_without_creating_a_journal_entry(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/cash-movements", [
            'type' => 'cash_in', 'amount' => 3000, 'reason' => 'تغذية الدرج بفكة',
        ])->assertCreated()->assertJsonPath('data.amount', '30.00');
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/cash-movements", [
            'type' => 'cash_out', 'amount' => 2000, 'reason' => 'إيداع جزئي في الخزنة',
        ])->assertCreated()->assertJsonPath('data.amount', '20.00');

        $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$id}/report")
            ->assertOk()
            ->assertJsonPath('report.cash_sales', '0.00')
            ->assertJsonPath('report.cash_in', '30.00')
            ->assertJsonPath('report.cash_out', '20.00')
            ->assertJsonPath('report.expected', '510.00');

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 51000])
            ->assertOk()
            ->assertJsonPath('data.difference', '0.00')
            ->assertJsonPath('data.difference_status', 'not_required');
        $this->assertSame(2, PosCashMovement::where('pos_session_id', $id)->count());
        $this->assertSame(0, JournalEntry::where('source_type', PosCashMovement::class)->count());
    }

    /** @test */
    public function a_drawer_movement_is_append_only_after_recording(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 1000);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/cash-movements", [
            'type' => 'cash_in', 'amount' => 100, 'reason' => 'فكة إضافية',
        ])->assertCreated();

        $movement = PosCashMovement::where('pos_session_id', $id)->sole();
        $this->expectException(\LogicException::class);
        $movement->update(['amount' => 200]);
    }

    /** @test */
    public function drawer_movement_is_limited_to_its_cashier_and_cannot_take_more_than_expected_cash(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 1000);
        $other = $this->tokenForRole($auth['tenant_id'], 'admin', 'drawer-other@acme.test');

        $this->withToken($other)->postJson("/api/pos-sessions/{$id}/cash-movements", [
            'type' => 'cash_in', 'amount' => 100, 'reason' => 'محاولة كاشير آخر',
        ])->assertStatus(422);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/cash-movements", [
            'type' => 'cash_out', 'amount' => 1001, 'reason' => 'سحب أكبر من الدرج',
        ])->assertStatus(422);
        $this->assertSame(0, PosCashMovement::where('pos_session_id', $id)->count());
    }

    /** @test */
    public function a_closing_difference_requires_manager_acknowledgement_and_keeps_an_immutable_audit_trail(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 49000])
            ->assertOk()
            ->assertJsonPath('data.difference', '-10.00')
            ->assertJsonPath('data.difference_status', 'pending');
        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $id,
            'type' => PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT,
        ]);

        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'cash-difference@acme.test');
        $this->withToken($accountant)->postJson("/api/pos-sessions/{$id}/acknowledge-difference", [
            'note' => 'فحص الفرق',
        ])->assertForbidden();

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/acknowledge-difference", [
            'note' => 'تمت مراجعة النقص مع الكاشير وإحالته للمتابعة التشغيلية.',
        ])->assertOk()
            ->assertJsonPath('data.difference_status', 'acknowledged')
            ->assertJsonPath('data.difference_acknowledgement.note', 'تمت مراجعة النقص مع الكاشير وإحالته للمتابعة التشغيلية.');

        $event = PosSessionEvent::where('pos_session_id', $id)
            ->where('type', PosSessionEvent::TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED)->sole();
        $this->expectException(\LogicException::class);
        $event->update(['type' => 'tampered']);
    }

    /** @test */
    public function an_acknowledged_difference_never_creates_a_journal_entry_or_an_automatic_settlement(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 10000);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 9000])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/acknowledge-difference", [
            'note' => 'فرق تشغيلي مسجل للمراجعة اللاحقة.',
        ])->assertOk();

        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
        $this->assertSame(0, JournalEntry::where('source_type', PosSessionEvent::class)->count());
    }

    /** @test */
    public function cash_drawer_open_endpoint_requires_the_dedicated_permission_and_audits_the_unsupported_attempt(): void
    {
        $auth = $this->registerTenant('drawer-contract', 'owner@drawer-contract.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'drawer-staff@drawer-contract.test');

        $this->withToken($staff)->postJson("/api/pos-sessions/{$id}/cash-drawer/open", [
            'reason' => 'محاولة بلا صلاحية',
        ])->assertForbidden();
        $this->assertSame(0, PosSessionEvent::where('pos_session_id', $id)
            ->where('type', PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT)->count());

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/cash-drawer/open", [
            'reason' => 'اختبار عقد الموصل غير المهيأ',
        ])->assertStatus(409)
            ->assertJsonPath('data.status', 'unsupported')
            ->assertJsonPath('data.error_code', 'cash_drawer_driver_unavailable');

        $event = PosSessionEvent::where('pos_session_id', $id)
            ->where('type', PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT)->sole();
        $this->assertSame('manual', $event->payload['mode']);
        $this->assertSame('unsupported', $event->payload['status']);
        $this->assertSame('cash_drawer_driver_unavailable', $event->payload['error_code']);
        $this->expectException(\LogicException::class);
        $event->update(['type' => 'tampered']);
    }

    /** @test */
    public function cash_drawer_open_endpoint_does_not_expose_a_session_from_another_active_branch(): void
    {
        $auth = $this->registerTenant('drawer-branch', 'owner@drawer-branch.test');
        $branch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع درج آخر'])
            ->assertCreated()['data']['id'];
        $headers = ['X-Branch-Id' => $branch];
        $warehouse = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => 'مخزن درج الفرع', 'code' => 'DRAWER-BRANCH-W', 'branch_id' => $branch, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $device = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => 'كاشير درج الفرع', 'code' => 'DRAWER-BRANCH', 'warehouse_id' => $warehouse, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $session = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device,
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/cash-drawer/open")
            ->assertNotFound();
        $this->assertSame(0, PosSessionEvent::where('pos_session_id', $session)
            ->where('type', PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT)->count());
    }

    /** @test */
    public function sessions_and_devices_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->openSession($a, 1000);

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson('/api/pos-sessions')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($b['token'])->getJson('/api/pos-devices')->assertOk()->assertJsonCount(0, 'data');
        $this->openSession($b, 2000);
    }
}
