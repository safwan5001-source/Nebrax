<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Support\CommerceOrderSerializer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * COMMERCE-ORDERS-O3c — العقد العام للطلب الملغى (ADR-28 D-9-P1 الخيار B).
 * `status: "cancelled"` + `cancellation: {cancelled_at}` للمشتري، بينما يبقى عمود `status` في القاعدة `confirmed`.
 * السبب والملاحظة وهوية الموظف لا تظهر أبداً في أي مسار عام. الطلب غير الملغى بلا أي تغيير في الشكل.
 */
class CommerceOrderPublicCancelledContractTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const NOTE = 'internal-only-note-xyz';

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function store(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => $slug, 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'Mobile', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $key = $this->service()->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function product(array $store): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج', 'name_en' => 'Product', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @return array<string, string> */
    private function bearer(array $store, array $extra = []): array
    {
        return ['Authorization' => 'Bearer '.$store['token']] + $extra;
    }

    /** @return array{id: string, reference: string, payload: array<string, mixed>} */
    private function guestOrder(array $store, Product $product, ?string $customerToken = null): array
    {
        $this->flushHeaders();
        $auth = fn (array $extra = []) => $this->bearer($store, $customerToken ? ['X-Customer-Token' => $customerToken] + $extra : $extra);

        $cartToken = $this->withHeaders($auth())
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $h = fn (array $extra = []) => $auth(['X-Cart-Token' => $cartToken] + $extra);

        $this->withHeaders($h())->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($h())->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم', 'phone' => '0501234567', 'email' => 's@example.com'])->assertOk();
        $this->withHeaders($h())->patchJson('/commerce/v1/checkout/address', [
            'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'الملك فهد', 'postal_code' => '31411',
        ])->assertOk();
        $this->withHeaders($h())->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();
        $done = $this->withHeaders($h(['Idempotency-Key' => (string) Str::uuid()]))->postJson('/commerce/v1/checkout/complete', [])->assertCreated();

        return ['id' => $done->json('data.order.id'), 'reference' => $done->json('data.order_reference'), 'payload' => $done->json('data.order')];
    }

    private function cancel(string $orderId): void
    {
        DB::table('commerce_orders')->where('id', $orderId)->update([
            'cancelled_at' => '2026-05-03 10:00:00', 'cancellation_reason' => 'fraud_suspected', 'cancellation_note' => self::NOTE,
        ]);
    }

    private function guestRead(array $store, string $id, string $reference): TestResponse
    {
        $this->flushHeaders();

        return $this->withHeaders($this->bearer($store, ['X-Order-Reference' => $reference]))->getJson("/commerce/v1/orders/{$id}");
    }

    private function customerToken(array $store, string $phone): string
    {
        $this->flushHeaders();
        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        return $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store))->assertOk()->json('data.token');
    }

    private function assertNoInternalLeak(TestResponse $response): void
    {
        $body = $response->getContent();
        foreach ([self::NOTE, 'fraud_suspected', 'cancellation_reason', 'cancellation_note', 'cancelled_by', 'cancel_action'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, "leaked: {$needle}");
        }
    }

    // ── الطلب غير الملغى: الشكل حرفياً كما كان ─────────────────────────────

    /** @test */
    public function a_non_cancelled_order_keeps_its_exact_payload_with_no_cancellation_key(): void
    {
        $store = $this->store('o3c-plain');
        $order = $this->guestOrder($store, $this->product($store));

        $read = $this->guestRead($store, $order['id'], $order['reference'])->assertOk();

        $this->assertSame('confirmed', $read->json('data.order.status'));
        $this->assertArrayNotHasKey('cancellation', $read->json('data.order'));
        $this->assertSame($order['payload'], $read->json('data.order'));
    }

    // ── ضيف /commerce/v1 ──────────────────────────────────────────────────

    /** @test */
    public function a_cancelled_order_reads_cancelled_for_the_guest_with_only_cancelled_at(): void
    {
        $store = $this->store('o3c-guest');
        $order = $this->guestOrder($store, $this->product($store));
        $this->cancel($order['id']);

        $read = $this->guestRead($store, $order['id'], $order['reference'])->assertOk();
        $data = $read->json('data.order');

        $this->assertSame('cancelled', $data['status']);
        $this->assertSame(['cancelled_at'], array_keys($data['cancellation']));
        $this->assertStringStartsWith('2026-05-03T10:00:00', $data['cancellation']['cancelled_at']);
        $this->assertSame($order['payload']['total'], $data['total']);
        $this->assertSame($order['payload']['items'], $data['items']);
        $this->assertSame($order['payload']['id'], $data['id']);
        $this->assertNoInternalLeak($read);
        $this->assertDatabaseHas('commerce_orders', ['id' => $order['id'], 'status' => 'confirmed']);
    }

    /** @test */
    public function the_signed_reference_stays_valid_for_reading_a_cancelled_order_and_other_keys_are_unchanged(): void
    {
        $store = $this->store('o3c-keys');
        $order = $this->guestOrder($store, $this->product($store));
        $before = array_keys($this->guestRead($store, $order['id'], $order['reference'])->json('data.order'));
        $this->cancel($order['id']);

        $after = array_keys($this->guestRead($store, $order['id'], $order['reference'])->assertOk()->json('data.order'));

        $this->assertSame([], array_diff($before, $after));
        $this->assertSame(['cancellation'], array_values(array_diff($after, $before)));
    }

    /** @test */
    public function a_cancelled_order_never_exposes_a_pending_payment_action(): void
    {
        $store = $this->store('o3c-pay');
        $order = $this->guestOrder($store, $this->product($store));
        DB::table('commerce_payment_intents')->where('commerce_order_id', $order['id'])->update(['status' => 'cancelled']);
        $this->cancel($order['id']);

        $payment = $this->guestRead($store, $order['id'], $order['reference'])->assertOk()->json('data.order.payment');

        $this->assertSame('cancelled', $payment['status']);
        $this->assertArrayNotHasKey('requires_action', $payment);
    }

    /** @test */
    public function a_foreign_reference_is_still_a_uniform_404_for_a_cancelled_order(): void
    {
        $a = $this->store('o3c-a');
        $b = $this->store('o3c-b');
        $orderA = $this->guestOrder($a, $this->product($a));
        $orderB = $this->guestOrder($b, $this->product($b));
        $this->cancel($orderA['id']);

        $this->guestRead($b, $orderA['id'], $orderB['reference'])->assertNotFound();
        $this->guestRead($b, $orderA['id'], $orderA['reference'])->assertNotFound();
        $this->guestRead($a, $orderA['id'], 'bogus')->assertNotFound();
    }

    // ── عميل مسجَّل: قائمة وتفاصيل ───────────────────────────────────────

    /** @test */
    public function customer_list_and_detail_agree_on_cancelled_status_and_cancellation_block(): void
    {
        $store = $this->store('o3c-cust');
        $token = $this->customerToken($store, '+966500000311');
        $product = $this->product($store);
        $live = $this->guestOrder($store, $product, $token);
        $dead = $this->guestOrder($store, $product, $token);
        $this->cancel($dead['id']);

        $headers = $this->bearer($store, ['X-Customer-Token' => $token]);
        $this->flushHeaders();
        $list = $this->withHeaders($headers)->getJson('/commerce/v1/me/orders')->assertOk();
        $rows = collect($list->json('data'))->keyBy('id');

        $this->assertSame('confirmed', $rows[$live['id']]['status']);
        $this->assertArrayNotHasKey('cancellation', $rows[$live['id']]);
        $this->assertSame('cancelled', $rows[$dead['id']]['status']);
        $this->assertSame(['cancelled_at'], array_keys($rows[$dead['id']]['cancellation']));
        $this->assertNoInternalLeak($list);

        $detail = $this->withHeaders($headers)->getJson("/commerce/v1/me/orders/{$dead['id']}")->assertOk();
        $this->assertSame('cancelled', $detail->json('data.order.status'));
        $this->assertSame($rows[$dead['id']]['cancellation'], $detail->json('data.order.cancellation'));
        $this->assertSame($rows[$dead['id']]['total'], $detail->json('data.order.total'));
        $this->assertNoInternalLeak($detail);
    }

    /** @test */
    public function another_customer_cannot_read_a_cancelled_order(): void
    {
        $store = $this->store('o3c-idor');
        $owner = $this->customerToken($store, '+966500000321');
        $order = $this->guestOrder($store, $this->product($store), $owner);
        $this->cancel($order['id']);
        $other = $this->customerToken($store, '+966500000322');

        $this->flushHeaders();
        $this->withHeaders($this->bearer($store, ['X-Customer-Token' => $other]))
            ->getJson("/commerce/v1/me/orders/{$order['id']}")->assertNotFound();
    }

    // ── المسلسل ومنع التسرّب البنيوي ──────────────────────────────────────

    /** @test */
    public function the_public_serializer_derives_cancelled_without_touching_the_stored_status(): void
    {
        $store = $this->store('o3c-ser');
        $order = $this->guestOrder($store, $this->product($store));
        $this->cancel($order['id']);

        app(TenantContext::class)->set($store['tenant']->id);
        $model = CommerceOrder::query()->findOrFail($order['id']);
        $this->assertSame('confirmed', $model->status);
        $this->assertSame('cancelled', CommerceOrderSerializer::publicStatus($model));
        $this->assertSame(['cancelled_at'], array_keys(CommerceOrderSerializer::cancellationBlock($model)['cancellation']));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function public_serializers_never_reference_internal_cancellation_fields(): void
    {
        foreach ([
            'app/Support/CommerceOrderSerializer.php',
            'app/Http/Controllers/Api/CommerceCustomerOrderController.php',
        ] as $file) {
            $code = file_get_contents(base_path($file)) ?: '';
            $code = preg_replace('#/\*.*?\*/|//[^\n]*#s', '', $code) ?? '';
            foreach (['cancellation_reason', 'cancellation_note', 'cancelled_by', 'cancelledBy'] as $field) {
                $this->assertStringNotContainsString($field, $code, "{$file} references {$field}");
            }
        }
    }
}
