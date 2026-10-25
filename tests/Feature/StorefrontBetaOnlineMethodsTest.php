<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Services\OnlinePaymentMethodSettingsService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Beta — وسائل الدفع الإلكتروني (mada/Visa/Mastercard/Apple Pay) في Checkout المتجر: `enabled` (اختيار التاجر) مفصول عن `ready` (جاهزية التحصيل).
 * المفعَّلة تُعرض وإن لم تجهز بوابة؛ اختيار غير الجاهزة يُرفض بإشعار قبل أي كتابة (لا نية ولا محاولة ولا سند ولا قيد)؛ الجاهزة تكمل المسار القائم؛
 * ولا تسرّب بين المستأجرين، والشعارات لا تدخل في الحكم.
 */
class StorefrontBetaOnlineMethodsTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private const NOTICE = 'الدفع الإلكتروني غير متاح حاليًا. لم يتم خصم أي مبلغ.';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
    }

    private function enable(string $key, ?string $tenantId = null): void
    {
        app(TenantContext::class)->set($tenantId ?? $this->tenant->id);
        app(OnlinePaymentMethodSettingsService::class)->setEnabled($key, true, null);
        app(TenantContext::class)->forget();
    }

    private function setGateway(string $status): void
    {
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => $status, 'is_active' => $status === 'active']);
    }

    private function methods(string $host = self::HOST): array
    {
        return $this->api($host)->getJson(self::BASE.'/checkout/payment-methods')->assertOk()->json('data');
    }

    /** @return array{0: string, 1: \Illuminate\Testing\TestResponse} */
    private function pickOnline(string $key, ?string $token = null, string $host = self::HOST): array
    {
        $token ??= $this->readyCheckout($this->product($this->tenant, $this->channel), null, $host);

        return [$token, $this->api($host, $token)->patchJson(self::BASE.'/checkout/payment', ['online_method' => $key])];
    }

    private function assertNoCollectionFootprint(): void
    {
        $this->assertSame(0, PaymentAttempt::query()->withoutGlobalScopes()->count(), 'لا محاولة دفع');
        $this->assertSame(0, Payment::query()->withoutGlobalScopes()->count(), 'لا سند قبض');
        $this->assertSame(0, JournalEntry::query()->withoutGlobalScopes()->count(), 'لا قيد محاسبي');
        $this->assertSame(0, CommercePaymentIntent::query()->withoutGlobalScopes()->where('method', CommercePaymentIntent::METHOD_ONLINE)->count(), 'لا نية إلكترونية');
        $this->assertSame(0, CommerceOrder::query()->withoutGlobalScopes()->count(), 'لا طلب');
    }

    #[Test]
    public function nothing_enabled_keeps_the_payment_methods_response_exactly_as_before(): void
    {
        $data = $this->methods();

        $this->assertArrayNotHasKey('online_methods', $data);
        $this->assertCount(1, $data['payment_methods']);
    }

    #[Test]
    public function an_enabled_method_with_a_ready_gateway_is_listed_ready_and_continues_the_existing_online_flow(): void
    {
        $this->enable('mada');

        $row = collect($this->methods()['online_methods'])->firstWhere('key', 'mada');
        $this->assertTrue($row['ready']);
        $this->assertSame($this->method->id, $row['payment_method_id']);

        [$token, $response] = $this->pickOnline('mada');
        $response->assertOk()->assertJsonPath('data.payment.payment_method_id', $this->method->id);

        $complete = $this->complete($token)->assertCreated();
        $complete->assertJsonPath('data.order.payment.method', CommercePaymentIntent::METHOD_ONLINE)
            ->assertJsonPath('data.order.payment.status', CommercePaymentIntent::STATUS_PENDING);
    }

    #[Test]
    public function an_enabled_method_without_a_ready_gateway_is_listed_but_refused_before_any_write(): void
    {
        $this->setGateway('draft');
        $this->enable('mada');

        $row = collect($this->methods()['online_methods'])->firstWhere('key', 'mada');
        $this->assertFalse($row['ready']);
        $this->assertNull($row['payment_method_id']);

        [$token, $response] = $this->pickOnline('mada');
        $response->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable')->assertJsonPath('error.message', self::NOTICE);

        // الرفض نفسه لا ينشئ طلباً ولا نية ولا محاولة ولا سنداً ولا قيداً (قبل أي إتمام)
        $this->assertSame(0, CommerceOrder::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, CommercePaymentIntent::query()->withoutGlobalScopes()->where('method', CommercePaymentIntent::METHOD_ONLINE)->count());
        $this->assertSame(0, PaymentAttempt::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, Payment::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, JournalEntry::query()->withoutGlobalScopes()->count());

        // الـCheckout لم يتغيّر، وإتمامه (بلا وسيلة) يبقى COD/استلام؛ لا نية إلكترونية ولا محاولة ولا سند ولا قيد في أي لحظة
        $this->complete($token)->assertCreated()->assertJsonPath('data.order.payment.method', CommercePaymentIntent::METHOD_PAY_ON_PICKUP);
        $this->assertSame(0, PaymentAttempt::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, Payment::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, JournalEntry::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, CommercePaymentIntent::query()->withoutGlobalScopes()->where('method', CommercePaymentIntent::METHOD_ONLINE)->count());
    }

    #[Test]
    public function a_method_that_is_not_enabled_is_neither_listed_nor_selectable_even_with_a_ready_gateway(): void
    {
        $this->enable('visa');

        $keys = array_column($this->methods()['online_methods'], 'key');
        $this->assertSame(['visa'], $keys);

        [, $response] = $this->pickOnline('mada');
        $response->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
        $this->assertNoCollectionFootprint();
    }

    #[Test]
    public function apple_pay_stays_not_ready_while_provider_setup_is_unverifiable(): void
    {
        $this->enable('apple_pay');

        $row = collect($this->methods()['online_methods'])->firstWhere('key', 'apple_pay');
        $this->assertFalse($row['ready']);

        [, $response] = $this->pickOnline('apple_pay');
        $response->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
        $this->assertNoCollectionFootprint();
    }

    #[Test]
    public function a_closed_platform_gate_makes_every_method_not_ready(): void
    {
        $this->enable('mada');
        config(['payments.commerce_online_checkout.enabled' => false]);

        $this->assertFalse(collect($this->methods()['online_methods'])->firstWhere('key', 'mada')['ready']);
        [, $response] = $this->pickOnline('mada');
        $response->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
        $this->assertNoCollectionFootprint();
    }

    #[Test]
    public function the_gateway_losing_readiness_after_selection_still_blocks_the_collection(): void
    {
        $this->enable('mada');
        [$token] = $this->pickOnline('mada');

        $this->setGateway('suspended');

        // المسار القائم يرفض الإتمام (لا سقوط صامت إلى COD) بلا أي أثر
        $this->complete($token)->assertStatus(422);
        $this->assertNoCollectionFootprint();
    }

    #[Test]
    public function an_enabled_setting_of_another_tenant_never_appears_and_cannot_be_used(): void
    {
        ['tenant' => $other, 'channel' => $otherChannel] = $this->makeStore('other-pay.test', 'other-pay');
        $this->wirePayments($other, $otherChannel);
        $this->enable('mada', $other->id);

        // متجرنا: لا شيء مفعَّل ⇒ لا قائمة، والاختيار مرفوض
        $this->assertArrayNotHasKey('online_methods', $this->methods());
        [, $response] = $this->pickOnline('mada');
        $response->assertStatus(503);
        // متجرهم: يرى إعداده هو
        $this->assertSame(['mada'], array_column($this->methods('other-pay.test')['online_methods'], 'key'));
    }

    #[Test]
    public function the_request_contract_rejects_unknown_keys_conflicts_and_extra_fields(): void
    {
        $this->enable('mada');
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $patch = fn (array $body) => $this->api(self::HOST, $token)->patchJson(self::BASE.'/checkout/payment', $body);

        $patch(['online_method' => 'bitcoin'])->assertStatus(422);
        $patch(['online_method' => 'mada', 'payment_method_id' => $this->method->id])->assertStatus(422);
        $patch([])->assertStatus(422);
        $patch(['online_method' => 'mada', 'amount' => 1])->assertStatus(422);
        $patch(['payment_method_id' => $this->method->id])->assertOk();   // المسار القديم كما كان
    }

    #[Test]
    public function turning_off_store_usage_hides_the_method_and_refuses_its_selection(): void
    {
        $this->enable('mada');
        app(TenantContext::class)->set($this->tenant->id);
        app(OnlinePaymentMethodSettingsService::class)->updateSettings('mada', ['use_in_store' => false], null);
        app(TenantContext::class)->forget();

        $this->assertArrayNotHasKey('online_methods', $this->methods());
        [, $response] = $this->pickOnline('mada');
        $response->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
        $this->assertNoCollectionFootprint();
    }

    #[Test]
    public function the_chosen_default_gateway_decides_which_payment_method_the_order_uses(): void
    {
        // اتصال ثانٍ جاهز مرتبط بطريقة دفع أخرى متاحة للقناة
        app(TenantContext::class)->set($this->tenant->id);
        $second = \App\Models\PaymentMethod::create(['name' => 'بطاقة ثانية', 'name_en' => 'Second card', 'settlement_type' => 'bank', 'available_online' => true]);
        app(\App\Services\PaymentMethodChannelAvailabilityService::class)->setAvailability($second, $this->channel, true);
        $gateway2 = \App\Models\PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Zeta', 'environment' => 'sandbox', 'payment_method_id' => $second->id]);
        DB::table('payment_gateways')->where('id', $gateway2->id)->update(['status' => 'active', 'is_active' => true]);
        app(TenantContext::class)->forget();

        $this->enable('mada');
        $this->assertSame($this->method->id, collect($this->methods()['online_methods'])->firstWhere('key', 'mada')['payment_method_id']);   // تلقائي: الأول بالاسم

        app(TenantContext::class)->set($this->tenant->id);
        app(OnlinePaymentMethodSettingsService::class)->updateSettings('mada', ['default_gateway_id' => $gateway2->id], null);
        app(TenantContext::class)->forget();
        $row = collect($this->methods()['online_methods'])->firstWhere('key', 'mada');
        $this->assertTrue($row['ready']);
        $this->assertSame($second->id, $row['payment_method_id']);

        [$token, $response] = $this->pickOnline('mada');
        $response->assertOk()->assertJsonPath('data.payment.payment_method_id', $second->id);
        $this->complete($token)->assertCreated()->assertJsonPath('data.order.payment.method', CommercePaymentIntent::METHOD_ONLINE);
    }
}
