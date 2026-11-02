<?php

namespace Tests\Feature;

use App\Events\CommerceOrderCancelled;
use App\Events\CommerceOrderDomainEvent;
use App\Events\CommerceOrderPaymentCollected;
use App\Events\CommerceOrderPaymentPaid;
use App\Events\CommerceOrderPlaced;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Commerce\CommerceOrderEventRecorder;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use ReflectionClass;
use ReflectionProperty;
use RuntimeException;
use Tests\TestCase;

/**
 * COPS-H1-2 (ADR-29 §2.4) — أحداث النطاق بعد الالتزام + تغذية الأحداث بالمؤشّر + مصالحة الانتباه، على SQLite وPostgreSQL.
 *
 * يُثبت: حدث نطاق واحد لكل انتقال فعلي وصفر للإعادات والتراجع، وإطلاقه بعد الالتزام لا قبله، ومعرّفات فقط، وأن استثناء مستمع لا يُفشل الطلب؛
 * تغذية بمؤشّر (ترتيب، ترقيم ≤ 100، حدّ، ETag/304، تحقق مدخلات)، RBAC وتطبيق القدرة والمقيَّد بمخازن والعزل، وعدد استعلامات ثابت، وأنها قراءة فقط؛
 * ومصالحة الحالة (جاهزية الدفع R-5، الملغى، النافذة، المؤشّر المفقود، ترتيب الأقدم، السقف، عزل، مستفيدة من طلب بلا حدث أصلاً).
 * التزامن والاكتمال بقارئ التغذية تحت كتّاب متوازين على PostgreSQL الحقيقي: `CommerceOrderFeedPostgresTest`.
 */
class CommerceOrderFeedTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        $this->enableApplications($this->tenant);
        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
        config(['commerce.order_cancellation_enabled' => true]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function enableApplications(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        app(TenantContext::class)->forget();
    }

    private function tokenFor(Tenant $tenant, string $role): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'مستخدم '.$role, 'email' => $role.'-'.Str::random(6).'@feed.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    /** طلب استلام (pay_on_pickup) بانتظار التحصيل عبر Checkout حقيقي. */
    private function pickupOrder(string $key): string
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);

        return (string) $this->complete($token, $key)->assertCreated()->json('data.order.id');
    }

    private function collect(string $orderId): void
    {
        $intent = $this->intent($orderId);
        $this->withToken($this->ownerToken)->postJson("/api/commerce/payment-intents/{$intent->id}/collect", ['note' => 'سالم 0501234567'])->assertOk();
    }

    private function pay(array $order): void
    {
        $this->startPayment($order)->assertSuccessful();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
    }

    /** يُلحق أحداث `payment.collected` نظامية بالمُسجِّل الحقيقي (للتجارب على الترقيم). */
    private function appendEvents(string $orderId, int $times): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($orderId);
        foreach (range(1, $times) as $i) {
            DB::transaction(fn () => app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system'));
        }
        app(TenantContext::class)->forget();
    }

    private function feed(string $query = '', ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson('/api/commerce/orders/feed'.($query === '' ? '' : '?'.$query));
    }

    private function attention(string $query = '', ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson('/api/commerce/orders/attention'.($query === '' ? '' : '?'.$query));
    }

    /** يسجّل كل أحداث النطاق الأربعة في مصفوفة (بالترتيب) ويعيد مرجعها. */
    private function captureDomainEvents(): \ArrayObject
    {
        $fired = new \ArrayObject;
        foreach ([CommerceOrderPlaced::class, CommerceOrderCancelled::class, CommerceOrderPaymentPaid::class, CommerceOrderPaymentCollected::class] as $class) {
            Event::listen($class, function (CommerceOrderDomainEvent $e) use ($fired): void {
                $fired[] = ['class' => $e::class, 'tenant' => $e->tenantId, 'order' => $e->orderId, 'event' => $e->eventId];
            });
        }

        return $fired;
    }

    // ═════════════════════════ 1) أحداث النطاق بعد الالتزام ═════════════════════════

    #[Test]
    public function each_real_transition_fires_exactly_one_domain_event_with_ids_matching_the_committed_row(): void
    {
        $fired = $this->captureDomainEvents();

        // مسارا انتقال مختلفان: (أ) إتمام ثم تحصيل، (ب) إتمام ثم إلغاء — المحصَّل لا يُلغى مباشرة (ADR-28 ⇒ 409).
        $collected = $this->pickupOrder('idem-feed-de-1');
        $this->collect($collected);
        $cancelled = $this->pickupOrder('idem-feed-de-2');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$cancelled}/cancel", ['reason' => 'out_of_stock'])->assertOk();

        $this->assertSame([CommerceOrderPlaced::class, CommerceOrderPaymentCollected::class, CommerceOrderPlaced::class, CommerceOrderCancelled::class],
            array_column($fired->getArrayCopy(), 'class'));
        $rows = CommerceOrderEvent::query()->orderBy('feed_seq')->get();
        $this->assertCount(4, $rows);
        foreach ($rows as $i => $row) {
            $this->assertSame($row->id, $fired[$i]['event'], 'معرّف الحدث = صف السجل الملتزم');
            $this->assertSame($row->commerce_order_id, $fired[$i]['order']);
            $this->assertSame($this->tenant->id, $fired[$i]['tenant']);
        }
    }

    #[Test]
    public function an_online_capture_fires_the_paid_event_once_and_replays_fire_nothing(): void
    {
        $fired = $this->captureDomainEvents();
        $order = $this->onlineOrder(product: $this->product($this->tenant, $this->channel), key: 'idem-feed-de-online');
        $this->assertSame([CommerceOrderPlaced::class], array_column($fired->getArrayCopy(), 'class'));

        $this->pay($order);
        $this->assertSame([CommerceOrderPlaced::class, CommerceOrderPaymentPaid::class], array_column($fired->getArrayCopy(), 'class'));

        $this->paymentStatus($order)->assertOk();
        $this->artisan('payments:complete-commerce-captures')->assertSuccessful();
        $this->assertCount(2, $fired, 'إعادة القراءة/المطابقة لا تطلق شيئاً');
    }

    #[Test]
    public function replays_of_the_same_transition_fire_no_further_domain_event(): void
    {
        $fired = $this->captureDomainEvents();
        // إعادة الإتمام بالمفتاح نفسه (idempotency) لا تنشئ طلباً ولا تطلق حدثاً ثانياً.
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $orderId = (string) $this->complete($token, 'idem-feed-de-replay')->assertCreated()->json('data.order.id');
        $this->assertCount(1, $fired);
        $this->complete($token, 'idem-feed-de-replay')->assertSuccessful();
        $this->assertCount(1, $fired, 'إعادة الإتمام بالمفتاح نفسه');

        // تكرار الإلغاء (idempotent بالحالة) لا يطلق حدثاً ثانياً.
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'out_of_stock'])->assertOk();
        $this->assertCount(2, $fired);
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'other', 'note' => 'تكرار'])->assertOk();
        $this->assertCount(2, $fired, 'تكرار الإلغاء لا يطلق حدثاً');

        // تكرار التحصيل مرفوض (422) ولا يطلق شيئاً.
        $collected = $this->pickupOrder('idem-feed-de-replay-2');
        $this->collect($collected);
        $afterCollect = count($fired);
        $this->withToken($this->ownerToken)->postJson('/api/commerce/payment-intents/'.$this->intent($collected)->id.'/collect', [])->assertStatus(422);
        $this->assertSame($afterCollect, count($fired));

        $this->assertSame(CommerceOrderEvent::query()->count(), count($fired), 'حدث نطاق واحد لكل صف سجل ملتزم');
    }

    #[Test]
    public function the_domain_event_fires_after_the_transaction_commits_not_inside_it(): void
    {
        $orderId = $this->pickupOrder('idem-feed-de-after');
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($orderId);
        $baseline = DB::transactionLevel();
        $fired = [];
        $levelAtDispatch = null;
        Event::listen(CommerceOrderPaymentCollected::class, function () use (&$fired, &$levelAtDispatch): void {
            $fired[] = 1;
            $levelAtDispatch = DB::transactionLevel();
        });

        DB::transaction(function () use ($order, &$fired): void {
            app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system');
            $this->assertSame([], $fired, 'لا إطلاق قبل الالتزام');
        });

        $this->assertCount(1, $fired);
        $this->assertSame($baseline, $levelAtDispatch, 'المستمع يعمل خارج معاملة الانتقال');
    }

    #[Test]
    public function a_rolled_back_transition_fires_no_domain_event_even_when_the_inner_write_succeeded(): void
    {
        $orderId = $this->pickupOrder('idem-feed-de-rollback');
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::query()->findOrFail($orderId);
        $fired = $this->captureDomainEvents();
        $before = CommerceOrderEvent::query()->count();

        try {
            DB::transaction(function () use ($order): void {
                DB::transaction(fn () => app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system'));
                throw new RuntimeException('رجوع المعاملة الخارجية');
            });
            $this->fail('كان يجب أن يرمي');
        } catch (RuntimeException) {
        }

        $this->assertCount(0, $fired);
        $this->assertSame($before, CommerceOrderEvent::query()->count(), 'لا سجل ولا حدث');
    }

    #[Test]
    public function a_throwing_listener_never_fails_the_request_or_the_committed_transition_and_logs_ids_only(): void
    {
        Log::spy();
        foreach ([CommerceOrderPlaced::class, CommerceOrderPaymentCollected::class, CommerceOrderCancelled::class] as $class) {
            Event::listen($class, function (): void {
                throw new RuntimeException('سالم 0501234567 boom');
            });
        }

        $collected = $this->pickupOrder('idem-feed-de-throw'); // assertCreated داخلها
        $this->collect($collected);
        $cancelled = $this->pickupOrder('idem-feed-de-throw-2');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$cancelled}/cancel", ['reason' => 'out_of_stock'])->assertOk();

        $this->assertSame(['order.placed', 'payment.collected'],
            CommerceOrderEvent::query()->where('commerce_order_id', $collected)->orderBy('feed_seq')->pluck('type')->all());
        $this->assertSame(['order.placed', 'order.cancelled'],
            CommerceOrderEvent::query()->where('commerce_order_id', $cancelled)->orderBy('feed_seq')->pluck('type')->all());
        $this->assertNotNull(CommerceOrder::query()->findOrFail($cancelled)->cancelled_at, 'الانتقال ملتزم');
        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context = []): bool {
            return $message === 'commerce.order_event.listener_failed'
                && array_keys($context) === ['type', 'tenant_id', 'order_id', 'event_id', 'exception']
                && ! str_contains(json_encode($context), '0501234567');
        })->atLeast()->times(3);
    }

    #[Test]
    public function the_domain_events_carry_ids_only_and_cover_every_recorded_type(): void
    {
        $classes = [CommerceOrderPlaced::class, CommerceOrderCancelled::class, CommerceOrderPaymentPaid::class, CommerceOrderPaymentCollected::class];
        foreach ($classes as $class) {
            $props = array_map(fn (ReflectionProperty $p) => $p->getName(), (new ReflectionClass($class))->getProperties(ReflectionProperty::IS_PUBLIC));
            sort($props);
            $this->assertSame(['eventId', 'orderId', 'tenantId'], $props, "$class: معرّفات فقط (لا PII ولا مبالغ)");
        }
        $types = array_map(fn (string $c) => $c::recordType(), $classes);
        sort($types);
        $expected = CommerceOrderEvent::TYPES;
        sort($expected);
        $this->assertSame($expected, $types, 'لكل نوع سجل حدث نطاق مقابل (نوع جديد بلا حدث يُفشل هذا الاختبار)');
    }

    // ═════════════════════════ 2) التغذية بالمؤشّر ═════════════════════════

    #[Test]
    public function an_empty_feed_returns_an_empty_page_and_keeps_the_cursor(): void
    {
        $this->feed()->assertOk()->assertJsonPath('data', [])
            ->assertJsonPath('meta.after_seq', 0)->assertJsonPath('meta.next_after_seq', 0)->assertJsonPath('meta.has_more', false);
        $this->feed('after_seq=41')->assertOk()->assertJsonPath('meta.next_after_seq', 41);
    }

    #[Test]
    public function the_feed_lists_real_events_in_sequence_with_order_reference_and_no_personal_data(): void
    {
        $a = $this->pickupOrder('idem-feed-1');
        $b = $this->pickupOrder('idem-feed-2');
        $this->collect($b);

        $res = $this->feed()->assertOk();
        $data = $res->json('data');
        $this->assertSame([1, 2, 3], array_column($data, 'seq'));
        $this->assertSame(['order.placed', 'order.placed', 'payment.collected'], array_column($data, 'type'));
        $this->assertSame([$a, $b, $b], array_column(array_column($data, 'order'), 'id'));
        $this->assertNotNull($data[0]['order']['number']);
        $this->assertSame($this->storefront->id, $data[0]['order']['storefront_id']);
        $this->assertSame(['type' => 'guest'], $data[0]['actor']);
        $this->assertSame(['type' => 'user'], $data[2]['actor'], 'نوع الفاعل فقط — لا اسم موظف ولا معرّفه');
        $this->assertSame(['delivery_method' => 'pickup', 'payment_method' => 'pay_on_pickup'], $data[0]['data']);
        $this->assertNotNull($data[0]['occurred_at']);
        $this->assertSame(3, $res->json('meta.next_after_seq'));
        $this->assertFalse($res->json('meta.has_more'));

        $json = $res->getContent();
        foreach (['0501234567', 'mobile', 'email', 'phone', 'address', 'customer_name', 'total', 'سالم'] as $needle) {
            $this->assertStringNotContainsString($needle, $json, "الخلاصة لا تحمل «{$needle}»");
        }
    }

    #[Test]
    public function the_cursor_pages_without_skipping_or_repeating_and_reports_whether_more_remain(): void
    {
        $orderId = $this->pickupOrder('idem-feed-page');
        $this->appendEvents($orderId, 6); // المجموع 7 أحداث

        $seen = [];
        $after = 0;
        $pages = 0;
        do {
            $res = $this->feed("after_seq={$after}&limit=3")->assertOk();
            $pages++;
            $seqs = array_column($res->json('data'), 'seq');
            $this->assertSame(range($after + 1, $after + count($seqs)), $seqs, 'كل صفحة متصلة بلا فجوة');
            $seen = array_merge($seen, $seqs);
            $this->assertSame(3, $res->json('meta.limit'));
            $after = $res->json('meta.next_after_seq');
            $more = $res->json('meta.has_more');
            $this->assertSame($pages < 3, $more, 'صفحتان ممتلئتان ثم الأخيرة');
        } while ($more);

        $this->assertSame(range(1, 7), $seen);
        $this->assertSame(3, $pages);
        $this->feed("after_seq={$after}&limit=3")->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.next_after_seq', 7);
        $this->feed('after_seq=500')->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.next_after_seq', 500);
    }

    #[Test]
    public function the_default_page_is_capped_at_one_hundred_events(): void
    {
        $orderId = $this->pickupOrder('idem-feed-cap');
        $this->appendEvents($orderId, 104); // 105 حدثاً

        $res = $this->feed()->assertOk();
        $this->assertCount(100, $res->json('data'));
        $this->assertTrue($res->json('meta.has_more'));
        $this->assertSame(100, $res->json('meta.next_after_seq'));
        $this->assertCount(5, $this->feed('after_seq=100')->assertOk()->json('data'));
    }

    #[Test]
    public function the_feed_validates_its_inputs(): void
    {
        $this->feed('after_seq=-1')->assertStatus(422);
        $this->feed('after_seq=abc')->assertStatus(422);
        $this->feed('after_seq=1.5')->assertStatus(422);
        $this->feed('limit=0')->assertStatus(422);
        $this->feed('limit=101')->assertStatus(422);
        $this->feed('limit=ten')->assertStatus(422);
        $this->feed('limit=100&after_seq=0')->assertOk();
    }

    #[Test]
    public function the_feed_supports_etag_and_not_modified_until_a_new_event_changes_the_page(): void
    {
        $orderId = $this->pickupOrder('idem-feed-etag');
        $this->appendEvents($orderId, 3); // 4 أحداث

        // صفحة ممتلئة (limit=2): ETag ثابت ما دامت الصفحة نفسها، حتى لو أُلحق حدث بعدها.
        $full = $this->feed('limit=2')->assertOk();
        $etag = $full->headers->get('ETag');
        $this->assertNotEmpty($etag);
        $this->assertStringContainsString('private', (string) $full->headers->get('Cache-Control'));
        $this->withHeader('If-None-Match', $etag)->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?limit=2')
            ->assertStatus(304)->assertHeader('ETag', $etag);
        $this->appendEvents($orderId, 1);
        $this->withHeader('If-None-Match', $etag)->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?limit=2')->assertStatus(304);

        // صفحة غير ممتلئة (بعد آخر seq): حدث جديد يغيّر ETag فيعود 200 بالحدث.
        $tail = $this->feed('after_seq=5')->assertOk();
        $tailEtag = $tail->headers->get('ETag');
        $this->withHeader('If-None-Match', $tailEtag)->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?after_seq=5')->assertStatus(304);
        $this->appendEvents($orderId, 1);
        $changed = $this->withHeader('If-None-Match', $tailEtag)->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?after_seq=5')->assertOk();
        $this->assertNotSame($tailEtag, $changed->headers->get('ETag'));
        $this->assertSame([6], array_column($changed->json('data'), 'seq'));

        // مؤشّر مختلف ⇒ ETag مختلف.
        $this->assertNotSame($etag, $this->feed('limit=2&after_seq=2')->headers->get('ETag'));
    }

    #[Test]
    public function the_feed_and_attention_enforce_rbac_authentication_application_gate_and_warehouse_restriction(): void
    {
        $this->pickupOrder('idem-feed-rbac');

        foreach (['accountant', 'staff'] as $role) {
            $token = $this->tokenFor($this->tenant, $role);
            $this->feed('', $token)->assertForbidden();
            $this->attention('', $token)->assertForbidden();
        }
        // بلا رمز: نفس رفض المسار القائم commerce/orders (لا يُكشف شيء).
        $anon = $this->getJson('/api/commerce/orders')->status();
        $this->assertContains($anon, [401, 403]);
        $this->getJson('/api/commerce/orders/feed')->assertStatus($anon);
        $this->getJson('/api/commerce/orders/attention')->assertStatus($anon);

        // مستخدم admin مقيَّد بمخزن ⇒ 403 رغم الصلاحية (الطلب CompanyWide بلا مخزن).
        $restricted = $this->tokenFor($this->tenant, 'admin');
        app(TenantContext::class)->set($this->tenant->id);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'WH-FEED', 'is_default' => false]);
        $user = User::query()->where('role', 'admin')->firstOrFail();
        $user->warehouses()->attach($warehouse->id);
        app(TenantContext::class)->forget();
        $this->feed('', $restricted)->assertForbidden();
        $this->attention('', $restricted)->assertForbidden();

        // قدرة المتجر معطَّلة ⇒ 403 على المسارين.
        app(TenantContext::class)->set($this->tenant->id);
        app(TenantApplicationService::class)->disable('commerce.storefront', User::query()->first());
        app(TenantContext::class)->forget();
        $this->feed()->assertForbidden();
        $this->attention()->assertForbidden();
    }

    #[Test]
    public function the_feed_and_attention_are_isolated_per_tenant(): void
    {
        $this->pickupOrder('idem-feed-iso');
        ['tenant' => $other] = $this->makeStore('feed-iso.test', 'feed-iso');
        $this->enableApplications($other);
        $otherToken = $this->tokenFor($other, 'owner');

        $this->assertCount(1, $this->feed()->assertOk()->json('data'));
        $this->feed('', $otherToken)->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.next_after_seq', 0);
        $this->assertCount(1, $this->attention()->assertOk()->json('data'));
        $this->attention('', $otherToken)->assertOk()->assertJsonPath('data', []);

        // مؤشّر مستأجر آخر لا يؤثر: تسلسل مستقل لكل مستأجر.
        $this->assertSame(1, $this->feed('after_seq=0')->json('data.0.seq'));
    }

    #[Test]
    public function the_feed_costs_a_constant_number_of_queries_however_many_events_exist(): void
    {
        $few = $this->pickupOrder('idem-feed-q');
        $count = function (): int {
            $this->feed()->assertOk(); // تسخين
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->feed()->assertOk();
            $n = count(array_filter(DB::getQueryLog(), fn (array $q) => ! str_contains($q['query'], 'personal_access_tokens')));
            DB::disableQueryLog();

            return $n;
        };
        $one = $count();
        $this->appendEvents($few, 20);
        $many = $count();

        $this->assertSame($one, $many, 'عدد الاستعلامات ثابت (صفحة الأحداث + مرجع الطلبات) مهما كثرت الأحداث');
    }

    #[Test]
    public function the_feed_and_attention_are_read_only(): void
    {
        $orderId = $this->pickupOrder('idem-feed-ro');
        $this->collect($orderId);
        $tables = ['commerce_order_events', 'commerce_orders', 'commerce_payment_intents', 'journal_entries', 'journal_lines', 'stock_movements', 'invoices', 'payments'];
        $snapshot = fn () => array_map(fn (string $t) => DB::table($t)->count(), $tables);
        $before = $snapshot();
        $head = DB::table('commerce_order_events')->max('feed_seq');

        $this->feed()->assertOk();
        $this->feed('after_seq=1&limit=1')->assertOk();
        $this->attention()->assertOk();

        $this->assertSame($before, $snapshot());
        $this->assertSame($head, DB::table('commerce_order_events')->max('feed_seq'));
    }

    // ═════════════════════════ 3) مصالحة الانتباه ═════════════════════════

    #[Test]
    public function attention_lists_payment_ready_confirmed_orders_with_the_baseline_reason_and_no_personal_data(): void
    {
        $cod = $this->pickupOrder('idem-att-1');
        $collected = $this->pickupOrder('idem-att-2');
        $this->collect($collected);

        $res = $this->attention()->assertOk();
        $rows = $res->json('data');
        $this->assertEqualsCanonicalizing([$cod, $collected], array_column(array_column($rows, 'order'), 'id'));
        foreach ($rows as $row) {
            $this->assertSame(['new_order'], $row['reasons']);
            $this->assertSame('pay_on_pickup', $row['payment']['method']);
            $this->assertSame('pickup', $row['order']['delivery_method']);
            $this->assertNotNull($row['order']['number']);
        }
        $this->assertSame(['awaiting_collection', 'collected'], collect($rows)->sortBy(fn ($r) => $r['payment']['status'])->pluck('payment.status')->values()->all());
        $this->assertFalse($res->json('meta.truncated'));
        $this->assertSame(48, $res->json('meta.window_hours'));

        $json = $res->getContent();
        foreach (['0501234567', 'email', 'phone', 'address', 'customer_name', 'total'] as $needle) {
            $this->assertStringNotContainsString($needle, $json);
        }
    }

    #[Test]
    public function an_unpaid_online_order_stays_out_until_the_payment_is_confirmed(): void
    {
        $order = $this->onlineOrder(product: $this->product($this->tenant, $this->channel), key: 'idem-att-online');
        $this->attention()->assertOk()->assertJsonPath('data', []);

        $this->pay($order);
        $rows = $this->attention()->assertOk()->json('data');
        $this->assertSame([$order['order_id']], array_column(array_column($rows, 'order'), 'id'));
        $this->assertSame(['online', 'paid'], [$rows[0]['payment']['method'], $rows[0]['payment']['status']]);
    }

    #[Test]
    public function a_cancelled_order_leaves_the_attention_list(): void
    {
        $keep = $this->pickupOrder('idem-att-keep');
        $drop = $this->pickupOrder('idem-att-drop');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$drop}/cancel", ['reason' => 'out_of_stock'])->assertOk();

        $this->assertSame([$keep], array_column(array_column($this->attention()->json('data'), 'order'), 'id'));
    }

    #[Test]
    public function orders_older_than_the_window_are_excluded_and_the_window_is_configurable(): void
    {
        $old = $this->pickupOrder('idem-att-old');
        $fresh = $this->pickupOrder('idem-att-fresh');
        DB::table('commerce_orders')->where('id', $old)->update(['created_at' => now('UTC')->subHours(100)]);

        $this->assertSame([$fresh], array_column(array_column($this->attention()->json('data'), 'order'), 'id'));

        config(['commerce.attention_window_hours' => 200]);
        $this->assertEqualsCanonicalizing([$old, $fresh], array_column(array_column($this->attention()->json('data'), 'order'), 'id'));
        $this->attention()->assertJsonPath('meta.window_hours', 200);
        config(['commerce.attention_window_hours' => 0]);
        $this->attention()->assertJsonPath('meta.window_hours', 1);
    }

    #[Test]
    public function attention_reconciles_an_order_whose_event_never_reached_the_feed(): void
    {
        $normal = $this->pickupOrder('idem-att-lost');
        // طلب من «كاتب قديم»/حدث مفقود: يُنشأ بلا أي صف سجل أحداث إطلاقاً.
        app(TenantContext::class)->set($this->tenant->id);
        $silent = CommerceOrder::create(['sales_channel_id' => $this->channel->id, 'number' => 'CORD-LOST-'.Str::upper(Str::random(6)), 'delivery_method' => 'pickup', 'total' => 1000]);
        $silent->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        \App\Models\CommercePaymentIntent::create(['commerce_order_id' => $silent->id, 'method' => \App\Models\CommercePaymentIntent::METHOD_PAY_ON_PICKUP,
            'status' => \App\Models\CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 1000, 'currency' => 'SAR']);
        app(TenantContext::class)->forget();

        $feedOrders = array_column(array_column($this->feed()->json('data'), 'order'), 'id');
        $this->assertNotContains($silent->id, $feedOrders, 'الحدث مفقود من التغذية');
        $attention = array_column(array_column($this->attention()->json('data'), 'order'), 'id');
        $this->assertEqualsCanonicalizing([$normal, $silent->id], $attention, 'المصالحة تستدركه من الحالة');
    }

    #[Test]
    public function attention_filters_by_storefront_orders_oldest_first_and_caps_with_a_truncated_flag(): void
    {
        $first = $this->pickupOrder('idem-att-s1');
        $second = $this->pickupOrder('idem-att-s2');
        $third = $this->pickupOrder('idem-att-s3');
        DB::table('commerce_orders')->where('id', $first)->update(['created_at' => now('UTC')->subHours(3)]);
        DB::table('commerce_orders')->where('id', $second)->update(['created_at' => now('UTC')->subHours(2)]);
        DB::table('commerce_orders')->where('id', $third)->update(['created_at' => now('UTC')->subHour()]);

        $this->assertSame([$first, $second, $third], array_column(array_column($this->attention()->json('data'), 'order'), 'id'), 'الأقدم أولاً');

        $capped = $this->attention('limit=2')->assertOk();
        $this->assertSame([$first, $second], array_column(array_column($capped->json('data'), 'order'), 'id'));
        $this->assertTrue($capped->json('meta.truncated'));
        $this->assertFalse($this->attention('limit=3')->json('meta.truncated'));

        $this->assertCount(3, $this->attention('storefront_id='.$this->storefront->id)->json('data'));
        $this->attention('storefront_id='.Str::uuid())->assertOk()->assertJsonPath('data', []);
        $this->attention('storefront_id=not-a-uuid')->assertStatus(422);
        $this->attention('limit=0')->assertStatus(422);
        $this->attention('limit=101')->assertStatus(422);
    }

    #[Test]
    public function a_draft_order_is_never_in_attention(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $draft = CommerceOrder::create(['sales_channel_id' => $this->channel->id, 'number' => 'CORD-DRAFT-'.Str::upper(Str::random(6)), 'delivery_method' => 'pickup', 'total' => 1000]);
        \App\Models\CommercePaymentIntent::create(['commerce_order_id' => $draft->id, 'method' => \App\Models\CommercePaymentIntent::METHOD_PAY_ON_PICKUP,
            'status' => \App\Models\CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 1000, 'currency' => 'SAR']);
        app(TenantContext::class)->forget();

        $this->attention()->assertOk()->assertJsonPath('data', []);
    }
}
