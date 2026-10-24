<?php

namespace Tests\Feature;

use App\Models\OnlinePaymentMethodSettingEvent;
use App\Models\PaymentGateway;
use App\Services\MoyasarAdapter;
use App\Services\OnlinePaymentMethodSettingsService;
use App\Support\OnlinePaymentMethodCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-SETTINGS-UX — وسائل الدفع الإلكتروني: حالة محسوبة (لا مخزَّنة) من اتصالات `PaymentGateway` وقدرات المحوّل؛ التفعيل = إظهار للعميل بجاهزية؛
 * لا وسيلة تظهر للعميل ما لم تكن مدعومة وجاهزة ومُظهَرة؛ تدقيق وصلاحيات وعزل مستأجرين.
 */
class OnlinePaymentMethodSettingsTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function methodRow(string $token, string $key): array
    {
        return collect($this->withToken($token)->getJson('/api/online-payment-methods')->assertOk()->json('data'))->firstWhere('key', $key);
    }

    private function fakeGateway(string $tenantId, string $name, string $status = PaymentGateway::STATUS_ACTIVE): PaymentGateway
    {
        app(TenantContext::class)->set($tenantId);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => $name, 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => $status, 'is_active' => $status === PaymentGateway::STATUS_ACTIVE]);

        return $gateway->fresh();
    }

    #[Test]
    public function without_any_connection_every_method_is_unsupported_and_cannot_be_enabled(): void
    {
        $auth = $this->registerTenant('opm-empty', 'owner@opm-empty.test');
        $rows = $this->withToken($auth['token'])->getJson('/api/online-payment-methods')->assertOk()->json('data');

        $this->assertSame(OnlinePaymentMethodCatalog::KEYS, array_column($rows, 'key'));
        foreach ($rows as $row) {
            $this->assertSame('unsupported', $row['status']);
            $this->assertFalse($row['customer_visible']);
            $this->assertNull($row['effective_gateway']);
            $this->assertFalse($row['default_gateway_selectable']);
        }
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])
            ->assertStatus(422)->assertJsonPath('error.code', 'method.unsupported');
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/bitcoin', ['enabled' => true])->assertNotFound();
        $this->assertSame(0, OnlinePaymentMethodSettingEvent::withoutGlobalScopes()->count());
    }

    #[Test]
    public function readiness_is_computed_from_the_connection_and_apple_pay_never_becomes_ready_by_itself(): void
    {
        $auth = $this->registerTenant('opm-ready', 'owner@opm-ready.test');
        $gateway = $this->fakeGateway($auth['tenant_id'], 'Fake', PaymentGateway::STATUS_DRAFT);

        // اتصال غير مفعَّل ⇒ تحتاج إعداداً؛ ولا تفعيل
        $mada = $this->methodRow($auth['token'], 'mada');
        $this->assertSame('needs_setup', $mada['status']);
        $this->assertSame('no_usable_gateway', $mada['reason']);
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])->assertStatus(422)->assertJsonPath('error.code', 'method.needs_setup');

        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->assertSame('disabled', $this->methodRow($auth['token'], 'mada')['status']);
        $this->assertSame($gateway->id, $this->methodRow($auth['token'], 'mada')['effective_gateway']['id']);

        // Apple Pay موثَّقة لدى المزوّد لكنها تحتاج إعداداً لديه لا يتحقق منه أَوْج ⇒ لا تُفعَّل
        $apple = $this->methodRow($auth['token'], 'apple_pay');
        $this->assertSame('needs_setup', $apple['status']);
        $this->assertSame('provider_setup_required', $apple['reason']);
        $this->assertNull($apple['effective_gateway']);
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/apple_pay', ['enabled' => true])->assertStatus(422)->assertJsonPath('error.code', 'method.needs_setup');

        // تفعيل ثم تعليق الاتصال ⇒ تختفي للعميل (المخزَّن باقٍ) وتعود بإعادة التفعيل
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true, 'reason' => 'إظهار للعملاء'])->assertOk()->assertJsonPath('data.status', 'enabled')->assertJsonPath('data.customer_visible', true);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'suspended', 'is_active' => false]);
        $suspended = $this->methodRow($auth['token'], 'mada');
        $this->assertSame('needs_setup', $suspended['status']);
        $this->assertTrue($suspended['enabled']);
        $this->assertFalse($suspended['customer_visible']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->assertTrue($this->methodRow($auth['token'], 'mada')['customer_visible']);
    }

    #[Test]
    public function changes_are_audited_once_and_a_no_op_writes_nothing(): void
    {
        $auth = $this->registerTenant('opm-audit', 'owner@opm-audit.test');
        $this->fakeGateway($auth['tenant_id'], 'Fake');

        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/visa', ['enabled' => false])->assertOk();   // لا تغيير (الغياب = معطّلة)
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/visa', ['enabled' => true, 'reason' => 'سبب'])->assertOk();
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/visa', ['enabled' => true])->assertOk();        // تكرار ⇒ لا حدث
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/visa', ['enabled' => false])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $events = OnlinePaymentMethodSettingEvent::query()->where('method_key', 'visa')->orderBy('created_at')->orderBy('id')->get();
        $this->assertCount(2, $events);
        $this->assertSame([[null, true], [true, false]], $events->map(fn ($e) => [$e->enabled_from, $e->enabled_to])->all());
        $this->assertNotNull($events[0]->actor_id);
        $this->assertSame('سبب', $events[0]->reason);
        $this->assertThrows(function () use ($events) {
            $events[0]->reason = 'x';
            $events[0]->save();
        }, \LogicException::class);
        $this->assertThrows(fn () => $events[0]->delete(), \LogicException::class);
    }

    #[Test]
    public function permissions_and_tenant_isolation_hold(): void
    {
        $a = $this->registerTenant('opm-a', 'owner@opm-a.test');
        $b = $this->registerTenant('opm-b', 'owner@opm-b.test');
        $this->fakeGateway($a['tenant_id'], 'Fake A');
        $this->fakeGateway($b['tenant_id'], 'Fake B');
        $this->withToken($a['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])->assertOk();

        $this->assertTrue($this->methodRow($a['token'], 'mada')['enabled']);
        $this->assertFalse($this->methodRow($b['token'], 'mada')['enabled'], 'إعداد مستأجر لا يظهر عند آخر');
        $this->withToken($b['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => false])->assertOk();
        $this->assertTrue($this->methodRow($a['token'], 'mada')['enabled']);

        $accountant = $this->tokenForRole($a['tenant_id'], 'accountant', 'acc@opm-a.test');
        $this->assertSame('enabled', $this->methodRow($accountant, 'mada')['status']);                         // القراءة بـ payments.view
        $this->withToken($accountant)->putJson('/api/online-payment-methods/mada', ['enabled' => false])->assertForbidden();   // التغيير بـ payment_gateways.manage
        $cashier = $this->tokenForRole($a['tenant_id'], 'cashier', 'cash@opm-a.test');
        $this->withToken($cashier)->getJson('/api/online-payment-methods')->assertForbidden();
        $this->flushHeaders();
        $this->getJson('/api/online-payment-methods')->assertUnauthorized();
    }

    #[Test]
    public function the_public_pay_link_lists_only_supported_ready_and_enabled_methods_of_the_request_gateway(): void
    {
        $auth = $this->registerTenant('opm-public', 'owner@opm-public.test');
        $gateway = $this->fakeGateway($auth['tenant_id'], 'Fake');
        $other = $this->fakeGateway($auth['tenant_id'], 'Other');
        // الخدمة نفسها: لا شيء مُظهَر ⇒ لا وسائل
        $service = app(OnlinePaymentMethodSettingsService::class);
        $this->assertSame([], $service->customerVisibleKeys($gateway->id));

        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])->assertOk();
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mastercard', ['enabled' => true])->assertOk();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(['mada', 'mastercard'], $service->customerVisibleKeys($gateway->id));
        $this->assertSame(['mada', 'mastercard'], $service->customerVisibleKeys($other->id));

        // اتصال الطلب غير جاهز ⇒ لا تُعرض له وسائل
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'suspended', 'is_active' => false]);
        $this->assertSame([], $service->customerVisibleKeys($gateway->id));
        $this->assertSame(['mada', 'mastercard'], $service->customerVisibleKeys($other->id));
    }

    #[Test]
    public function gateway_resources_expose_adapter_capabilities_without_secrets_and_moyasar_declares_documented_methods(): void
    {
        $auth = $this->registerTenant('opm-caps', 'owner@opm-caps.test');
        $fake = $this->fakeGateway($auth['tenant_id'], 'Fake');
        $custom = $this->withToken($auth['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'مخصّص', 'secret_key' => 'sk_caps_secret'])->assertCreated()->json('data.id');

        $caps = $this->withToken($auth['token'])->getJson("/api/payment-gateways/{$fake->id}")->assertOk()->json('data.provider_capabilities');
        $this->assertTrue($caps['hosted_checkout']);
        $this->assertContains('mada', $caps['methods']);
        $this->assertSame(['apple_pay'], $caps['methods_requiring_provider_setup']);
        $this->withToken($auth['token'])->getJson("/api/payment-gateways/{$custom}")->assertOk()->assertJsonPath('data.provider_capabilities', null);
        $this->assertStringNotContainsString('sk_caps_secret', $this->withToken($auth['token'])->getJson('/api/payment-gateways')->getContent());

        $moyasar = app(MoyasarAdapter::class)->capabilities();
        $this->assertEqualsCanonicalizing(OnlinePaymentMethodCatalog::KEYS, $moyasar->methods);
        $this->assertSame(['apple_pay'], $moyasar->methodsRequiringProviderSetup);
        $this->assertTrue($moyasar->supportsMethod('visa'));
        $this->assertFalse($moyasar->supportsMethod('stc_pay'));
    }
}
