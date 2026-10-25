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
    public function without_any_connection_every_method_is_unsupported_yet_the_merchant_can_still_enable_it_in_beta(): void
    {
        $auth = $this->registerTenant('opm-empty', 'owner@opm-empty.test');
        $rows = $this->withToken($auth['token'])->getJson('/api/online-payment-methods')->assertOk()->json('data');

        $this->assertSame(OnlinePaymentMethodCatalog::KEYS, array_column($rows, 'key'));
        foreach ($rows as $row) {
            $this->assertSame('unsupported', $row['status']);
            $this->assertFalse($row['enabled']);
            $this->assertFalse($row['ready']);
            $this->assertSame('no_gateway', $row['reason']);
            $this->assertFalse($row['customer_visible']);
            $this->assertNull($row['effective_gateway']);
            $this->assertFalse($row['default_gateway_selectable']);
        }
        // Beta: التفعيل اختيار تاجر؛ يُحفظ ويُدقَّق حتى بلا أي بوابة، لكنه لا يجعل الوسيلة جاهزة للتحصيل.
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])
            ->assertOk()->assertJsonPath('data.status', 'enabled_not_ready')->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.ready', false)->assertJsonPath('data.customer_visible', true)->assertJsonPath('data.reason', 'no_gateway');
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => false])->assertOk()->assertJsonPath('data.status', 'unsupported');
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/bitcoin', ['enabled' => true])->assertNotFound();
        $this->assertSame(2, OnlinePaymentMethodSettingEvent::withoutGlobalScopes()->count());
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
        $this->assertFalse($mada['ready']);

        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->assertTrue($this->methodRow($auth['token'], 'mada')['ready']);
        $this->assertSame('disabled', $this->methodRow($auth['token'], 'mada')['status']);
        $this->assertSame($gateway->id, $this->methodRow($auth['token'], 'mada')['effective_gateway']['id']);

        // Apple Pay موثَّقة لدى المزوّد لكنها تحتاج إعداداً لديه لا يتحقق منه أَوْج ⇒ لا تكون جاهزة أبداً من تلقاء نفسها، ويجوز مع ذلك تفعيلها (Beta)
        $apple = $this->methodRow($auth['token'], 'apple_pay');
        $this->assertSame('needs_setup', $apple['status']);
        $this->assertSame('provider_setup_required', $apple['reason']);
        $this->assertFalse($apple['ready']);
        $this->assertNull($apple['effective_gateway']);
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/apple_pay', ['enabled' => true])
            ->assertOk()->assertJsonPath('data.status', 'enabled_not_ready')->assertJsonPath('data.ready', false)->assertJsonPath('data.reason', 'provider_setup_required');

        // تفعيل ثم تعليق الاتصال ⇒ تبقى مفعَّلة ومعروضة لكنها غير جاهزة، وتعود جاهزة بعودة الاتصال
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true, 'reason' => 'إظهار للعملاء'])->assertOk()->assertJsonPath('data.status', 'enabled')->assertJsonPath('data.ready', true)->assertJsonPath('data.customer_visible', true);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'suspended', 'is_active' => false]);
        $suspended = $this->methodRow($auth['token'], 'mada');
        $this->assertSame('enabled_not_ready', $suspended['status']);
        $this->assertTrue($suspended['enabled']);
        $this->assertFalse($suspended['ready']);
        $this->assertTrue($suspended['customer_visible']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->assertSame('enabled', $this->methodRow($auth['token'], 'mada')['status']);
    }

    #[Test]
    public function a_real_provider_connection_is_ready_only_while_its_credentials_are_verified(): void
    {
        $auth = $this->registerTenant('opm-verify', 'owner@opm-verify.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $gateway = PaymentGateway::query()->create(['provider' => 'moyasar', 'name' => 'Moyasar', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true, 'verified_at' => null]);

        // مفعَّل لكن غير متحقَّق منه (مثلاً بعد تدوير الأسرار) ⇒ لا جاهزية للتحصيل
        $this->assertSame('needs_setup', $this->methodRow($auth['token'], 'mada')['status']);
        $this->assertSame('no_usable_gateway', $this->methodRow($auth['token'], 'mada')['reason']);

        DB::table('payment_gateways')->where('id', $gateway->id)->update(['verified_at' => now()]);
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])->assertOk()->assertJsonPath('data.status', 'enabled')->assertJsonPath('data.customer_visible', true);

        // التحقق صُفّر بعد التفعيل ⇒ تبقى معروضة لكنها غير جاهزة؛ ورابط الدفع (له اتصال محدَّد) لا يعرضها
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['verified_at' => null]);
        $row = $this->methodRow($auth['token'], 'mada');
        $this->assertTrue($row['enabled']);
        $this->assertFalse($row['ready']);
        $this->assertSame('enabled_not_ready', $row['status']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame([], app(OnlinePaymentMethodSettingsService::class)->customerVisibleKeys($gateway->id));
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
    public function manage_settings_persist_default_gateway_and_usage_and_are_audited_once(): void
    {
        $auth = $this->registerTenant('opm-manage', 'owner@opm-manage.test');
        $first = $this->fakeGateway($auth['tenant_id'], 'A-First');
        $second = $this->fakeGateway($auth['tenant_id'], 'B-Second');
        $token = $auth['token'];

        // الافتراضي: تلقائي (أول جاهز بالاسم)، والاستعمال فواتير+متجر، وPOS غير مدعوم
        $row = $this->methodRow($token, 'mada');
        $this->assertNull($row['default_gateway_id']);
        $this->assertSame($first->id, $row['effective_gateway']['id']);
        $this->assertTrue($row['default_gateway_selectable']);
        $this->assertSame(['invoices' => true, 'store' => true, 'pos' => false], $row['usage']);
        $this->assertSame(['invoices' => true, 'store' => true, 'pos' => false], $row['usage_supported']);

        $this->withToken($token)->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => $second->id, 'use_in_store' => false, 'reason' => 'اختيار البوابة'])
            ->assertOk()->assertJsonPath('data.default_gateway_id', $second->id)->assertJsonPath('data.effective_gateway.id', $second->id)
            ->assertJsonPath('data.usage.store', false)->assertJsonPath('data.usage.invoices', true)->assertJsonPath('data.enabled', false);
        // تكرار نفس القيم ⇒ لا حدث ثانٍ
        $this->withToken($token)->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => $second->id, 'use_in_store' => false])->assertOk();
        // العودة للتلقائي
        $this->withToken($token)->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => null])->assertOk()->assertJsonPath('data.default_gateway_id', null);
        // POS ليس إعداداً مقبولاً
        $this->withToken($token)->putJson('/api/online-payment-methods/mada', ['use_in_pos' => true])->assertStatus(422)->assertJsonPath('error.code', 'method.nothing_to_update');

        app(TenantContext::class)->set($auth['tenant_id']);
        $events = OnlinePaymentMethodSettingEvent::query()->where('method_key', 'mada')->orderBy('created_at')->orderBy('id')->get();
        $this->assertCount(2, $events);
        $this->assertSame('اختيار البوابة', $events[0]->reason);
        $this->assertSame(
            ['default_gateway_id' => ['from' => null, 'to' => $second->id], 'use_in_store' => ['from' => true, 'to' => false]],
            json_decode((string) $events[0]->changes, true),
        );
        $this->assertSame(['default_gateway_id' => ['from' => $second->id, 'to' => null]], json_decode((string) $events[1]->changes, true));
        $this->assertFalse($events[1]->enabled_to);
    }

    #[Test]
    public function the_default_gateway_must_be_an_own_non_revoked_connection_that_declares_the_method(): void
    {
        $a = $this->registerTenant('opm-dg-a', 'owner@opm-dg-a.test');
        $b = $this->registerTenant('opm-dg-b', 'owner@opm-dg-b.test');
        $mine = $this->fakeGateway($a['tenant_id'], 'Mine');
        $foreign = $this->fakeGateway($b['tenant_id'], 'Foreign');
        $revoked = $this->fakeGateway($a['tenant_id'], 'Revoked', PaymentGateway::STATUS_REVOKED);
        app(TenantContext::class)->set($a['tenant_id']);
        $custom = PaymentGateway::query()->create(['provider' => 'custom', 'name' => 'Custom', 'environment' => 'sandbox']);

        foreach ([$foreign->id, $revoked->id, $custom->id, (string) \Illuminate\Support\Str::uuid()] as $bad) {
            $this->withToken($a['token'])->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => $bad])
                ->assertStatus(422)->assertJsonPath('error.code', 'method.default_gateway_invalid');
        }
        $this->withToken($a['token'])->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => 'not-a-uuid'])->assertStatus(422);
        $this->assertNull($this->methodRow($a['token'], 'mada')['default_gateway_id']);
        $this->withToken($a['token'])->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => $mine->id])->assertOk();
        // الإعداد لا يتسرب بين المستأجرين
        $this->assertNull($this->methodRow($b['token'], 'mada')['default_gateway_id']);
    }

    #[Test]
    public function an_unready_default_gateway_makes_the_method_not_ready_and_never_fails_over_to_another_gateway(): void
    {
        $auth = $this->registerTenant('opm-nofailover', 'owner@opm-nofailover.test');
        $primary = $this->fakeGateway($auth['tenant_id'], 'A-Primary');
        $this->fakeGateway($auth['tenant_id'], 'B-Other');
        $token = $auth['token'];
        $this->withToken($token)->putJson('/api/online-payment-methods/mada', ['enabled' => true, 'default_gateway_id' => $primary->id])->assertOk()->assertJsonPath('data.status', 'enabled');

        DB::table('payment_gateways')->where('id', $primary->id)->update(['status' => 'suspended', 'is_active' => false]);
        $row = $this->methodRow($token, 'mada');
        $this->assertFalse($row['ready']);
        $this->assertSame('enabled_not_ready', $row['status']);
        $this->assertNull($row['effective_gateway'], 'لا تحويل تلقائي إلى البوابة الأخرى الجاهزة');
        $this->assertSame('no_usable_gateway', $row['reason']);
    }

    #[Test]
    public function the_invoice_usage_switch_controls_the_public_pay_link_methods(): void
    {
        $auth = $this->registerTenant('opm-usage', 'owner@opm-usage.test');
        $gateway = $this->fakeGateway($auth['tenant_id'], 'Fake');
        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['enabled' => true])->assertOk();
        app(TenantContext::class)->set($auth['tenant_id']);
        $service = app(OnlinePaymentMethodSettingsService::class);
        $this->assertSame(['mada'], $service->customerVisibleKeys($gateway->id));

        $this->withToken($auth['token'])->putJson('/api/online-payment-methods/mada', ['use_in_invoices' => false])->assertOk();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame([], $service->customerVisibleKeys($gateway->id));
        $this->assertSame([], $service->customerVisibleKeys());
    }

    #[Test]
    public function viewers_cannot_change_manage_settings(): void
    {
        $auth = $this->registerTenant('opm-rbac2', 'owner@opm-rbac2.test');
        $gateway = $this->fakeGateway($auth['tenant_id'], 'Fake');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@opm-rbac2.test');
        $this->withToken($accountant)->putJson('/api/online-payment-methods/mada', ['default_gateway_id' => $gateway->id])->assertForbidden();
        $this->withToken($accountant)->putJson('/api/online-payment-methods/mada', ['use_in_store' => false])->assertForbidden();
        $this->assertNull($this->methodRow($auth['token'], 'mada')['default_gateway_id']);
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
