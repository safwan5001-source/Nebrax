<?php

namespace Tests\Feature;

use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceOrderSchedule;
use App\Models\CommerceProductPreparation;
use App\Services\Commerce\CommerceOrderAttentionQuery;
use App\Services\Commerce\CommerceOrderPrepQueueQuery;
use Carbon\CarbonImmutable;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceOrderFulfillmentLockedException;
use App\Services\Commerce\CommerceOrderFulfillmentService;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommercePaymentIntentService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-6 (D-H2-18/19/20) — طابور التحضير المجدول وأسباب `attention` الجديدة
 * ═══════════════════════════════════════════════════════════════
 *  الدلاء (متأخر/اليوم/غداً/ابدأ التحضير) بمنطقة اللقطة وحدود القناة · مدة التحضير (منتج ثم قناة) · الإقصاءات (غير مجدول/ملغى/مكتمل/دفع غير جاهز/قبول معلّق/صف قائم) ·
 *  `attention`: البوابة مغلقة ⇒ H1 حرفياً؛ مفتوحة ⇒ `fulfillment_not_started` (48س) و`due_for_preparation` و`delivery_failed` (بلا نافذة) · مرشّح القائمة `due` ·
 *  نطاق المخازن · قراءة فقط.
 */
class CommerceOrderPrepQueueTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $warehouse;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 11, 2)->setTime(9, 0));
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'FUL-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->enableApplications($this->tenant);
        app(TenantContext::class)->forget();

        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
        config(['commerce.order_fulfillment_enabled' => true, 'commerce.order_acceptance_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function enableApplications(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        $applications = app(TenantApplicationService::class);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if ($application['mandatory'] || $application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
                continue;
            }
            $applications->enable($key, null);
        }
        app(TenantContext::class)->forget();
    }

    private function tokenFor(Tenant $tenant, string $role, ?string $email = null): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create([
            'tenant_id' => $tenant->id, 'name' => $role, 'email' => $email ?? $role.'-'.Str::random(6).'@fulfil.test',
            'password' => 'password123', 'role' => $role,
        ]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function role(string $slug, array $permissions): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        app(TenantContext::class)->forget();
    }

    /** طلب مؤكَّد بنية بحالة معطاة (COD/استلام افتراضياً)، لقطة قبول معطاة، بطريقة تسليم معطاة، مع حجز فعّال اختياري. */
    private function order(string $intentStatus = CommercePaymentIntent::STATUS_AWAITING_COLLECTION, ?string $mode = null, string $delivery = 'standard',
        string $method = CommercePaymentIntent::METHOD_COD, bool $hold = false): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = new CommerceOrder(['sales_channel_id' => $this->channel->id, 'storefront_id' => $this->storefront->id, 'number' => 'CORD-F'.Str::upper(Str::random(6)), 'delivery_method' => $delivery, 'total' => 11500]);
        if ($mode !== null) {
            $order->forceFill(['acceptance_mode' => $mode]);
        }
        $order->save();
        CommerceOrderLine::create(['commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 2, 'unit_price' => 5000, 'line_total' => 10000]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001', 'email' => 'b@example.test', 'shipping_city' => 'الدمام']);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => $method, 'status' => $intentStatus, 'amount_minor' => 11500, 'currency' => 'SAR']);
        if ($hold) {
            $product = Product::create(['name' => 'منتج', 'sku' => 'FU-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
            InventoryReservation::create([
                'warehouse_id' => $this->warehouse->id, 'product_id' => $product->id, 'base_quantity' => 1, 'status' => InventoryReservation::STATUS_ACTIVE,
                'source_type' => CommerceOrder::class, 'source_id' => $order->id, 'idempotency_key' => 'hold-'.Str::random(10), 'request_checksum' => Str::random(16),
                'expires_at' => now('UTC')->addHour(),
            ]);
        }
        app(TenantContext::class)->forget();

        return $order->fresh();
    }

    private function act(string $orderId, string $action, array $body = [], ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/fulfillment/{$action}", $body);
    }


    private const NOW = '2026-11-02 09:00:00';

    /** يضبط إعداد جدولة القناة (المنطقة ومهلة التجهيز). */
    private function channelSettings(string $tz = 'Asia/Riyadh', int $lead = 0): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        CommerceDeliveryScheduleSetting::updateOrCreate(['sales_channel_id' => $this->channel->id], ['is_enabled' => true, 'timezone' => $tz, 'lead_time_minutes' => $lead]);
        app(TenantContext::class)->forget();
    }

    /** طلب مجدول: اللقطة تُنشأ قبل تأكيد الطلب (قاعدة اللقطة الثابتة). */
    private function scheduled(string $date, string $start, string $end, string $tz = 'Asia/Riyadh', string $intentStatus = CommercePaymentIntent::STATUS_AWAITING_COLLECTION, ?string $mode = null, ?string $productId = null): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = new CommerceOrder(['sales_channel_id' => $this->channel->id, 'storefront_id' => $this->storefront->id, 'number' => 'CORD-Q'.Str::upper(Str::random(6)), 'delivery_method' => 'standard', 'total' => 11500]);
        if ($mode !== null) {
            $order->forceFill(['acceptance_mode' => $mode]);
        }
        $order->save();
        CommerceOrderLine::create(['commerce_order_id' => $order->id, 'product_id' => $productId, 'product_name_snapshot' => 'وردة', 'quantity' => 1, 'unit_price' => 5000, 'line_total' => 5000]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001', 'email' => 'q@example.test', 'shipping_city' => 'الدمام']);
        CommerceOrderSchedule::create(['tenant_id' => $this->tenant->id, 'commerce_order_id' => $order->id, 'method' => 'delivery', 'delivery_date' => $date, 'slot_label' => 'نافذة', 'start_time' => $start, 'end_time' => $end, 'timezone' => $tz]);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_COD, 'status' => $intentStatus, 'amount_minor' => 11500, 'currency' => 'SAR']);
        app(TenantContext::class)->forget();

        return $order->fresh();
    }

    /** @return array<string, array<string, mixed>> orderId => item */
    private function queue(?string $bucket = null, ?array $warehouses = null): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $result = app(CommerceOrderPrepQueueQuery::class)->run(null, $bucket, $warehouses, CarbonImmutable::now('UTC'));
        app(TenantContext::class)->forget();

        return $result['items']->keyBy('order_id')->all();
    }

    private function reasons(): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $query = app(CommerceOrderAttentionQuery::class);
        $out = [];
        foreach ($query->run(null, 100)['orders'] as $order) {
            $out[$order->id] = $query->reasonsFor($order);
        }
        app(TenantContext::class)->forget();

        return $out;
    }

    #[Test]
    public function buckets_are_computed_in_the_snapshot_timezone_with_channel_day_boundaries(): void
    {
        $this->channelSettings();
        $later = $this->scheduled('2026-11-02', '17:00', '20:00');      // 14:00–17:00Z اليوم، لاحقاً
        $soon = $this->scheduled('2026-11-02', '11:00', '13:00');       // 08:00–10:00Z: ينتهي بعد الآن، prepare_from 08:00Z ≤ الآن+60
        $past = $this->scheduled('2026-11-01', '10:00', '12:00');       // 07:00–09:00Z أمس: متأخر
        $tomorrow = $this->scheduled('2026-11-03', '10:00', '12:00');
        $berlin = $this->scheduled('2026-11-02', '12:00', '13:00', 'Europe/Berlin'); // 11:00–12:00Z: ≠ منطقة القناة

        $items = $this->queue();

        $this->assertSame(['today'], $items[$later->id]['buckets']);
        $this->assertSame(['today', 'prepare_now'], $items[$soon->id]['buckets']);
        $this->assertSame(['overdue', 'prepare_now'], $items[$past->id]['buckets']);
        $this->assertSame(['tomorrow'], $items[$tomorrow->id]['buckets']);
        $this->assertSame(['today'], $items[$berlin->id]['buckets']);
        $this->assertSame('2026-11-02T11:00:00+00:00', $items[$berlin->id]['window_start']);
        $this->assertSame('Europe/Berlin', $items[$berlin->id]['timezone']);
    }

    #[Test]
    public function the_day_boundary_uses_the_channel_zone_not_the_order_zone(): void
    {
        // طلب بتوقيت Kiritimati (UTC+14): 2026-11-03 06:00 هناك = 2026-11-02 16:00Z = 19:00 الرياض اليوم ⇒ «اليوم» بمنطقة القناة.
        $this->channelSettings('Asia/Riyadh');
        $order = $this->scheduled('2026-11-03', '06:00', '08:00', 'Pacific/Kiritimati');
        $this->assertSame(['today'], $this->queue()[$order->id]['buckets']);

        // والقناة نفسها بمنطقة Kiritimati ⇒ يصبح «غداً» (اليوم هناك 2026-11-02 23:00 ⇒ 2026-11-03 بداية الغد).
        $this->channelSettings('Pacific/Kiritimati');
        $this->assertSame(['tomorrow'], $this->queue()[$order->id]['buckets']);
    }

    #[Test]
    public function preparation_minutes_come_from_the_largest_product_then_the_channel_lead(): void
    {
        $this->channelSettings('Asia/Riyadh', 30);
        app(TenantContext::class)->set($this->tenant->id);
        $slow = Product::create(['name' => 'تنسيق', 'sku' => 'PQ-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true]);
        CommerceProductPreparation::create(['product_id' => $slow->id, 'preparation_minutes' => 240]);
        app(TenantContext::class)->forget();

        $withProduct = $this->scheduled('2026-11-02', '17:00', '20:00', productId: $slow->id);   // 14:00Z − 240 = 10:00Z ⇒ ≤ 10:00Z (الآن+60)
        $channelOnly = $this->scheduled('2026-11-02', '17:00', '20:00');                          // 14:00Z − 30 = 13:30Z ⇒ لا

        $items = $this->queue();
        $this->assertSame(240, $items[$withProduct->id]['prepare_minutes']);
        $this->assertContains('prepare_now', $items[$withProduct->id]['buckets']);
        $this->assertSame(30, $items[$channelOnly->id]['prepare_minutes']);
        $this->assertNotContains('prepare_now', $items[$channelOnly->id]['buckets']);
        $this->assertSame('2026-11-02T10:00:00+00:00', $items[$withProduct->id]['prepare_from']);
    }

    #[Test]
    public function exclusions_unscheduled_cancelled_completed_unpaid_and_pending_acceptance(): void
    {
        $this->channelSettings();
        $included = $this->scheduled('2026-11-02', '11:00', '13:00');
        $unscheduled = $this->order();                                                     // بلا موعد
        $unpaid = $this->scheduled('2026-11-02', '11:00', '13:00', intentStatus: CommercePaymentIntent::STATUS_PENDING);
        $started = $this->scheduled('2026-11-02', '11:00', '13:00');
        $this->act($started->id, 'start', ['expected_version' => 0])->assertOk();
        $manual = $this->scheduled('2026-11-02', '11:00', '13:00', mode: CommerceOrder::ACCEPTANCE_MANUAL);
        $cancelled = $this->scheduled('2026-11-02', '11:00', '13:00');
        app(TenantContext::class)->set($this->tenant->id);
        CommerceOrder::query()->whereKey($cancelled->id)->update(['cancelled_at' => now(), 'cancellation_reason' => 'customer_request']);
        $done = $this->scheduled('2026-11-02', '11:00', '13:00');
        app(TenantContext::class)->forget();
        $this->act($done->id, 'start', ['expected_version' => 0])->assertOk();
        $this->act($done->id, 'mark_ready', ['expected_version' => 1])->assertOk();
        $this->act($done->id, 'dispatch', ['expected_version' => 2])->assertOk();
        $this->act($done->id, 'deliver', ['expected_version' => 3])->assertOk();

        $items = $this->queue();
        $this->assertArrayHasKey($included->id, $items);
        foreach ([$unscheduled, $unpaid, $cancelled, $done] as $excluded) {
            $this->assertArrayNotHasKey($excluded->id, $items, $excluded->number);
        }
        // بدأ التنفيذ ⇒ ما زال في الطابور (مجدول وغير مكتمل) لكن ليس «ابدأ التحضير»؛ وقبول يدوي معلّق ⇒ كذلك.
        $this->assertNotContains('prepare_now', $items[$started->id]['buckets']);
        $this->assertNotContains('prepare_now', $items[$manual->id]['buckets']);
    }

    #[Test]
    public function a_corrupt_snapshot_timezone_drops_the_order_from_the_queue_instead_of_guessing(): void
    {
        $this->channelSettings();
        $order = $this->scheduled('2026-11-02', '11:00', '13:00');
        \Illuminate\Support\Facades\DB::table('commerce_order_schedules')->where('commerce_order_id', $order->id)->update(['timezone' => 'Mars/Olympus']);

        $this->assertArrayNotHasKey($order->id, $this->queue());
    }

    #[Test]
    public function attention_with_the_gate_closed_is_h1_verbatim(): void
    {
        config(['commerce.order_fulfillment_enabled' => false]);
        $this->channelSettings();
        $stale = $this->scheduled('2026-11-02', '11:00', '13:00');
        $this->backdate($stale, hours: 72);
        $fresh = $this->order();

        $reasons = $this->reasons();
        $this->assertArrayNotHasKey($stale->id, $reasons, 'خارج نافذة 48س ولا سبب جديد مع بوابة مغلقة');
        $this->assertSame(['new_order'], $reasons[$fresh->id]);
    }

    private function backdate(CommerceOrder $order, int $hours): void
    {
        \Illuminate\Support\Facades\DB::table('commerce_orders')->where('id', $order->id)->update(['created_at' => now('UTC')->subHours($hours)]);
    }

    #[Test]
    public function attention_with_the_gate_open_adds_the_three_reasons(): void
    {
        $this->channelSettings();
        $notStarted = $this->order();                                                       // غير مجدول، مقبول، ضمن 48س
        $due = $this->scheduled('2026-11-02', '11:00', '13:00');
        $this->backdate($due, hours: 100);                                                  // خارج نافذة 48س ⇒ يدخل بلا نافذة
        $failed = $this->order();
        $this->backdate($failed, hours: 100);
        foreach (['start' => 0, 'mark_ready' => 1, 'dispatch' => 2] as $action => $version) {
            $this->act($failed->id, $action, ['expected_version' => $version])->assertOk();
        }
        $this->act($failed->id, 'fail', ['expected_version' => 3, 'reason' => 'address_issue'])->assertOk();
        $old = $this->order();                                                              // قديم عادي بلا سبب جديد ⇒ خارج المصالحة
        $this->backdate($old, hours: 100);

        $reasons = $this->reasons();

        $this->assertSame(['new_order', 'fulfillment_not_started'], $reasons[$notStarted->id]);
        $this->assertSame(['due_for_preparation'], $reasons[$due->id]);
        $this->assertSame(['delivery_failed'], $reasons[$failed->id]);
        $this->assertArrayNotHasKey($old->id, $reasons);
    }

    #[Test]
    public function a_scheduled_order_is_not_reported_as_fulfillment_not_started(): void
    {
        $this->channelSettings();
        $scheduled = $this->scheduled('2026-11-04', '17:00', '20:00');   // بعيد: لا due_for_preparation

        $this->assertNotContains('fulfillment_not_started', $this->reasons()[$scheduled->id] ?? []);
    }

    #[Test]
    public function the_staff_list_filters_by_bucket_and_annotates_rows_with_the_queue_block_only_then(): void
    {
        $this->channelSettings();
        $soon = $this->scheduled('2026-11-02', '11:00', '13:00');
        $tomorrow = $this->scheduled('2026-11-03', '10:00', '12:00');
        $plain = $this->order();

        $all = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders')->assertOk();
        foreach ($all->json('data') as $row) {
            $this->assertArrayNotHasKey('queue', $row, 'القائمة القديمة بلا كتلة queue');
        }
        $this->assertArrayNotHasKey('queue_truncated', $all->json('meta'));

        $today = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?due=today')->assertOk();
        $this->assertSame([$soon->id], array_column($today->json('data'), 'id'));
        $row = $today->json('data.0');
        $this->assertSame(['window_start', 'window_end', 'prepare_from', 'timezone', 'buckets'], array_keys($row['queue']));
        $this->assertContains('prepare_now', $row['queue']['buckets']);
        $this->assertFalse($today->json('meta.queue_truncated'));

        $tm = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?due=tomorrow')->assertOk();
        $this->assertSame([$tomorrow->id], array_column($tm->json('data'), 'id'));

        $none = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?due=overdue')->assertOk();
        $this->assertSame([], $none->json('data'));
        $this->assertNotContains($plain->id, array_column($today->json('data'), 'id'));
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?due=whenever')->assertStatus(422);
    }

    #[Test]
    public function the_queue_respects_the_users_warehouse_scope(): void
    {
        $this->channelSettings();
        $order = $this->scheduled('2026-11-02', '11:00', '13:00');
        // مستخدم مقيَّد بمخزن آخر لا يرى طلباً مخزنه الفعّال سياسة القناة.
        $this->assertArrayHasKey($order->id, $this->queue(null, [$this->warehouse->id]));
        $this->assertArrayNotHasKey($order->id, $this->queue(null, [(string) Str::uuid()]));
        $this->assertSame([], $this->queue(null, []));
    }

    #[Test]
    public function a_long_lead_order_is_a_preparation_candidate_far_beyond_the_three_day_window(): void
    {
        // Codex P1: أطول تحضير مدعوم 30 يوماً؛ طلب يُسلَّم بعد 10 أيام بتحضير 10 أيام يدخل prepare_now اليوم.
        $this->channelSettings();
        app(TenantContext::class)->set($this->tenant->id);
        $slow = Product::create(['name' => 'تركيب', 'sku' => 'PQ-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true]);
        CommerceProductPreparation::create(['product_id' => $slow->id, 'preparation_minutes' => 14400]);
        app(TenantContext::class)->forget();
        $far = $this->scheduled('2026-11-12', '12:00', '14:00', 'Asia/Riyadh', CommercePaymentIntent::STATUS_AWAITING_COLLECTION, null, $slow->id);
        // أبعد من أفق أطول تحضير مدعوم (30 يوماً) لا يدخل حتى لو كان مقبولاً.
        $beyond = $this->scheduled('2026-12-20', '12:00', '14:00');

        $items = $this->queue('prepare_now');

        $this->assertArrayHasKey($far->id, $items);
        $this->assertSame(['prepare_now'], $items[$far->id]['buckets']);
        $this->assertArrayNotHasKey($beyond->id, $items);
        $this->assertArrayHasKey($far->id, $this->queue(), 'الطابور غير المصفّى يضمّه أيضاً');
    }

    #[Test]
    public function the_coarse_date_bounds_cover_a_channel_zone_that_differs_from_the_snapshot_zone(): void
    {
        // Codex P2: القناة Pacific/Pago_Pago (UTC−11) والطلب بلقطة Kiritimati (UTC+14). في 2026-11-02 23:00Z
        // يوم القناة هو 11-02 11:00Z..11-03 11:00Z؛ نافذة 2026-11-04 00:30 بتوقيت Kiritimati = 11-03T10:30Z ⇒ «اليوم»
        // بينما تاريخ تسليمها الاسمي 11-04 (خارج نافذة «يوم واحد» القديمة).
        $this->travelTo(CarbonImmutable::parse('2026-11-02 23:00:00', 'UTC'));
        $this->channelSettings('Pacific/Pago_Pago');
        $today = $this->scheduled('2026-11-04', '00:30', '02:30', 'Pacific/Kiritimati');
        $this->assertSame(['today'], $this->queue('today')[$today->id]['buckets'] ?? null);

        // والعكس: قناة Kiritimati (اليوم التالي بدأ 11-03T10:00Z) ولقطة Pago ⇒ 2026-11-03 01:00 هناك = 11-03T12:00Z ⇒ «غداً».
        $this->channelSettings('Pacific/Kiritimati');
        $tomorrow = $this->scheduled('2026-11-03', '01:00', '03:00', 'Pacific/Pago_Pago');
        $this->assertSame(['tomorrow'], $this->queue('tomorrow')[$tomorrow->id]['buckets'] ?? null);
    }

    #[Test]
    public function an_unstarted_order_never_ages_out_of_overdue_or_preparation_attention(): void
    {
        // Codex P2 / D-H2-20: بلا نافذة حداثة؛ طلب عالق منذ 90 يوماً ما زال متأخراً ويحتاج تحضيراً.
        $this->channelSettings();
        $ancient = $this->scheduled('2026-08-04', '10:00', '12:00');

        $items = $this->queue();

        $this->assertArrayHasKey($ancient->id, $items);
        $this->assertSame(['overdue', 'prepare_now'], $items[$ancient->id]['buckets']);
        $this->assertArrayHasKey($ancient->id, $this->queue('overdue'));
        $this->assertArrayHasKey($ancient->id, $this->queue('prepare_now'));
    }

    #[Test]
    public function list_filters_narrow_the_candidate_population_before_the_cap(): void
    {
        // Codex P2: مرشّحات القائمة (بحث/قناة/دفع…) تُطبَّق على المرشّحين قبل السقف لا بعده.
        $this->channelSettings();
        $a = $this->scheduled('2026-11-02', '11:00', '13:00');
        $this->scheduled('2026-11-02', '12:00', '14:00');
        $this->scheduled('2026-11-02', '13:00', '15:00');

        $loaded = 0;
        CommerceOrder::retrieved(function () use (&$loaded): void {
            $loaded++;
        });
        app(TenantContext::class)->set($this->tenant->id);
        $result = app(CommerceOrderPrepQueueQuery::class)->run(null, 'today', null, CarbonImmutable::now('UTC'), fn ($q) => $q->where('number', $a->number));
        app(TenantContext::class)->forget();

        $this->assertSame([$a->id], $result['items']->pluck('order_id')->all());
        $this->assertSame(1, $loaded, 'المرشّحون المحمّلون هم المطابقون للمرشّح وحدهم');

        // وعبر HTTP: بحث برقم الطلب مع due يعيد ذلك الطلب وحده.
        $response = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders?due=today&q='.$a->number)->assertOk();
        $this->assertSame([$a->id], collect($response->json('data'))->pluck('id')->all());
    }

    #[Test]
    public function attention_reports_truncation_when_the_preparation_queue_hit_its_candidate_cap(): void
    {
        // Codex P2: سقف مرشّحي الطابور جزء من اكتمال المصالحة؛ لا `truncated=false` كاذب.
        $this->channelSettings();
        foreach (range(1, 3) as $i) {
            $this->scheduled('2026-11-02', '1'.$i.':00', '1'.($i + 1).':00');
        }
        app(TenantContext::class)->set($this->tenant->id);
        $capped = new CommerceOrderPrepQueueQuery(app(\App\Services\Commerce\CommerceDeliveryScheduleService::class), app(\App\Services\Commerce\ProductPreparationService::class), 2);
        $this->assertTrue($capped->run(null, 'prepare_now')['truncated']);

        $this->assertTrue((new CommerceOrderAttentionQuery($capped))->run(null, 100)['truncated'], 'الانتباه يرث اقتطاع الطابور');
        $uncapped = (new CommerceOrderAttentionQuery(app(CommerceOrderPrepQueueQuery::class)))->run(null, 100);
        app(TenantContext::class)->forget();

        $this->assertFalse($uncapped['truncated']);
    }

    #[Test]
    public function candidates_are_narrowed_by_bucket_before_the_shared_cap(): void
    {
        // Codex P2: طلبات دلو آخر لا تُحمَّل أصلاً (فلا تستنزف سقف المرشّحين).
        $this->channelSettings();
        foreach (range(1, 3) as $i) {
            $this->scheduled('2026-10-20', '10:00', '12:00'); // متأخرة بوضوح
        }
        $tomorrow = $this->scheduled('2026-11-03', '10:00', '12:00');

        $loaded = 0;
        CommerceOrder::retrieved(function () use (&$loaded): void {
            $loaded++;
        });
        $items = $this->queue('tomorrow');

        $this->assertSame([$tomorrow->id], array_keys($items));
        $this->assertSame(1, $loaded, 'دلو «غداً» يحمّل مرشّحيه وحدهم لا المتأخرات');
    }

    #[Test]
    public function channel_settings_are_loaded_in_one_batch_with_the_same_shape_as_the_single_lookup(): void
    {
        // Codex P2: لا استعلام إعدادات لكل قناة. دفعة واحدة مهما كثرت القنوات، وبالشكل نفسه تماماً لـ settings().
        $this->channelSettings('Europe/Berlin', 45);
        $service = app(\App\Services\Commerce\CommerceDeliveryScheduleService::class);
        app(TenantContext::class)->set($this->tenant->id);
        $ids = [$this->channel->id, ...array_map(fn () => (string) Str::uuid(), range(1, 8))];

        DB::flushQueryLog();
        DB::enableQueryLog();
        $many = $service->settingsMany($ids);
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertLessThanOrEqual(2, count($log), 'استعلام إعدادات واحد + منطقة المستأجر مرة واحدة على الأكثر');
        $this->assertCount(9, $many);
        foreach ($ids as $id) {
            $this->assertSame($service->settings($id), $many[$id]);
        }
        $this->assertSame('Europe/Berlin', $many[$this->channel->id]['timezone']);
        $this->assertSame(45, $many[$this->channel->id]['lead_time_minutes']);
        $this->assertSame([], $service->settingsMany([]));
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function the_queue_reads_only_and_runs_a_bounded_number_of_queries(): void
    {
        $this->channelSettings();
        foreach (range(1, 6) as $i) {
            $this->scheduled('2026-11-02', '11:00', '13:00');
        }
        app(TenantContext::class)->set($this->tenant->id);
        $query = app(CommerceOrderPrepQueueQuery::class);
        $query->run(); // تسخين
        \Illuminate\Support\Facades\DB::flushQueryLog();
        \Illuminate\Support\Facades\DB::enableQueryLog();
        $query->run(null, null, null, CarbonImmutable::now('UTC'));
        $log = \Illuminate\Support\Facades\DB::getQueryLog();
        \Illuminate\Support\Facades\DB::disableQueryLog();
        app(TenantContext::class)->forget();

        $this->assertLessThanOrEqual(8, count($log), 'عدد الاستعلامات لا يتبع عدد الطلبات');
        foreach ($log as $entry) {
            $this->assertMatchesRegularExpression('/^\s*(select|with)/i', $entry['query']);
        }
    }

    #[Test]
    public function the_queue_services_never_write_or_emit_events(): void
    {
        foreach (['CommerceOrderPrepQueueQuery', 'CommerceOrderPreparationClock'] as $class) {
            $source = (string) file_get_contents(app_path("Services/Commerce/{$class}.php"));
            foreach (['->save(', '->update(', '->create(', '->delete(', 'DB::table', 'Event::', 'dispatch(', 'lockForUpdate'] as $forbidden) {
                $this->assertStringNotContainsString($forbidden, $source, "{$class} يجب ألا يذكر {$forbidden}");
            }
        }
    }
}
