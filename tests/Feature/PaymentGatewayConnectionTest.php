<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentConnectionEvent;
use App\Models\PaymentGateway;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\Accounting\PaymentService;
use App\Services\PaymentGatewayService;
use App\Support\PaymentGatewayException;
use App\Tenancy\TenantContext;
use Closure;
use DomainException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/** PAY-H1-01 — دورة حياة اتصال بوابة الدفع: الحالة، التدوير، الحذف الآمن، التدقيق، العزل. */
class PaymentGatewayConnectionTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = '2026_11_23_010000_harden_payment_gateway_connections.php';

    private Tenant $tenant;

    private PaymentGatewayService $service;

    private User $actor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة اتصالات الدفع',
            'slug' => 'pay-h1-01',
            'vat_number' => '300000000000013',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->service = app(PaymentGatewayService::class);
        $this->actor = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h1-01.test',
            'password' => 'password123', 'role' => 'owner',
        ]);
    }

    // ───────────────────────── الإنشاء والحالة ─────────────────────────

    /** @test */
    public function a_new_connection_is_a_draft_that_is_not_usable_and_records_a_created_event(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_STRIPE, 'secret_key' => 'sk_test_a']);

        $this->assertSame(PaymentGateway::STATUS_DRAFT, $gateway->status);
        $this->assertSame(PaymentGateway::MODE_BYOG, $gateway->connection_mode);
        $this->assertSame(1, $gateway->credential_version);
        $this->assertFalse($gateway->isUsable());
        $this->assertSame(64, strlen($gateway->webhook_key));

        $event = PaymentConnectionEvent::where('payment_gateway_id', $gateway->id)->firstOrFail();
        $this->assertSame('created', $event->event_type);
        $this->assertNull($event->from_status);
        $this->assertSame('draft', $event->to_status);
        $this->assertSame($this->actor->id, $event->actor_user_id);
        $this->assertSame($this->tenant->id, $event->tenant_id);
    }

    /** @test */
    public function lifecycle_fields_cannot_be_mass_assigned(): void
    {
        $gateway = PaymentGateway::create([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'name' => 'محاولة تزوير',
            'status' => PaymentGateway::STATUS_ACTIVE,
            'credential_version' => 99,
            'verified_at' => now(),
            'webhook_key' => 'forged',
        ]);

        $this->assertSame(PaymentGateway::STATUS_DRAFT, $gateway->fresh()->status);
        $this->assertSame(1, $gateway->fresh()->credential_version);
        $this->assertNull($gateway->fresh()->verified_at);
        $this->assertNotSame('forged', $gateway->fresh()->webhook_key);
    }

    /** @test */
    public function webhook_keys_are_unique_per_connection(): void
    {
        $a = $this->connection(['name' => 'أ']);
        $b = $this->connection(['name' => 'ب']);

        $this->assertNotSame($a->webhook_key, $b->webhook_key);
    }

    /** @test */
    public function custom_connections_activate_directly_and_real_providers_need_verification(): void
    {
        $custom = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM, 'name' => 'يدوي']);
        $active = $this->service->activate($custom, $this->actor);
        $this->assertSame(PaymentGateway::STATUS_ACTIVE, $active->status);
        $this->assertTrue($active->is_active);
        $this->assertTrue($active->isUsable());
        $this->assertNotNull($active->activated_at);

        $stripe = $this->connection(['provider' => PaymentGateway::PROVIDER_STRIPE, 'name' => 'ستريب', 'secret_key' => 'sk_x']);
        $events = PaymentConnectionEvent::count();
        $this->assertSame('gateway.verification_required', $this->reason(fn () => $this->service->activate($stripe, $this->actor)));
        $this->assertSame(PaymentGateway::STATUS_DRAFT, $stripe->fresh()->status);
        $this->assertSame($events, PaymentConnectionEvent::count(), 'الرفض لا يكتب حدثاً');
    }

    /** @test */
    public function suspend_and_reactivate_follow_the_lifecycle_and_are_idempotent(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]);
        $this->assertSame('gateway.not_active', $this->reason(fn () => $this->service->suspend($gateway, $this->actor)));

        $this->service->activate($gateway, $this->actor);
        $suspended = $this->service->suspend($gateway, $this->actor, 'مراجعة');
        $this->assertSame(PaymentGateway::STATUS_SUSPENDED, $suspended->status);
        $this->assertFalse($suspended->is_active);
        $this->assertFalse($suspended->isUsable());
        $this->assertNotNull($suspended->deactivated_at);

        $count = PaymentConnectionEvent::count();
        $this->service->suspend($suspended, $this->actor); // idempotent
        $this->assertSame($count, PaymentConnectionEvent::count());

        $again = $this->service->activate($suspended, $this->actor);
        $this->assertTrue($again->isUsable());
        $this->assertNull($again->deactivated_at);

        $this->assertEqualsCanonicalizing(
            ['created', 'activated', 'suspended', 'reactivated'],
            PaymentConnectionEvent::where('payment_gateway_id', $gateway->id)->pluck('event_type')->all()
        );
    }

    /** @test */
    public function revoking_requires_a_reason_erases_credentials_and_is_final(): void
    {
        $gateway = $this->connection([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'secret_key' => 'sk_to_erase', 'webhook_secret' => 'whsec_to_erase', 'extra_credentials' => ['k' => 'v_to_erase'],
        ]);
        $this->service->activate($gateway, $this->actor);

        $this->assertSame('gateway.reason_required', $this->reason(fn () => $this->service->revoke($gateway, $this->actor)));
        $this->assertSame('sk_to_erase', $this->service->providerCredentials($gateway->fresh())['secret_key']);

        $revoked = $this->service->revoke($gateway, $this->actor, 'تسرب مفتاح');
        $this->assertSame(PaymentGateway::STATUS_REVOKED, $revoked->status);
        $this->assertFalse($revoked->isUsable());
        $row = DB::table('payment_gateways')->where('id', $gateway->id)->first();
        $this->assertNull($row->secret_key);
        $this->assertNull($row->webhook_secret);
        $this->assertNull($row->extra_credentials);
        $this->assertNull($row->previous_webhook_secret);
        $this->assertSame(2, (int) $row->credential_version);

        $count = PaymentConnectionEvent::count();
        $this->service->revoke($revoked, $this->actor, 'مرة ثانية'); // idempotent
        $this->assertSame($count, PaymentConnectionEvent::count());

        $this->assertSame('gateway.revoked', $this->reason(fn () => $this->service->activate($revoked, $this->actor)));
        $this->assertSame('gateway.revoked', $this->reason(fn () => $this->service->update($revoked, ['name' => 'اسم جديد'], $this->actor)));
        $this->assertSame('gateway.revoked', $this->reason(fn () => $this->service->rotateCredentials($revoked, ['secret_key' => 'sk_new'], 0, $this->actor)));
    }

    // ───────────────────────── الحذف الآمن ─────────────────────────

    /** @test */
    public function a_connection_linked_to_a_payment_cannot_be_deleted_and_the_link_survives(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $payment = app(PaymentService::class)->create([
            'partner_id' => $customer->id, 'amount' => 5000, 'method' => 'bank', 'payment_gateway_id' => $gateway->id,
        ]);

        $this->assertSame('gateway.has_references', $this->reason(fn () => $this->service->delete($gateway, $this->actor)));
        $this->assertSame('gateway.has_references', $this->reason(fn () => $gateway->fresh()->delete()), 'حارس النموذج يغطي أي مسار حذف');

        $this->assertNotNull(PaymentGateway::find($gateway->id));
        $this->assertSame($gateway->id, $payment->fresh()->payment_gateway_id);
        $this->assertSame(0, PaymentConnectionEvent::where('payment_gateway_id', $gateway->id)->where('event_type', 'deleted')->count());
    }

    /** @test */
    public function a_connection_with_a_settlement_cannot_be_deleted(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_STRIPE, 'name' => 'مسوّى']);
        $customer = Partner::create(['name' => 'عميل التسوية', 'type' => 'customer']);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));
        $payments = app(PaymentService::class);
        $payment = $payments->post($payments->create([
            'partner_id' => $customer->id, 'invoice_id' => $invoice->id, 'amount' => 115000,
            'method' => 'bank', 'payment_gateway_id' => $gateway->id,
        ]));
        app(CashBankAccountService::class)->bootstrapDefaults();
        $bank = CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail();
        app(PaymentGatewaySettlementService::class)->post([
            'payment_gateway_id' => $gateway->id, 'cash_bank_account_id' => $bank->id,
            'provider_settlement_ref' => 'SET-H1-01', 'settlement_date' => now()->toDateString(),
            'net_bank_amount' => 112000, 'provider_fee_ex_tax' => 3000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);

        $this->assertSame('gateway.has_references', $this->reason(fn () => $this->service->delete($gateway, $this->actor)));
        $this->assertNotNull(PaymentGateway::find($gateway->id));
    }

    /** @test */
    public function an_unreferenced_inactive_connection_is_deleted_and_its_audit_trail_survives(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]);
        $id = $gateway->id;

        $this->service->delete($gateway, $this->actor);

        $this->assertNull(PaymentGateway::find($id));
        $types = PaymentConnectionEvent::where('payment_gateway_id', $id)->pluck('event_type')->all();
        $this->assertContains('created', $types);
        $this->assertContains('deleted', $types);
    }

    /** @test */
    public function an_active_connection_must_be_suspended_before_deletion(): void
    {
        $gateway = $this->service->activate($this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]), $this->actor);

        $this->assertSame('gateway.active_cannot_delete', $this->reason(fn () => $this->service->delete($gateway, $this->actor)));
        $this->assertNotNull(PaymentGateway::find($gateway->id));
    }

    // ───────────────────────── تدوير الأسرار ─────────────────────────

    /** @test */
    public function webhook_secret_rotation_keeps_the_previous_secret_only_inside_the_grace_window(): void
    {
        $gateway = $this->connection(['webhook_secret' => 'whsec_old']);

        $rotated = $this->service->rotateCredentials($gateway, ['webhook_secret' => 'whsec_new'], 60, $this->actor);
        $this->assertSame(2, $rotated->credential_version);
        $this->assertSame(['whsec_new', 'whsec_old'], $rotated->webhookSecretsForVerification());

        $this->travel(59)->minutes();
        $this->assertSame(['whsec_new', 'whsec_old'], $rotated->fresh()->webhookSecretsForVerification());

        $this->travel(2)->minutes();
        $this->assertSame(['whsec_new'], $rotated->fresh()->webhookSecretsForVerification());
        $this->travelBack();
    }

    /** @test */
    public function rotation_with_zero_grace_drops_the_previous_secret_immediately(): void
    {
        $gateway = $this->connection(['webhook_secret' => 'whsec_compromised']);

        $rotated = $this->service->rotateCredentials($gateway, ['webhook_secret' => 'whsec_fresh'], 0, $this->actor);

        $this->assertSame(['whsec_fresh'], $rotated->webhookSecretsForVerification());
        $this->assertNull(DB::table('payment_gateways')->where('id', $gateway->id)->value('previous_webhook_secret'));
    }

    /** @test */
    public function rotating_provider_credentials_clears_verification_but_not_for_custom(): void
    {
        $stripe = $this->connection(['provider' => PaymentGateway::PROVIDER_STRIPE, 'secret_key' => 'sk_1']);
        $stripe->forceFill(['verified_at' => now()])->save(); // يحاكي نتيجة محوّل لاحق
        $this->assertNull($this->service->rotateCredentials($stripe, ['secret_key' => 'sk_2'], 0, $this->actor)->verified_at);

        $custom = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM, 'name' => 'يدوي', 'secret_key' => 'sk_1']);
        $custom->forceFill(['verified_at' => now()])->save();
        $this->assertNotNull($this->service->rotateCredentials($custom, ['secret_key' => 'sk_2'], 0, $this->actor)->verified_at);
    }

    /** @test */
    public function an_unchanged_or_empty_rotation_is_rejected_and_writes_no_event(): void
    {
        $gateway = $this->connection(['secret_key' => 'sk_same']);
        $count = PaymentConnectionEvent::count();

        $this->assertSame('gateway.nothing_to_rotate', $this->reason(fn () => $this->service->rotateCredentials($gateway, [], 60, $this->actor)));
        $this->assertSame('gateway.nothing_to_rotate', $this->reason(fn () => $this->service->rotateCredentials($gateway, ['secret_key' => 'sk_same'], 60, $this->actor)));
        $this->assertSame('gateway.invalid_grace', $this->reason(fn () => $this->service->rotateCredentials($gateway, ['secret_key' => 'sk_n'], 99999, $this->actor)));
        $this->assertSame($count, PaymentConnectionEvent::count());
        $this->assertSame(1, $gateway->fresh()->credential_version);
    }

    /** @test */
    public function secrets_never_reach_the_audit_trail_or_the_serialized_connection(): void
    {
        $gateway = $this->connection([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'secret_key' => 'sk_audit_secret', 'webhook_secret' => 'whsec_audit_secret', 'extra_credentials' => ['k' => 'extra_audit_secret'],
        ]);
        $this->service->rotateCredentials($gateway, ['webhook_secret' => 'whsec_audit_new', 'secret_key' => 'sk_audit_new'], 30, $this->actor);
        $this->service->revoke($gateway, $this->actor, 'إنهاء');

        $dump = json_encode(PaymentConnectionEvent::all()->toArray()) . $gateway->fresh()->toJson();
        foreach (['sk_audit_secret', 'whsec_audit_secret', 'extra_audit_secret', 'sk_audit_new', 'whsec_audit_new'] as $secret) {
            $this->assertStringNotContainsString($secret, $dump);
        }
        $rotation = PaymentConnectionEvent::where('event_type', 'credentials_rotated')->firstOrFail();
        $this->assertEqualsCanonicalizing(['webhook_secret', 'secret_key'], $rotation->changed_fields);
    }

    // ───────────────────────── التعديل ─────────────────────────

    /** @test */
    public function provider_is_immutable_and_environment_locks_after_the_draft_stage(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]);

        $this->assertSame('gateway.provider_immutable', $this->reason(fn () => $this->service->update($gateway, ['provider' => PaymentGateway::PROVIDER_STRIPE], $this->actor)));

        $draft = $this->service->update($gateway, ['environment' => PaymentGateway::ENVIRONMENT_LIVE], $this->actor);
        $this->assertSame(PaymentGateway::ENVIRONMENT_LIVE, $draft->environment);

        $this->service->activate($draft, $this->actor);
        $this->assertSame('gateway.environment_locked', $this->reason(fn () => $this->service->update($draft->fresh(), ['environment' => PaymentGateway::ENVIRONMENT_SANDBOX], $this->actor)));
    }

    /** @test */
    public function a_noop_update_writes_no_event_and_a_real_one_lists_field_names_only(): void
    {
        $gateway = $this->connection(['merchant_reference' => 'MER-1']);
        $count = PaymentConnectionEvent::count();

        $this->service->update($gateway, ['merchant_reference' => 'MER-1'], $this->actor);
        $this->assertSame($count, PaymentConnectionEvent::count());

        $this->service->update($gateway, ['merchant_reference' => 'MER-2', 'name_en' => 'Renamed'], $this->actor);
        $event = PaymentConnectionEvent::where('event_type', 'updated')->firstOrFail();
        $this->assertEqualsCanonicalizing(['merchant_reference', 'name_en'], $event->changed_fields);
    }

    /** @test */
    public function the_legacy_update_path_still_rotates_secrets_but_now_versions_and_audits_them(): void
    {
        $gateway = $this->connection(['secret_key' => 'sk_keep', 'webhook_secret' => 'whsec_keep']);

        $updated = $this->service->update($gateway, ['name' => 'اسم محدّث', 'secret_key' => 'sk_replaced'], $this->actor);

        $this->assertSame('sk_replaced', $this->service->providerCredentials($updated)['secret_key']);
        $this->assertSame('whsec_keep', $this->service->providerCredentials($updated)['webhook_secret']);
        $this->assertSame(2, $updated->credential_version);
        $this->assertSame(1, PaymentConnectionEvent::where('event_type', 'credentials_rotated')->count());
    }

    // ───────────────────────── العزل والثبات ─────────────────────────

    /** @test */
    public function another_tenant_cannot_see_or_touch_a_connection_or_its_events(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]);
        $other = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'pay-h1-01-b', 'vat_number' => '300000000000021', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);

        $this->assertNull(PaymentGateway::find($gateway->id));
        $this->assertSame(0, PaymentConnectionEvent::count());
        $this->assertCount(0, $this->service->list());
        try {
            $this->service->find($gateway->id);
            $this->fail('find must not resolve a foreign connection');
        } catch (ModelNotFoundException) {
            $this->addToAssertionCount(1);
        }

        foreach ([
            fn () => $this->service->suspend($gateway),
            fn () => $this->service->revoke($gateway, null, 'x'),
            fn () => $this->service->delete($gateway),
            fn () => $this->service->events($gateway),
            fn () => $this->service->rotateCredentials($gateway, ['secret_key' => 'x'], 0),
        ] as $attempt) {
            $this->assertThrowsDomain($attempt);
        }

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentGateway::STATUS_DRAFT, $gateway->fresh()->status);
    }

    /** @test */
    public function events_keep_their_order_even_when_they_share_a_second(): void
    {
        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM]);
        $this->service->activate($gateway, $this->actor);
        $this->service->suspend($gateway, $this->actor);
        $this->service->activate($gateway, $this->actor);
        $this->service->suspend($gateway, $this->actor);

        $this->assertSame(
            ['suspended', 'reactivated', 'suspended', 'activated', 'created'],
            $this->service->events($gateway)->pluck('event_type')->all()
        );
    }

    /** @test */
    public function connection_events_are_append_only(): void
    {
        $this->connection();
        $event = PaymentConnectionEvent::firstOrFail();

        $this->expectException(LogicException::class);
        $event->update(['reason' => 'تعديل']);
    }

    /** @test */
    public function connection_events_cannot_be_deleted(): void
    {
        $this->connection();

        $this->expectException(LogicException::class);
        PaymentConnectionEvent::firstOrFail()->delete();
    }

    /** @test */
    public function connection_management_writes_no_payment_or_journal_rows(): void
    {
        $before = [Payment::count(), JournalEntry::count(), JournalLine::count(), Invoice::count()];

        $gateway = $this->connection(['provider' => PaymentGateway::PROVIDER_CUSTOM, 'secret_key' => 'sk_1']);
        $this->service->update($gateway, ['name_en' => 'X'], $this->actor);
        $this->service->rotateCredentials($gateway, ['secret_key' => 'sk_2'], 0, $this->actor);
        $this->service->activate($gateway, $this->actor);
        $this->service->suspend($gateway, $this->actor);
        $this->service->revoke($gateway, $this->actor, 'إنهاء');

        $this->assertSame($before, [Payment::count(), JournalEntry::count(), JournalLine::count(), Invoice::count()]);
    }

    // ───────────────────────── الهجرة ─────────────────────────

    /** @test */
    public function the_migration_backfills_existing_gateways_so_current_behavior_is_unchanged(): void
    {
        $this->migration()->down();

        $now = now()->subDay()->toDateTimeString();
        foreach ([['active-legacy', true], ['inactive-legacy', false]] as [$name, $active]) {
            DB::table('payment_gateways')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id,
                'provider' => 'stripe', 'name' => $name, 'environment' => 'sandbox', 'is_active' => $active,
                'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        $this->migration()->up();

        $active = PaymentGateway::where('name', 'active-legacy')->firstOrFail();
        $inactive = PaymentGateway::where('name', 'inactive-legacy')->firstOrFail();
        $this->assertSame(PaymentGateway::STATUS_ACTIVE, $active->status);
        $this->assertTrue($active->isUsable());
        $this->assertNotNull($active->activated_at);
        $this->assertSame(PaymentGateway::STATUS_SUSPENDED, $inactive->status);
        $this->assertFalse($inactive->isUsable());
        $this->assertNotNull($inactive->deactivated_at);
        $this->assertNotSame($active->webhook_key, $inactive->webhook_key);
        $this->assertSame(64, strlen($active->webhook_key));
        $this->assertSame(1, $active->credential_version);
    }

    /** @test */
    public function the_migration_refuses_to_roll_back_over_audit_events(): void
    {
        $this->connection();

        try {
            $this->migration()->down();
            $this->fail('rollback must be refused while audit events exist');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('التراجع مرفوض', $e->getMessage());
        }
        $this->assertTrue(DB::getSchemaBuilder()->hasTable('payment_connection_events'));
        $this->assertTrue(DB::getSchemaBuilder()->hasColumn('payment_gateways', 'status'));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @param array<string, mixed> $over */
    private function connection(array $over = []): PaymentGateway
    {
        return $this->service->create(array_merge([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'name' => 'اتصال ' . bin2hex(random_bytes(3)),
        ], $over), $this->actor);
    }

    private function reason(Closure $fn): string
    {
        try {
            $fn();
        } catch (PaymentGatewayException $e) {
            return $e->reason;
        }
        $this->fail('Expected PaymentGatewayException');
    }

    private function assertThrowsDomain(Closure $fn): void
    {
        try {
            $fn();
        } catch (DomainException) {
            $this->addToAssertionCount(1);

            return;
        }
        $this->fail('Expected a DomainException for a foreign-tenant connection');
    }

    private function migration(): object
    {
        return require database_path('migrations/' . self::MIGRATION);
    }
}
