<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\PosCashMovement;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Services\Accounting\CashBankAccountService;
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
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
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
    public function it_allows_parallel_sessions_for_distinct_cashiers_and_devices_and_snapshots_an_optional_work_shift(): void
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
        $otherToken = $this->tokenForRole($auth['tenant_id'], 'admin', 'parallel-cashier@acme.test');
        $b = $this->openSession(['token' => $otherToken], 0, $second['id']);

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
    public function session_register_filters_are_validated_and_applied_inside_the_active_branch(): void
    {
        $auth = $this->registerTenant('pos-register-filters', 'owner@pos-register-filters.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $firstDevice = $this->device($auth);
        $secondDevice = $this->device($auth);
        $firstShift = $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية الصباح', 'code' => 'MORNING', 'is_active' => true,
        ])->assertCreated()['data'];
        $secondShift = $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية المساء', 'code' => 'EVENING', 'is_active' => true,
        ])->assertCreated()['data'];

        $closedId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $firstDevice['id'],
            'pos_shift_id' => $firstShift['id'],
        ])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$closedId}/close", [
            'closing_balance' => 0,
        ])->assertOk();
        PosSession::findOrFail($closedId)->forceFill(['opened_at' => '2026-08-15 08:00:00'])->save();

        $openId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $secondDevice['id'],
            'pos_shift_id' => $secondShift['id'],
        ])->assertCreated()['data']['id'];
        PosSession::findOrFail($openId)->forceFill(['opened_at' => '2026-09-01 16:00:00'])->save();

        $query = http_build_query([
            'status' => 'closed',
            'pos_device_id' => $firstDevice['id'],
            'pos_shift_id' => $firstShift['id'],
            'date_from' => '2026-08-01',
            'date_to' => '2026-08-31',
        ]);
        $this->withToken($auth['token'])->getJson("/api/pos-sessions?{$query}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $closedId)
            ->assertJsonCount(2, 'meta.filters.devices')
            ->assertJsonCount(2, 'meta.filters.shifts');

        $this->withToken($auth['token'])->getJson('/api/pos-sessions?status=open')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $openId);
        $this->withToken($auth['token'])->getJson('/api/pos-sessions?status=unknown')->assertUnprocessable();
        $this->withToken($auth['token'])->getJson('/api/pos-sessions?date_from=2026-09-02&date_to=2026-09-01')->assertUnprocessable();
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
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
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

        $sessionInvoiceIds = Invoice::where('pos_session_id', $id)->orderBy('created_at')->pluck('id')->all();

        $response = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$id}/report")
            ->assertOk()
            ->assertJsonPath('report.cash_sales', '2300.00')
            ->assertJsonPath('report.sales_count', 2)
            ->assertJsonPath('report.average', '1150.00')
            ->assertJsonPath('report.expected', '2800.00')
            ->assertJsonCount(2, 'sales')
            ->assertJsonPath('session.status', 'open');

        $this->assertSame($sessionInvoiceIds, collect($response->json('sales'))->pluck('id')->all());
        $this->assertNotContains($ordinaryInvoiceId, collect($response->json('sales'))->pluck('id')->all());
        $this->assertSame(['1150.00', '1150.00'], collect($response->json('sales'))->pluck('total')->all());
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
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
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
        $mainBranch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
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

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $mainBranch])
            ->postJson("/api/pos-sessions/{$session}/cash-drawer/open")
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

    /** @test */
    public function blind_count_does_not_expose_or_settle_expected_cash_before_the_count_is_locked(): void
    {
        $auth = $this->registerTenant('pos-blind-gate', 'owner@pos-blind-gate.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['blind_cash_count_enabled' => true, 'audit_operation_policies' => [
                'item_remove' => 'allowed', 'price_override' => 'allowed', 'discount_change' => 'allowed', 'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
            ]],
        ])->assertOk();

        $id = $this->openSession($auth, 50000);
        $open = PosSession::findOrFail($id);
        $this->assertNull($open->expected_balance);
        $this->assertNull($open->counted_balance_locked_at);
        $this->assertNull($open->closing_count_revealed_at);

        // لا يتيح مسار التسوية إظهار المتوقّع أو إنشاء أثر محاسبي قبل تثبيت العد وإغلاق الجلسة.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertStatus(422);
        $open->refresh();
        $this->assertNull($open->expected_balance);
        $this->assertNull($open->variance_journal_entry_id);
        $this->assertSame(0, PosSessionEvent::where('pos_session_id', $id)
            ->where('type', PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED)->count());

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 48000])
            ->assertOk()
            ->assertJsonPath('data.expected_balance', '500.00');
        $closed = PosSession::findOrFail($id);
        $this->assertNotNull($closed->counted_balance_locked_at);
        $this->assertNotNull($closed->closing_count_revealed_at);
    }

    /** @test */
    public function blind_recount_remains_approval_gated_and_a_settlement_locks_the_recount_basis_once(): void
    {
        $owner = $this->registerTenant('pos-blind-recount', 'owner@pos-blind-recount.test');
        app(TenantContext::class)->set($owner['tenant_id']);
        $requester = $this->tokenForRole($owner['tenant_id'], 'accountant', 'recount-requester@pos-blind-recount.test');
        $approver = $this->tokenForRole($owner['tenant_id'], 'admin', 'recount-approver@pos-blind-recount.test');
        $this->withToken($owner['token'])->putJson('/api/sales-config/pos', [
            'data' => ['blind_cash_count_enabled' => true, 'audit_operation_policies' => [
                'item_remove' => 'allowed', 'price_override' => 'allowed', 'discount_change' => 'allowed', 'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
            ]],
        ])->assertOk();

        $device = $this->device($owner);
        $id = $this->withToken($requester)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 50000, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');
        $this->withToken($requester)->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 48000])->assertOk();

        $approval = $this->withToken($requester)->postJson('/api/pos/approval-requests', [
            'pos_session_id' => $id,
            'operation' => 'cash_recount',
            'reason_code' => 'other',
            'reason_note' => 'تدقيق يدوي ثانٍ لعد النقد.',
        ])->assertCreated()->json('data');
        $this->withToken($approver)->postJson("/api/pos/audit/approvals/{$approval['id']}/approve")->assertOk();

        $this->withToken($requester)->postJson("/api/pos-sessions/{$id}/recount", [
            'closing_balance' => 49000,
            'approval_id' => $approval['id'],
        ])->assertOk()
            ->assertJsonPath('data.closing_balance', '490.00')
            ->assertJsonPath('data.expected_balance', '500.00')
            ->assertJsonPath('data.difference', '-10.00')
            ->assertJsonPath('data.difference_status', 'pending');

        $recounted = PosSession::findOrFail($id);
        $this->assertSame(49000, (int) $recounted->closing_balance);
        $this->assertSame(-1000, (int) $recounted->difference);
        $this->assertNotNull($recounted->recounted_at);
        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $id,
            'type' => PosSessionEvent::TYPE_CLOSING_COUNT_RECOUNTED,
        ]);

        $this->withToken($owner['token'])->postJson("/api/pos-sessions/{$id}/acknowledge-difference", [
            'note' => 'اعتماد فرق العد المعاد قبل التسوية.',
        ])->assertOk();
        $this->withToken($owner['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertOk();

        $settled = PosSessionEvent::where('pos_session_id', $id)
            ->where('type', PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED)
            ->sole();
        $this->assertSame('server', $settled->payload['provenance']['source'] ?? null);
        $this->assertSame('server_authoritative', $settled->payload['provenance']['trust_level'] ?? null);
        $this->assertSame(1, JournalEntry::where('source_type', PosSession::class)->where('source_id', $id)->count());

        // القيد المرحّل يجعل أساسه ثابتاً: لا يعاد العد بعد التسوية ولا ينشأ قيد ثانٍ.
        $this->withToken($requester)->postJson("/api/pos-sessions/{$id}/recount", [
            'closing_balance' => 50000,
            'approval_id' => $approval['id'],
        ])->assertStatus(422);
        $this->assertSame(1, JournalEntry::where('source_type', PosSession::class)->where('source_id', $id)->count());
    }

    /** يغلق جلسة برصيد معدود ثم يعتمد الفرق؛ يعيد معرّف الجلسة الجاهزة للتسوية. */
    private function closedAcknowledgedSession(array $auth, int $opening, int $counted): string
    {
        $id = $this->openSession($auth, $opening);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => $counted])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/acknowledge-difference", [
            'note' => 'اعتماد الفرق قبل التسوية المحاسبية.',
        ])->assertOk();

        return $id;
    }

    /** @return array{account_id:string,debit:int,credit:int}[] */
    private function varianceEntryLines(string $sessionId): array
    {
        $entry = JournalEntry::where('source_type', PosSession::class)->where('source_id', $sessionId)->sole();

        return JournalLine::where('journal_entry_id', $entry->id)
            ->get(['account_id', 'debit', 'credit'])
            ->map(fn (JournalLine $line) => ['account_id' => $line->account_id, 'debit' => (int) $line->debit, 'credit' => (int) $line->credit])
            ->all();
    }

    /** @test */
    public function settling_a_shortage_debits_the_variance_account_and_credits_cash_in_one_balanced_entry(): void
    {
        $auth = $this->registerTenant('pos-shortage', 'owner@pos-shortage.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        // متوقّع 500.00، معدود 480.00 ⇒ عجز 20.00 (2000 هللة).
        $id = $this->closedAcknowledgedSession($auth, 50000, 48000);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")
            ->assertOk()
            ->assertJsonPath('data.variance_type', 'shortage')
            ->assertJsonPath('data.difference', '-20.00');

        $session = PosSession::findOrFail($id);
        $this->assertNotNull($session->variance_journal_entry_id);

        $varianceAccountId = Account::where('code', '5170')->value('id');
        // التسوية تضرب خزينة الجلسة المثبّتة، لا حساباً عاماً. في الإعداد الافتراضي
        // خزينة وسيلة النقد هي الخزينة الرئيسية (1110).
        $cashAccountId = $session->cash_account_id;
        $this->assertNotNull($cashAccountId);
        $this->assertSame(app(CashBankAccountService::class)->resolveForPayment(null, 'cash')->account_id, $cashAccountId);

        $lines = $this->varianceEntryLines($id);
        $this->assertSame(2000, collect($lines)->sum('debit'));
        $this->assertSame(2000, collect($lines)->sum('credit'));
        $variance = collect($lines)->firstWhere('account_id', $varianceAccountId);
        $cash = collect($lines)->firstWhere('account_id', $cashAccountId);
        $this->assertSame(['debit' => 2000, 'credit' => 0], ['debit' => $variance['debit'], 'credit' => $variance['credit']]);
        $this->assertSame(['debit' => 0, 'credit' => 2000], ['debit' => $cash['debit'], 'credit' => $cash['credit']]);

        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $id,
            'type' => PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED,
        ]);
    }

    /** @test */
    public function settling_an_overage_debits_cash_and_credits_the_variance_account(): void
    {
        $auth = $this->registerTenant('pos-overage', 'owner@pos-overage.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        // متوقّع 500.00، معدود 515.00 ⇒ فائض 15.00 (1500 هللة).
        $id = $this->closedAcknowledgedSession($auth, 50000, 51500);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")
            ->assertOk()
            ->assertJsonPath('data.variance_type', 'overage')
            ->assertJsonPath('data.difference', '15.00');

        $varianceAccountId = Account::where('code', '5170')->value('id');
        $cashAccountId = PosSession::findOrFail($id)->cash_account_id;

        $lines = $this->varianceEntryLines($id);
        $this->assertSame(1500, collect($lines)->sum('debit'));
        $this->assertSame(1500, collect($lines)->sum('credit'));
        $variance = collect($lines)->firstWhere('account_id', $varianceAccountId);
        $cash = collect($lines)->firstWhere('account_id', $cashAccountId);
        $this->assertSame(['debit' => 0, 'credit' => 1500], ['debit' => $variance['debit'], 'credit' => $variance['credit']]);
        $this->assertSame(['debit' => 1500, 'credit' => 0], ['debit' => $cash['debit'], 'credit' => $cash['credit']]);
    }

    /** @test */
    public function variance_settlement_is_idempotent_and_posts_exactly_one_journal_entry(): void
    {
        $auth = $this->registerTenant('pos-idem', 'owner@pos-idem.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->closedAcknowledgedSession($auth, 50000, 48000);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertOk();
        // إعادة الطلب (تحديث/إعادة إرسال) لا تُنشئ قيداً ثانياً.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertStatus(422);

        $this->assertSame(1, JournalEntry::where('source_type', PosSession::class)->where('source_id', $id)->count());
    }

    /** @test */
    public function settlement_requires_a_prior_acknowledgement_and_the_approval_permission(): void
    {
        $auth = $this->registerTenant('pos-gate', 'owner@pos-gate.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 48000])->assertOk();

        // قبل الاعتماد: التسوية مرفوضة ولا تُنشئ قيداً.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertStatus(422);
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());

        // كاشير بلا صلاحية الاعتماد لا يستطيع التسوية مباشرةً عبر المسار.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/acknowledge-difference", [
            'note' => 'اعتماد قبل اختبار الصلاحية.',
        ])->assertOk();
        $staff = $this->tokenForRole($auth['tenant_id'], 'accountant', 'settle-staff@pos-gate.test');
        $this->withToken($staff)->postJson("/api/pos-sessions/{$id}/settle-variance")->assertForbidden();
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
    }

    /** @test */
    public function a_missing_variance_account_blocks_settlement_cleanly_without_a_partial_journal(): void
    {
        $auth = $this->registerTenant('pos-noacct', 'owner@pos-noacct.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->closedAcknowledgedSession($auth, 50000, 48000);

        // محاكاة تهيئة محاسبية ناقصة: تعطيل حساب فروق الصندوق.
        Account::where('code', '5170')->update(['is_active' => false]);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertStatus(422);
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
        $this->assertNull(PosSession::findOrFail($id)->variance_journal_entry_id);
        // الجلسة تبقى معتمدة قابلة للتسوية بعد إصلاح الحساب — لا حالة تالفة.
        $this->assertSame('acknowledged', PosSession::findOrFail($id)->difference_status);
    }

    /** @test */
    public function a_zero_variance_session_cannot_be_settled_and_settlement_respects_tenant_isolation(): void
    {
        $auth = $this->registerTenant('pos-zero', 'owner@pos-zero.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 50000])
            ->assertOk()->assertJsonPath('data.difference', '0.00')->assertJsonPath('data.difference_status', 'not_required');
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertStatus(422);
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());

        // مستأجر آخر لا يرى الجلسة ولا يسوّي فرقها.
        $other = $this->registerTenant('pos-other', 'owner@pos-other.test');
        $this->withToken($other['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertNotFound();
    }

    /** @return array{id:string,account_id:string} خزينة نقدية مسمّاة تحت مجموعة الخزائن. */
    private function namedCashTreasury(array $auth, string $name): array
    {
        return $this->withToken($auth['token'])->postJson('/api/cash-bank-accounts', [
            'type' => 'cash', 'name' => $name, 'currency' => 'SAR',
            'deposit_scope' => 'all', 'withdraw_scope' => 'all',
        ])->assertCreated()->json('data');
    }

    /** يوجّه وسيلة النقد الافتراضية إلى خزينة محددة، فتصير خزينة نقد POS. */
    private function pointCashMethodToTreasury(array $auth, string $cashBankAccountId): void
    {
        $methods = $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk()['data'];
        $cash = collect($methods)->firstWhere('settlement_type', 'cash');
        $this->withToken($auth['token'])->putJson("/api/payment-methods/{$cash['id']}", [
            'name' => $cash['name'],
            'settlement_type' => 'cash',
            'cash_bank_account_id' => $cashBankAccountId,
            'is_active' => true,
            'is_default' => true,
        ])->assertOk();
    }

    /** @test */
    public function settlement_hits_the_actual_session_treasury_not_the_main_cashbox_when_they_differ(): void
    {
        $auth = $this->registerTenant('pos-treasury', 'owner@pos-treasury.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $mainCashAccountId = app(CashBankAccountService::class)->resolveForPayment(null, 'cash')->account_id;

        // خزينة نقد ثانية (غير رئيسية) هي خزينة وسيلة النقد فعلياً.
        $treasury = $this->namedCashTreasury($auth, 'خزينة المعرض');
        $this->assertNotSame($mainCashAccountId, $treasury['account_id']);
        $this->pointCashMethodToTreasury($auth, $treasury['id']);

        $id = $this->closedAcknowledgedSession($auth, 50000, 48000); // عجز 2000
        $session = PosSession::findOrFail($id);
        // الجلسة تثبّت خزينتها الفعلية عند الفتح، لا الرئيسية العامة.
        $this->assertSame($treasury['account_id'], $session->cash_account_id);
        $this->assertNotSame($mainCashAccountId, $session->cash_account_id);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertOk();

        $lines = $this->varianceEntryLines($id);
        $treasuryLine = collect($lines)->firstWhere('account_id', $treasury['account_id']);
        $this->assertSame(['debit' => 0, 'credit' => 2000], ['debit' => $treasuryLine['debit'], 'credit' => $treasuryLine['credit']]);
        // لا سطر على الخزينة الرئيسية إطلاقاً.
        $this->assertNull(collect($lines)->firstWhere('account_id', $mainCashAccountId));
    }

    /** @test */
    public function the_session_treasury_is_frozen_at_opening_and_two_sessions_bind_to_their_own_treasuries(): void
    {
        $auth = $this->registerTenant('pos-drift', 'owner@pos-drift.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $treasuryA = $this->namedCashTreasury($auth, 'خزينة أ');
        $this->pointCashMethodToTreasury($auth, $treasuryA['id']);
        $first = $this->closedAcknowledgedSession($auth, 50000, 48000); // عجز 2000 على خزينة أ

        // انجراف: تُغيَّر خزينة وسيلة النقد إلى خزينة ب بعد فتح الجلسة الأولى.
        $treasuryB = $this->namedCashTreasury($auth, 'خزينة ب');
        $this->pointCashMethodToTreasury($auth, $treasuryB['id']);
        $second = $this->closedAcknowledgedSession($auth, 50000, 51000); // فائض 1000 على خزينة ب

        $this->assertSame($treasuryA['account_id'], PosSession::findOrFail($first)->cash_account_id);
        $this->assertSame($treasuryB['account_id'], PosSession::findOrFail($second)->cash_account_id);

        // تسوية الجلسة الأولى تبقى على خزينة أ رغم تغيّر خزينة الطريقة — لا انجراف.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$first}/settle-variance")->assertOk();
        $firstLines = $this->varianceEntryLines($first);
        $this->assertSame(2000, collect($firstLines)->firstWhere('account_id', $treasuryA['account_id'])['credit']);
        $this->assertNull(collect($firstLines)->firstWhere('account_id', $treasuryB['account_id']));

        // تسوية الجلسة الثانية تضرب خزينة ب.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$second}/settle-variance")->assertOk();
        $secondLines = $this->varianceEntryLines($second);
        $this->assertSame(1000, collect($secondLines)->firstWhere('account_id', $treasuryB['account_id'])['debit']);
    }

    /** @test */
    public function a_legacy_session_without_a_bound_treasury_blocks_settlement_cleanly(): void
    {
        $auth = $this->registerTenant('pos-legacy-treasury', 'owner@pos-legacy-treasury.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->closedAcknowledgedSession($auth, 50000, 48000);

        // محاكاة جلسة سابقة للهجرة لا تحمل خزينة مثبتة.
        PosSession::whereKey($id)->update(['cash_account_id' => null]);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/settle-variance")->assertStatus(422);
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
        $this->assertNull(PosSession::findOrFail($id)->variance_journal_entry_id);
    }
}
