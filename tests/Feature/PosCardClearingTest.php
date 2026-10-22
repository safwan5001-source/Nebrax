<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\PosSessionReconciliation;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\Accounting\PaymentReversalService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H6-01 (قرار D-09 — الخيار 1): مقاصة بطاقات POS اختيارية لكل طريقة دفع، مطفأة افتراضياً.
 *
 * A11 (الافتراضي، بلا تغيير): مدين بنك الطريقة / دائن 1130.
 * A12 (طريقة مربوطة باتصال مستحوذ): مدين 1170 مقاصة / دائن 1130 — عبر PaymentService القائم، ثم التسوية القائمة 1170 → بنك + رسوم.
 */
class PosCardClearingTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private int $seq = 0;

    // ═══════════════ الافتراضي مطفأ (A11) ═══════════════

    #[Test]
    public function by_default_a_card_sale_is_unchanged_a11_with_no_gateway_and_no_clearing(): void
    {
        $auth = $this->tenant('pos-clr-default');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->cardMethod($auth);

        $this->assertNull($card['pos_clearing_gateway_id']);
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();

        $payment = Payment::query()->sole();
        $this->assertNull($payment->payment_gateway_id);
        $this->assertNull($payment->reference);
        $this->assertNull($payment->payment_details);
        $entry = $this->entry($payment);
        $this->assertSame(11500, $this->debit($entry, '1120'), 'مدين البنك');
        $this->assertSame(11500, $this->credit($entry, '1130'));
        $this->assertNull($this->lineFor($entry, '1170'));
        $this->assertSame(0, $this->balance('1170'));
        $this->assertSame(11500, $this->balance('1120'));
    }

    // ═══════════════ A12 ═══════════════

    #[Test]
    public function a_linked_method_posts_a12_debiting_clearing_not_the_bank_and_the_settlement_clears_it(): void
    {
        $auth = $this->tenant('pos-clr-a12');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->linkedCard($auth, $gateway = $this->gateway());

        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();

        $invoice = Invoice::query()->sole();
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertSame(11500, $invoice->paid_amount);

        $payment = Payment::query()->sole();
        $this->assertSame($gateway->id, $payment->payment_gateway_id);
        $this->assertSame('posted', $payment->status);
        $entry = $this->entry($payment);
        $this->assertSame(11500, $this->debit($entry, '1170'), 'مدين المقاصة');
        $this->assertSame(11500, $this->credit($entry, '1130'));
        $this->assertNull($this->lineFor($entry, '1120'), 'لا أثر على البنك قبل التسوية');
        $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertSame(11500, $this->balance('1170'));
        $this->assertSame(0, $this->balance('1120'));

        // التسوية القائمة (غير معدّلة): 1170 → بنك صافياً + رسوم 5510.
        app(CashBankAccountService::class)->bootstrapDefaults();
        app(PaymentGatewaySettlementService::class)->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBankId(),
            'provider_settlement_ref' => 'POS-SET-1',
            'settlement_date' => now()->toDateString(),
            'net_bank_amount' => 11000,
            'provider_fee_ex_tax' => 500,
            'provider_fee_tax' => 0,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 11500, 'provider_event_ref' => 'POS-EVT-1']],
        ]);
        $this->assertSame(0, $this->balance('1170'));
        $this->assertSame(11000, $this->balance('1120'));
        $this->assertSame(500, $this->balance('5510'));
    }

    #[Test]
    public function mixed_tenders_post_cash_to_the_drawer_and_only_the_linked_card_to_clearing(): void
    {
        $auth = $this->tenant('pos-clr-mixed');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $cash = $this->methodBySettlement($auth, 'cash');
        $card = $this->linkedCard($auth, $this->gateway());
        $transfer = $this->methodNamed($auth, 'تحويل بنكي'); // بنكية غير مربوطة ⇒ A11

        $this->checkout($auth, $partner, $session, [
            ['payment_method_id' => $cash['id'], 'amount' => 3000],
            ['payment_method_id' => $card['id'], 'amount' => 5000],
            ['payment_method_id' => $transfer['id'], 'amount' => 3500],
        ])->assertCreated();

        $this->assertSame(3000, $this->balance('1110'));
        $this->assertSame(5000, $this->balance('1170'));
        $this->assertSame(3500, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1130'), 'الذمة صفر بعد السداد الكامل');
        $this->assertSame(2, Payment::query()->whereNull('payment_gateway_id')->count());
        $this->assertSame(1, Payment::query()->whereNotNull('payment_gateway_id')->count());
    }

    #[Test]
    public function relinking_or_unlinking_never_rewrites_a_posted_payment_or_its_entry(): void
    {
        $auth = $this->tenant('pos-clr-history');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->linkedCard($auth, $this->gateway());
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();
        $before = Payment::query()->sole();
        $entryBefore = $this->entry($before)->lines->map(fn ($l) => [$l->account_id, (int) $l->debit, (int) $l->credit])->all();

        $this->putMethod($auth, $card, ['pos_clearing_gateway_id' => null])->assertOk()->assertJsonPath('data.pos_clearing_gateway_id', null);
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();

        $this->assertSame($before->payment_gateway_id, Payment::query()->findOrFail($before->id)->payment_gateway_id);
        $this->assertSame($entryBefore, $this->entry(Payment::query()->findOrFail($before->id))->lines->map(fn ($l) => [$l->account_id, (int) $l->debit, (int) $l->credit])->all());
        $this->assertSame(11500, $this->balance('1170'), 'الأول فقط على المقاصة');
        $this->assertSame(11500, $this->balance('1120'), 'الثاني A11 بعد فك الربط');
    }

    #[Test]
    public function an_a12_collection_reverses_by_mirroring_clearing_before_settlement(): void
    {
        $auth = $this->tenant('pos-clr-reverse');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $gateway = $this->gateway();
        $card = $this->linkedCard($auth, $gateway);
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();
        $payment = Payment::query()->sole();

        $reversed = app(PaymentReversalService::class)->reverse($payment, null, 'استرجاع قبل التسوية');
        $this->assertSame('reversed', $reversed->status);
        $this->assertSame(0, $this->balance('1170'));
        $this->assertSame(11500, $this->balance('1130'), 'عادت الذمة');
        $this->assertSame(0, $this->balance('1120'));
    }

    #[Test]
    public function a_settled_a12_collection_can_no_longer_be_reversed(): void
    {
        $auth = $this->tenant('pos-clr-settled');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $gateway = $this->gateway();
        $card = $this->linkedCard($auth, $gateway);
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();
        $payment = Payment::query()->sole();
        app(CashBankAccountService::class)->bootstrapDefaults();
        app(PaymentGatewaySettlementService::class)->post([
            'payment_gateway_id' => $gateway->id, 'cash_bank_account_id' => $this->mainBankId(),
            'provider_settlement_ref' => 'POS-SET-2', 'settlement_date' => now()->toDateString(),
            'net_bank_amount' => 11500, 'provider_fee_ex_tax' => 0, 'provider_fee_tax' => 0,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 11500, 'provider_event_ref' => 'POS-EVT-2']],
        ]);

        $this->expectException(\RuntimeException::class);
        app(PaymentReversalService::class)->reverse($payment->fresh(), null, 'بعد التسوية');
    }

    // ═══════════════ مرجع العملية ═══════════════

    #[Test]
    public function the_optional_operation_reference_is_stored_on_the_receipt_and_changes_no_entry(): void
    {
        $auth = $this->tenant('pos-clr-ref');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->cardMethod($auth); // A11 — المرجع مستقل عن المقاصة

        $this->checkout($auth, $partner, $session, [[
            'payment_method_id' => $card['id'], 'amount' => 11500,
            'approval_code' => 'AB-1234', 'rrn' => '402312345678', 'last4' => '4242',
        ]])->assertCreated();

        $payment = Payment::query()->sole();
        $this->assertSame('402312345678', $payment->reference);
        $this->assertSame(['approval_code' => 'AB-1234', 'rrn' => '402312345678', 'last4' => '4242'], json_decode((string) $payment->payment_details, true));
        $this->assertSame(11500, $this->debit($this->entry($payment), '1120'));
    }

    #[Test]
    public function malformed_or_misplaced_references_and_smuggled_fields_are_rejected_before_any_document(): void
    {
        $auth = $this->tenant('pos-clr-ref-bad');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->cardMethod($auth);
        $cash = $this->methodBySettlement($auth, 'cash');
        $gateway = $this->gateway();

        foreach ([
            ['last4' => '42'], ['last4' => '4242 4242 4242 4242'], ['last4' => 'abcd'],
            ['rrn' => '12'], ['approval_code' => 'bad code!'],
            ['payment_gateway_id' => $gateway->id], ['clearing_account_id' => (string) Str::uuid()], ['cvv' => '123'],
        ] as $extra) {
            $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500, ...$extra]])
                ->assertStatus(422);
        }
        // مرجع على النقد مرفوض.
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $cash['id'], 'amount' => 11500, 'rrn' => '402312345678']])
            ->assertStatus(422);

        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    #[Test]
    public function idempotency_is_intact_old_bodies_keep_their_fingerprint_and_a_changed_reference_conflicts(): void
    {
        $auth = $this->tenant('pos-clr-idem');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->linkedCard($auth, $this->gateway());
        $key = (string) Str::uuid();
        $body = fn (array $tender) => [
            'idempotency_key' => $key, 'partner_id' => $partner, 'pos_session_id' => $session,
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => [['payment_method_id' => $card['id'], 'amount' => 11500, ...$tender]],
        ];

        $first = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body(['rrn' => '402312345678']))->assertCreated()['data'];
        $replay = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body(['rrn' => '402312345678']))->assertOk()
            ->assertJsonPath('idempotent_replay', true)['data'];
        $this->assertSame($first['id'], $replay['id']);
        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body(['rrn' => '999999999999']))->assertStatus(409);
        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body([]))->assertStatus(409);

        $this->assertSame(1, Invoice::query()->count());
        $this->assertSame(1, Payment::query()->count());
        $this->assertSame(11500, $this->balance('1170'), 'مرة واحدة مهما تكرر الطلب');
    }

    // ═══════════════ فشل الاتصال المربوط ═══════════════

    #[Test]
    public function a_suspended_or_revoked_linked_connection_fails_closed_with_no_partial_document_and_no_silent_a11(): void
    {
        $auth = $this->tenant('pos-clr-dead');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $gateway = $this->gateway();
        $card = $this->linkedCard($auth, $gateway);

        foreach (['suspended', 'revoked'] as $status) {
            DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => $status]);
            $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])
                ->assertStatus(422);
            $this->assertSame(0, Invoice::query()->count());
            $this->assertSame(0, Payment::query()->count());
            $this->assertSame(0, JournalEntry::query()->count());
        }

        // الاتصال الحي يعيد العمل، وفكّ الربط يعيد A11.
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active']);
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();
        $this->assertSame(11500, $this->balance('1170'));
    }

    // ═══════════════ إدارة الربط: صلاحية وعزل ═══════════════

    #[Test]
    public function linking_requires_a_bank_method_and_a_usable_gateway_of_the_same_tenant(): void
    {
        $auth = $this->tenant('pos-clr-link');
        $gateway = $this->gateway();
        $cash = $this->methodBySettlement($auth, 'cash');
        $card = $this->cardMethod($auth);

        $this->putMethod($auth, $cash, ['pos_clearing_gateway_id' => $gateway->id])->assertStatus(422);
        $this->putMethod($auth, $card, ['pos_clearing_gateway_id' => (string) Str::uuid()])->assertStatus(422);

        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'draft']);
        $this->putMethod($auth, $card, ['pos_clearing_gateway_id' => $gateway->id])->assertStatus(422);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active']);

        $this->putMethod($auth, $card, ['pos_clearing_gateway_id' => $gateway->id])->assertOk()
            ->assertJsonPath('data.pos_clearing_gateway_id', $gateway->id)
            ->assertJsonPath('data.pos_clearing_gateway_usable', true);

        // PUT بلا المفتاح يُبقي الربط؛ تحويل الطريقة إلى نقدية وهي مربوطة مرفوض.
        $this->putMethod($auth, $card, ['instructions' => 'تعليمات'], withLink: false)->assertOk()
            ->assertJsonPath('data.pos_clearing_gateway_id', $gateway->id);
        $this->putMethod($auth, $card, ['settlement_type' => 'cash', 'cash_bank_account_id' => $cash['cash_bank_account_id'], 'pos_clearing_gateway_id' => $gateway->id])
            ->assertStatus(422);

        // الاتصال المربوط لا يُحذف من القاعدة (مرجع مالي).
        $this->assertTrue($gateway->fresh()->hasFinancialReferences());
    }

    #[Test]
    public function another_tenants_gateway_can_never_be_linked_or_used_and_staff_cannot_manage_the_link(): void
    {
        $a = $this->tenant('pos-clr-iso-a');
        $b = $this->tenant('pos-clr-iso-b');
        app(TenantContext::class)->set($a['tenant_id']);
        $foreign = $this->gateway();
        app(TenantContext::class)->set($b['tenant_id']);
        $cardB = $this->cardMethod($b);

        $this->putMethod($b, $cardB, ['pos_clearing_gateway_id' => $foreign->id])->assertStatus(422);

        // ربط مزوَّر مباشرةً في القاعدة: PaymentService يفشل مغلقاً عند البيع (البوابة خارج نطاق المستأجر).
        DB::table('payment_methods')->where('id', $cardB['id'])->update(['pos_clearing_gateway_id' => $foreign->id]);
        $session = $this->openSession($b);
        $partner = $this->customer($b);
        $this->checkout($b, $partner, $session, [['payment_method_id' => $cardB['id'], 'amount' => 11500]])->assertStatus(422);
        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame(0, Payment::query()->count());

        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@pos-clr-iso-a.test');
        app(TenantContext::class)->set($a['tenant_id']);
        $cardA = $this->cardMethod($a);
        $this->withToken($staff)->putJson("/api/payment-methods/{$cardA['id']}", $this->methodBody($cardA, ['pos_clearing_gateway_id' => $foreign->id]))
            ->assertForbidden();
    }

    // ═══════════════ إقفال الجلسة ═══════════════

    #[Test]
    public function session_close_distinguishes_the_clearing_portion_and_blind_count_hides_it(): void
    {
        $auth = $this->tenant('pos-clr-close');
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->linkedCard($auth, $this->gateway());
        $transfer = $this->methodNamed($auth, 'تحويل بنكي');
        $this->checkout($auth, $partner, $session, [
            ['payment_method_id' => $card['id'], 'amount' => 6000],
            ['payment_method_id' => $transfer['id'], 'amount' => 5500],
        ])->assertCreated();
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();

        $rows = collect($this->withToken($auth['token'])->getJson("/api/pos-sessions/{$session}/closing-preview")->assertOk()['data']['payment_methods'])->keyBy('payment_method_id');
        $this->assertSame('175.00', $rows[$card['id']]['expected_amount']);
        $this->assertSame('175.00', $rows[$card['id']]['clearing_amount']);
        $this->assertSame('0.00', $rows[$transfer['id']]['clearing_amount']);

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session}/close", [
            'closing_balance' => 0,
            'payment_counts' => [['payment_method_id' => $card['id'], 'counted_amount' => 17500]],
        ])->assertOk()->assertJsonPath('data.status', 'closed');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(17500, PosSessionReconciliation::query()->where('payment_method_id', $card['id'])->sole()->clearing_amount);
        $this->assertSame(0, PosSessionReconciliation::query()->where('payment_method_id', $transfer['id'])->sole()->clearing_amount);
        $this->assertNull(PosSessionReconciliation::query()->where('reconciliation_key', 'cash_drawer')->sole()->clearing_amount);
    }

    #[Test]
    public function blind_count_hides_the_clearing_portion_like_the_expected_amount(): void
    {
        $auth = $this->tenant('pos-clr-blind');
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['blind_cash_count_enabled' => true, 'audit_operation_policies' => [
                'item_remove' => 'allowed', 'price_override' => 'allowed', 'discount_change' => 'allowed', 'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
            ]],
        ])->assertOk();
        $session = $this->openSession($auth);
        $partner = $this->customer($auth);
        $card = $this->linkedCard($auth, $this->gateway());
        $this->checkout($auth, $partner, $session, [['payment_method_id' => $card['id'], 'amount' => 11500]])->assertCreated();

        $row = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$session}/closing-preview")->assertOk()['data']['payment_methods'][0];
        $this->assertNull($row['expected_amount']);
        $this->assertNull($row['clearing_amount']);
    }

    #[Test]
    public function the_migration_refuses_to_roll_back_while_any_method_is_linked(): void
    {
        $auth = $this->tenant('pos-clr-down');
        $this->linkedCard($auth, $this->gateway());
        $migration = require base_path('database/migrations/2026_11_27_010000_add_pos_clearing_to_payment_methods.php');

        $this->expectException(\RuntimeException::class);
        $migration->down();
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function tenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth;
    }

    private function gateway(): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create(['provider' => 'custom', 'name' => 'مستحوذ '.(++$this->seq), 'environment' => 'live']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);

        return $gateway->fresh();
    }

    private function openSession(array $auth): string
    {
        $n = ++$this->seq;
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => "مخزن {$n}", 'code' => "CLR-W-{$n}", 'is_active' => true])->assertCreated()['data']['id'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', ['name' => "كاشير {$n}", 'code' => "CLR-D-{$n}", 'warehouse_id' => $warehouse, 'is_active' => true])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $device])->assertCreated()['data']['id'];
    }

    private function customer(array $auth): string
    {
        return $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل '.(++$this->seq), 'type' => 'customer'])->assertCreated()['data']['id'];
    }

    private function checkout(array $auth, string $partner, string $session, array $tenders): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(), 'partner_id' => $partner, 'pos_session_id' => $session,
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]], 'tenders' => $tenders,
        ]);
    }

    private function methods(array $auth): array
    {
        return $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk()['data'];
    }

    private function methodNamed(array $auth, string $name): array
    {
        foreach ($this->methods($auth) as $method) {
            if ($method['name'] === $name) {
                return $method;
            }
        }
        $this->fail("لا توجد طريقة «{$name}».");
    }

    private function methodBySettlement(array $auth, string $type): array
    {
        foreach ($this->methods($auth) as $method) {
            if ($method['settlement_type'] === $type) {
                return $method;
            }
        }
        $this->fail("لا توجد طريقة {$type}.");
    }

    private function cardMethod(array $auth): array
    {
        return $this->methodNamed($auth, 'بطاقة ائتمان');
    }

    private function linkedCard(array $auth, PaymentGateway $gateway): array
    {
        $card = $this->cardMethod($auth);
        $this->putMethod($auth, $card, ['pos_clearing_gateway_id' => $gateway->id])->assertOk();

        return $this->cardMethod($auth);
    }

    private function methodBody(array $method, array $changes, bool $withLink = true): array
    {
        $body = [
            'name' => $method['name'], 'name_en' => $method['name_en'], 'settlement_type' => $method['settlement_type'],
            'cash_bank_account_id' => $method['cash_bank_account_id'], 'instructions' => $method['instructions'],
            'available_online' => $method['available_online'], 'is_active' => $method['is_active'], 'is_default' => $method['is_default'],
        ];
        if ($withLink) {
            $body['pos_clearing_gateway_id'] = $method['pos_clearing_gateway_id'];
        }

        return [...$body, ...$changes];
    }

    private function putMethod(array $auth, array $method, array $changes, bool $withLink = true): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($auth['token'])->putJson("/api/payment-methods/{$method['id']}", $this->methodBody($method, $changes, $withLink));
    }

    private function entry(Payment $payment): JournalEntry
    {
        return JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
    }

    private function lineFor(JournalEntry $entry, string $code): ?\App\Models\JournalLine
    {
        return $entry->lines->first(fn ($l) => $l->account->code === $code);
    }

    private function debit(JournalEntry $entry, string $code): int
    {
        return (int) ($this->lineFor($entry, $code)?->debit ?? 0);
    }

    private function credit(JournalEntry $entry, string $code): int
    {
        return (int) ($this->lineFor($entry, $code)?->credit ?? 0);
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()?->balance?->fresh()?->balance ?? 0);
    }

    private function mainBankId(): string
    {
        return \App\Models\CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail()->id;
    }
}
