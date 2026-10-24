<?php

namespace Tests\Feature;

use App\Events\CommercePaymentAttemptCaptured;
use App\Models\CommerceCart;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\PaymentMethodChannelAvailabilityService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\CommerceOrderReference;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H4-04a — رحلة الدفع الإلكتروني لطلب المتجر (`/store/v1`) فوق `CommercePaymentIntent` و`PaymentOrchestrator` القائمين:
 * اختيار وسيلة → إتمام (نية `online/pending`) → بدء محاولة → الانتقال لصفحة المزوّد → التحقق من النتيجة **من الخادم** → تثبيت النية مدفوعة مرة واحدة،
 * مع الفشل/التكرار/الانقطاع/الالتقاط المتأخر، وعزل المستأجر، ومراجع الملكية، وRBAC الموظفين، وغياب أي أثر محاسبي أو مخزني (G3 لم تُعتمد).
 */
class StorefrontOnlinePaymentTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    use OnlineStorefrontHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
    }

    // ═══════════════ البوابة والتوافق الخلفي ═══════════════

    #[Test]
    public function the_gate_is_closed_by_default_and_checkout_behaves_exactly_as_before(): void
    {
        config(['payments.commerce_online_checkout.enabled' => false]);
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, $this->method->id);

        $response = $this->complete($token)->assertCreated();
        $response->assertJsonPath('data.order.payment.method', CommercePaymentIntent::METHOD_PAY_ON_PICKUP)
            ->assertJsonPath('data.order.payment.status', CommercePaymentIntent::STATUS_AWAITING_COLLECTION)
            ->assertJsonMissingPath('data.order.payment.requires_action')
            ->assertJsonMissingPath('data.order_reference'); // الشكل حرفياً كما كان (عقد الرحلة المشترك) والبوابة مغلقة

        $orderId = $response->json('data.order.id');
        $reference = CommerceOrderReference::issue(CommerceOrder::query()->withoutGlobalScopes()->findOrFail($orderId));

        $this->startPayment(['order_id' => $orderId, 'reference' => $reference])->assertNotFound();
        $this->paymentStatus(['order_id' => $orderId, 'reference' => $reference])->assertNotFound();
        $this->api()->getJson(self::BASE.'/checkout/payment-methods')->assertOk()->assertJsonMissingPath('data.payment_methods.0.online');
    }

    #[Test]
    public function without_a_selected_method_the_order_stays_cod_even_when_the_gate_is_open(): void
    {
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, null);

        $this->complete($token)->assertCreated()
            ->assertJsonPath('data.order.payment.method', CommercePaymentIntent::METHOD_PAY_ON_PICKUP)
            ->assertJsonMissingPath('data.order.payment.requires_action');
    }

    #[Test]
    public function the_payment_methods_list_flags_a_method_online_only_when_a_ready_gateway_is_linked(): void
    {
        $this->api()->getJson(self::BASE.'/checkout/payment-methods')->assertOk()
            ->assertJsonPath('data.payment_methods.0.id', $this->method->id)
            ->assertJsonPath('data.payment_methods.0.online', true);

        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_SUSPENDED, 'is_active' => false]);
        $this->api()->getJson(self::BASE.'/checkout/payment-methods')->assertOk()->assertJsonPath('data.payment_methods.0.online', false);
    }

    #[Test]
    public function selecting_a_gateway_method_whose_gateway_is_not_ready_is_rejected_without_silently_falling_back_to_cod(): void
    {
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, $this->method->id);
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_SUSPENDED, 'is_active' => false]);

        $this->complete($token)->assertStatus(422);

        $this->assertSame(0, DB::table('commerce_orders')->count());
        $this->assertSame(0, DB::table('commerce_payment_intents')->count());
        // السلة لم تُستهلك: يمكن الإتمام بعد إصلاح الاتصال أو اختيار طريقة أخرى
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->complete($token, 'idem-online-retry')->assertCreated()->assertJsonPath('data.order.payment.method', 'online');
    }

    #[Test]
    public function a_revoked_gateway_linked_to_the_selected_method_is_rejected_never_silently_downgraded_to_cod(): void
    {
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, $this->method->id);
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_REVOKED, 'is_active' => false]);

        $this->complete($token)->assertStatus(422);
        $this->assertSame(0, DB::table('commerce_orders')->count());
        $this->assertSame(0, DB::table('commerce_payment_intents')->count());
    }

    #[Test]
    public function a_currency_the_provider_does_not_support_is_rejected_at_checkout_before_any_order_is_committed(): void
    {
        ['tenant' => $usd, 'channel' => $channel] = $this->makeStore('online-pay-usd.test', 'online-pay-usd', 'USD');
        [$method] = $this->wirePayments($usd, $channel);
        $product = $this->product($usd, $channel);
        $token = $this->readyCheckout($product, $method->id, 'online-pay-usd.test');

        $this->complete($token, 'idem-usd-001', 'online-pay-usd.test')->assertStatus(422);

        $this->assertSame(0, DB::table('commerce_orders')->count());
        $this->assertSame(0, DB::table('commerce_payment_intents')->count());
    }

    // ═══════════════ الرحلة الكاملة ═══════════════

    #[Test]
    public function the_full_journey_selects_completes_starts_verifies_from_the_server_and_marks_paid_exactly_once(): void
    {
        $before = $this->counts();
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, $this->method->id);

        // الإتمام: طلب مؤكَّد + نية إلكترونية بانتظار الدفع، ولا محاولة بعد
        $done = $this->complete($token)->assertCreated();
        $done->assertJsonPath('data.order.status', CommerceOrder::STATUS_CONFIRMED)
            ->assertJsonPath('data.order.payment.method', 'online')
            ->assertJsonPath('data.order.payment.status', 'pending')
            ->assertJsonPath('data.order.payment.requires_action', true)
            ->assertJsonPath('data.order.total.amount_minor', 5000);
        $order = ['order_id' => $done->json('data.order.id'), 'reference' => $done->json('data.order_reference')];
        $this->assertCount(0, $this->attempts($order['order_id']));
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'awaiting_payment')->assertJsonPath('data.payment.can_retry', true);

        // البدء: محاولة واحدة على المزوّد بالمبلغ من الخادم + عنوان عودة من نطاق المتجر الموثَّق
        $start = $this->startPayment($order)->assertCreated();
        $start->assertJsonPath('data.payment.status', 'pending')
            ->assertJsonPath('data.payment.amount.amount_minor', 5000)->assertJsonPath('data.payment.amount.currency', 'SAR');
        $checkoutUrl = $start->json('data.payment.checkout_url');
        $this->assertStringStartsWith('https://fake-checkout.invalid/pay/', $checkoutUrl);
        $this->assertStringContainsString('no-store', (string) $start->headers->get('Cache-Control'));
        $this->assertCount(1, $this->fake->checkoutCalls);
        $this->assertSame(5000, $this->fake->checkoutCalls[0]['amount_minor']);
        $this->assertSame('https://'.self::HOST.'/checkout/payment-return', $this->fake->checkoutCalls[0]['return_url']);

        // إعادة البدء تستأنف المحاولة نفسها بلا محاولة/استدعاء مزوّد ثانٍ
        $replay = $this->startPayment($order)->assertOk();
        $this->assertSame($checkoutUrl, $replay->json('data.payment.checkout_url'));
        $this->assertCount(1, $this->fake->checkoutCalls);
        $this->assertCount(1, $this->attempts($order['order_id']));

        // عودة المتصفح لا تُثبت شيئاً: الحالة تبقى معلّقة (المزوّد لم يلتقط) مهما حملت الاستعلامات
        $pending = $this->paymentStatus($order, null, self::HOST, '?status=paid&payment_status=paid&id=x')->assertOk();
        $pending->assertJsonPath('data.payment.status', 'pending');
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($order['order_id'])->status);

        // الالتقاط الفعلي لدى المزوّد ⇒ الحالة من الخادم paid، والنية تُثبَّت مرة واحدة
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $paid = $this->paymentStatus($order)->assertOk();
        $paid->assertJsonPath('data.payment.status', 'paid')->assertJsonPath('data.payment.checkout_url', null)->assertJsonPath('data.payment.can_retry', false);
        $intent = $this->intent($order['order_id']);
        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $intent->status);
        $this->assertNotNull($intent->paid_at);
        $paidAt = $intent->paid_at->toIso8601String();

        // تكرار القراءة/الإكمال/المطابقة: لا أثر ثانٍ
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
        app(CommerceOnlinePaymentService::class)->completeCaptured($this->attempts($order['order_id'])->first());
        $this->artisan('payments:complete-commerce-captures')->assertSuccessful();
        $this->assertSame($paidAt, $this->intent($order['order_id'])->fresh()->paid_at->toIso8601String());
        $this->assertSame(1, CommercePaymentIntent::query()->where('status', CommercePaymentIntent::STATUS_PAID)->count());
        $this->assertCount(1, $this->attempts($order['order_id']));

        // بعد الدفع لا بدء ثانٍ
        $this->startPayment($order)->assertStatus(409)->assertJsonPath('error.code', 'payment_not_payable')->assertJsonPath('error.details.reason', 'already_paid');

        // G3 غير معتمدة: لا فاتورة ولا سند ولا قيد ولا حجز/حركة مخزون
        $this->assertSame($before, $this->counts());
        $this->assertNull($this->attempts($order['order_id'])->first()->posting_status);
    }

    #[Test]
    public function a_failed_attempt_can_be_retried_with_a_new_attempt_and_the_order_is_paid_only_by_the_confirmed_capture(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $first = $this->attempts($order['order_id'])->first();

        $this->fake->script((string) $first->provider_payment_id, 'failed', 0, null, null, 'declined');
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'failed')->assertJsonPath('data.payment.can_retry', true);
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($order['order_id'])->status);

        $retry = $this->startPayment($order)->assertCreated();
        $attempts = $this->attempts($order['order_id']);
        $this->assertCount(2, $attempts);
        $this->assertNotSame($attempts[0]->id, $attempts[1]->id);
        $this->assertNotSame($attempts[0]->idempotency_key, $attempts[1]->idempotency_key);
        $this->assertCount(2, $this->fake->checkoutCalls);
        $retry->assertJsonPath('data.payment.status', 'pending');

        $this->capture($attempts[1]);
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);
    }

    #[Test]
    public function an_expired_attempt_reports_expired_and_allows_a_fresh_attempt(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $first = $this->attempts($order['order_id'])->first();

        $this->fake->script((string) $first->provider_payment_id, 'expired');
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'expired')->assertJsonPath('data.payment.can_retry', true);
        $this->startPayment($order)->assertCreated()->assertJsonPath('data.payment.status', 'pending');
        $this->assertCount(2, $this->attempts($order['order_id']));
    }

    #[Test]
    public function a_page_that_expired_locally_is_reconciled_on_read_and_on_start_so_the_customer_is_never_stuck(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $first = $this->attempts($order['order_id'])->first();
        DB::table('payment_attempts')->where('id', $first->id)->update(['expires_at' => now('UTC')->subMinute(), 'last_synced_at' => now('UTC')->subMinute()]);

        // القراءة: تُنهى المحاولة (لا «معلّقة» للأبد) ويُتاح التكرار
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'expired')->assertJsonPath('data.payment.can_retry', true);
        $this->assertSame('expired', $first->fresh()->capture_status);

        // البدء مباشرة على محاولة منتهية محلياً (بلا قراءة سابقة) يسأل المزوّد ثم ينشئ محاولة جديدة
        $order2 = $this->onlineOrder(null, null, null, 'idem-online-002');
        $this->startPayment($order2)->assertCreated();
        $stale = $this->attempts($order2['order_id'])->first();
        DB::table('payment_attempts')->where('id', $stale->id)->update(['expires_at' => now('UTC')->subMinute()]);
        $this->startPayment($order2)->assertCreated()->assertJsonPath('data.payment.status', 'pending');
        $this->assertCount(2, $this->attempts($order2['order_id']));
        $this->assertSame('expired', $stale->fresh()->capture_status);
    }

    #[Test]
    public function an_expired_page_that_the_provider_actually_captured_is_paid_not_retried(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $first = $this->attempts($order['order_id'])->first();
        DB::table('payment_attempts')->where('id', $first->id)->update(['expires_at' => now('UTC')->subMinute()]);
        $this->capture($first);

        $this->startPayment($order)->assertStatus(409)->assertJsonPath('error.details.reason', 'already_paid');
        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);
        $this->assertCount(1, $this->attempts($order['order_id']));
    }

    #[Test]
    public function an_order_without_a_web_storefront_such_as_mobile_never_becomes_online(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::create(['sales_channel_id' => $this->channel->id, 'number' => 'CORD-MOB-1', 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);

        $intent = app(\App\Services\Commerce\CommercePaymentIntentService::class)->createForOrder($order, $this->method->id, 'pickup');

        $this->assertSame(CommercePaymentIntent::METHOD_PAY_ON_PICKUP, $intent->method);
        $this->assertSame(CommercePaymentIntent::STATUS_AWAITING_COLLECTION, $intent->status);
    }

    #[Test]
    public function a_provider_outage_at_start_leaves_a_resumable_attempt_and_never_a_second_charge(): void
    {
        $order = $this->onlineOrder();
        $this->fake->failNextCheckouts();

        $this->startPayment($order)->assertStatus(503)->assertJsonPath('error.code', 'payment_provider_unavailable');
        // الحالة العامة بعد الانقطاع ليست طريقاً مسدوداً: لا صفحة بعد، والتكرار متاح (إعادة payment-intent تستأنف)
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'awaiting_payment')->assertJsonPath('data.payment.can_retry', true);
        $this->assertCount(1, $this->attempts($order['order_id']));
        $this->assertSame('created', $this->attempts($order['order_id'])->first()->capture_status);

        // استئناف بالمفتاح نفسه للمحاولة نفسها (لا محاولة ثانية)
        $this->startPayment($order)->assertOk()->assertJsonPath('data.payment.status', 'pending');
        $this->assertCount(1, $this->attempts($order['order_id']));
        $this->assertSame('pending_customer', $this->attempts($order['order_id'])->first()->capture_status);
    }

    #[Test]
    public function a_provider_outage_while_reading_the_status_keeps_the_last_known_state_and_converges_later(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);

        $this->fake->failFetchWith(new \RuntimeException('provider down'));
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'pending');
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($order['order_id'])->status);

        $this->fake->failFetchWith(null);
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['last_synced_at' => now('UTC')->subMinute()]);
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
    }

    #[Test]
    public function the_status_endpoint_never_hammers_the_provider_within_the_minimum_interval(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();

        $this->paymentStatus($order)->assertOk();
        $fetches = $this->fake->fetchCount;
        $this->paymentStatus($order)->assertOk();
        $this->paymentStatus($order)->assertOk();

        $this->assertSame($fetches, $this->fake->fetchCount, 'قراءات متتالية خلال ثوانٍ لا تعيد استعلام المزوّد');
    }

    // ═══════════════ التقارب (listener / safety net) ═══════════════

    #[Test]
    public function a_capture_applied_outside_the_status_endpoint_marks_the_order_paid_via_the_listener(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);

        // مسار الـwebhook/المطابِق: `sync` يطبّق حقيقة المزوّد ثم يطلق الحدث بعد الالتزام
        app(PaymentOrchestrator::class)->sync($attempt);

        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);
    }

    #[Test]
    public function the_safety_net_command_completes_a_capture_whose_listener_never_ran(): void
    {
        Event::fake([CommercePaymentAttemptCaptured::class]);
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        app(PaymentOrchestrator::class)->sync($attempt);

        Event::assertDispatched(CommercePaymentAttemptCaptured::class);
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($order['order_id'])->status);

        $this->artisan('payments:complete-commerce-captures')->assertSuccessful();
        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);
        $this->artisan('payments:complete-commerce-captures')->assertSuccessful();
        $this->assertSame(1, CommercePaymentIntent::query()->where('status', CommercePaymentIntent::STATUS_PAID)->count());
    }

    #[Test]
    public function an_amount_mismatch_never_marks_the_order_paid_and_waits_for_human_review(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->fake->script((string) $attempt->provider_payment_id, 'captured', 4000, 5000);

        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'under_review')->assertJsonPath('data.payment.can_retry', false);
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($order['order_id'])->status);
        $this->assertContains(PaymentAttempt::REVIEW_AMOUNT_MISMATCH, $this->attempts($order['order_id'])->first()->review_reasons);
        $this->startPayment($order)->assertStatus(409)->assertJsonPath('error.code', 'payment_not_payable');
    }

    // ═══════════════ الالتقاط المتأخر (D-15، مراجعة بشرية) ═══════════════

    #[Test]
    public function a_late_capture_after_the_intent_was_cancelled_is_flagged_for_review_and_does_not_revive_the_order(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $staff = $this->token('accountant');
        $intentId = $this->intent($order['order_id'])->id;

        $this->withToken($staff)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame('cancelled', $this->attempts($order['order_id'])->first()->capture_status);

        // المزوّد التقط رغم الإلغاء المحلي
        $this->capture($attempt);
        app(PaymentOrchestrator::class)->sync($attempt->fresh());

        $this->assertSame(CommercePaymentIntent::STATUS_CANCELLED, $this->intent($order['order_id'])->status);
        $reviewed = $this->attempts($order['order_id'])->first();
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $reviewed->review_reasons);
        $this->assertSame('captured', $reviewed->capture_status);

        // يظهر للموظف في عرض النوايا بسبب المراجعة؛ ولا بدء جديد
        $rows = $this->withToken($staff)->getJson('/api/commerce/payment-intents')->assertOk()->json('data');
        $row = collect($rows)->firstWhere('id', $intentId);
        $this->assertSame('cancelled', $row['status']);
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $row['attempts'][0]['review_reasons']);
        $this->startPayment($order)->assertStatus(409)->assertJsonPath('error.code', 'payment_not_payable');
    }

    #[Test]
    public function a_start_racing_an_admin_cancel_never_hands_out_a_live_page_for_a_cancelled_intent(): void
    {
        $order = $this->onlineOrder();
        // الإلغاء يلتزم أثناء استدعاء المزوّد لإنشاء الصفحة (بعد فحص الصلاحية وقبل عودة البدء)
        $this->fake->onCheckout = function () use ($order): void {
            DB::table('commerce_payment_intents')->where('commerce_order_id', $order['order_id'])->update(['status' => 'cancelled', 'cancelled_at' => now('UTC')]);
        };

        $this->startPayment($order)->assertStatus(409)->assertJsonPath('error.code', 'payment_not_payable');

        $attempts = $this->attempts($order['order_id']);
        $this->assertCount(1, $attempts);
        $this->assertSame('cancelled', $attempts->first()->capture_status, 'لا صفحة دفع حيّة لنية ملغاة');
        $this->fake->onCheckout = null;
        $this->startPayment($order)->assertStatus(409)->assertJsonPath('error.code', 'payment_not_payable');
        $this->assertCount(1, $this->attempts($order['order_id']));
    }

    #[Test]
    public function the_safety_net_skips_held_captures_before_applying_its_batch_limit(): void
    {
        Event::fake([CommercePaymentAttemptCaptured::class]);
        $held = $this->onlineOrder();
        $this->startPayment($held)->assertCreated();
        $heldAttempt = $this->attempts($held['order_id'])->first();
        $this->fake->script((string) $heldAttempt->provider_payment_id, 'captured', 4000, 5000); // مبلغ غير مطابق ⇒ محجوزة للمراجعة
        app(PaymentOrchestrator::class)->sync($heldAttempt);

        $good = $this->onlineOrder(null, null, null, 'idem-online-002');
        $this->startPayment($good)->assertCreated();
        $goodAttempt = $this->attempts($good['order_id'])->first();
        $this->capture($goodAttempt);
        app(PaymentOrchestrator::class)->sync($goodAttempt);

        // الدفعة بحدّ 1: الأقدم محجوزة ولا يجوز أن تسدّ الطريق أمام الصالحة
        $this->artisan('payments:complete-commerce-captures', ['--limit' => 1])->assertSuccessful();

        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($good['order_id'])->status);
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($held['order_id'])->status);
    }

    #[Test]
    public function a_second_open_attempt_is_cancelled_once_the_order_is_paid_and_a_double_payment_is_flagged(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $first = $this->attempts($order['order_id'])->first();
        // انتهاء محلي لصفحة الأولى ثم محاولة ثانية؛ ثم التقاط الأولى (دفع العميل صفحته القديمة)
        DB::table('payment_attempts')->where('id', $first->id)->update(['capture_status' => 'expired']);
        $this->startPayment($order)->assertCreated();
        $second = $this->attempts($order['order_id'])->last();
        $this->assertSame('pending_customer', $second->capture_status);

        $this->capture($first->fresh());
        app(PaymentOrchestrator::class)->sync($first->fresh());

        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);
        $this->assertSame('cancelled', $second->fresh()->capture_status, 'المحاولة الثانية المفتوحة تُلغى بعد الدفع');
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $first->fresh()->review_reasons);

        // الثانية التُقطت لاحقاً أيضاً ⇒ دفعة مزدوجة تُوسم للمراجعة ولا تغيّر النية
        $this->capture($second->fresh());
        app(PaymentOrchestrator::class)->sync($second->fresh());
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $second->fresh()->review_reasons);
        $this->assertSame(1, CommercePaymentIntent::query()->where('status', CommercePaymentIntent::STATUS_PAID)->count());
    }

    #[Test]
    public function a_second_capture_on_an_already_paid_intent_is_flagged_even_when_its_attempt_was_authorized_and_could_not_be_cancelled(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $first = $this->attempts($order['order_id'])->first();
        DB::table('payment_attempts')->where('id', $first->id)->update(['capture_status' => 'expired']);
        $this->startPayment($order)->assertCreated();
        $second = $this->attempts($order['order_id'])->last();
        // الثانية «مفوَّضة» لدى المزوّد فلا تُلغى محلياً
        $this->fake->script((string) $second->provider_payment_id, 'authorized');
        app(PaymentOrchestrator::class)->sync($second->fresh());
        $this->assertSame('authorized', $second->fresh()->capture_status);

        $this->capture($first->fresh());
        app(PaymentOrchestrator::class)->sync($first->fresh());
        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);

        $this->capture($second->fresh());
        app(PaymentOrchestrator::class)->sync($second->fresh());

        $this->assertSame('captured', $second->fresh()->capture_status);
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $second->fresh()->review_reasons ?? [], 'دفعة مزدوجة بلا علامة مراجعة');
        $this->assertSame(1, CommercePaymentIntent::query()->where('status', CommercePaymentIntent::STATUS_PAID)->count());
    }

    #[Test]
    public function the_staff_listing_adds_online_only_fields_just_for_online_intents(): void
    {
        $online = $this->onlineOrder();
        $product = $this->product($this->tenant, $this->channel);
        config(['payments.commerce_online_checkout.enabled' => false]);
        $cod = $this->complete($this->readyCheckout($product, null), 'idem-cod-001')->assertCreated();
        config(['payments.commerce_online_checkout.enabled' => true]);

        $rows = collect($this->withToken($this->token('accountant'))->getJson('/api/commerce/payment-intents')->assertOk()->json('data'));
        $onlineRow = $rows->firstWhere('commerce_order_id', $online['order_id']);
        $codRow = $rows->firstWhere('commerce_order_id', $cod->json('data.order.id'));
        $this->assertArrayHasKey('attempts', $onlineRow);
        $this->assertArrayHasKey('paid_at', $onlineRow);
        $this->assertArrayNotHasKey('attempts', $codRow, 'شكل COD كما كان');
        $this->assertArrayNotHasKey('paid_at', $codRow);
    }

    // ═══════════════ الملكية والعزل ═══════════════

    #[Test]
    public function ownership_requires_the_signed_order_reference_and_every_failure_is_the_same_404(): void
    {
        $order = $this->onlineOrder();
        $other = $this->onlineOrder(null, null, null, 'idem-online-002');

        $bodies = [];
        foreach ([
            $this->api()->postJson(self::BASE.'/checkout/payment-intent', ['order_id' => $order['order_id']]),                                  // بلا مرجع
            $this->startPayment($order, 'v1.'.str_repeat('0', 64)),                                                                           // توقيع خاطئ
            $this->startPayment($order, $other['reference']),                                                                                   // مرجع طلب آخر
            $this->startPayment($order, 'garbage'),
            $this->startPayment(['order_id' => (string) Str::uuid(), 'reference' => $order['reference']]),                                     // طلب غير موجود
        ] as $response) {
            $response->assertNotFound();
            $bodies[] = $response->json('error.code').'|'.$response->json('error.message');
        }
        $this->assertCount(1, array_unique($bodies));
        $this->paymentStatus($order, 'garbage')->assertNotFound();
        $this->assertCount(0, $this->attempts($order['order_id']));
    }

    #[Test]
    public function an_order_of_another_tenant_is_invisible_and_cannot_be_paid_or_read_through_this_storefront(): void
    {
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->makeStore('online-pay-b.test', 'online-pay-b');
        [$methodB] = $this->wirePayments($tenantB, $channelB);
        $productB = $this->product($tenantB, $channelB);
        $orderB = $this->onlineOrder('online-pay-b.test', $productB, $methodB->id, 'idem-online-b');

        // مرجع B الصحيح على نطاق A ⇒ 404 (الطلب خارج مستأجر/قناة السياق)
        $this->startPayment($orderB, null, self::HOST)->assertNotFound();
        $this->paymentStatus($orderB, null, self::HOST)->assertNotFound();
        // وعلى نطاقه الصحيح يعمل
        $this->startPayment($orderB, null, 'online-pay-b.test')->assertCreated();
        $this->paymentStatus($orderB, null, 'online-pay-b.test')->assertOk()->assertJsonPath('data.payment.status', 'pending');

        app(TenantContext::class)->set($tenantB->id);
        $this->assertSame(1, PaymentAttempt::query()->count());
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, PaymentAttempt::query()->count());
    }

    #[Test]
    public function an_order_that_is_not_online_cannot_start_a_payment(): void
    {
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, null);
        $done = $this->complete($token)->assertCreated();
        $order = ['order_id' => $done->json('data.order.id'), 'reference' => $done->json('data.order_reference')];

        $this->startPayment($order)->assertNotFound()->assertJsonPath('error.details.reason', 'not_online');
        $this->assertCount(0, PaymentAttempt::query()->get());
    }

    #[Test]
    public function the_request_accepts_no_amount_gateway_or_url_fields_from_the_client(): void
    {
        $order = $this->onlineOrder();

        foreach (['amount' => 1, 'amount_minor' => 1, 'gateway_id' => (string) Str::uuid(), 'return_url' => 'https://evil.test', 'success_url' => 'https://evil.test'] as $field => $value) {
            $this->api()->withHeaders([CommerceOrderReference::HEADER => $order['reference']])
                ->postJson(self::BASE.'/checkout/payment-intent', ['order_id' => $order['order_id'], $field => $value])->assertStatus(422);
        }
        $this->assertCount(0, $this->attempts($order['order_id']));
    }

    #[Test]
    public function the_return_url_is_built_from_the_verified_storefront_domain_only(): void
    {
        $order = $this->onlineOrder();
        app(TenantContext::class)->set($this->tenant->id);
        // نطاق غير موثَّق/غير نشط لا يُستعمل أبداً
        StorefrontDomain::create([
            'storefront_id' => $this->storefront->id, 'hostname' => 'evil-pending.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'is_primary' => false, 'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
        ]);
        app(TenantContext::class)->forget();

        $this->startPayment($order)->assertCreated();

        $this->assertSame('https://'.self::HOST.'/checkout/payment-return', $this->fake->checkoutCalls[0]['return_url']);
    }

    // ═══════════════ الموظفون: RBAC ═══════════════

    #[Test]
    public function staff_cannot_mark_an_online_intent_collected_and_cannot_cancel_a_paid_one(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $intentId = $this->intent($order['order_id'])->id;
        $accountant = $this->token('accountant');

        // التحصيل اليدوي (COD) غير متاح للنية الإلكترونية
        $this->withToken($accountant)->postJson("/api/commerce/payment-intents/{$intentId}/collect")->assertStatus(422);

        $this->capture($this->attempts($order['order_id'])->first());
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
        $this->withToken($accountant)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertStatus(422);
        $this->assertSame(CommercePaymentIntent::STATUS_PAID, $this->intent($order['order_id'])->status);
    }

    #[Test]
    public function cancelling_a_pending_online_intent_closes_its_open_attempt_and_refuses_when_a_capture_exists(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $intentId = $this->intent($order['order_id'])->id;
        $accountant = $this->token('accountant');
        $attempt = $this->attempts($order['order_id'])->first();

        // التُقط لدى المزوّد قبل الإلغاء ولم تُثبَّت النية بعد ⇒ يُرفض الإلغاء (يُسترد ولا يُلغى)
        $this->capture($attempt);
        Event::fake([CommercePaymentAttemptCaptured::class]);
        app(PaymentOrchestrator::class)->sync($attempt);
        $this->withToken($accountant)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertStatus(422);
        $this->assertSame(CommercePaymentIntent::STATUS_PENDING, $this->intent($order['order_id'])->status);
    }

    #[Test]
    public function viewing_and_managing_online_intents_follow_rbac_and_tenant_isolation(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $intentId = $this->intent($order['order_id'])->id;

        // `staff` يعرض (payments.view) ولا يدير (payments.manage)
        $viewer = $this->token('staff');
        $this->withToken($viewer)->getJson('/api/commerce/payment-intents')->assertOk()->assertJsonPath('data.0.attempts.0.capture_status', 'pending_customer');
        $this->withToken($viewer)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertForbidden();
        $this->withToken($viewer)->postJson("/api/commerce/payment-intents/{$intentId}/collect")->assertForbidden();

        // مستأجر آخر لا يرى النية ولا يلغيها
        ['tenant' => $tenantB] = $this->makeStore('online-pay-rbac-b.test', 'online-pay-rbac-b');
        app(TenantContext::class)->set($tenantB->id);
        $ownerB = User::create(['tenant_id' => $tenantB->id, 'name' => 'مالك ب', 'email' => 'owner-b@online-pay.test', 'password' => 'password123', 'role' => 'owner']);
        $tokenB = $ownerB->createToken('t')->plainTextToken;
        app(TenantContext::class)->forget();
        $this->withToken($tokenB)->getJson('/api/commerce/payment-intents')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($tokenB)->postJson("/api/commerce/payment-intents/{$intentId}/cancel")->assertNotFound();
    }

    // ═══════════════ ثوابت الحدود ═══════════════

    #[Test]
    public function the_gateway_is_resolved_from_the_selected_method_never_from_the_client_and_must_be_ready(): void
    {
        $order = $this->onlineOrder();
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_SUSPENDED, 'is_active' => false]);

        $this->startPayment($order)->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
        $this->assertCount(0, $this->attempts($order['order_id']));
    }

    #[Test]
    public function a_platform_emergency_stop_blocks_starting_but_never_blocks_confirming_a_capture(): void
    {
        $order = $this->onlineOrder();
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();

        app(TenantContext::class)->forget();
        app(PaymentsRolloutControlService::class)->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');
        app(TenantContext::class)->set($this->tenant->id);

        // الإيقاف الطارئ يوقف البدء/الاستئناف الجديد فقط؛ لا يوقف التحقق مما التقطه المزوّد فعلاً
        $this->startPayment($order)->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
        $this->capture($attempt);
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
    }

    #[Test]
    public function the_migration_adds_only_paid_at_and_old_intents_are_untouched(): void
    {
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('commerce_payment_intents', 'paid_at'));
        $this->assertSame(['cod', 'pay_on_pickup'], CommercePaymentIntent::METHODS, 'عقد OpenAPI المنشور لم يتغيّر');
        $this->assertContains('online', CommercePaymentIntent::ALL_METHODS);
    }

    // ═══════════════ مساعد الرموز ═══════════════

    private function token(string $role): string
    {
        app(TenantContext::class)->set($this->tenant->id);
        $user = User::create(['tenant_id' => $this->tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(5).'@online-pay.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('t')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }
}
