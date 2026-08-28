<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\Invoice;
use App\Models\PosCashMovement;
use App\Models\PosException;
use App\Models\PosInvestigationCase;
use App\Models\PosLpDigest;
use App\Models\PosOverrideApproval;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Role;
use App\Models\Shift;
use App\Models\User;
use App\Services\Pos\PosExceptionDetectionService;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 4 — جودة الدليل، الضبط الوقائي، الاستثناءات الحتمية، وطابور الانتباه.
 * لا يولّد هذا الملف قيداً محاسبياً جديداً من تلقاء نفسه؛ مسارات المرتجع/الصرف
 * القائمة تُستدعى كما هي للتحقّق من البوابة فقط.
 */
class PosLossPreventionPhase4Test extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    private int $sessionSequence = 0;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** @return array{id:string,warehouse_id:string} */
    private function device(array $auth): array
    {
        $n = ++$this->deviceSequence;
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن ف4 {$n}", 'code' => "P4-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير ف4 {$n}", 'code' => "P4-POS-{$n}",
            'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];

        return ['id' => $device['id'], 'warehouse_id' => $warehouse['id']];
    }

    private function openSession(array $auth, int $opening = 0): string
    {
        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $opening, 'pos_device_id' => $this->device($auth)['id'],
        ])->assertCreated()['data']['id'];
    }

    private function owner(array $auth): User
    {
        app(TenantContext::class)->set($auth['tenant_id']);

        return User::query()->where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->firstOrFail();
    }

    private function roleToken(string $tenantId, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        $role = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'p4-' . Str::random(6),
            'name' => 'دور ف4', 'permissions' => $permissions, 'is_system' => false,
        ]);
        $user = User::create([
            'tenant_id' => $tenantId, 'name' => 'مستخدم ف4', 'email' => $email,
            'password' => 'password123', 'role' => $role->slug,
        ]);

        return $user->createToken('api')->plainTextToken;
    }

    private function cashier(string $tenantId, string $email): User
    {
        app(TenantContext::class)->set($tenantId);

        return User::create([
            'tenant_id' => $tenantId, 'name' => 'كاشير ف4 ' . Str::random(4),
            'email' => $email, 'password' => 'password123', 'role' => 'staff',
        ]);
    }

    private function posSession(string $tenantId, string $ownerId, ?string $branchId = null): PosSession
    {
        $openedAt = Carbon::now()->subDays(1);

        return PosSession::create([
            'tenant_id' => $tenantId, 'branch_id' => $branchId,
            'number' => 'POS-P4-' . (++$this->sessionSequence),
            'status' => 'closed', 'opening_balance' => 0,
            'opened_at' => $openedAt, 'closed_at' => $openedAt->copy()->addHours(8),
            'opened_by' => $ownerId,
        ]);
    }

    /** @param array<string,mixed> $opts */
    private function event(string $tenantId, string $sessionId, string $performerId, string $type, array $opts = []): PosSessionEvent
    {
        return PosSessionEvent::create([
            'tenant_id' => $tenantId,
            'branch_id' => $opts['branch_id'] ?? null,
            'pos_session_id' => $sessionId,
            'cart_id' => $opts['cart_id'] ?? null,
            'type' => $type,
            'category' => $opts['category'] ?? 'test',
            'actor_id' => $performerId,
            'performed_by' => $performerId,
            'approved_by' => $opts['approved_by'] ?? null,
            'amount' => $opts['amount'] ?? null,
            'payload' => $opts['payload'] ?? ['provenance' => ['source' => 'server', 'trust_level' => 'server_authoritative']],
            'created_at' => $opts['at'] ?? Carbon::now()->subDays(1),
        ]);
    }

    private function detect(string $tenantId, ?Carbon $now = null): array
    {
        app(TenantContext::class)->set($tenantId);

        return app(PosExceptionDetectionService::class)->run($now);
    }

    private function exceptionsFor(string $ruleKey, ?string $subject = null)
    {
        return PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('rule_key', $ruleKey)
            ->when($subject, fn ($q) => $q->where('subject_user_id', $subject))
            ->get();
    }

    private function policies(array $auth, array $overrides): void
    {
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', ['data' => ['audit_operation_policies' => array_merge([
            'item_remove' => 'allowed', 'price_override' => 'allowed', 'discount_change' => 'allowed',
            'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
            'refund' => 'allowed', 'cash_out' => 'allowed', 'manual_drawer_open' => 'allowed',
        ], $overrides)]])->assertOk();
    }

    private function assignShift(User $user, string $start, string $end, array $workDays): Shift
    {
        $shift = Shift::create([
            'name' => 'وردية ف4', 'start_time' => $start, 'end_time' => $end,
            'work_days' => $workDays, 'is_active' => true, 'break_minutes' => 0,
        ]);
        $employee = Employee::create([
            'name' => $user->name,
            'employee_no' => 'EMP-P4-' . Str::upper(Str::random(4)),
            'shift_id' => $shift->id,
            'is_active' => true,
        ]);
        $user->update(['employee_id' => $employee->id]);

        return $shift;
    }

    // ═══════════════════════ Idempotency ═══════════════════════

    /** @test */
    public function duplicate_client_event_id_with_the_same_payload_returns_the_original_row(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', ['pos_session_id' => $session])
            ->assertCreated()->json('data.cart_id');

        $payload = [
            'pos_session_id' => $session, 'type' => 'item_removed', 'reason_code' => 'wrong_scan',
            'client_event_id' => 'evt-retry-1',
            'before' => ['item' => ['quantity' => 1]], 'after' => ['items' => []],
        ];
        $first = $this->withToken($auth['token'])->postJson("/api/pos/carts/{$cart}/events", $payload)
            ->assertCreated()->json('data');
        $second = $this->withToken($auth['token'])->postJson("/api/pos/carts/{$cart}/events", $payload)
            ->assertOk()->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, PosSessionEvent::where('cart_id', $cart)->where('type', 'item_removed')->count());
    }

    /** @test */
    public function duplicate_client_event_id_with_a_different_payload_returns_conflict(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', ['pos_session_id' => $session])
            ->assertCreated()->json('data.cart_id');

        $this->withToken($auth['token'])->postJson("/api/pos/carts/{$cart}/events", [
            'pos_session_id' => $session, 'type' => 'item_removed', 'reason_code' => 'wrong_scan',
            'client_event_id' => 'evt-clash-1',
            'before' => ['item' => ['quantity' => 1]], 'after' => ['items' => []],
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/pos/carts/{$cart}/events", [
            'pos_session_id' => $session, 'type' => 'item_removed', 'reason_code' => 'customer_changed_mind',
            'client_event_id' => 'evt-clash-1',
            'before' => ['item' => ['quantity' => 2]], 'after' => ['items' => []],
        ])->assertStatus(409);

        $this->assertSame(1, PosSessionEvent::where('client_event_id', 'evt-clash-1')->count());
    }

    /** @test */
    public function the_same_client_event_id_is_isolated_across_tenants(): void
    {
        $first = $this->registerTenant();
        app(TenantContext::class)->set($first['tenant_id']);
        $sessionA = $this->openSession($first);
        $cartA = $this->withToken($first['token'])->postJson('/api/pos/carts', ['pos_session_id' => $sessionA])
            ->assertCreated()->json('data.cart_id');
        $this->withToken($first['token'])->postJson("/api/pos/carts/{$cartA}/events", [
            'pos_session_id' => $sessionA, 'type' => 'item_removed', 'reason_code' => 'wrong_scan',
            'client_event_id' => 'shared-key',
            'before' => ['item' => ['quantity' => 1]], 'after' => ['items' => []],
        ])->assertCreated();

        $second = $this->registerTenant('p4-b', 'p4-b@example.test');
        app(TenantContext::class)->set($second['tenant_id']);
        $sessionB = $this->openSession($second);
        $cartB = $this->withToken($second['token'])->postJson('/api/pos/carts', ['pos_session_id' => $sessionB])
            ->assertCreated()->json('data.cart_id');
        $this->withToken($second['token'])->postJson("/api/pos/carts/{$cartB}/events", [
            'pos_session_id' => $sessionB, 'type' => 'item_removed', 'reason_code' => 'wrong_quantity',
            'client_event_id' => 'shared-key',
            'before' => ['item' => ['quantity' => 9]], 'after' => ['items' => []],
        ])->assertCreated();

        $this->assertSame(2, PosSessionEvent::withoutGlobalScopes()
            ->where('client_event_id', 'shared-key')->count());
    }

    /** @test */
    public function approval_request_retry_with_the_same_client_event_id_does_not_create_a_second_request(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->policies($auth, ['item_remove' => 'approval_required']);
        $session = $this->openSession($auth);
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', ['pos_session_id' => $session])
            ->assertCreated()->json('data.cart_id');

        $body = [
            'pos_session_id' => $session, 'cart_id' => $cart, 'operation' => 'item_remove',
            'reason_code' => 'wrong_scan', 'client_event_id' => 'apr-retry-1',
        ];
        $first = $this->withToken($auth['token'])->postJson('/api/pos/approval-requests', $body)->assertCreated()->json('data');
        $second = $this->withToken($auth['token'])->postJson('/api/pos/approval-requests', $body)->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, PosOverrideApproval::where('cart_id', $cart)->count());
        $this->assertSame(1, PosSessionEvent::where('cart_id', $cart)->where('type', PosSessionEvent::TYPE_OVERRIDE_REQUESTED)->count());
    }

    // ═══════════════════════ Cross-cashier evidence ═══════════════════════

    /** @test */
    public function generic_return_of_a_pos_invoice_stamps_created_by_and_emits_external_evidence(): void
    {
        $seller = $this->registerTenant();
        app(TenantContext::class)->set($seller['tenant_id']);
        $device = $this->device($seller);
        $session = $this->withToken($seller['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');
        $product = Product::create(['name' => 'صنف ف4', 'sale_price' => 10000, 'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $customer = $this->withToken($seller['token'])->postJson('/api/partners', ['name' => 'عميل ف4', 'type' => 'customer'])->assertCreated()->json('data.id');
        $invoice = Invoice::with('lines')->findOrFail($this->withToken($seller['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $customer, 'pos_session_id' => $session,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 11500],
        ])->assertCreated()->json('data.id'));

        $returnerToken = $this->tokenForRole($seller['tenant_id'], 'admin', 'returner-p4@example.test');
        $draft = $this->withToken($returnerToken)->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $customer, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [[
                'product_id' => $product->id, 'source_line_id' => $invoice->lines->first()->id,
                'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();
        $returnId = $draft->json('data.id');
        $returner = User::where('email', 'returner-p4@example.test')->firstOrFail();
        $this->assertSame($returner->id, ReturnDocument::findOrFail($returnId)->created_by);

        $this->withToken($returnerToken)->postJson("/api/returns/{$returnId}/post")->assertOk();

        $event = PosSessionEvent::where('type', PosSessionEvent::TYPE_RETURN_RECORDED_EXTERNAL)->sole();
        $this->assertSame($session, $event->pos_session_id);
        $this->assertSame($invoice->created_by, $event->payload['original_sale_actor_id']);
        $this->assertSame($returner->id, $event->payload['return_actor_id']);
        $this->assertNotSame($event->payload['original_sale_actor_id'], $event->payload['return_actor_id']);
    }

    /** @test */
    public function cross_cashier_refund_fires_only_when_both_actors_are_present_and_different(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $seller = $this->cashier($tenant, 'seller-cc@x.test');
        $returner = $this->cashier($tenant, 'returner-cc@x.test');
        $session = $this->posSession($tenant, $seller->id);

        $this->event($tenant, $session->id, $returner->id, PosSessionEvent::TYPE_RETURN_RECORDED_EXTERNAL, [
            'payload' => ['original_sale_actor_id' => $seller->id, 'return_actor_id' => $returner->id],
        ]);
        $same = $this->cashier($tenant, 'same-cc@x.test');
        $this->event($tenant, $session->id, $same->id, PosSessionEvent::TYPE_RETURN_RECORDED_EXTERNAL, [
            'payload' => ['original_sale_actor_id' => $same->id, 'return_actor_id' => $same->id],
        ]);
        $legacy = $this->cashier($tenant, 'legacy-cc@x.test');
        $this->event($tenant, $session->id, $legacy->id, PosSessionEvent::TYPE_RETURN_RECORDED_EXTERNAL, [
            'payload' => ['original_sale_actor_id' => null, 'return_actor_id' => $legacy->id],
        ]);

        $this->detect($tenant);

        $this->assertSame(1, $this->exceptionsFor('cross_cashier_refund', $returner->id)->count());
        $this->assertSame(0, $this->exceptionsFor('cross_cashier_refund', $same->id)->count());
        $this->assertSame(0, $this->exceptionsFor('cross_cashier_refund', $legacy->id)->count());
        $hit = $this->exceptionsFor('cross_cashier_refund', $returner->id)->sole();
        $this->assertSame(0, (int) $hit->amount_under_review);
        $this->assertSame('server_authoritative', $hit->evidence_confidence);
    }

    /** @test */
    public function refund_shortly_after_sale_uses_posted_pos_returns_inside_the_window_only(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $device = $this->device($auth);
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');
        $product = Product::create(['name' => 'صنف نافذة', 'sale_price' => 10000, 'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نافذة', 'type' => 'customer'])->assertCreated()->json('data.id');
        $invoice = Invoice::with('lines')->findOrFail($this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $customer, 'pos_session_id' => $sessionId,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 11500],
        ])->assertCreated()->json('data.id'));

        $draft = $this->withToken($auth['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $customer, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [[
                'product_id' => $product->id, 'source_line_id' => $invoice->lines->first()->id,
                'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/returns/{$draft}/post")->assertOk();

        // النافذة الحالية `created_at < now` صارمة؛ نمرّر لحظة بعد التسجيل كي يدخل المرتجع.
        $this->detect($auth['tenant_id'], Carbon::now()->addMinute());
        $owner = $this->owner($auth);
        $this->assertGreaterThanOrEqual(1, $this->exceptionsFor('refund_shortly_after_sale', $owner->id)->count());
    }

    // ═══════════════════════ Outside operating hours ═══════════════════════

    /** @test */
    public function outside_operating_hours_covers_inside_outside_overnight_grace_and_missing_shift(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-26 07:00:00', 'UTC')); // 10:00 Asia/Riyadh, Wednesday
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        app(TenantContext::class)->set($tenant);

        $inside = $this->cashier($tenant, 'inside-oh@x.test');
        $this->assignShift($inside, '08:00', '16:00', [0, 1, 2, 3, 4]);
        $session = $this->posSession($tenant, $inside->id);

        $this->event($tenant, $session->id, $inside->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'at' => Carbon::parse('2026-08-26 07:00:00', 'UTC'), // 10:00 Riyadh — داخل الوردية
        ]);

        $outside = $this->cashier($tenant, 'outside-oh@x.test');
        $this->assignShift($outside, '08:00', '16:00', [0, 1, 2, 3, 4]);
        $this->event($tenant, $session->id, $outside->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'at' => Carbon::parse('2026-08-26 17:00:00', 'UTC'), // 20:00 Riyadh — خارج
        ]);

        $overnight = $this->cashier($tenant, 'overnight-oh@x.test');
        $this->assignShift($overnight, '22:00', '06:00', [2]); // تبدأ الثلاثاء
        $this->event($tenant, $session->id, $overnight->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'at' => Carbon::parse('2026-08-25 20:30:00', 'UTC'), // 23:30 Riyadh الثلاثاء — داخل الليلية
        ]);
        $this->event($tenant, $session->id, $overnight->id, PosSessionEvent::TYPE_DISCOUNT_APPLIED, [
            'at' => Carbon::parse('2026-08-26 00:30:00', 'UTC'), // 03:30 Riyadh الأربعاء — ما زالت داخل الليلية
        ]);

        $grace = $this->cashier($tenant, 'grace-oh@x.test');
        $this->assignShift($grace, '08:00', '16:00', [0, 1, 2, 3, 4]);
        $this->event($tenant, $session->id, $grace->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'at' => Carbon::parse('2026-08-26 04:40:00', 'UTC'), // 07:40 Riyadh — ضمن سماح 30 د
        ]);
        $beyondGrace = $this->cashier($tenant, 'beyond-oh@x.test');
        $this->assignShift($beyondGrace, '08:00', '16:00', [0, 1, 2, 3, 4]);
        $this->event($tenant, $session->id, $beyondGrace->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'at' => Carbon::parse('2026-08-26 04:20:00', 'UTC'), // 07:20 Riyadh — خارج السماح
        ]);

        $noShift = $this->cashier($tenant, 'noshift-oh@x.test');
        $this->event($tenant, $session->id, $noShift->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'at' => Carbon::parse('2026-08-26 17:00:00', 'UTC'),
        ]);

        $this->detect($tenant, Carbon::parse('2026-08-27 00:00:00', 'UTC'));

        $this->assertSame(0, $this->exceptionsFor('outside_operating_hours', $inside->id)->count());
        $this->assertSame(1, $this->exceptionsFor('outside_operating_hours', $outside->id)->count());
        $this->assertSame(0, $this->exceptionsFor('outside_operating_hours', $overnight->id)->count());
        $this->assertSame(0, $this->exceptionsFor('outside_operating_hours', $grace->id)->count());
        $this->assertSame(1, $this->exceptionsFor('outside_operating_hours', $beyondGrace->id)->count());
        $this->assertSame(0, $this->exceptionsFor('outside_operating_hours', $noShift->id)->count());
    }

    // ═══════════════════════ Advanced rules ═══════════════════════

    /** @test */
    public function repeated_hold_discard_and_cancel_before_checkout_follow_existing_baseline_engine(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'hold-p4@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        for ($i = 0; $i < 100; $i++) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CREATED);
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CHECKOUT_STARTED);
        }
        for ($i = 0; $i < 30; $i++) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_DISCARDED);
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CANCELLED, [
                'payload' => ['provenance' => ['source' => 'client_observed', 'trust_level' => 'secondary_telemetry']],
            ]);
        }

        $this->detect($tenant);

        $discard = $this->exceptionsFor('repeated_hold_discard', $cashier->id)->sole();
        $this->assertSame('server_authoritative', $discard->evidence_confidence);
        $this->assertSame(0, (int) $discard->amount_under_review);
        $cancel = $this->exceptionsFor('repeated_cancel_before_checkout', $cashier->id)->sole();
        $this->assertSame('client_observed', $cancel->evidence_confidence);
    }

    /** @test */
    public function manual_drawer_without_proximity_override_then_cancel_and_approval_replay_are_deterministic(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'adv-p4@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $cart = (string) Str::uuid();

        $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT, [
            'payload' => ['mode' => 'manual'],
            'at' => Carbon::now()->subHours(3),
        ]);
        $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CHECKOUT_COMPLETED, [
            'at' => Carbon::now()->subHours(5),
        ]);

        $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_OVERRIDE_CONSUMED, [
            'cart_id' => $cart, 'at' => Carbon::now()->subMinutes(20),
        ]);
        $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CANCELLED, [
            'cart_id' => $cart, 'at' => Carbon::now()->subMinutes(15),
        ]);

        for ($i = 0; $i < 3; $i++) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_OVERRIDE_REQUESTED, [
                'cart_id' => $cart,
                'payload' => ['operation' => 'item_remove'],
                'at' => Carbon::now()->subMinutes(8 - $i),
            ]);
        }

        $this->detect($tenant);

        $this->assertSame(1, $this->exceptionsFor('manual_drawer_without_transaction_proximity', $cashier->id)->count());
        $this->assertSame(1, $this->exceptionsFor('override_then_cancel', $cashier->id)->count());
        $this->assertSame('client_observed', $this->exceptionsFor('override_then_cancel', $cashier->id)->sole()->evidence_confidence);
        $this->assertSame(1, $this->exceptionsFor('approval_replay', $cashier->id)->count());

        $this->detect($tenant);
        $this->assertSame(1, $this->exceptionsFor('manual_drawer_without_transaction_proximity', $cashier->id)->count());
        $this->assertSame(1, $this->exceptionsFor('approval_replay', $cashier->id)->count());
    }

    /** @test */
    public function manual_drawer_with_a_nearby_checkout_does_not_fire(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'near-drawer@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $at = Carbon::now()->subHour();
        $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT, [
            'payload' => ['mode' => 'manual'], 'at' => $at,
        ]);
        $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CHECKOUT_COMPLETED, [
            'at' => $at->copy()->addMinutes(2),
        ]);

        $this->detect($tenant);
        $this->assertSame(0, $this->exceptionsFor('manual_drawer_without_transaction_proximity', $cashier->id)->count());
    }

    // ═══════════════════════ Preventive controls ═══════════════════════

    /** @test */
    public function denied_refund_cash_out_and_manual_drawer_policies_block_the_real_server_action(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->policies($auth, [
            'refund' => 'denied', 'cash_out' => 'denied', 'manual_drawer_open' => 'denied',
        ]);
        $device = $this->device($auth);
        $session = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 200000, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');
        $product = Product::create(['name' => 'صنف منع', 'sale_price' => 10000, 'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل منع', 'type' => 'customer'])->assertCreated()->json('data.id');
        $invoice = Invoice::with('lines')->findOrFail($this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $customer, 'pos_session_id' => $session,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 11500],
        ])->assertCreated()->json('data.id'));

        $this->withToken($auth['token'])->postJson('/api/pos/returns', [
            'pos_session_id' => $session, 'original_invoice_id' => $invoice->id, 'payment_type' => 'credit',
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => 1]],
        ])->assertStatus(422);
        $this->assertSame(0, ReturnDocument::count());

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/cash-movements", [
            'type' => PosCashMovement::TYPE_CASH_OUT, 'amount' => 1000, 'reason' => 'صرف تجريبي للسياسة',
        ])->assertStatus(422);
        $this->assertSame(0, PosCashMovement::count());

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/cash-drawer/open", [
            'reason' => 'فتح تجريبي',
        ])->assertStatus(422);
    }

    /** @test */
    public function approval_required_cash_out_consumes_a_matching_approval_before_recording(): void
    {
        $owner = $this->registerTenant();
        app(TenantContext::class)->set($owner['tenant_id']);
        $this->policies($owner, ['cash_out' => 'approval_required']);
        $approverToken = $this->tokenForRole($owner['tenant_id'], 'admin', 'approver-co@example.test');
        $device = $this->device($owner);
        $session = $this->withToken($owner['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 50000, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');

        $this->withToken($owner['token'])->postJson("/api/pos-sessions/{$session}/cash-movements", [
            'type' => 'cash_out', 'amount' => 1000, 'reason' => 'صرف بلا اعتماد',
        ])->assertStatus(422);

        $approval = $this->withToken($owner['token'])->postJson('/api/pos/approval-requests', [
            'pos_session_id' => $session, 'operation' => 'cash_out', 'reason_code' => 'other', 'reason_note' => 'صرف معتمد',
        ])->assertCreated()->json('data');
        $this->withToken($approverToken)->postJson("/api/pos/audit/approvals/{$approval['id']}/approve")->assertOk();

        $this->withToken($owner['token'])->postJson("/api/pos-sessions/{$session}/cash-movements", [
            'type' => 'cash_out', 'amount' => 1000, 'reason' => 'صرف معتمد', 'approval_id' => $approval['id'],
        ])->assertCreated();
        $this->assertSame(1, PosCashMovement::count());
        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $session, 'type' => PosSessionEvent::TYPE_OVERRIDE_CONSUMED,
        ]);
    }

    // ═══════════════════════ SoD ═══════════════════════

    /** @test */
    public function variance_self_approval_is_allowed_by_default_and_blocked_when_the_flag_is_on(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth, 50000);
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/close", ['closing_balance' => 40000])->assertOk();

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/acknowledge-difference", [
            'note' => 'إقرار الكاشير نفسه — الافتراض يسمح',
        ])->assertOk();

        $other = $this->registerTenant('p4-sod', 'p4-sod@example.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $this->withToken($other['token'])->putJson('/api/sales-config/pos_loss_prevention', [
            'data' => ['self_approval_blocked_for_variance' => true, 'outside_hours_grace_minutes' => 30],
        ])->assertOk();
        $blocked = $this->openSession($other, 50000);
        $this->withToken($other['token'])->postJson("/api/pos-sessions/{$blocked}/close", ['closing_balance' => 40000])->assertOk();
        $this->withToken($other['token'])->postJson("/api/pos-sessions/{$blocked}/acknowledge-difference", [
            'note' => 'محاولة اعتماد ذاتي',
        ])->assertStatus(422);

        $admin = $this->tokenForRole($other['tenant_id'], 'admin', 'sod-admin@example.test');
        $this->withToken($admin)->postJson("/api/pos-sessions/{$blocked}/acknowledge-difference", [
            'note' => 'اعتماد من مستخدم آخر',
        ])->assertOk();
        $this->withToken($other['token'])->postJson("/api/pos-sessions/{$blocked}/settle-variance")->assertStatus(422);
        $this->withToken($admin)->postJson("/api/pos-sessions/{$blocked}/settle-variance")->assertOk();
    }

    // ═══════════════════════ Needs Attention ═══════════════════════

    /** @test */
    public function needs_attention_is_paginated_tenant_scoped_and_gated_by_permission(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        app(TenantContext::class)->set($tenant);
        $subject = $this->cashier($tenant, 'attn-subj@x.test');
        $branchA = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع أ ف4', 'code' => 'P4A'])->assertCreated()->json('data.id');
        $branchB = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ب ف4', 'code' => 'P4B'])->assertCreated()->json('data.id');

        PosException::create([
            'tenant_id' => $tenant, 'branch_id' => $branchA, 'rule_key' => 'cross_cashier_refund',
            'category' => 'returns', 'rule_version' => 1, 'rule_snapshot' => ['weight' => 18],
            'subject_user_id' => $subject->id, 'performed_by' => $subject->id,
            'window_start' => now()->subDays(7), 'window_end' => now(),
            'observed_count' => 1, 'denominator' => 1, 'observed_rate_milli' => 1000,
            'baseline_rate_milli' => 1000, 'baseline_type' => 'static', 'sample_size' => 1,
            'severity' => PosException::SEVERITY_PRIORITY, 'risk_contribution' => 18,
            'amount_under_review' => 0, 'evidence_confidence' => 'server_authoritative',
            'dedup_key' => 'p4-attn-a', 'explanation' => [], 'detected_at' => now(),
            'review_state' => PosException::STATE_NEW,
        ]);
        PosException::create([
            'tenant_id' => $tenant, 'branch_id' => $branchB, 'rule_key' => 'cross_cashier_refund',
            'category' => 'returns', 'rule_version' => 1, 'rule_snapshot' => ['weight' => 18],
            'subject_user_id' => $subject->id, 'performed_by' => $subject->id,
            'window_start' => now()->subDays(7), 'window_end' => now(),
            'observed_count' => 1, 'denominator' => 1, 'observed_rate_milli' => 1000,
            'baseline_rate_milli' => 1000, 'baseline_type' => 'static', 'sample_size' => 1,
            'severity' => PosException::SEVERITY_PRIORITY, 'risk_contribution' => 18,
            'amount_under_review' => 0, 'evidence_confidence' => 'server_authoritative',
            'dedup_key' => 'p4-attn-b', 'explanation' => [], 'detected_at' => now(),
            'review_state' => PosException::STATE_NEW,
        ]);
        PosInvestigationCase::create([
            'tenant_id' => $tenant, 'branch_id' => $branchA, 'number' => 'LP-P4-00001',
            'title' => 'قضية غير مسندة', 'status' => 'open', 'priority' => 'high',
            'opened_at' => now()->subDays(5), 'last_activity_at' => now()->subDays(5),
        ]);
        PosLpDigest::create([
            'digest_date' => now()->toDateString(), 'timezone' => 'Asia/Riyadh',
            'period_start' => now()->startOfDay(), 'period_end' => now()->endOfDay(),
            'generated_at' => now(), 'priority_exceptions_count' => 2,
            'unresolved_high_priority_cases_count' => 1, 'confirmed_loss_count' => 0,
            'branch_breakdown' => [
                ['branch_id' => $branchA, 'priority_exceptions_count' => 1, 'unresolved_high_priority_cases_count' => 1, 'confirmed_loss_count' => 0],
                ['branch_id' => $branchB, 'priority_exceptions_count' => 1, 'unresolved_high_priority_cases_count' => 0, 'confirmed_loss_count' => 0],
            ],
        ]);

        $all = $this->withToken($auth['token'])->getJson('/api/pos/audit/needs-attention?per_page=50&branch=all')->assertOk();
        $this->assertGreaterThanOrEqual(3, $all->json('meta.total'));
        $kinds = collect($all->json('data'))->pluck('kind');
        $this->assertTrue($kinds->contains('priority_exception'));
        $this->assertTrue($kinds->contains('attention_case'));
        $this->assertTrue($kinds->contains('digest_highlight'));

        $inA = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branchA])
            ->getJson('/api/pos/audit/needs-attention')->assertOk();
        $branchIds = collect($inA->json('data'))->pluck('branch_id')->filter()->unique()->values();
        $this->assertFalse($branchIds->contains($branchB));

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-attn@example.test');
        $this->withToken($staff)->getJson('/api/pos/audit/needs-attention')->assertForbidden();

        $viewer = $this->roleToken($tenant, ['pos.audit.view'], 'view-only-attn@example.test');
        $viewOnly = $this->withToken($viewer)->getJson('/api/pos/audit/needs-attention?branch=all')->assertOk();
        $viewKinds = collect($viewOnly->json('data'))->pluck('kind');
        $this->assertTrue($viewKinds->contains('priority_exception'));
        $this->assertFalse($viewKinds->contains('attention_case'));
        $this->assertFalse($viewKinds->contains('digest_highlight'));
        $this->assertFalse($viewKinds->contains('pending_approval'));

        $other = $this->registerTenant('p4-attn-iso', 'p4-attn-iso@example.test');
        $this->withToken($other['token'])->getJson('/api/pos/audit/needs-attention')
            ->assertOk()->assertJsonPath('meta.total', 0);
    }
}
