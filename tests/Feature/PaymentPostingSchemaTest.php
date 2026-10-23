<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPosting;
use App\Models\PaymentGateway;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * PAY-H2-02a — مخطط طلبات دفع الفواتير ومجموعة ترحيل الالتقاط (ADR-0006): الحراس والقيود وعزل المستأجر. لا ترحيل في هذه الشريحة.
 */
class PaymentPostingSchemaTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_29_010000_create_invoice_payment_requests_and_posting_tables.php';

    private Tenant $tenant;

    private Partner $customer;

    private PaymentGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'شركة مخطط الترحيل', 'slug' => 'pay-h2-02a', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->gateway = $this->gateway();
    }

    // ═══════════════ طلب الدفع ═══════════════

    #[Test]
    public function a_request_defaults_to_open_without_partial_payment_and_exposes_its_payable_key_but_never_the_token_hash(): void
    {
        $request = $this->request($this->invoice());

        $this->assertSame('open', $request->status);
        $this->assertFalse($request->allow_partial);
        $this->assertSame('invoice_payment_request:'.$request->id, $request->payableKey());
        $this->assertMatchesRegularExpression('/^[a-z][a-z0-9_.-]*:[A-Za-z0-9_-]{1,100}$/', $request->payableKey());
        $this->assertArrayNotHasKey('token_hash', $request->toArray());
    }

    #[Test]
    public function the_status_can_only_leave_open_once_and_identity_and_partial_flag_are_immutable(): void
    {
        $request = $this->request($this->invoice(), ['allow_partial' => true]);

        foreach (['allow_partial' => false, 'currency' => 'USD', 'invoice_id' => $this->invoice()->id, 'partner_id' => null, 'payment_gateway_id' => $this->gateway()->id] as $field => $value) {
            $e = $this->thrown(fn () => $request->forceFill([$field => $value])->save(), $field, LogicException::class);
            $this->assertStringContainsString('immutable', $e->getMessage(), $field);
            $request->refresh();
        }

        $request->forceFill(['status' => 'cancelled', 'cancelled_at' => now()])->save();
        $this->thrown(fn () => $request->forceFill(['status' => 'open'])->save(), 'reopen', LogicException::class);
        $this->thrown(fn () => $request->forceFill(['status' => 'completed'])->save(), 'cancelled→completed', LogicException::class);
        $this->thrown(fn () => $request->delete(), 'delete', LogicException::class);
    }

    #[Test]
    public function the_database_allows_one_open_request_per_invoice_and_unique_token_hashes(): void
    {
        $invoice = $this->invoice();
        $first = $this->request($invoice, ['token_hash' => str_repeat('a', 64)]);

        $this->thrownDb(fn () => $this->request($invoice), 'second open request');

        $first->forceFill(['status' => 'cancelled'])->save();
        $second = $this->request($invoice);                         // بعد الإلغاء يجوز طلب جديد
        $this->assertSame('open', $second->status);

        $other = $this->request($this->invoice(), ['token_hash' => str_repeat('b', 64)]);
        $this->thrownDb(fn () => DB::table('invoice_payment_requests')->where('id', $other->id)->update(['token_hash' => str_repeat('a', 64)]), 'duplicate token');
    }

    #[Test]
    public function a_raw_row_with_an_unknown_status_is_rejected_by_the_database(): void
    {
        $request = $this->request($this->invoice());

        $this->thrownDb(fn () => DB::table('invoice_payment_requests')->where('id', $request->id)->update(['status' => 'weird']), 'status');
        $this->assertSame('open', $request->fresh()->status);
    }

    #[Test]
    public function another_tenants_invoice_or_gateway_can_never_be_referenced(): void
    {
        $invoice = $this->invoice();
        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h2-02a-x', 'vat_number' => '300000000000015', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $this->assertSame(0, InvoicePaymentRequest::query()->count());

        $foreignGateway = $this->thrown(fn () => $this->request($invoice, ['payment_gateway_id' => $this->gateway()->id]), 'foreign invoice', DomainException::class);
        $this->assertStringContainsString('invoice', $foreignGateway->getMessage());

        app(TenantContext::class)->set($this->tenant->id);
        $mine = $this->request($invoice);
        $this->assertSame(1, InvoicePaymentRequest::query()->count());

        app(TenantContext::class)->set($other->id);
        $this->assertSame(0, InvoicePaymentRequest::query()->count());
        $this->assertNull(InvoicePaymentRequest::query()->find($mine->id));

        app(TenantContext::class)->set($this->tenant->id);
        $forged = (new InvoicePaymentRequest)->forceFill([
            'invoice_id' => $invoice->id, 'partner_id' => $this->customer->id, 'payment_gateway_id' => $this->gateway->id, 'currency' => 'SAR', 'tenant_id' => $other->id,
        ]);
        $this->thrown(fn () => $forged->save(), 'forged tenant', DomainException::class);
    }

    // ═══════════════ مجموعة الترحيل ═══════════════

    #[Test]
    public function a_posting_group_has_one_payment_per_role_and_a_payment_belongs_to_one_group(): void
    {
        [$attempt] = $this->capturedAttempt();
        $paymentA = $this->payment($attempt, 80000);
        $paymentB = $this->payment($attempt, 35000);

        $allocated = $this->posting($attempt, 'allocated', $paymentA, 80000);
        $this->thrownDb(fn () => $this->posting($attempt, 'allocated', $paymentB, 35000), 'duplicate role');
        $this->thrownDb(fn () => $this->posting($attempt, 'excess', $paymentA, 80000), 'payment reuse');
        $excess = $this->posting($attempt, 'excess', $paymentB, 35000);

        $this->assertSame(2, PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->count());
        $this->assertSame(115000, (int) PaymentAttemptPosting::query()->sum('amount_minor'));
        $this->assertNotSame($allocated->id, $excess->id);
    }

    #[Test]
    public function postings_are_append_only_and_validated(): void
    {
        [$attempt] = $this->capturedAttempt();
        $payment = $this->payment($attempt, 115000);
        $posting = $this->posting($attempt, 'allocated', $payment, 115000);

        $this->thrown(fn () => $posting->forceFill(['amount_minor' => 1])->save(), 'update', LogicException::class);
        $this->thrown(fn () => $posting->delete(), 'delete', LogicException::class);
        $this->assertSame(115000, (int) $posting->fresh()->amount_minor);
        $this->thrown(fn () => $this->posting($attempt, 'bogus', $this->payment($attempt, 100), 100), 'role', DomainException::class);
        $this->thrown(fn () => $this->posting($attempt, 'excess', $this->payment($attempt, 100), 0), 'amount', DomainException::class);
        $this->thrownDb(fn () => DB::table('payment_attempt_postings')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id, 'payment_attempt_id' => $attempt->id,
            'role' => 'excess', 'payment_id' => $this->payment($attempt, 100)->id, 'amount_minor' => -5,
        ]), 'raw negative');
    }

    #[Test]
    public function a_posting_cannot_reference_another_tenants_attempt_or_payment(): void
    {
        [$attempt] = $this->capturedAttempt();
        $payment = $this->payment($attempt, 115000);

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h2-02a-y', 'vat_number' => '300000000000015', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $this->thrown(fn () => $this->posting($attempt, 'allocated', $payment, 115000), 'foreign refs', DomainException::class);
        $this->assertSame(0, PaymentAttemptPosting::query()->count());
    }

    // ═══════════════ حالة الترحيل على المحاولة ═══════════════

    #[Test]
    public function posting_state_follows_the_closed_transition_map_and_requires_a_captured_attempt(): void
    {
        [$attempt, $created] = $this->capturedAttempt();

        $this->assertNull($attempt->posting_status);
        $this->thrown(fn () => $created->forceFill(['posting_status' => 'pending'])->save(), 'uncaptured', LogicException::class);

        $attempt->forceFill(['posting_status' => 'pending'])->save();
        $this->thrown(fn () => $attempt->forceFill(['posting_status' => 'bogus'])->save(), 'unknown', LogicException::class);
        $attempt->refresh();

        $attempt->forceFill(['posting_status' => 'blocked_period', 'accounting_date' => '2026-10-01', 'posting_blocked_reason' => ['kind' => 'year', 'id' => 'fy-1']])->save();
        $this->assertSame('2026-10-01', $attempt->fresh()->accounting_date->toDateString());
        $this->assertSame('year', $attempt->fresh()->posting_blocked_reason['kind']);

        $this->thrown(fn () => $attempt->forceFill(['posting_status' => 'pending'])->save(), 'blocked→pending', LogicException::class);
        $attempt->refresh();
        $this->thrown(fn () => $attempt->forceFill(['accounting_date' => '2026-10-02'])->save(), 'date change', LogicException::class);
        $attempt->refresh();

        $attempt->forceFill(['posting_status' => 'posted', 'posted_at' => now()])->save();   // R1
        foreach (['pending', 'blocked_period', 'not_postable'] as $to) {
            $this->thrown(fn () => $attempt->forceFill(['posting_status' => $to])->save(), "posted→{$to}", LogicException::class);
            $attempt->refresh();
        }
        $this->thrown(fn () => $attempt->forceFill(['posted_at' => now()->addDay()])->save(), 'posted_at', LogicException::class);
    }

    #[Test]
    public function the_database_rejects_unknown_posting_states_and_posting_on_an_uncaptured_attempt(): void
    {
        [$attempt, $created] = $this->capturedAttempt();

        $this->thrownDb(fn () => DB::table('payment_attempts')->where('id', $attempt->id)->update(['posting_status' => 'weird']), 'unknown');
        $this->thrownDb(fn () => DB::table('payment_attempts')->where('id', $created->id)->update(['posting_status' => 'pending']), 'uncaptured');
        $this->assertNull($attempt->fresh()->posting_status);
    }

    #[Test]
    public function the_migration_refuses_to_roll_back_while_rows_or_posting_state_exist(): void
    {
        $migration = require database_path('migrations/'.self::MIGRATION);

        [$attempt] = $this->capturedAttempt();
        $attempt->forceFill(['posting_status' => 'pending'])->save();
        $this->thrown(fn () => $migration->down(), 'posting state', RuntimeException::class);

        $attempt->forceFill(['posting_status' => 'not_postable'])->save();
        $this->request($this->invoice());
        $this->thrown(fn () => $migration->down(), 'rows', RuntimeException::class);
        $this->assertSame(1, InvoicePaymentRequest::query()->count());
    }

    // ═══════════════ مساعدات ═══════════════

    /** يتوقّع QueryException من عملية قاعدة بيانات داخل savepoint (PostgreSQL يُبطل المعاملة كلها عند أول خطأ SQL). */
    private function thrownDb(callable $operation, string $failure): QueryException
    {
        /** @var QueryException $e */
        $e = $this->thrown(fn () => DB::transaction($operation), $failure, QueryException::class);

        return $e;
    }

    private function gateway(): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake '.uniqid(), 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);

        return $gateway->fresh();
    }

    private function invoice(): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return app(InvoiceService::class)->post($invoice);
    }

    /** @param array<string, mixed> $over */
    private function request(Invoice $invoice, array $over = []): InvoicePaymentRequest
    {
        return InvoicePaymentRequest::create(array_merge([
            'invoice_id' => $invoice->id, 'partner_id' => $invoice->partner_id, 'payment_gateway_id' => $this->gateway->id, 'currency' => 'SAR',
        ], $over));
    }

    /** @return array{0: PaymentAttempt, 1: PaymentAttempt} [ملتقطة، غير ملتقطة] */
    private function capturedAttempt(): array
    {
        $make = fn (string $key) => PaymentAttempt::query()->create([
            'payment_gateway_id' => $this->gateway->id, 'provider' => 'fake', 'environment' => 'sandbox',
            'payable_key' => 'invoice_payment_request:'.$key, 'idempotency_key' => 'idem-'.$key, 'amount_minor' => 115000, 'currency' => 'SAR',
        ]);
        $captured = $make('cap-'.uniqid());
        $captured->forceFill(['provider_payment_id' => 'prov-'.uniqid(), 'capture_status' => 'pending_customer'])->save();
        $captured->forceFill(['capture_status' => 'captured', 'captured_minor' => 115000, 'captured_at' => now()])->save();
        $open = $make('open-'.uniqid());

        return [$captured->fresh(), $open];
    }

    private function payment(PaymentAttempt $attempt, int $amount): Payment
    {
        return Payment::query()->create([
            'number' => 'RCT-'.uniqid(), 'partner_id' => $this->customer->id, 'direction' => 'received', 'method' => 'bank',
            'payment_date' => now()->toDateString(), 'amount' => $amount, 'status' => 'draft',
        ]);
    }

    private function posting(PaymentAttempt $attempt, string $role, Payment $payment, int $amount): PaymentAttemptPosting
    {
        return PaymentAttemptPosting::create(['payment_attempt_id' => $attempt->id, 'role' => $role, 'payment_id' => $payment->id, 'amount_minor' => $amount]);
    }
}
