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
 * أدوات مشتركة لاختبارات الدفع الإلكتروني للمتجر (H4): متجر ويب + بوابة وهمية + رحلة Checkout كاملة عبر `/store/v1`.
 * مستخرَجة من `StorefrontOnlinePaymentTest` كي تعيد استعمالها اختبارات H4-01..03 بلا نسخ.
 */
trait OnlineStorefrontHarness
{
    private const SECRET = 'online-pay-gateway-secret';

    private const HOST = 'online-pay.test';

    private Tenant $tenant;

    private SalesChannel $channel;

    private Storefront $storefront;

    private PaymentMethod $method;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PlatformAdministrator $admin;

    /** يهيّئ متجراً ويباً بدفع إلكتروني جاهز (بوابة وهمية نشطة مرتبطة بوسيلة متاحة للقناة، البوابة المنصّية مفتوحة، تفعيل المستأجر). */
    protected function bootOnlineStore(): void
    {
        config(['payments.commerce_online_checkout.enabled' => true]);
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@online-pay.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();

        ['tenant' => $this->tenant, 'channel' => $this->channel, 'storefront' => $this->storefront] = $this->makeStore(self::HOST, 'online-pay');
        [$this->method, $this->gateway] = $this->wirePayments($this->tenant, $this->channel);
    }

    // ───────────────────────── الإعداد ─────────────────────────

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront} */
    private function makeStore(string $host, string $slug, string $currency = 'SAR'): array
    {
        $tenant = Tenant::create(['name' => $host, 'slug' => $slug.'-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => $currency, 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true,
            'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront');
    }

    /** طريقة دفع متاحة للقناة + اتصال وهمي نشط مرتبط بها + تفعيل المدفوعات للمستأجر. @return array{0: PaymentMethod, 1: PaymentGateway} */
    private function wirePayments(Tenant $tenant, SalesChannel $channel, bool $activate = true): array
    {
        app(TenantContext::class)->set($tenant->id);
        $method = PaymentMethod::create(['name' => 'بطاقة إلكترونية', 'name_en' => 'Online card', 'settlement_type' => 'bank', 'available_online' => true]);
        app(PaymentMethodChannelAvailabilityService::class)->setAvailability($method, $channel, true);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox', 'payment_method_id' => $method->id]);
        if ($activate) {
            DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        }
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $tenant->id, true, 'تفعيل للاختبار');
        app(TenantContext::class)->forget();

        return [$method, $gateway->fresh()];
    }

    private function product(Tenant $tenant, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(['name' => 'منتج الدفع', 'sku' => 'OP-'.Str::random(8), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function headers(string $host = self::HOST): array
    {
        config(['storefront.gateway_secret' => self::SECRET]);

        return ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
    }

    private function api(string $host = self::HOST, ?string $token = null)
    {
        $test = $this->withHeaders($this->headers($host))->withCredentials();

        return $token === null ? $test : $test->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token);
    }

    private const BASE = 'http://laravel-internal.test/store/v1';

    /** يبني Checkout جاهزاً (اتصال/عنوان/توصيل=pickup) ويختار طريقة الدفع إن مُرِّرت. يعيد رمز السلة. */
    private function readyCheckout(Product $product, ?string $paymentMethodId, string $host = self::HOST): string
    {
        $this->defaultCookies = [];
        $this->unencryptedCookies = []; // كل رحلة شراء بمتصفح جديد (لا كوكي سلة من رحلة سابقة في الاختبار نفسه)
        $token = $this->api($host)->postJson(self::BASE.'/cart/items', ['product_id' => $product->id, 'quantity' => 1, 'unit_key' => 'base'])
            ->assertCreated()->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $this->api($host, $token)->postJson(self::BASE.'/checkout', [])->assertCreated();
        $this->api($host, $token)->patchJson(self::BASE.'/checkout/contact', ['name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com'])->assertOk();
        $this->api($host, $token)->patchJson(self::BASE.'/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'شارع الملك فهد', 'postal_code' => '31411'])->assertOk();
        $this->api($host, $token)->patchJson(self::BASE.'/checkout/delivery', ['method' => 'pickup'])->assertOk();
        if ($paymentMethodId !== null) {
            $this->api($host, $token)->patchJson(self::BASE.'/checkout/payment', ['payment_method_id' => $paymentMethodId])->assertOk();
        }

        return $token;
    }

    private function complete(string $token, string $key = 'idem-online-001', string $host = self::HOST): TestResponse
    {
        return $this->api($host, $token)->withHeaders(['Idempotency-Key' => $key])->postJson(self::BASE.'/checkout/complete', []);
    }

    /** @return array{order_id: string, reference: string} طلب إلكتروني مكتمل بانتظار الدفع. */
    private function onlineOrder(?string $host = null, ?Product $product = null, ?string $methodId = null, string $key = 'idem-online-001'): array
    {
        $host ??= self::HOST;
        $product ??= $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, $methodId ?? $this->method->id, $host);
        $response = $this->complete($token, $key, $host)->assertCreated();

        return ['order_id' => $response->json('data.order.id'), 'reference' => $response->json('data.order_reference')];
    }

    private function startPayment(array $order, ?string $reference = null, string $host = self::HOST): TestResponse
    {
        return $this->api($host)->withHeaders([CommerceOrderReference::HEADER => $reference ?? $order['reference']])
            ->postJson(self::BASE.'/checkout/payment-intent', ['order_id' => $order['order_id']]);
    }

    private function paymentStatus(array $order, ?string $reference = null, string $host = self::HOST, string $query = ''): TestResponse
    {
        return $this->api($host)->withHeaders([CommerceOrderReference::HEADER => $reference ?? $order['reference']])
            ->getJson(self::BASE."/orders/{$order['order_id']}/payment-status".$query);
    }

    private function intent(string $orderId): CommercePaymentIntent
    {
        app(TenantContext::class)->set($this->tenant->id);

        return CommercePaymentIntent::query()->where('commerce_order_id', $orderId)->firstOrFail();
    }

    private function attempts(string $orderId)
    {
        app(TenantContext::class)->set($this->tenant->id);

        return PaymentAttempt::query()->where('payable_key', $this->intent($orderId)->payableKey())->orderBy('created_at')->orderBy('id')->get();
    }

    private function capture(PaymentAttempt $attempt, ?int $amount = null): void
    {
        $this->fake->script((string) $attempt->provider_payment_id, 'captured', $amount, null);
    }

    /** يحاكي مرور ثوانٍ منذ آخر استعلام للمزوّد (حدّ أدنى بين قراءتين). */
    private function elapse(PaymentAttempt $attempt): void
    {
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['last_synced_at' => now('UTC')->subMinute()]);
    }

    private function counts(): array
    {
        return [
            'journal_entries' => DB::table('journal_entries')->count(),
            'payments' => DB::table('payments')->count(),
            'invoices' => DB::table('invoices')->count(),
            'stock_movements' => DB::table('stock_movements')->count(),
            'reservations' => DB::table('inventory_reservations')->count(),
            'attempt_postings' => DB::table('payment_attempt_postings')->count(),
        ];
    }
}
