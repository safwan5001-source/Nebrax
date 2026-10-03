<?php

namespace Tests\Feature;

use App\Models\CommerceCheckoutSchedule;
use App\Models\CommerceDeliverySlot;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderSchedule;
use App\Models\CommerceShippingZone;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * FLOWERS-H7b / ADR-19 — موعد التسليم في Checkout والطلب: الاختيار والتحقق، الإلزامية، إعادة التحقق عند الإتمام،
 * السعة تحت قفل النافذة، اللقطة الثابتة، الإعادة المتماثلة، وثبات معرّف النافذة عند التعديل.
 *
 * الساعة مثبَّتة: الأربعاء 2026-10-07 10:00 بتوقيت الرياض (= 07:00 UTC).
 *
 * تشغيل: php artisan test --filter=CommerceDeliveryScheduleCheckoutTest
 */
class CommerceDeliveryScheduleCheckoutTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN = 'X-Cart-Token';

    private const SECRET = 'h7b-gateway-secret';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 07:00:00', 'UTC'));
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string, product: Product} */
    private function mobileStore(string $slug, array $settings = ['is_enabled' => true], ?array $slots = null): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        $product = Product::create(['name' => 'باقة', 'sku' => 'P-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 12000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        $service = app(CommerceDeliveryScheduleService::class);
        if ($settings !== []) {
            $service->saveSettings($channel->id, $settings);
        }
        $service->replaceSlots($channel->id, $slots ?? [
            ['method' => 'delivery', 'label' => 'مساءً', 'start_time' => '19:00', 'end_time' => '22:00'],
            ['method' => 'delivery', 'label' => 'ليلاً', 'start_time' => '22:00', 'end_time' => '23:30'],
        ]);
        app(TenantContext::class)->forget();

        $keys = app(ApiClientKeyService::class);

        return [
            'tenant' => $tenant, 'channel' => $channel, 'product' => $product,
            'token' => $keys->issueKey($keys->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken,
        ];
    }

    /** @return list<string> معرّفات نوافذ القناة بترتيب الإدارة */
    private function slotIds(array $store): array
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $ids = array_column(app(CommerceDeliveryScheduleService::class)->slots($store['channel']->id), 'id');
        app(TenantContext::class)->forget();

        return $ids;
    }

    private function headers(array $store, ?string $cart = null): array
    {
        return ['Authorization' => 'Bearer '.$store['token']] + ($cart !== null ? [self::TOKEN => $cart] : []);
    }

    /** يبدأ Checkout كاملاً حتى طريقة التوصيل ويعيد رمز السلة. */
    private function checkout(array $store, string $method = 'standard', string $city = 'الدمام'): string
    {
        $added = $this->postJson('/commerce/v1/cart/items', ['product_id' => $store['product']->id, 'quantity' => 1], $this->headers($store))->assertCreated();
        $cart = $added->headers->get(self::TOKEN);
        $h = $this->headers($store, $cart);
        $this->postJson('/commerce/v1/checkout', [], $h)->assertCreated();
        $this->patchJson('/commerce/v1/checkout/contact', ['name' => 'المشتري', 'phone' => '0501111111'], $h)->assertOk();
        $this->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => $city, 'street' => 'شارع'], $h)->assertOk();
        $this->patchJson('/commerce/v1/checkout/delivery', ['method' => $method], $h)->assertOk();

        return $cart;
    }

    private function schedule(array $store, string $cart, ?string $date, ?string $slotId): TestResponse
    {
        return $this->patchJson('/commerce/v1/checkout/schedule', ['date' => $date, 'slot_id' => $slotId], $this->headers($store, $cart));
    }

    private function complete(array $store, string $cart, string $key = 'h7b-key-0001'): TestResponse
    {
        return $this->postJson('/commerce/v1/checkout/complete', [], $this->headers($store, $cart) + ['Idempotency-Key' => $key]);
    }

    // ── سياسة معطَّلة: لا أثر ───────────────────────────────────────────

    /** @test */
    public function a_channel_without_scheduling_behaves_exactly_as_before(): void
    {
        $store = $this->mobileStore('h7b-off', []);
        $slot = $this->slotIds($store)[0];
        $cart = $this->checkout($store);

        $this->schedule($store, $cart, '2026-10-08', $slot)->assertStatus(422); // الجدولة غير مفعّلة
        $cleared = $this->schedule($store, $cart, null, null)->assertOk();
        $this->assertArrayNotHasKey('schedule', $cleared->json('data'));

        $done = $this->complete($store, $cart)->assertCreated();
        $this->assertArrayNotHasKey('schedule', $done->json('data.order'));
        $this->assertSame(0, CommerceOrderSchedule::withoutGlobalScopes()->count());
    }

    // ── الاختيار والتحقق ────────────────────────────────────────────────

    /** @test */
    public function a_valid_selection_is_stored_shown_and_snapshotted_on_the_order(): void
    {
        $store = $this->mobileStore('h7b-ok');
        [$evening] = $this->slotIds($store);
        $cart = $this->checkout($store);

        $set = $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();
        $this->assertSame('2026-10-08', $set->json('data.schedule.date'));
        $this->assertSame('مساءً', $set->json('data.schedule.slot.label'));
        $this->assertTrue($set->json('data.schedule.valid'));

        $done = $this->complete($store, $cart)->assertCreated();
        $this->assertSame([
            'method' => 'delivery', 'date' => '2026-10-08',
            'slot' => ['label' => 'مساءً', 'label_en' => null, 'start_time' => '19:00', 'end_time' => '22:00'],
            'timezone' => 'Asia/Riyadh',
        ], $done->json('data.order.schedule'));
        $this->assertSame(1, CommerceOrderSchedule::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_selections_are_rejected_and_nothing_is_stored(): void
    {
        $store = $this->mobileStore('h7b-bad');
        $other = $this->mobileStore('h7b-bad-other');
        [$evening] = $this->slotIds($store);
        [$foreignSlot] = $this->slotIds($other);
        $cart = $this->checkout($store);
        $h = $this->headers($store, $cart);

        $this->schedule($store, $cart, '2026-10-08', null)->assertStatus(422);                   // أحدهما فقط
        $this->schedule($store, $cart, null, $evening)->assertStatus(422);
        $this->schedule($store, $cart, '2026-13-40', $evening)->assertStatus(422);               // صيغة
        $this->schedule($store, $cart, '2026-10-08', (string) Str::uuid())->assertStatus(422);   // نافذة غير موجودة
        $this->schedule($store, $cart, '2026-10-08', $foreignSlot)->assertStatus(422);           // نافذة مستأجر آخر
        $this->schedule($store, $cart, '2026-10-06', $evening)->assertStatus(422);               // ماضٍ
        $this->schedule($store, $cart, '2026-12-31', $evening)->assertStatus(422);               // خارج الأفق (30 يوماً)
        $this->patchJson('/commerce/v1/checkout/schedule', ['date' => '2026-10-08'], $h)->assertStatus(422);            // slot_id غائب
        $this->patchJson('/commerce/v1/checkout/schedule', ['date' => '2026-10-08', 'slot_id' => $evening, 'x' => 1], $h)->assertStatus(422); // مفتاح غير مسموح

        $this->assertSame(0, CommerceCheckoutSchedule::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_delivery_method_must_be_chosen_first_and_pickup_uses_pickup_windows(): void
    {
        $store = $this->mobileStore('h7b-method', ['is_enabled' => true], [
            ['method' => 'delivery', 'label' => 'توصيل', 'start_time' => '19:00', 'end_time' => '22:00'],
            ['method' => 'pickup', 'label' => 'استلام', 'start_time' => '12:00', 'end_time' => '20:00'],
        ]);
        [$delivery, $pickup] = $this->slotIds($store);

        $added = $this->postJson('/commerce/v1/cart/items', ['product_id' => $store['product']->id, 'quantity' => 1], $this->headers($store))->assertCreated();
        $cart = $added->headers->get(self::TOKEN);
        $this->postJson('/commerce/v1/checkout', [], $this->headers($store, $cart))->assertCreated();
        $this->schedule($store, $cart, '2026-10-08', $delivery)->assertStatus(422); // لا طريقة بعد

        $this->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'], $this->headers($store, $cart))->assertOk();
        $this->schedule($store, $cart, '2026-10-08', $delivery)->assertStatus(422);  // نافذة توصيل لطريقة استلام
        $this->schedule($store, $cart, '2026-10-08', $pickup)->assertOk()->assertJsonPath('data.schedule.slot.label', 'استلام');
    }

    /** @test */
    public function a_zone_restricted_window_follows_the_stored_destination(): void
    {
        $store = $this->mobileStore('h7b-zone');
        app(TenantContext::class)->set($store['tenant']->id);
        $zone = CommerceShippingZone::create(['name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500]);
        app(CommerceDeliveryScheduleService::class)->replaceSlots($store['channel']->id, [
            ['method' => 'delivery', 'label' => 'الدمام فقط', 'start_time' => '19:00', 'end_time' => '22:00', 'shipping_zone_id' => $zone->id],
        ]);
        app(TenantContext::class)->forget();
        [$dammam] = $this->slotIds($store);

        $inside = $this->checkout($store, 'standard', 'الدمام');
        $this->schedule($store, $inside, '2026-10-08', $dammam)->assertOk();

        $outside = $this->checkout($store, 'standard', 'الرياض');
        $this->schedule($store, $outside, '2026-10-08', $dammam)->assertStatus(422);

        // تغيير المدينة بعد الاختيار: الاختيار يصير غير صالح ويُرفض الإتمام (المصدر وجهة Checkout المخزَّنة)
        $h = $this->headers($store, $inside);
        $changed = $this->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الرياض', 'street' => 'شارع'], $h)->assertOk();
        $this->assertFalse($changed->json('data.schedule.valid'));
        $this->assertNull($changed->json('data.schedule.slot'));
        $this->complete($store, $inside)->assertStatus(409)->assertJsonPath('error.details.items.0.reason', 'schedule_unavailable');
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_required_schedule_is_not_forced_when_no_window_applies_to_the_destination(): void
    {
        $store = $this->mobileStore('h7b-zone-req', ['is_enabled' => true, 'is_required' => true]);
        app(TenantContext::class)->set($store['tenant']->id);
        $zone = CommerceShippingZone::create(['name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500]);
        app(CommerceDeliveryScheduleService::class)->replaceSlots($store['channel']->id, [
            ['method' => 'delivery', 'label' => 'الدمام فقط', 'start_time' => '19:00', 'end_time' => '22:00', 'shipping_zone_id' => $zone->id],
        ]);
        app(TenantContext::class)->forget();

        // وجهة خارج المنطقة: لا نافذة تنطبق ⇒ لا يُلزَم بموعد لا يستطيع اختياره
        $outside = $this->checkout($store, 'standard', 'الرياض');
        $this->complete($store, $outside)->assertCreated()->assertJsonMissingPath('data.order.schedule');

        // وجهة داخل المنطقة: النافذة تنطبق ⇒ الموعد إلزامي
        $inside = $this->checkout($store, 'standard', 'الدمام');
        $this->complete($store, $inside, 'h7b-key-inside')->assertStatus(409)->assertJsonPath('error.details.items.0.reason', 'schedule_required');
    }

    /** @test */
    public function the_order_revalidates_the_committed_configuration_under_the_final_lock(): void
    {
        $store = $this->mobileStore('h7b-final', ['is_enabled' => true]);
        [$evening, $late] = $this->slotIds($store);

        // طلبٌ قائم (بنافذة أخرى) يُستعمل حاملاً لاستدعاء الخدمة مباشرةً بلقطةٍ التُقطت قبل التحرير.
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $late)->assertOk();
        $this->complete($store, $cart)->assertCreated();

        app(TenantContext::class)->set($store['tenant']->id);
        $service = app(CommerceDeliveryScheduleService::class);
        $channel = $store['channel']->id;
        $existing = CommerceOrder::query()->firstOrFail();
        $order = fn () => $existing;
        $captured = [
            'method' => 'delivery', 'delivery_date' => '2026-10-08', 'slot_id' => $evening, 'slot_label' => 'مساءً',
            'slot_label_en' => null, 'start_time' => '19:00', 'end_time' => '22:00', 'timezone' => 'Asia/Riyadh',
        ];
        $expectRefused = function (string $why) use ($service, $order, $captured): void {
            try {
                DB::transaction(fn () => $service->snapshotToOrder($order(), $captured, 'الدمام', null));
                $this->fail("a stale schedule was accepted: {$why}");
            } catch (\App\Services\Commerce\CheckoutReviewRequiredException $e) {
                $this->assertSame(1, CommerceOrderSchedule::query()->count(), $why);
            }
        };

        // 1) نافذة حُرِّرت (الهوية ثابتة) بعد التقاط اللقطة: أوقات وتسمية مختلفة
        $service->replaceSlots($channel, [
            ['id' => $evening, 'method' => 'delivery', 'label' => 'مساء جديد', 'start_time' => '20:00', 'end_time' => '23:00'],
        ]);
        $expectRefused('slot edited in place');

        // 2) تاريخ حُجب بعد الالتقاط
        $service->replaceSlots($channel, [
            ['id' => $evening, 'method' => 'delivery', 'label' => 'مساءً', 'start_time' => '19:00', 'end_time' => '22:00'],
        ]);
        $service->replaceBlockedDates($channel, [['date' => '2026-10-08', 'method' => 'all']]);
        $expectRefused('date blocked');

        // 3) الجدولة عُطِّلت
        $service->replaceBlockedDates($channel, []);
        $service->saveSettings($channel, ['is_enabled' => false]);
        $expectRefused('scheduling disabled');
        app(TenantContext::class)->forget();
    }

    // ── الإلزامية ───────────────────────────────────────────────────────

    /** @test */
    public function a_required_schedule_blocks_completion_until_chosen(): void
    {
        $store = $this->mobileStore('h7b-required');
        [$evening] = $this->slotIds($store);
        $cart = $this->checkout($store);

        $blocked = $this->complete($store, $cart)->assertStatus(409);
        $this->assertSame('review_required', $blocked->json('error.code'));
        $this->assertSame('schedule_required', $blocked->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());

        $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();
        $this->complete($store, $cart, 'h7b-key-0002')->assertCreated();
    }

    /** @test */
    public function an_optional_schedule_does_not_block_and_a_method_without_windows_is_never_forced(): void
    {
        $optional = $this->mobileStore('h7b-optional', ['is_enabled' => true, 'is_required' => false]);
        $this->complete($optional, $this->checkout($optional))->assertCreated();

        // إلزامية، لكن لا نافذة استلام مهيّأة ⇒ الاستلام لا يُلزَم بموعد
        $store = $this->mobileStore('h7b-nowindow');
        $done = $this->complete($store, $this->checkout($store, 'pickup'))->assertCreated();
        $this->assertArrayNotHasKey('schedule', $done->json('data.order'));
    }

    // ── إعادة التحقق ────────────────────────────────────────────────────

    /** @test */
    public function changes_after_selection_force_a_review_and_create_no_order(): void
    {
        $scenarios = [
            'policy disabled' => fn (array $s, string $slot) => app(CommerceDeliveryScheduleService::class)->saveSettings($s['channel']->id, ['is_enabled' => false]),
            'date blocked' => fn (array $s, string $slot) => app(CommerceDeliveryScheduleService::class)->replaceBlockedDates($s['channel']->id, [['date' => '2026-10-08']]),
            'window deactivated' => fn (array $s, string $slot) => app(CommerceDeliveryScheduleService::class)->replaceSlots($s['channel']->id, [
                ['id' => $slot, 'method' => 'delivery', 'label' => 'مساءً', 'start_time' => '19:00', 'end_time' => '22:00', 'is_active' => false],
            ]),
            'window removed' => fn (array $s, string $slot) => app(CommerceDeliveryScheduleService::class)->replaceSlots($s['channel']->id, []),
            'lead time grows' => fn (array $s, string $slot) => app(CommerceDeliveryScheduleService::class)->saveSettings($s['channel']->id, ['lead_time_minutes' => 60 * 72]),
        ];

        foreach ($scenarios as $name => $change) {
            $store = $this->mobileStore('h7b-reval-'.Str::slug($name));
            [$evening] = $this->slotIds($store);
            $cart = $this->checkout($store);
            $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();

            app(TenantContext::class)->set($store['tenant']->id);
            $change($store, $evening);
            app(TenantContext::class)->forget();

            $res = $this->complete($store, $cart, 'h7b-key-'.Str::random(6))->assertStatus(409);
            $this->assertSame('review_required', $res->json('error.code'), $name);
            $this->assertSame('schedule_unavailable', $res->json('error.details.items.0.reason'), $name);
        }
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function editing_a_window_in_place_keeps_its_id_and_the_open_selection_valid(): void
    {
        $store = $this->mobileStore('h7b-stable');
        [$evening, $late] = $this->slotIds($store);
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();

        // يعيد التاجر ترتيب النوافذ ويعدّل تسمية الأولى مع إبقاء المعرّفين
        app(TenantContext::class)->set($store['tenant']->id);
        $after = app(CommerceDeliveryScheduleService::class)->replaceSlots($store['channel']->id, [
            ['id' => $late, 'method' => 'delivery', 'label' => 'ليلاً', 'start_time' => '22:00', 'end_time' => '23:30'],
            ['id' => $evening, 'method' => 'delivery', 'label' => 'مساء جديد', 'start_time' => '19:00', 'end_time' => '22:00'],
        ]);
        app(TenantContext::class)->forget();

        $this->assertSame([$late, $evening], array_column($after, 'id'));
        $shown = $this->getJson('/commerce/v1/checkout', $this->headers($store, $cart))->assertOk();
        $this->assertTrue($shown->json('data.schedule.valid'));
        $this->assertSame('مساء جديد', $shown->json('data.schedule.slot.label'));
        $this->complete($store, $cart)->assertCreated()->assertJsonPath('data.order.schedule.slot.label', 'مساء جديد');
    }

    // ── السعة ───────────────────────────────────────────────────────────

    /** @test */
    public function capacity_is_enforced_at_selection_and_again_at_order_creation(): void
    {
        $store = $this->mobileStore('h7b-cap', ['is_enabled' => true], [
            ['method' => 'delivery', 'label' => 'محدودة', 'start_time' => '19:00', 'end_time' => '22:00', 'capacity' => 1],
        ]);
        [$limited] = $this->slotIds($store);
        $first = $this->checkout($store);
        $second = $this->checkout($store);
        $third = $this->checkout($store);

        // الثاني اختار قبل أن يكتمل الأول: كلاهما يرى مكاناً
        $this->schedule($store, $first, '2026-10-08', $limited)->assertOk();
        $this->schedule($store, $second, '2026-10-08', $limited)->assertOk();
        $this->complete($store, $first)->assertCreated();

        // الثاني: الإتمام تحت القفل يرى حجز الأول ⇒ مراجعة بلا طلب
        $blocked = $this->complete($store, $second, 'h7b-key-second')->assertStatus(409);
        $this->assertSame('schedule_unavailable', $blocked->json('error.details.items.0.reason'));
        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());

        // الثالث: النافذة الممتلئة لا تُعرض ولا يمكن اختيارها
        $this->schedule($store, $third, '2026-10-08', $limited)->assertStatus(422);
        $listed = $this->getJson('/commerce/v1/delivery-schedule', $this->headers($store))->assertOk();
        $day8 = collect($listed->json('data.dates'))->firstWhere('date', '2026-10-08');
        $this->assertNull($day8);                                  // لا نافذة أخرى في اليوم
        $this->assertNotNull(collect($listed->json('data.dates'))->firstWhere('date', '2026-10-09')); // يوم آخر ما زال متاحاً
    }

    /** @test */
    public function the_order_time_count_is_the_race_guard_when_a_full_slot_slips_past_revalidation(): void
    {
        $store = $this->mobileStore('h7b-race', ['is_enabled' => true], [
            ['method' => 'delivery', 'label' => 'محدودة', 'start_time' => '19:00', 'end_time' => '22:00', 'capacity' => 1],
        ]);
        [$slot] = $this->slotIds($store);
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $slot)->assertOk();
        $this->complete($store, $cart)->assertCreated();

        // طلبٌ منافس تجاوز إعادة التحقق قبل أن يُرى حجز الأول: العدّ تحت القفل هو خط الدفاع الأخير.
        app(TenantContext::class)->set($store['tenant']->id);
        $order = CommerceOrder::query()->firstOrFail();
        $payload = [
            'method' => 'delivery', 'delivery_date' => '2026-10-08', 'slot_id' => $slot, 'slot_label' => 'محدودة',
            'slot_label_en' => null, 'start_time' => '19:00', 'end_time' => '22:00', 'timezone' => 'Asia/Riyadh',
        ];

        try {
            app(CommerceDeliveryScheduleService::class)->snapshotToOrder($order, $payload);
            $this->fail('expected the full slot to be refused');
        } catch (\App\Services\Commerce\CheckoutReviewRequiredException $e) {
            $this->assertSame(1, CommerceOrderSchedule::query()->count());
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function the_slot_row_is_locked_inside_the_order_transaction_before_the_capacity_count(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('FOR UPDATE يظهر في SQL على PostgreSQL فقط.');
        }

        $store = $this->mobileStore('h7b-lock', ['is_enabled' => true], [
            ['method' => 'delivery', 'label' => 'محدودة', 'start_time' => '19:00', 'end_time' => '22:00', 'capacity' => 5],
        ]);
        [$slot] = $this->slotIds($store);
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $slot)->assertOk();

        $baseline = DB::transactionLevel();
        $events = [];
        DB::listen(function ($q) use (&$events) {
            if (str_contains($q->sql, 'from "commerce_delivery_slots"') && str_contains($q->sql, 'for update')) {
                $events[] = ['type' => 'lock', 'level' => DB::transactionLevel()];
            // العدّ الحاسم فقط (Eloquent ->count()) — لا استعلام العرض المجمّع المقروء قبل المعاملة
            } elseif (str_contains($q->sql, 'count(*) as aggregate') && str_contains($q->sql, 'commerce_order_schedules')) {
                $events[] = ['type' => 'count', 'level' => DB::transactionLevel()];
            }
        });
        $this->complete($store, $cart)->assertCreated();

        $types = array_column($events, 'type');
        $this->assertContains('lock', $types);
        $this->assertContains('count', $types);
        $this->assertLessThan(array_search('count', $types, true), array_search('lock', $types, true), 'the count ran before the slot lock');
        foreach ($events as $event) {
            $this->assertGreaterThan($baseline, $event['level'], 'the slot lock/count ran outside the order transaction');
        }
    }

    // ── اللقطة والإعادة ─────────────────────────────────────────────────

    /** @test */
    public function the_order_snapshot_is_frozen_and_survives_slot_edits_and_deletion(): void
    {
        $store = $this->mobileStore('h7b-frozen');
        [$evening] = $this->slotIds($store);
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();
        $orderId = $this->complete($store, $cart)->assertCreated()->json('data.order.id');

        app(TenantContext::class)->set($store['tenant']->id);
        $service = app(CommerceDeliveryScheduleService::class);
        $service->replaceSlots($store['channel']->id, [['method' => 'delivery', 'label' => 'غيّرها التاجر', 'start_time' => '08:00', 'end_time' => '09:00']]); // يحذف القديمة
        $row = CommerceOrderSchedule::query()->firstOrFail();
        app(TenantContext::class)->forget();

        $this->assertNull($row->commerce_delivery_slot_id);          // مرجع النافذة فُكّ، اللقطة باقية
        $this->assertSame('مساءً', $row->slot_label);
        $this->assertSame('19:00', $row->start_time);

        app(TenantContext::class)->set($store['tenant']->id);
        foreach ([fn () => $row->update(['slot_label' => 'تعديل']), fn () => $row->delete()] as $mutation) {
            try {
                $mutation();
                $this->fail('a confirmed order schedule was mutated');
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }
        app(TenantContext::class)->forget();
        $this->assertNotNull($orderId);
    }

    /** @test */
    public function replaying_completion_returns_the_same_order_with_one_snapshot(): void
    {
        $store = $this->mobileStore('h7b-replay');
        [$evening] = $this->slotIds($store);
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();

        $first = $this->complete($store, $cart)->assertCreated();
        $replay = $this->complete($store, $cart)->assertOk();

        $this->assertSame($first->json('data.order.id'), $replay->json('data.order.id'));
        $this->assertSame($first->json('data.order.schedule'), $replay->json('data.order.schedule'));
        $this->assertSame(1, CommerceOrderSchedule::withoutGlobalScopes()->count());
    }

    /** @test */
    public function clearing_the_selection_removes_it(): void
    {
        $store = $this->mobileStore('h7b-clear', ['is_enabled' => true, 'is_required' => false]);
        [$evening] = $this->slotIds($store);
        $cart = $this->checkout($store);
        $this->schedule($store, $cart, '2026-10-08', $evening)->assertOk();

        $cleared = $this->schedule($store, $cart, null, null)->assertOk();

        $this->assertArrayNotHasKey('schedule', $cleared->json('data'));
        $this->assertSame(0, CommerceCheckoutSchedule::withoutGlobalScopes()->count());
    }

    // ── مسار الإدارة: التحديث بالمعرّف ──────────────────────────────────

    /** @test */
    public function the_admin_slot_replacement_updates_by_id_and_rejects_foreign_or_duplicate_ids(): void
    {
        $auth = $this->registerTenant('h7b-admin', 'owner@h7b-admin.test');
        $other = $this->registerTenant('h7b-admin-b', 'owner@h7b-admin-b.test');
        foreach ([$auth, $other] as $a) {
            app(TenantContext::class)->set($a['tenant_id']);
            $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
            $storefronts[$a['tenant_id']] = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
            app(TenantContext::class)->forget();
        }
        $url = fn (array $a, string $s = '') => "/api/commerce/workspace/storefronts/{$storefronts[$a['tenant_id']]->id}/delivery-schedule{$s}";
        $slot = fn (array $extra = []) => $extra + ['method' => 'delivery', 'label' => 'مساءً', 'start_time' => '19:00', 'end_time' => '22:00'];

        $created = $this->withToken($auth['token'])->putJson($url($auth, '/slots'), ['slots' => [$slot(), $slot(['label' => 'ليلاً', 'start_time' => '22:00', 'end_time' => '23:00'])]])->assertOk();
        [$a, $b] = array_column($created->json('data.slots'), 'id');

        $updated = $this->withToken($auth['token'])->putJson($url($auth, '/slots'), ['slots' => [$slot(['id' => $b, 'label' => 'ليلاً معدّلة', 'start_time' => '22:00', 'end_time' => '23:00']), $slot(['id' => $a])]])->assertOk();
        $this->assertSame([$b, $a], array_column($updated->json('data.slots'), 'id'));    // المعرّفان باقيان وبترتيب جديد
        $this->assertSame('ليلاً معدّلة', $updated->json('data.slots.0.label'));

        $foreignId = array_column($this->withToken($other['token'])->putJson($url($other, '/slots'), ['slots' => [$slot()]])->json('data.slots'), 'id')[0];
        $this->withToken($auth['token'])->putJson($url($auth, '/slots'), ['slots' => [$slot(['id' => $foreignId])]])->assertStatus(422);          // معرّف قناة أخرى
        $this->withToken($auth['token'])->putJson($url($auth, '/slots'), ['slots' => [$slot(['id' => (string) Str::uuid()])]])->assertStatus(422);  // غير موجود
        $this->withToken($auth['token'])->putJson($url($auth, '/slots'), ['slots' => [$slot(['id' => $a]), $slot(['id' => $a])]])->assertStatus(422); // تكرار

        $kept = $this->withToken($auth['token'])->getJson($url($auth))->json('data.slots');
        $this->assertSame([$b, $a], array_column($kept, 'id'));                            // الفاشل لم يمسّ شيئاً
        $this->assertSame(1, CommerceDeliverySlot::withoutGlobalScopes()->where('tenant_id', $other['tenant_id'])->count()); // مستأجر آخر سليم
    }

    // ── store/v1 ────────────────────────────────────────────────────────

    /** @test */
    public function the_web_storefront_completes_a_scheduled_order_and_serializes_it(): void
    {
        $host = 'sched-web.example.com';
        config(['storefront.gateway_secret' => self::SECRET]);
        $tenant = Tenant::create(['name' => $host, 'slug' => 'sw-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);
        $product = Product::create(['name' => 'باقة', 'sku' => 'W-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 12000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        $service = app(CommerceDeliveryScheduleService::class);
        $service->saveSettings($channel->id, ['is_enabled' => true]);
        $service->replaceSlots($channel->id, [['method' => 'delivery', 'label' => 'مساءً', 'start_time' => '19:00', 'end_time' => '22:00']]);
        $slotId = $service->slots($channel->id)[0]['id'];
        app(TenantContext::class)->forget();

        $headers = ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
        $base = 'http://laravel-internal.test/store/v1/';
        $token = $this->withHeaders($headers)->postJson($base.'cart/items', ['product_id' => $product->id, 'quantity' => 1, 'unit_key' => 'base'])
            ->assertCreated()->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $call = fn (string $method, string $path, array $body = [], array $extra = []) => $this->withHeaders($headers + $extra)->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)->json($method, $base.$path, $body);

        $opts = $this->withHeaders($headers)->getJson($base.'delivery-schedule?method=delivery')->assertOk();
        $this->assertSame($slotId, $opts->json('data.earliest.slot_id'));

        $call('POST', 'checkout')->assertSuccessful();
        $call('PATCH', 'checkout/contact', ['name' => 'سالم المشتري', 'phone' => '0501111111'])->assertOk();
        $call('PATCH', 'checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع'])->assertOk();
        $call('PATCH', 'checkout/delivery', ['method' => 'standard'])->assertOk();
        $call('POST', 'checkout/complete', [], ['Idempotency-Key' => 'web-sched-0'])->assertStatus(409)->assertJsonPath('error.details.items.0.reason', 'schedule_required');
        $call('PATCH', 'checkout/schedule', ['date' => '2026-10-08', 'slot_id' => $slotId])->assertOk()->assertJsonPath('data.schedule.valid', true);
        $call('PATCH', 'checkout/schedule', ['date' => '2026-10-08', 'slot_id' => $slotId, 'bogus' => 1])->assertStatus(422);

        $done = $call('POST', 'checkout/complete', [], ['Idempotency-Key' => 'web-sched-1'])->assertCreated();
        $this->assertSame('2026-10-08', $done->json('data.order.schedule.date'));
        $this->assertSame('مساءً', $done->json('data.order.schedule.slot.label'));
    }
}
