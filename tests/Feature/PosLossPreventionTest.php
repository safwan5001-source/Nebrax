<?php

namespace Tests\Feature;

use App\Models\PosSessionEvent;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PosLossPreventionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    /** @return array{id:string,warehouse_id:string} */
    private function device(array $auth): array
    {
        $number = ++$this->deviceSequence;
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن الرقابة {$number}", 'code' => "AUD-{$number}", 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "نقطة رقابة {$number}", 'code' => "AUD-POS-{$number}",
            'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];

        return ['id' => $device['id'], 'warehouse_id' => $warehouse['id']];
    }

    private function openPosSession(array $auth, int $opening = 0): string
    {
        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $opening, 'pos_device_id' => $this->device($auth)['id'],
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function a_cart_gets_a_server_identity_and_sensitive_removal_requires_a_structured_reason(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openPosSession($auth);
        $created = $this->withToken($auth['token'])->postJson('/api/pos/carts', [
            'pos_session_id' => $session,
            'snapshot' => ['items' => [['product_id' => null, 'quantity' => 1]], 'tax_inclusive' => false],
        ])->assertCreated()->json('data');

        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $session, 'cart_id' => $created['cart_id'], 'type' => PosSessionEvent::TYPE_CART_CREATED,
        ]);

        $this->withToken($auth['token'])->postJson("/api/pos/carts/{$created['cart_id']}/events", [
            'pos_session_id' => $session, 'type' => 'item_removed', 'item' => ['description' => 'عنصر'],
        ])->assertStatus(422);

        $this->withToken($auth['token'])->postJson("/api/pos/carts/{$created['cart_id']}/events", [
            'pos_session_id' => $session, 'type' => 'item_removed', 'reason_code' => 'other',
            'reason_note' => 'تمت إزالة صنف أضيف بالخطأ', 'before' => ['item' => ['quantity' => 1]], 'after' => ['items' => []],
        ])->assertCreated()->assertJsonPath('data.type', 'item_removed')->assertJsonPath('data.reason_code', 'other');

        $this->withToken($auth['token'])->postJson("/api/pos/carts/{$created['cart_id']}/events", [
            'pos_session_id' => $session, 'type' => 'cart_cancelled', 'reason_code' => 'customer_changed_mind',
            'before' => ['items' => []], 'after' => ['status' => 'cancelled'],
        ])->assertCreated();

        $timeline = $this->withToken($auth['token'])->getJson("/api/pos/audit/carts/{$created['cart_id']}")->assertOk();
        $this->assertCount(3, $timeline->json('data.timeline'));
        $this->assertSame('item_removed', $timeline->json('data.timeline.1.type'));
        $this->assertSame('cart_cancelled', $timeline->json('data.timeline.2.type'));
    }

    /** @test */
    public function audit_reading_is_server_scoped_to_the_active_tenant_and_branch_context(): void
    {
        $first = $this->registerTenant();
        app(TenantContext::class)->set($first['tenant_id']);
        $session = $this->openPosSession($first);
        $cart = $this->withToken($first['token'])->postJson('/api/pos/carts', ['pos_session_id' => $session])->assertCreated()->json('data.cart_id');

        $second = $this->registerTenant('second-audit-tenant', 'second-audit@example.test');
        $this->withToken($second['token'])->getJson("/api/pos/audit/carts/{$cart}")->assertNotFound();
        $this->withToken($second['token'])->getJson('/api/pos/audit/events')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function checkout_appends_start_and_completion_events_without_creating_extra_financial_documents(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openPosSession($auth);
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', ['pos_session_id' => $session])->assertCreated()->json('data.cart_id');
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل التدقيق', 'type' => 'customer'])->assertCreated()->json('data.id');

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $customer, 'pos_session_id' => $session, 'cart_id' => $cart,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]], 'tenders' => ['cash' => 115000],
        ])->assertCreated();

        $this->assertDatabaseHas('pos_session_events', ['cart_id' => $cart, 'type' => PosSessionEvent::TYPE_CHECKOUT_STARTED]);
        $this->assertDatabaseHas('pos_session_events', ['cart_id' => $cart, 'type' => PosSessionEvent::TYPE_CHECKOUT_COMPLETED]);
        $this->assertSame(2, PosSessionEvent::where('cart_id', $cart)->whereIn('type', [PosSessionEvent::TYPE_CHECKOUT_STARTED, PosSessionEvent::TYPE_CHECKOUT_COMPLETED])->count());
    }

    /** @test */
    public function sensitive_events_cannot_be_updated_or_deleted_after_being_written(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openPosSession($auth);
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', ['pos_session_id' => $session])->assertCreated()->json('data.cart_id');
        $eventId = $this->withToken($auth['token'])->postJson("/api/pos/carts/{$cart}/events", [
            'pos_session_id' => $session, 'type' => 'item_removed', 'reason_code' => 'wrong_scan',
            'before' => ['item' => ['product_id' => 'known-product', 'quantity' => 1]], 'after' => ['items' => []],
        ])->assertCreated()->json('data.id');
        $event = PosSessionEvent::findOrFail($eventId);

        try { $event->update(['reason_note' => 'محاولة تعديل']); $this->fail('حدث POS يجب أن يرفض update.'); }
        catch (\LogicException) { $this->assertDatabaseHas('pos_session_events', ['id' => $eventId, 'reason_note' => null]); }
        try { $event->delete(); $this->fail('حدث POS يجب أن يرفض delete.'); }
        catch (\LogicException) { $this->assertDatabaseHas('pos_session_events', ['id' => $eventId]); }
    }

    /** @test */
    public function a_user_without_the_audit_view_permission_cannot_read_the_audit_api(): void
    {
        $auth = $this->registerTenant();
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-audit@example.test');

        $this->withToken($staffToken)->getJson('/api/pos/audit/events')->assertForbidden();
    }

    /** @test */
    public function approval_records_distinct_performer_and_approver_without_relying_on_a_role_name(): void
    {
        $owner = $this->registerTenant();
        app(TenantContext::class)->set($owner['tenant_id']);
        $device = $this->device($owner);
        $requesterToken = $this->tokenForRole($owner['tenant_id'], 'accountant', 'requester-audit@example.test');
        $approverToken = $this->tokenForRole($owner['tenant_id'], 'admin', 'approver-audit@example.test');
        $this->withToken($owner['token'])->putJson('/api/sales-config/pos', ['data' => ['audit_operation_policies' => [
            'item_remove' => 'approval_required', 'price_override' => 'allowed', 'discount_change' => 'allowed', 'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
        ]]] )->assertOk();
        $session = $this->withToken($requesterToken)->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $device['id']])->assertCreated()->json('data.id');
        $cart = $this->withToken($requesterToken)->postJson('/api/pos/carts', ['pos_session_id' => $session])->assertCreated()->json('data.cart_id');
        $approval = $this->withToken($requesterToken)->postJson('/api/pos/approval-requests', [
            'pos_session_id' => $session, 'cart_id' => $cart, 'operation' => 'item_remove', 'reason_code' => 'wrong_scan',
        ])->assertCreated()->json('data');
        $this->withToken($approverToken)->postJson("/api/pos/audit/approvals/{$approval['id']}/approve")->assertOk();
        $this->withToken($requesterToken)->postJson("/api/pos/carts/{$cart}/events", [
            'pos_session_id' => $session, 'type' => 'item_removed', 'approval_id' => $approval['id'], 'reason_code' => 'wrong_scan',
            'before' => ['item' => ['quantity' => 1]], 'after' => ['items' => []],
        ])->assertCreated();
        $event = PosSessionEvent::where('cart_id', $cart)->where('type', 'item_removed')->sole();
        $this->assertNotNull($event->performed_by);
        $this->assertNotNull($event->approved_by);
        $this->assertNotSame($event->performed_by, $event->approved_by);
    }

    /** @test */
    public function blind_close_locks_the_count_before_revealing_the_expected_cash_and_keeps_both_events(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['blind_cash_count_enabled' => true, 'audit_operation_policies' => [
                'item_remove' => 'allowed', 'price_override' => 'allowed', 'discount_change' => 'allowed', 'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
            ]],
        ])->assertOk();
        $session = $this->openPosSession($auth, 50000);

        $closed = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/close", ['closing_balance' => 50000])
            ->assertOk()->assertJsonPath('data.closing_balance', '500.00')->assertJsonPath('data.expected_balance', '500.00');
        $this->assertSame('closed', $closed->json('data.status'));
        $this->assertDatabaseHas('pos_sessions', ['id' => $session]);
        $this->assertNotNull(\App\Models\PosSession::findOrFail($session)->counted_balance_locked_at);
        $this->assertNotNull(\App\Models\PosSession::findOrFail($session)->closing_count_revealed_at);
        $this->assertDatabaseHas('pos_session_events', ['pos_session_id' => $session, 'type' => PosSessionEvent::TYPE_CLOSING_COUNT_SUBMITTED]);
        $this->assertDatabaseHas('pos_session_events', ['pos_session_id' => $session, 'type' => PosSessionEvent::TYPE_CLOSING_COUNT_REVEALED]);
    }
}
