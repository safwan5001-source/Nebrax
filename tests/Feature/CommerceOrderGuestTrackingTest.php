<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\PublicApiRequestLog;
use App\Support\CommerceOrderReference;
use App\Support\CommerceOrderTrackingToken;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-5 (D-H2-15/16/17) — تتبّع الضيف الموقَّع لطلب المتجر
 * ═══════════════════════════════════════════════════════════════
 *  البوابة المغلقة · إصدار بمرجع `v1` فقط وحتمي · إسقاط ضيّق بلا PII · مصفوفة الإخفاق 404 بجسم واحد (تلاعب/انتهاء/طلب آخر/مستأجر آخر/صيغة/بادئة) ·
 *  فصل الغرض (الرمز لا يخوّل الدفع والمرجع لا يخوّل التتبع) · حدود المعدّل (30 صالح / 20 فاشل) · ترويسات التصليب · لا تدقيق ولا كتابة.
 */
class CommerceOrderGuestTrackingTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 11, 2)->setTime(9, 0));
        $this->bootOnlineStore();
        config(['commerce.guest_order_tracking_enabled' => true]);
        RateLimiter::clear('x');
    }

    /** @return array{order_id: string, reference: string} */
    private function order(): array
    {
        return $this->onlineOrder();
    }

    private function issue(array $order, ?string $reference = null, string $host = self::HOST): TestResponse
    {
        $this->flushHeaders(); // withHeaders يتراكم عبر الطلبات داخل الاختبار الواحد
        $effective = $reference ?? $order['reference'];
        $headers = $effective === '' ? [] : [CommerceOrderReference::HEADER => $effective];

        return $this->api($host)->withHeaders($headers)->postJson(self::BASE."/orders/{$order['order_id']}/tracking-link");
    }

    private function token(array $order): string
    {
        return (string) $this->issue($order)->assertOk()->json('data.token');
    }

    private function track(string $token, string $host = self::HOST): TestResponse
    {
        return $this->api($host)->getJson(self::BASE."/order-tracking/{$token}");
    }

    /** الجسم الموحَّد بعد حذف ما يتغير بين الطلبات (request_id). */
    private function body(TestResponse $response): array
    {
        $json = $response->json();
        unset($json['meta']['request_id'], $json['meta']['requestId']);

        return $json;
    }

    #[Test]
    public function a_closed_gate_answers_404_for_issue_and_read(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        config(['commerce.guest_order_tracking_enabled' => false]);

        $this->assertSame(false, (bool) config('commerce.guest_order_tracking_enabled'));
        $this->issue($order)->assertNotFound();
        $this->track($token)->assertNotFound();
    }

    #[Test]
    public function the_gate_is_closed_by_default_in_shipped_config(): void
    {
        $this->assertFalse((bool) (require config_path('commerce.php'))['guest_order_tracking_enabled']);
    }

    #[Test]
    public function issuing_requires_the_v1_order_reference_and_is_deterministic(): void
    {
        $order = $this->order();

        $first = $this->issue($order)->assertOk();
        $second = $this->issue($order)->assertOk();
        $this->assertSame($first->json('data.token'), $second->json('data.token'));
        $this->assertStringStartsWith('trk1.', (string) $first->json('data.token'));
        $this->assertNotNull($first->json('data.expires_at'));

        $other = $this->order2();
        $this->issue($order, '')->assertNotFound();
        $this->issue($order, 'v1.'.str_repeat('0', 64))->assertNotFound();
        $this->issue($order, $other['reference'])->assertNotFound();
        $this->assertSame($this->body($this->issue($order, '')), $this->body($this->issue($order, $other['reference'])));
    }

    private function order2(): array
    {
        return $this->onlineOrder(key: 'idem-online-002');
    }

    #[Test]
    public function the_expiry_is_confirmed_at_plus_the_configured_days(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        app(TenantContext::class)->set($this->tenant->id);
        $model = CommerceOrder::query()->findOrFail($order['order_id']);
        $exp = (int) explode('.', $token)[2];
        app(TenantContext::class)->forget();

        $this->assertSame($model->confirmed_at->copy()->addDays(90)->getTimestamp(), $exp);
    }

    #[Test]
    public function reading_returns_only_the_narrow_projection_with_hardening_headers(): void
    {
        $order = $this->order();
        $response = $this->track($this->token($order))->assertOk();

        $data = $response->json('data.tracking');
        $allowed = ['number', 'status', 'delivery_method', 'placed_at', 'expires_at'];
        foreach (array_keys($data) as $key) {
            $this->assertContains($key, [...$allowed, 'cancellation', 'schedule', 'fulfillment'], "مفتاح غير معتمد في إسقاط التتبع: {$key}");
        }
        $this->assertSame('confirmed', $data['status']);

        $encoded = (string) json_encode($response->json(), JSON_UNESCAPED_UNICODE);
        foreach (['سالم', 'الأحمدي', '0501234567', 'salem@example.com', 'شارع الملك فهد', '31411', 'الشاطئ', 'gift', 'items', 'total', 'payment', 'contact', 'delivery"', 'line'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $encoded, "تسريب: {$forbidden}");
        }

        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertSame('noindex, nofollow', $response->headers->get('X-Robots-Tag'));
        $this->assertSame('strict-origin-when-cross-origin', $response->headers->get('Referrer-Policy'));
    }

    #[Test]
    public function every_failure_is_one_identical_404(): void
    {
        $a = $this->order();
        $b = $this->order2();
        $token = $this->token($a);
        [$prefix, $id, $exp, $sig] = explode('.', $token);

        $expired = $this->token($a);
        $bodies = [
            'unknown' => $this->body($this->track('trk1.'.\Illuminate\Support\Str::uuid().'.'.$exp.'.'.str_repeat('a', 64))),
            'tampered signature' => $this->body($this->track(implode('.', [$prefix, $id, $exp, strrev($sig)]))),
            'tampered expiry' => $this->body($this->track(implode('.', [$prefix, $id, (string) ((int) $exp + 86400), $sig]))),
            'other order id' => $this->body($this->track(implode('.', [$prefix, explode('.', $this->token($b))[1], $exp, $sig]))),
            'v1 reference as token' => $this->body($this->track($a['reference'])),
            'wrong prefix' => $this->body($this->track(implode('.', ['trk2', $id, $exp, $sig]))),
            'garbage' => $this->body($this->track('not-a-token')),
            'oversized' => $this->body($this->track(str_repeat('a', 400))),
            'truncated' => $this->body($this->track(substr($token, 0, -5))),
        ];
        $this->travel(91)->days();
        $bodies['expired'] = $this->body($this->track($expired));

        $reference = $bodies['unknown'];
        foreach ($bodies as $label => $body) {
            $this->assertSame($reference, $body, "الإخفاق «{$label}» يجب أن يطابق الجسم الموحَّد");
        }
        $this->assertSame('not_found', $reference['error']['code'] ?? null);
    }

    #[Test]
    public function a_token_from_another_store_or_tenant_does_not_open_this_one(): void
    {
        $order = $this->order();
        $token = $this->token($order);

        $this->makeStore('other-store.test', 'other');
        $this->track($token, 'other-store.test')->assertNotFound();
        $this->track($token)->assertOk();
    }

    #[Test]
    public function purposes_are_separated_the_token_grants_no_payment_and_the_reference_grants_no_tracking(): void
    {
        $order = $this->order();
        $token = $this->token($order);

        // الرمز كمرجع طلب: لا بدء دفع ولا حالة دفع.
        $this->startPayment($order, $token)->assertNotFound();
        $this->paymentStatus($order, $token)->assertNotFound();
        // والمرجع كرمز: لا تتبع.
        $this->track($order['reference'])->assertNotFound();
        // الرمز لا يحمل أي هوية دفع في استجابته.
        $encoded = (string) json_encode($this->track($token)->json());
        $this->assertStringNotContainsString($order['reference'], $encoded);
    }

    #[Test]
    public function valid_reads_are_limited_to_thirty_per_minute_per_token(): void
    {
        $order = $this->order();
        $token = $this->token($order);

        for ($i = 0; $i < 30; $i++) {
            $this->track($token)->assertOk();
        }
        $limited = $this->track($token);
        $limited->assertStatus(429);
        $this->assertNotNull($limited->headers->get('Retry-After'));
        $this->assertSame('rate_limited', $limited->json('error.code'));

        $this->travel(61)->seconds();
        $this->track($token)->assertOk();
    }

    #[Test]
    public function a_noncanonical_expiry_is_rejected_so_one_token_cannot_buy_extra_read_budgets(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        [$prefix, $id, $exp, $sig] = explode('.', $token);

        // التمثيلات ذات الأصفار البادئة كانت تتحقق بالتوقيع نفسه وتأخذ سلة معدل خاصة بها (3×30 قراءة في الدقيقة).
        foreach (["0{$exp}", "00{$exp}", "000{$exp}"] as $variant) {
            $this->assertNull(\App\Support\CommerceOrderTrackingToken::parse(implode('.', [$prefix, $id, $variant, $sig])));
            $this->track(implode('.', [$prefix, $id, $variant, $sig]))->assertNotFound();
        }

        // الرمز القانوني وحده يُقرأ، وسلته 30 فقط مهما حُرِّف.
        for ($i = 0; $i < 30; $i++) {
            $this->track($token)->assertOk();
        }
        $this->track($token)->assertStatus(429);
        $this->track(implode('.', [$prefix, $id, "0{$exp}", $sig]))->assertNotFound();
        // أحرف كبيرة في uuid/hex ليست تمثيلاً ثانياً أيضاً.
        $this->assertNull(\App\Support\CommerceOrderTrackingToken::parse(implode('.', [$prefix, strtoupper($id), $exp, $sig])));
        $this->assertNull(\App\Support\CommerceOrderTrackingToken::parse(implode('.', [$prefix, $id, $exp, strtoupper($sig)])));
    }

    #[Test]
    public function issuing_links_has_its_own_budget_and_never_consumes_the_payment_start_budget(): void
    {
        $order = $this->order();

        // 10 إصدارات تستنفد سلة الإصدار لهذا الطلب، والحادي عشر 429.
        for ($i = 0; $i < 10; $i++) {
            $this->issue($order)->assertOk();
        }
        $this->issue($order)->assertStatus(429);

        // ولا أثر على سلة `checkout/payment-intent` المشتركة بعنوان خادم المتجر (مراجعة Codex P1):
        // بدء الدفع لا يُقابَل بـ429 بسبب إصدارات التتبع.
        $this->assertNotSame(429, $this->startPayment($order, $order['reference'])->getStatusCode());
    }

    #[Test]
    public function failed_attempts_are_limited_to_twenty_per_minute_but_a_valid_token_is_never_locked_out(): void
    {
        $order = $this->order();
        $token = $this->token($order);

        for ($i = 0; $i < 20; $i++) {
            $this->track('trk1.'.\Illuminate\Support\Str::uuid().'.1893456000.'.str_repeat('b', 64))->assertNotFound();
        }
        $this->track('not-a-token')->assertStatus(429);
        // التحقق عديم الحالة: الحامل الشرعي لا يُقفل بسلة الفاشل.
        $this->track($token)->assertOk();
    }

    #[Test]
    public function a_cancelled_order_reads_cancelled_without_a_fulfillment_block(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        app(TenantContext::class)->set($this->tenant->id);
        CommerceOrder::query()->whereKey($order['order_id'])->update(['cancelled_at' => now(), 'cancellation_reason' => 'customer_request']);
        app(TenantContext::class)->forget();

        $data = $this->track($token)->assertOk()->json('data.tracking');
        $this->assertSame('cancelled', $data['status']);
        $this->assertArrayHasKey('cancellation', $data);
        $this->assertArrayNotHasKey('fulfillment', $data);
    }

    #[Test]
    public function a_started_fulfillment_appears_as_the_public_block_without_internal_fields(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        app(TenantContext::class)->set($this->tenant->id);
        $warehouse = \App\Models\Warehouse::create(['name' => 'مخزن سري', 'code' => 'SECRET-W', 'is_default' => true]);
        \Illuminate\Support\Facades\DB::table('commerce_order_fulfillments')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id, 'commerce_order_id' => $order['order_id'],
            'warehouse_id' => $warehouse->id, 'type' => 'pickup', 'status' => 'preparing', 'version' => 1,
            'preparing_at' => now(), 'courier_name' => 'ساعي سري', 'last_failure_note' => null, 'created_at' => now(), 'updated_at' => now(),
        ]);
        app(TenantContext::class)->forget();

        $response = $this->track($token)->assertOk();
        $block = $response->json('data.tracking.fulfillment');
        $this->assertSame('preparing', $block['stage']);
        $this->assertSame('pickup', $block['type']);
        $encoded = (string) json_encode($response->json(), JSON_UNESCAPED_UNICODE);
        foreach (['مخزن سري', 'SECRET-W', 'ساعي سري', 'courier', 'warehouse'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $encoded);
        }
    }

    #[Test]
    public function reading_writes_nothing_and_is_not_audited(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        app(TenantContext::class)->set($this->tenant->id);
        $before = [CommerceOrder::query()->count(), CommerceOrder::query()->first()->updated_at->toIso8601String()];
        app(TenantContext::class)->forget();

        $this->track($token)->assertOk();

        app(TenantContext::class)->set($this->tenant->id);
        $after = [CommerceOrder::query()->count(), CommerceOrder::query()->first()->updated_at->toIso8601String()];
        app(TenantContext::class)->forget();
        $this->assertSame($before, $after);
        $this->assertSame(0, PublicApiRequestLog::query()->count());
    }

    #[Test]
    public function the_token_class_is_a_pure_stateless_hmac_with_no_database_or_logging(): void
    {
        $source = (string) file_get_contents(app_path('Support/CommerceOrderTrackingToken.php'));
        foreach (['DB::', 'Log::', '->save(', '->update(', 'Cache::'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $source);
        }
        $controller = (string) file_get_contents(app_path('Http/Controllers/Api/StorefrontOrderTrackingController.php'));
        foreach (['DB::', 'Log::', '->save(', '->update(', '->create(', 'Event::'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $controller);
        }
    }

    #[Test]
    public function a_configured_key_rotates_every_token(): void
    {
        $order = $this->order();
        $token = $this->token($order);
        $this->track($token)->assertOk();

        config(['commerce.tracking_key' => 'rotated-key-value']);
        $this->track($token)->assertNotFound();
        $this->assertNotSame($token, $this->token($order));
    }

    #[Test]
    public function parse_rejects_any_malformed_shape_without_throwing(): void
    {
        foreach (['', 'trk1', 'trk1.a.b.c', 'trk1.'.str_repeat('0', 36).'.12.'.str_repeat('0', 63), str_repeat('x', 500), "trk1.\0.1.2"] as $bad) {
            $this->assertNull(CommerceOrderTrackingToken::parse($bad));
        }
    }
}
