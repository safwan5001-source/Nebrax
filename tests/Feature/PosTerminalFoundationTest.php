<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PosPaymentTerminal;
use App\Models\PosSession;
use App\Models\PosTerminalRequest;
use App\Services\FakePosTerminalAdapter;
use App\Services\PosTerminalAdapterRegistry;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H6-02 — أساس أجهزة دفع POS والتعويض: لا بيع بلا موافقة مؤكدة · لا موافقة يتيمة دون تعويض · عزل · لا أثر مالي من الخدمة نفسها.
 * البيع نفسه يمرّ بـPosService (A11/A12) ولا قيد جديد.
 */
class PosTerminalFoundationTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private int $seq = 0;

    private FakePosTerminalAdapter $fake;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->singleton(FakePosTerminalAdapter::class);
        $this->fake = app(FakePosTerminalAdapter::class);
    }

    // ═══════════════ الأجهزة ═══════════════

    #[Test]
    public function terminal_management_is_rbac_guarded_tenant_isolated_and_provider_bound_to_an_available_adapter(): void
    {
        $a = $this->tenant('pos-term-a');
        $b = $this->tenant('pos-term-b');
        $terminal = $this->terminal($a);

        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@pos-term-a.test');
        $this->withToken($staff)->postJson('/api/pos-payment-terminals', ['name' => 'ن', 'provider' => 'fake'])->assertForbidden();

        $this->withToken($a['token'])->postJson('/api/pos-payment-terminals', ['name' => 'جهاز حقيقي', 'provider' => 'stripe'])->assertStatus(422)
            ->assertJsonPath('reason', 'provider_unavailable');
        $this->withToken($a['token'])->postJson('/api/pos-payment-terminals', ['name' => $terminal['name'], 'provider' => 'fake'])->assertStatus(422);
        $this->withToken($a['token'])->putJson("/api/pos-payment-terminals/{$terminal['id']}", ['provider' => 'other'])->assertStatus(422);
        $this->withToken($a['token'])->putJson("/api/pos-payment-terminals/{$terminal['id']}", ['name' => 'اسم جديد'])->assertOk()->assertJsonPath('data.name', 'اسم جديد');

        $this->assertCount(1, $this->withToken($a['token'])->getJson('/api/pos-payment-terminals')->assertOk()['data']);
        $this->assertCount(0, $this->withToken($b['token'])->getJson('/api/pos-payment-terminals')->assertOk()['data']);
        $this->withToken($b['token'])->putJson("/api/pos-payment-terminals/{$terminal['id']}", ['name' => 'سرقة'])->assertNotFound();
    }

    #[Test]
    public function the_fake_terminal_adapter_is_not_resolvable_outside_local_and_testing(): void
    {
        $registry = app(PosTerminalAdapterRegistry::class);
        $this->assertTrue($registry->has('fake'));

        $this->app['env'] = 'production';
        try {
            $this->assertFalse($registry->has('fake'));
            $this->assertSame('adapter_unavailable', $this->thrown(fn () => $registry->for('fake'), 'يجب أن يفشل حل المحوّل', \App\Support\PosTerminalException::class)->reason);
        } finally {
            $this->app['env'] = 'testing';
        }
    }

    // ═══════════════ دورة الطلب ═══════════════

    #[Test]
    public function a_request_goes_pending_then_approved_by_the_device_truth_with_idempotent_create_and_one_active_per_terminal(): void
    {
        $ctx = $this->context('pos-term-life');
        $key = (string) Str::uuid();

        $created = $this->createRequest($ctx, 11500, $key)->assertCreated()->assertJsonPath('data.status', 'sent')->json('data');
        $this->createRequest($ctx, 11500, $key)->assertOk()->assertJsonPath('data.id', $created['id'])->assertJsonPath('data.idempotent_replay', true);
        $this->createRequest($ctx, 9900, $key)->assertStatus(409)->assertJsonPath('reason', 'idempotency_conflict');
        $this->createRequest($ctx, 11500)->assertStatus(409)->assertJsonPath('reason', 'terminal_busy');

        // الحقيقة من الجهاز: ما لم يوافق يبقى sent.
        $this->show($ctx, $created['id'])->assertJsonPath('data.status', 'sent');
        $this->fake->script($created['id'], 'approved');
        $this->show($ctx, $created['id'])->assertOk()
            ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.last4', '4242')->assertJsonPath('data.amount', '115.00');
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    #[Test]
    public function decline_cancel_start_failure_and_cash_methods_are_handled_without_any_financial_artifact(): void
    {
        $ctx = $this->context('pos-term-paths');

        $declined = $this->createRequest($ctx, 11500)->assertCreated()->json('data');
        $this->fake->script($declined['id'], 'declined', failureCode: 'insufficient_funds');
        $this->show($ctx, $declined['id'])->assertJsonPath('data.status', 'declined')->assertJsonPath('data.failure_code', 'insufficient_funds');

        $cancelled = $this->createRequest($ctx, 11500)->assertCreated()->json('data');
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$cancelled['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$cancelled['id']}/cancel")->assertStatus(422);

        // استثناء من المحوّل = نتيجة غامضة: يبقى sent بعلامة start_unconfirmed ويحجز الجهاز (لا خصم ثانٍ) حتى يُستعلَم أو يُلغى.
        $this->fake->failStartWith(new \RuntimeException('response lost'));
        $ambiguous = $this->createRequest($ctx, 11500)->assertCreated()->assertJsonPath('data.status', 'sent')->assertJsonPath('data.failure_code', 'start_unconfirmed')->json('data.id');
        $this->fake->failStartWith(null);
        $this->createRequest($ctx, 11500)->assertStatus(409)->assertJsonPath('reason', 'terminal_busy');
        $this->fake->script($ambiguous, 'approved');
        $this->show($ctx, $ambiguous)->assertOk()->assertJsonPath('data.status', 'approved')->assertJsonPath('data.failure_code', null);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$ambiguous}/void")->assertOk()->assertJsonPath('data.status', 'voided');

        // فشل قاطع يعلنه المحوّل (لم يُرسَل شيء) ⇒ error نهائي ويتحرر الجهاز.
        $definitive = $this->createRequest($ctx, 11500)->assertCreated()->json('data.id');
        $this->assertSame('sent', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($definitive)->status);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$definitive}/cancel")->assertOk();

        $cash = $this->methodBySettlement($ctx, 'cash');
        $this->createRequest($ctx, 11500, method: $cash['id'])->assertStatus(422)->assertJsonPath('reason', 'method_not_card');

        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
        $this->assertSame(0, Invoice::query()->count());
    }

    // ═══════════════ الاستهلاك في البيع ═══════════════

    #[Test]
    public function checkout_consumes_a_confirmed_approval_once_taking_references_from_the_device_and_posting_a11(): void
    {
        $ctx = $this->context('pos-term-consume');
        $id = $this->approvedRequest($ctx, 11500);

        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertCreated();

        $payment = Payment::query()->sole();
        $details = json_decode((string) $payment->payment_details, true);
        $request = PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id);
        $this->assertSame('consumed', $request->status);
        $this->assertSame($payment->id, $request->consumed_payment_id);
        $this->assertSame(Invoice::query()->sole()->id, $request->consumed_invoice_id);
        $this->assertSame($request->rrn, $payment->reference);
        $this->assertSame($id, $details['terminal_request_id']);
        $this->assertSame('4242', $details['last4']);
        $this->assertSame(11500, $this->balance($ctx, '1120'), 'A11 دون تغيير: بنك الطريقة');
        $this->assertSame([], $this->fake->voided, 'الموافقة المستهلكة لا تُلغى');

        // الاستهلاك مرة واحدة: إعادة الاستعمال ببيع جديد مرفوضة بلا مستند ولا إلغاء.
        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertStatus(422);
        $this->assertSame(1, Invoice::query()->count());
        $this->assertSame(1, Payment::query()->count());
        $this->assertSame('consumed', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id)->status);
    }

    #[Test]
    public function a_clearing_linked_method_consumes_the_approval_into_a12_and_the_replay_is_idempotent(): void
    {
        $ctx = $this->context('pos-term-a12');
        $gateway = PaymentGateway::query()->create(['provider' => 'custom', 'name' => 'مستحوذ', 'environment' => 'live']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        DB::table('payment_methods')->where('id', $ctx['card']['id'])->update(['pos_clearing_gateway_id' => $gateway->id]);
        $id = $this->approvedRequest($ctx, 11500);
        $key = (string) Str::uuid();
        $tenders = [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]];

        $first = $this->checkout($ctx, $tenders, $key)->assertCreated()['data'];
        $replay = $this->checkout($ctx, $tenders, $key)->assertOk()->assertJsonPath('idempotent_replay', true)['data'];

        $this->assertSame($first['id'], $replay['id']);
        $this->assertSame(11500, $this->balance($ctx, '1170'), 'A12 مرة واحدة');
        $this->assertSame(0, $this->balance($ctx, '1120'));
        $this->assertSame([], $this->fake->voided);
        $this->assertSame(1, Payment::query()->count());
    }

    #[Test]
    public function an_invalid_approval_never_sells_and_a_checkout_that_fails_after_it_voids_the_device_auth_automatically(): void
    {
        $ctx = $this->context('pos-term-bad');
        $card = $ctx['card']['id'];

        // 1) موافقة غير مؤكدة (sent): لا بيع ولا إلغاء (لم يوافق الجهاز بعد).
        $pending = $this->createRequest($ctx, 11500)->assertCreated()->json('data.id');
        $this->checkout($ctx, [['payment_method_id' => $card, 'amount' => 11500, 'terminal_request_id' => $pending]])->assertStatus(422);
        $this->assertSame('sent', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($pending)->status);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$pending}/cancel")->assertOk();

        // 2) مبلغ لا يطابق المبلغ الموافَق عليه ⇒ رفض، وتبقى الموافقة قائمة (لم تجتز التحقق فلا تُعوَّض آلياً)؛ يُلغيها الكاشير أو المجدول.
        $mismatch = $this->approvedRequest($ctx, 11000);
        $this->checkout($ctx, [['payment_method_id' => $card, 'amount' => 11500, 'terminal_request_id' => $mismatch]])->assertStatus(422);
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($mismatch)->status);
        $this->assertSame([], $this->fake->voided);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$mismatch}/void")->assertOk()->assertJsonPath('data.status', 'voided');

        // 3) فشل بعد اجتياز الموافقة كل الفحوص (مبلغ بنكي يتجاوز المتبقي) ⇒ تراجع كامل + إلغاء آلي.
        $over = $this->approvedRequest($ctx, 20000);
        $this->checkout($ctx, [['payment_method_id' => $card, 'amount' => 20000, 'terminal_request_id' => $over]])->assertStatus(422);
        $this->assertSame('voided', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($over)->status);
        $this->assertContains($over, $this->fake->voided);
        $this->assertNull(PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($over)->consumed_payment_id);

        // 4) مراجع يدوية مع موافقة الجهاز مرفوضة قبل التحقق من الموافقة ⇒ لا إلغاء آلي.
        $manual = $this->approvedRequest($ctx, 11500);
        $this->checkout($ctx, [['payment_method_id' => $card, 'amount' => 11500, 'terminal_request_id' => $manual, 'rrn' => '123456789012']])->assertStatus(422);
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($manual)->status);

        // 5) وسيلة خاطئة بنفس الجلسة (ملاحظة Codex): موافقة صالحة لا تُلغى بسبب طلب خاطئ.
        $transfer = $this->methodNamed($ctx, 'تحويل بنكي');
        $this->checkout($ctx, [['payment_method_id' => $transfer['id'], 'amount' => 11500, 'terminal_request_id' => $manual]])->assertStatus(422);
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($manual)->status);
        $this->assertNotContains($manual, $this->fake->voided);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$manual}/void")->assertOk();

        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    #[Test]
    public function an_approval_of_another_session_method_or_tenant_is_rejected_and_never_voided_by_the_wrong_checkout(): void
    {
        $ctx = $this->context('pos-term-scope');
        $other = $this->context('pos-term-scope-b');
        $id = $this->approvedRequest($ctx, 11500);

        // جلسة أخرى لنفس المستأجر (كاشير آخر): لا تستهلكها ولا تلغيها.
        $adminToken = $this->tokenForRole($ctx['tenant_id'], 'admin', 'admin@pos-term-scope.test');
        app(TenantContext::class)->set($ctx['tenant_id']);
        $adminCtx = [...$ctx, 'token' => $adminToken];
        $adminCtx['session'] = $this->openSession($adminCtx);
        $this->checkout($adminCtx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertStatus(422);
        app(TenantContext::class)->set($ctx['tenant_id']);
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id)->status, 'ليست من جلسة هذا البيع ⇒ لا إلغاء');

        // مستأجر آخر: الطلب غير موجود له، ولا يمسّه.
        $this->checkout($other, [['payment_method_id' => $other['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertStatus(422);
        $this->withToken($other['token'])->getJson("/api/pos/terminal-requests/{$id}")->assertNotFound();
        app(TenantContext::class)->set($ctx['tenant_id']);
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id)->status);

        // وسيلة أخرى.
        $transfer = $this->methodNamed($ctx, 'تحويل بنكي');
        $this->checkout($ctx, [['payment_method_id' => $transfer['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertStatus(422);
    }

    #[Test]
    public function a_method_that_requires_a_terminal_approval_rejects_a_sale_without_one(): void
    {
        $ctx = $this->context('pos-term-required');
        $this->putMethod($ctx, $ctx['card'], ['pos_terminal_required' => true])->assertOk()->assertJsonPath('data.pos_terminal_required', true);
        $cash = $this->methodBySettlement($ctx, 'cash');
        $this->putMethod($ctx, $cash, ['pos_terminal_required' => true])->assertStatus(422);

        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500]])->assertStatus(422);
        $this->assertSame(0, Invoice::query()->count());

        $id = $this->approvedRequest($ctx, 11500);
        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertCreated();
        $this->assertSame(1, Payment::query()->count());

        // الافتراضي مطفأ: طريقة أخرى لا تشترط شيئاً.
        $transfer = $this->methodNamed($ctx, 'تحويل بنكي');
        $this->assertFalse($transfer['pos_terminal_required']);
    }

    #[Test]
    public function an_approval_with_a_live_compensation_lease_cannot_be_consumed(): void
    {
        $ctx = $this->context('pos-term-lease');
        $id = $this->approvedRequest($ctx, 11500);
        DB::table('pos_terminal_requests')->where('id', $id)->update(['compensating_until' => now('UTC')->addSeconds(60)]);

        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $id]])->assertStatus(422);
        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id)->status, 'الإيجار لغيرنا: لا نلمسه');
    }

    // ═══════════════ التعويض وإقفال الجلسة ═══════════════

    #[Test]
    public function a_failed_void_becomes_compensation_required_blocks_the_session_close_and_clears_on_retry_or_manager_resolution(): void
    {
        $ctx = $this->context('pos-term-comp');
        $id = $this->approvedRequest($ctx, 20000);
        $this->fake->failVoidWith(new \RuntimeException('provider down'));

        // فشل البيع (مبلغ > المتبقي) ثم فشل الإلغاء ⇒ compensation_required.
        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 20000, 'terminal_request_id' => $id]])->assertStatus(422);
        $request = PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id);
        $this->assertSame('compensation_required', $request->status);
        $this->assertSame('void_failed', $request->last_void_error);
        $this->assertSame(1, $request->void_attempts);
        $this->assertNull($request->compensating_until);

        $preview = $this->withToken($ctx['token'])->getJson("/api/pos-sessions/{$ctx['session']}/closing-preview")->assertOk()['data'];
        $this->assertSame(1, $preview['terminal_blockers']['compensation_required']);
        $this->withToken($ctx['token'])->postJson("/api/pos-sessions/{$ctx['session']}/close", ['closing_balance' => 0])->assertStatus(422);
        $this->assertSame('open', PosSession::query()->findOrFail($ctx['session'])->status);

        // إعادة المحاولة بينما الجهاز ما زال معطلاً: يبقى معلّقاً ويزيد العدّاد.
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/void")->assertOk()->assertJsonPath('data.status', 'compensation_required')->assertJsonPath('data.void_attempts', 2);

        // الجهاز يعود: النجاح يفتح الإقفال.
        $this->fake->failVoidWith(null);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/void")->assertOk()->assertJsonPath('data.status', 'voided');
        $this->withToken($ctx['token'])->postJson("/api/pos-sessions/{$ctx['session']}/close", ['closing_balance' => 0])->assertOk()->assertJsonPath('data.status', 'closed');
    }

    #[Test]
    public function a_manager_can_resolve_a_stuck_compensation_with_a_note_and_an_unresolved_in_flight_request_also_blocks_close(): void
    {
        $ctx = $this->context('pos-term-resolve');
        $id = $this->approvedRequest($ctx, 11500);

        // موافقة قائمة غير مستهلكة تمنع الإقفال.
        $this->withToken($ctx['token'])->postJson("/api/pos-sessions/{$ctx['session']}/close", ['closing_balance' => 0])->assertStatus(422);

        $this->fake->failVoidWith(new \RuntimeException('down'));
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/void")->assertOk()->assertJsonPath('data.status', 'compensation_required');

        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/resolve", ['note' => 'abc'])->assertStatus(422);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/resolve", ['note' => 'أُعيد المبلغ للعميل من لوحة المزوّد'])->assertOk()
            ->assertJsonPath('data.status', 'compensated')->assertJsonPath('data.resolution_note', 'أُعيد المبلغ للعميل من لوحة المزوّد');
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/resolve", ['note' => 'مرة ثانية غير ممكنة'])->assertStatus(422);

        $cashier = $this->tokenForRole($ctx['tenant_id'], 'staff', 'staff@pos-term-resolve.test');
        $this->withToken($cashier)->postJson("/api/pos/terminal-requests/{$id}/resolve", ['note' => 'محاولة بلا صلاحية'])->assertForbidden();

        $this->withToken($ctx['token'])->postJson("/api/pos-sessions/{$ctx['session']}/close", ['closing_balance' => 0])->assertOk();
    }

    #[Test]
    public function a_device_approval_for_a_different_amount_is_voided_immediately_and_can_never_be_consumed(): void
    {
        $ctx = $this->context('pos-term-amount');
        $created = $this->createRequest($ctx, 11500)->assertCreated()->json('data');
        $this->fake->script($created['id'], 'approved', amountMinor: 99999);

        $this->show($ctx, $created['id'])->assertOk()->assertJsonPath('data.status', 'voided');
        $this->assertContains($created['id'], $this->fake->voided);
        $this->checkout($ctx, [['payment_method_id' => $ctx['card']['id'], 'amount' => 11500, 'terminal_request_id' => $created['id']]])->assertStatus(422);
        $this->assertSame(0, Payment::query()->count());
    }

    // ═══════════════ ملاحظات المراجعة: ملكية الجلسة، ربط الجهاز، حذف الطريقة، إيجار الحل ═══════════════

    #[Test]
    public function only_the_session_cashier_or_an_approver_can_inspect_cancel_or_void_a_terminal_request(): void
    {
        $ctx = $this->context('pos-term-owner');
        $id = $this->approvedRequest($ctx, 11500);
        $other = $this->tokenForRole($ctx['tenant_id'], 'accountant', 'acct@pos-term-owner.test'); // invoices.manage بلا pos.variance.approve
        app(TenantContext::class)->set($ctx['tenant_id']);

        $this->withToken($other)->getJson("/api/pos/terminal-requests/{$id}")->assertForbidden();
        $this->withToken($other)->postJson("/api/pos/terminal-requests/{$id}/cancel")->assertForbidden();
        $this->withToken($other)->postJson("/api/pos/terminal-requests/{$id}/void")->assertForbidden();
        $this->withToken($other)->getJson("/api/pos-sessions/{$ctx['session']}/terminal-requests")->assertForbidden();
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id)->status, 'لم يُلغَ بيع كاشير آخر');
        $this->assertSame([], $this->fake->voided);

        // كاشير الجلسة (المالك) والمعتمد (admin بـ*) يعملان.
        $this->withToken($ctx['token'])->getJson("/api/pos-sessions/{$ctx['session']}/terminal-requests")->assertOk();
        $admin = $this->tokenForRole($ctx['tenant_id'], 'admin', 'admin@pos-term-owner.test');
        $this->withToken($admin)->postJson("/api/pos/terminal-requests/{$id}/void")->assertOk()->assertJsonPath('data.status', 'voided');
    }

    #[Test]
    public function a_terminal_assigned_to_a_pos_device_only_serves_sessions_on_that_device(): void
    {
        $ctx = $this->context('pos-term-device');
        app(TenantContext::class)->set($ctx['tenant_id']);
        $deviceA = PosSession::query()->withoutGlobalScopes()->findOrFail($ctx['session'])->pos_device_id;
        $this->withToken($ctx['token'])->putJson("/api/pos-payment-terminals/{$ctx['terminal']['id']}", ['pos_device_id' => $deviceA])->assertOk();

        $adminToken = $this->tokenForRole($ctx['tenant_id'], 'admin', 'admin@pos-term-device.test');
        app(TenantContext::class)->set($ctx['tenant_id']);
        $adminCtx = [...$ctx, 'token' => $adminToken];
        $adminCtx['session'] = $this->openSession($adminCtx); // جهاز POS آخر
        $this->createRequest($adminCtx, 11500)->assertStatus(422)->assertJsonPath('reason', 'terminal_device_mismatch');

        $this->createRequest($ctx, 11500)->assertCreated()->assertJsonPath('data.status', 'sent'); // جهازه
        $this->assertSame(1, PosTerminalRequest::query()->withoutGlobalScopes()->count());

        // غير مخصَّص ⇒ متاح لأي جهاز في الفرع.
        $free = $this->terminal($ctx, 'جهاز حر');
        $this->createRequest($adminCtx, 11500, terminal: $free['id'])->assertCreated();
    }

    #[Test]
    public function deleting_a_payment_method_with_terminal_history_is_a_validation_error_not_a_500(): void
    {
        $ctx = $this->context('pos-term-del');
        $method = $this->withToken($ctx['token'])->postJson('/api/payment-methods', [
            'name' => 'بطاقة اختبار الحذف', 'settlement_type' => 'bank', 'cash_bank_account_id' => $ctx['card']['cash_bank_account_id'],
        ])->assertCreated()['data'];
        $id = $this->createRequest($ctx, 11500, method: $method['id'])->assertCreated()->json('data.id');
        $this->fake->script($id, 'declined');
        $this->show($ctx, $id)->assertJsonPath('data.status', 'declined');

        $this->withToken($ctx['token'])->deleteJson("/api/payment-methods/{$method['id']}")->assertStatus(422);
        $this->assertNotNull(\App\Models\PaymentMethod::query()->find($method['id']));
    }

    #[Test]
    public function a_manager_cannot_resolve_while_a_void_attempt_holds_a_live_lease(): void
    {
        $ctx = $this->context('pos-term-lease-resolve');
        $id = $this->approvedRequest($ctx, 11500);
        DB::table('pos_terminal_requests')->where('id', $id)->update(['status' => 'compensation_required', 'compensating_until' => now('UTC')->addSeconds(60)]);

        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/resolve", ['note' => 'أُعيد المبلغ خارجياً'])->assertStatus(422)
            ->assertJsonPath('reason', 'compensation_in_progress');
        $this->assertSame('compensation_required', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id)->status);

        DB::table('pos_terminal_requests')->where('id', $id)->update(['compensating_until' => now('UTC')->subSecond()]);
        $this->withToken($ctx['token'])->postJson("/api/pos/terminal-requests/{$id}/resolve", ['note' => 'أُعيد المبلغ خارجياً'])->assertOk()->assertJsonPath('data.status', 'compensated');
    }

    // ═══════════════ المجدول ═══════════════

    #[Test]
    public function the_sweeper_voids_orphan_approvals_expires_stale_pending_requests_and_retries_stuck_compensation(): void
    {
        $ctx = $this->context('pos-term-sweep');
        $orphan = $this->approvedRequest($ctx, 11500);
        DB::table('pos_terminal_requests')->where('id', $orphan)->update(['approved_at' => now('UTC')->subMinutes(30)]);

        // طلب معلّق قديم على جهاز ثانٍ.
        $second = $this->terminal($ctx, 'جهاز ثانٍ');
        $stale = $this->createRequest($ctx, 5000, terminal: $second['id'])->assertCreated()->json('data.id');
        DB::table('pos_terminal_requests')->where('id', $stale)->update(['created_at' => now('UTC')->subMinutes(40)]);

        // تعويض عالق قديم.
        $stuckTerminal = $this->terminal($ctx, 'جهاز ثالث');
        $stuck = $this->approvedRequest($ctx, 7000, terminal: $stuckTerminal['id']);
        DB::table('pos_terminal_requests')->where('id', $stuck)->update(['status' => 'compensation_required', 'last_void_error' => 'void_failed', 'updated_at' => now('UTC')->subMinutes(20)]);

        // طازج: لا يُمسّ.
        $fresh = $this->terminal($ctx, 'جهاز رابع');
        $recent = $this->approvedRequest($ctx, 3000, terminal: $fresh['id']);

        $this->artisan('pos:sweep-terminals')->assertSuccessful();

        $this->assertSame('voided', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($orphan)->status);
        $this->assertSame('expired', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($stale)->status);
        $this->assertSame('voided', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($stuck)->status);
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($recent)->status);
        $this->assertNull(app(TenantContext::class)->id() === $ctx['tenant_id'] ? null : app(TenantContext::class)->id());

        // تكرار آمن.
        $this->artisan('pos:sweep-terminals')->assertSuccessful();
        $this->assertSame('approved', PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($recent)->status);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    // ═══════════════ حراس النموذج والقاعدة ═══════════════

    #[Test]
    public function the_request_model_and_database_refuse_identity_rewrites_illegal_transitions_deletes_and_bad_rows(): void
    {
        $ctx = $this->context('pos-term-guard');
        $id = $this->approvedRequest($ctx, 11500);
        app(TenantContext::class)->set($ctx['tenant_id']);
        $request = PosTerminalRequest::query()->withoutGlobalScopes()->findOrFail($id);

        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $request->update(['amount' => 1]), 'amount', LogicException::class));
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $request->update(['pos_session_id' => (string) Str::uuid()]), 'session', LogicException::class));
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $request->update(['status' => 'sent']), 'transition', LogicException::class));
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $request->delete(), 'delete', LogicException::class));

        // SQL خام: مبلغ غير موجب أو حالة مجهولة مرفوضان في القاعدة بالمحرّكين.
        $this->assertNotNull($this->thrown(fn () => DB::table('pos_terminal_requests')->where('id', $id)->update(['amount' => 0]), 'amount>0', \Throwable::class));
        $this->assertNotNull($this->thrown(fn () => DB::table('pos_terminal_requests')->where('id', $id)->update(['status' => 'bogus']), 'status', \Throwable::class));
        // طلب نشط ثانٍ على الجهاز نفسه مرفوض في القاعدة.
        $this->assertNotNull($this->thrown(fn () => DB::table('pos_terminal_requests')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $ctx['tenant_id'], 'branch_id' => $request->branch_id, 'pos_session_id' => $request->pos_session_id,
            'pos_payment_terminal_id' => $request->pos_payment_terminal_id, 'payment_method_id' => $request->payment_method_id,
            'idempotency_key' => (string) Str::uuid(), 'amount' => 100, 'currency' => 'SAR', 'status' => 'created', 'void_attempts' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]), 'active-unique', \Throwable::class));
    }

    #[Test]
    public function the_terminal_layer_never_touches_the_ledger_and_the_migration_refuses_rollback_with_data(): void
    {
        $forbidden = '/LedgerService|PaymentService|JournalEntry|JournalLine|InvoiceService|ZatcaService|table\([\'"](journal_|payments[\'"]|invoices)/';
        foreach (['app/Services/PosTerminalService.php', 'app/Services/PosTerminalAdapterRegistry.php', 'app/Services/FakePosTerminalAdapter.php', 'app/Models/PosTerminalRequest.php', 'app/Http/Controllers/Api/PosTerminalController.php'] as $file) {
            $this->assertDoesNotMatchRegularExpression($forbidden, php_strip_whitespace(base_path($file)), $file);
        }

        $ctx = $this->context('pos-term-down');
        $this->approvedRequest($ctx, 11500);
        $migration = require base_path('database/migrations/2026_11_28_010000_create_pos_payment_terminals.php');
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

    /** مستأجر + جهاز دفع + جلسة مفتوحة + عميل + طريقة بطاقة. */
    private function context(string $slug): array
    {
        $auth = $this->tenant($slug);
        $auth['terminal'] = $this->terminal($auth);
        $auth['session'] = $this->openSession($auth);
        $auth['partner'] = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل '.(++$this->seq), 'type' => 'customer'])->assertCreated()['data']['id'];
        $auth['card'] = $this->methodNamed($auth, 'بطاقة ائتمان');

        return $auth;
    }

    private function terminal(array $auth, ?string $name = null): array
    {
        app(TenantContext::class)->set($auth['tenant_id']);

        return $this->withToken($auth['token'])->postJson('/api/pos-payment-terminals', ['name' => $name ?? 'جهاز '.(++$this->seq), 'provider' => 'fake'])->assertCreated()['data'];
    }

    private function openSession(array $auth): string
    {
        $n = ++$this->seq;
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => "مخزن {$n}", 'code' => "TRM-W-{$n}", 'is_active' => true])->assertCreated()['data']['id'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', ['name' => "كاشير {$n}", 'code' => "TRM-D-{$n}", 'warehouse_id' => $warehouse, 'is_active' => true])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $device])->assertCreated()['data']['id'];
    }

    private function createRequest(array $ctx, int $amount, ?string $key = null, ?string $method = null, ?string $terminal = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($ctx['token'])->postJson('/api/pos/terminal-requests', [
            'pos_session_id' => $ctx['session'],
            'pos_payment_terminal_id' => $terminal ?? $ctx['terminal']['id'],
            'payment_method_id' => $method ?? $ctx['card']['id'],
            'amount' => $amount,
            'idempotency_key' => $key ?? (string) Str::uuid(),
        ]);
    }

    private function show(array $ctx, string $id): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($ctx['token'])->getJson("/api/pos/terminal-requests/{$id}");
    }

    private function approvedRequest(array $ctx, int $amount, ?string $terminal = null): string
    {
        $id = $this->createRequest($ctx, $amount, terminal: $terminal)->assertCreated()->json('data.id');
        $this->fake->script($id, 'approved');
        $this->show($ctx, $id)->assertOk()->assertJsonPath('data.status', 'approved');

        return $id;
    }

    private function checkout(array $ctx, array $tenders, ?string $key = null, ?string $session = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($ctx['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => $key ?? (string) Str::uuid(),
            'partner_id' => $ctx['partner'],
            'pos_session_id' => $session ?? $ctx['session'],
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => $tenders,
        ]);
    }

    private function methods(array $ctx): array
    {
        return $this->withToken($ctx['token'])->getJson('/api/payment-methods')->assertOk()['data'];
    }

    private function methodNamed(array $ctx, string $name): array
    {
        foreach ($this->methods($ctx) as $method) {
            if ($method['name'] === $name) {
                return $method;
            }
        }
        $this->fail("لا توجد طريقة «{$name}».");
    }

    private function methodBySettlement(array $ctx, string $type): array
    {
        foreach ($this->methods($ctx) as $method) {
            if ($method['settlement_type'] === $type) {
                return $method;
            }
        }
        $this->fail("لا توجد طريقة {$type}.");
    }

    private function putMethod(array $ctx, array $method, array $changes): \Illuminate\Testing\TestResponse
    {
        $body = [
            'name' => $method['name'], 'name_en' => $method['name_en'], 'settlement_type' => $method['settlement_type'],
            'cash_bank_account_id' => $method['cash_bank_account_id'], 'instructions' => $method['instructions'],
            'available_online' => $method['available_online'], 'is_active' => $method['is_active'], 'is_default' => $method['is_default'],
        ];

        return $this->withToken($ctx['token'])->putJson("/api/payment-methods/{$method['id']}", [...$body, ...$changes]);
    }

    private function balance(array $ctx, string $code): int
    {
        app(TenantContext::class)->set($ctx['tenant_id']);

        return (int) (Account::where('code', $code)->first()?->balance?->fresh()?->balance ?? 0);
    }
}
