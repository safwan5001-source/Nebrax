<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** PAY-H1-01 — واجهة اتصالات بوابات الدفع: الصلاحيات، العزل، الأسرار، الأخطاء، التدقيق. */
class PaymentGatewayApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @test */
    public function the_new_permission_is_owner_admin_only_and_not_in_any_stored_role_matrix(): void
    {
        $this->assertContains('payment_gateways.manage', Rbac::PERMISSIONS);
        $this->assertSame(1, array_count_values(Rbac::PERMISSIONS)['payment_gateways.manage']);
        $this->assertTrue(Rbac::allows('owner', 'payment_gateways.manage'));
        $this->assertTrue(Rbac::allows('admin', 'payment_gateways.manage'));
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertFalse(Rbac::allows($role, 'payment_gateways.manage'), $role);
        }
    }

    /** @test */
    public function an_owner_creates_a_draft_connection_and_no_secret_is_ever_returned(): void
    {
        $auth = $this->registerTenant('h1-create', 'owner@h1-create.test');

        $res = $this->withToken($auth['token'])->postJson('/api/payment-gateways', [
            'provider' => 'stripe', 'name' => 'Stripe', 'environment' => 'sandbox',
            'publishable_key' => 'pk_visible', 'secret_key' => 'sk_api_secret',
            'webhook_secret' => 'whsec_api_secret', 'extra_credentials' => ['acct' => 'acct_api_secret'],
            // حقول لا يملك العميل تعيينها: يجب أن تُتجاهل
            'status' => 'active', 'tenant_id' => '00000000-0000-0000-0000-000000000000',
            'credential_version' => 50, 'webhook_key' => 'forged', 'verified_at' => now()->toISOString(),
        ])->assertCreated();

        $res->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.is_usable', false)
            ->assertJsonPath('data.credential_version', 1)
            ->assertJsonPath('data.has_secret_key', true)
            ->assertJsonPath('data.has_webhook_secret', true)
            ->assertJsonPath('data.verified_at', null)
            ->assertJsonPath('data.publishable_key', 'pk_visible');
        $this->assertNotSame('forged', $res->json('data.webhook_key'));
        $this->assertSame(64, strlen($res->json('data.webhook_key')));
        foreach (['sk_api_secret', 'whsec_api_secret', 'acct_api_secret'] as $secret) {
            $this->assertStringNotContainsString($secret, $res->getContent());
        }

        $id = $res->json('data.id');
        $show = $this->withToken($auth['token'])->getJson("/api/payment-gateways/{$id}")->assertOk();
        $list = $this->withToken($auth['token'])->getJson('/api/payment-gateways')->assertOk();
        foreach ([$show->getContent(), $list->getContent()] as $body) {
            foreach (['sk_api_secret', 'whsec_api_secret', 'acct_api_secret'] as $secret) {
                $this->assertStringNotContainsString($secret, $body);
            }
        }
        $this->assertSame($auth['tenant_id'], PaymentGateway::withoutGlobalScopes()->findOrFail($id)->tenant_id);
    }

    /** @test */
    public function validation_rejects_an_unknown_provider_and_a_duplicate_name_with_a_stable_code(): void
    {
        $auth = $this->registerTenant('h1-validate', 'owner@h1-validate.test');

        $this->withToken($auth['token'])->postJson('/api/payment-gateways', ['provider' => 'nope', 'name' => 'X'])
            ->assertUnprocessable();

        $this->withToken($auth['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'مكرر'])->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'مكرر'])
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'gateway.name_taken');
    }

    /** @test */
    public function an_accountant_can_read_but_never_manage_connections_or_see_the_webhook_key(): void
    {
        $auth = $this->registerTenant('h1-rbac', 'owner@h1-rbac.test');
        $id = $this->withToken($auth['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'للقراءة'])
            ->assertCreated()->json('data.id');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@h1-rbac.test');

        $list = $this->withToken($accountant)->getJson('/api/payment-gateways')->assertOk();
        $list->assertJsonMissingPath('data.0.webhook_key');
        $this->withToken($accountant)->getJson("/api/payment-gateways/{$id}")->assertOk()->assertJsonMissingPath('data.webhook_key');

        $this->withToken($accountant)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'ممنوع'])->assertForbidden();
        $this->withToken($accountant)->putJson("/api/payment-gateways/{$id}", ['name' => 'ممنوع'])->assertForbidden();
        $this->withToken($accountant)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'x'])->assertForbidden();
        $this->withToken($accountant)->postJson("/api/payment-gateways/{$id}/activate")->assertForbidden();
        $this->withToken($accountant)->postJson("/api/payment-gateways/{$id}/suspend")->assertForbidden();
        $this->withToken($accountant)->postJson("/api/payment-gateways/{$id}/revoke", ['reason' => 'x'])->assertForbidden();
        $this->withToken($accountant)->deleteJson("/api/payment-gateways/{$id}")->assertForbidden();
        $this->withToken($accountant)->getJson("/api/payment-gateways/{$id}/events")->assertForbidden();

        $this->flushHeaders()->getJson('/api/payment-gateways')->assertUnauthorized();
    }

    /** @test */
    public function another_tenant_gets_404_on_every_endpoint_and_sees_an_empty_list(): void
    {
        $a = $this->registerTenant('h1-iso-a', 'owner@h1-iso-a.test');
        $b = $this->registerTenant('h1-iso-b', 'owner@h1-iso-b.test');
        $id = $this->withToken($a['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'لـA'])
            ->assertCreated()->json('data.id');

        $this->withToken($b['token'])->getJson('/api/payment-gateways')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($b['token'])->getJson("/api/payment-gateways/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson("/api/payment-gateways/{$id}/events")->assertNotFound();
        $this->withToken($b['token'])->putJson("/api/payment-gateways/{$id}", ['name' => 'اختراق'])->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'x'])->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/payment-gateways/{$id}/activate")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/payment-gateways/{$id}/suspend")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/payment-gateways/{$id}/revoke", ['reason' => 'x'])->assertNotFound();
        $this->withToken($b['token'])->deleteJson("/api/payment-gateways/{$id}")->assertNotFound();

        $this->withToken($a['token'])->getJson("/api/payment-gateways/{$id}")->assertOk()->assertJsonPath('data.name', 'لـA');
    }

    /** @test */
    public function the_lifecycle_endpoints_enforce_verification_reason_and_state_rules(): void
    {
        $auth = $this->registerTenant('h1-life', 'owner@h1-life.test');
        $t = $auth['token'];
        $custom = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'يدوي'])->assertCreated()->json('data.id');
        $stripe = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'stripe', 'name' => 'ستريب', 'secret_key' => 'sk_x'])->assertCreated()->json('data.id');

        $this->withToken($t)->postJson("/api/payment-gateways/{$stripe}/activate")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.verification_required');
        $this->withToken($t)->postJson("/api/payment-gateways/{$custom}/suspend")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.not_active');

        $this->withToken($t)->postJson("/api/payment-gateways/{$custom}/activate")->assertOk()
            ->assertJsonPath('data.status', 'active')->assertJsonPath('data.is_usable', true);
        $this->withToken($t)->deleteJson("/api/payment-gateways/{$custom}")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.active_cannot_delete');
        $this->withToken($t)->postJson("/api/payment-gateways/{$custom}/suspend", ['reason' => 'صيانة'])->assertOk()
            ->assertJsonPath('data.status', 'suspended')->assertJsonPath('data.is_usable', false);

        $this->withToken($t)->postJson("/api/payment-gateways/{$custom}/revoke")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.reason_required');
        $this->withToken($t)->postJson("/api/payment-gateways/{$custom}/revoke", ['reason' => 'إنهاء التعاقد'])->assertOk()
            ->assertJsonPath('data.status', 'revoked')->assertJsonPath('data.has_secret_key', false);
        $this->withToken($t)->putJson("/api/payment-gateways/{$custom}", ['name' => 'جديد'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.revoked');
        $this->withToken($t)->postJson("/api/payment-gateways/{$custom}/activate")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.revoked');
    }

    /** @test */
    public function update_cannot_change_provider_and_accepts_no_secrets_or_status(): void
    {
        $auth = $this->registerTenant('h1-upd', 'owner@h1-upd.test');
        $t = $auth['token'];
        $id = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'تعديل', 'secret_key' => 'sk_keep'])
            ->assertCreated()->json('data.id');

        $this->withToken($t)->putJson("/api/payment-gateways/{$id}", ['provider' => 'stripe'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.provider_immutable');

        $res = $this->withToken($t)->putJson("/api/payment-gateways/{$id}", [
            'name_en' => 'Renamed', 'status' => 'active', 'secret_key' => 'sk_sneaky', 'is_active' => false,
        ])->assertOk();
        $res->assertJsonPath('data.name_en', 'Renamed')->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.credential_version', 1);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('sk_keep', app(\App\Services\PaymentGatewayService::class)->providerCredentials(PaymentGateway::findOrFail($id))['secret_key']);
    }

    /** @test */
    public function rotation_returns_a_grace_deadline_hides_secrets_and_appears_in_the_audit_trail(): void
    {
        $auth = $this->registerTenant('h1-rot', 'owner@h1-rot.test');
        $t = $auth['token'];
        $id = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'تدوير', 'webhook_secret' => 'whsec_first'])
            ->assertCreated()->json('data.id');

        $this->withToken($t)->postJson("/api/payment-gateways/{$id}/rotate-credentials", [])
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.nothing_to_rotate');
        $this->withToken($t)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['webhook_secret' => 'x', 'grace_minutes' => 99999])
            ->assertUnprocessable();

        $res = $this->withToken($t)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['webhook_secret' => 'whsec_second', 'grace_minutes' => 30])
            ->assertOk();
        $res->assertJsonPath('data.credential_version', 2);
        $this->assertNotNull($res->json('data.previous_secret_valid_until'));
        foreach (['whsec_first', 'whsec_second'] as $secret) {
            $this->assertStringNotContainsString($secret, $res->getContent());
        }

        $events = $this->withToken($t)->getJson("/api/payment-gateways/{$id}/events")->assertOk();
        $this->assertSame(['credentials_rotated', 'created'], array_column($events->json('data'), 'event_type'));
        $this->assertSame(['webhook_secret'], $events->json('data.0.changed_fields'));
        foreach (['whsec_first', 'whsec_second'] as $secret) {
            $this->assertStringNotContainsString($secret, $events->getContent());
        }
    }

    /** @test */
    public function an_unreferenced_draft_can_be_deleted_but_one_with_a_payment_cannot(): void
    {
        $auth = $this->registerTenant('h1-del', 'owner@h1-del.test');
        $t = $auth['token'];
        $free = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'حرّ'])->assertCreated()->json('data.id');
        $used = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'مستخدم'])->assertCreated()->json('data.id');

        // الـAPI العام للسندات لا يقبل `payment_gateway_id` بعد؛ الربط يتم عبر الخدمة (PAY-V2-5).
        app(TenantContext::class)->set($auth['tenant_id']);
        $customer = \App\Models\Partner::create(['name' => 'عميل', 'type' => 'customer']);
        app(\App\Services\Accounting\PaymentService::class)->create([
            'partner_id' => $customer->id, 'amount' => 5000, 'method' => 'bank', 'payment_gateway_id' => $used,
        ]);

        $this->withToken($t)->deleteJson("/api/payment-gateways/{$free}")->assertOk();
        $this->withToken($t)->getJson("/api/payment-gateways/{$free}")->assertNotFound();

        $this->withToken($t)->deleteJson("/api/payment-gateways/{$used}")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.has_references');
        $this->withToken($t)->getJson("/api/payment-gateways/{$used}")->assertOk();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($used, Payment::firstOrFail()->payment_gateway_id);
    }

    /** @test */
    public function connection_management_through_the_api_creates_no_payment_or_journal_rows(): void
    {
        $auth = $this->registerTenant('h1-zero', 'owner@h1-zero.test');
        $t = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $journals = JournalEntry::count();

        $id = $this->withToken($t)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'بلا أثر', 'secret_key' => 's'])->json('data.id');
        $this->withToken($t)->postJson("/api/payment-gateways/{$id}/activate")->assertOk();
        $this->withToken($t)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 's2'])->assertOk();
        $this->withToken($t)->postJson("/api/payment-gateways/{$id}/suspend")->assertOk();
        $this->withToken($t)->postJson("/api/payment-gateways/{$id}/revoke", ['reason' => 'x'])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Payment::count());
        $this->assertSame($journals, JournalEntry::count());
    }
}
