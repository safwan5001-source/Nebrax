<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceOrderAlertNotifier;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\NotificationService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * COPS-H3-1 (ADR-30 §0 R-8، R-5) — منتِج إشعار «طلب متجر جديد» للتاجر.
 *
 * يُثبت: البوابة المغلقة لا تنتج شيئاً؛ COD/استلام يُنبَّه به عند الإنشاء؛ الإلكتروني غير المدفوع لا يُنبَّه (R-5) ويُنبَّه عند الدفع مرة واحدة؛ المستلمون = حاملو
 * `commerce.orders.view` فعلاً (دور مخصص + `*`) النشطون من المستأجر نفسه فقط، مع تفضيل المستخدم ونطاق المخازن؛ dedupe؛ إخفاق المُنتِج لا يُفشل الإتمام؛
 * الحمولة بلا PII؛ واكتشاف المستمعين لا يسجّله مرتين. تمرّ كلها عبر Checkout حقيقي.
 */
class CommerceOrderAlertProducerTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $a;

    private Warehouse $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->a = Warehouse::create(['name' => 'مخزن أ', 'code' => 'AL-A', 'is_default' => true]);
        $this->b = Warehouse::create(['name' => 'مخزن ب', 'code' => 'AL-B']);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->a->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        app(TenantContext::class)->forget();
        config(['commerce.order_alerts_enabled' => true]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function user(Tenant $tenant, string $role, array $extra = []): User
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'مستخدم '.$role, 'email' => $role.'-'.Str::random(6).'@alert.test', 'password' => 'password123', 'role' => $role] + $extra);
        app(TenantContext::class)->forget();

        return $user;
    }

    private function customRole(string $slug, array $permissions): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['tenant_id' => $this->tenant->id, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        app(TenantContext::class)->forget();
    }

    /** @return \Illuminate\Support\Collection<int, Notification> */
    private function alerts(?string $recipientId = null)
    {
        $q = Notification::withoutGlobalScopes()->where('type', CommerceOrderAlertNotifier::TYPE);

        return $q->when($recipientId !== null, fn ($b) => $b->where('recipient_id', $recipientId))->get();
    }

    private function pickupOrder(string $key): string
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);

        return (string) $this->complete($token, $key)->assertCreated()->json('data.order.id');
    }

    private function pay(array $order): void
    {
        $this->startPayment($order)->assertSuccessful();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $this->paymentStatus($order)->assertOk()->assertJsonPath('data.payment.status', 'paid');
    }

    // ───────────────────────── البوابة ─────────────────────────

    #[Test]
    public function the_closed_gate_produces_nothing(): void
    {
        config(['commerce.order_alerts_enabled' => false]);
        $this->user($this->tenant, 'owner');

        $this->pickupOrder('idem-al-closed');

        $this->assertCount(0, $this->alerts());
        $this->assertTrue(config('commerce.order_alerts_enabled') === false);
    }

    #[Test]
    public function the_gate_defaults_to_closed_in_config(): void
    {
        $this->assertFalse((bool) (require base_path('config/commerce.php'))['order_alerts_enabled']);
    }

    // ───────────────────────── COD / استلام ─────────────────────────

    #[Test]
    public function a_pickup_order_notifies_eligible_users_once_with_a_safe_payload(): void
    {
        $owner = $this->user($this->tenant, 'owner');
        $orderId = $this->pickupOrder('idem-al-cod');

        $rows = $this->alerts($owner->id);
        $this->assertCount(1, $rows);
        $n = $rows->first();
        $this->assertSame('alert', $n->category);
        $this->assertSame('view_commerce_order', $n->action);
        $this->assertSame('commerce_order', $n->source_type);
        $this->assertSame($orderId, $n->source_id);
        $this->assertSame('commerce.order_alert:'.$orderId, $n->dedupe_key);
        $this->assertSame($this->tenant->id, $n->tenant_id);
        $this->assertNull($n->read_at);
        $this->assertSame(['order_number'], array_keys($n->data));

        // لا PII في أي حقل نصي.
        $blob = json_encode([$n->title, $n->message, $n->data], JSON_UNESCAPED_UNICODE);
        foreach (['سالم', '0501234567', 'salem@example.com', 'الدمام', 'شارع'] as $pii) {
            $this->assertStringNotContainsString($pii, $blob);
        }

        // يظهر عبر واجهة الإشعارات للمستلم بالإجراء المسموح.
        $token = $owner->createToken('api')->plainTextToken;
        $this->withToken($token)->getJson('/api/notifications')->assertOk()
            ->assertJsonPath('data.0.action', 'view_commerce_order')
            ->assertJsonPath('data.0.source_id', $orderId);
    }

    #[Test]
    public function recipients_are_active_holders_of_the_view_permission_of_the_same_tenant_only(): void
    {
        $owner = $this->user($this->tenant, 'owner');
        $admin = $this->user($this->tenant, 'admin');
        $this->customRole('shop_viewer', ['commerce.orders.view']);
        $granted = $this->user($this->tenant, 'shop_viewer');
        $accountant = $this->user($this->tenant, 'accountant');            // بلا الصلاحية
        $inactive = $this->user($this->tenant, 'owner', ['is_active' => false]);
        $otherTenant = $this->makeStore('other-alert.test', 'other-alert')['tenant'];
        $foreign = $this->user($otherTenant, 'owner');

        $this->pickupOrder('idem-al-rcpt');

        $recipients = $this->alerts()->pluck('recipient_id')->sort()->values()->all();
        $this->assertSame(collect([$owner->id, $admin->id, $granted->id])->sort()->values()->all(), $recipients);
        foreach ([$accountant, $inactive, $foreign] as $excluded) {
            $this->assertCount(0, $this->alerts($excluded->id), 'مستلم غير مؤهل');
        }
    }

    #[Test]
    public function a_personal_opt_out_stops_only_that_users_alerts(): void
    {
        $in = $this->user($this->tenant, 'owner');
        $out = $this->user($this->tenant, 'admin', ['preferences' => ['locale' => 'ar', 'theme' => 'system', 'commerce_alerts' => ['enabled' => false]]]);
        $default = $this->user($this->tenant, 'admin', ['preferences' => ['locale' => 'ar', 'theme' => 'system']]);

        $this->pickupOrder('idem-al-pref');

        $this->assertCount(1, $this->alerts($in->id));
        $this->assertCount(1, $this->alerts($default->id));
        $this->assertCount(0, $this->alerts($out->id));
    }

    #[Test]
    public function a_warehouse_restricted_user_is_alerted_only_for_orders_of_their_warehouses(): void
    {
        $forA = $this->user($this->tenant, 'admin');
        $forB = $this->user($this->tenant, 'admin');
        $unrestricted = $this->user($this->tenant, 'owner');
        app(TenantContext::class)->set($this->tenant->id);
        $forA->warehouses()->attach([$this->a->id]);
        $forB->warehouses()->attach([$this->b->id]);
        app(TenantContext::class)->forget();

        $this->pickupOrder('idem-al-wh'); // مخزن سياسة القناة = أ

        $this->assertCount(1, $this->alerts($forA->id));
        $this->assertCount(0, $this->alerts($forB->id));
        $this->assertCount(1, $this->alerts($unrestricted->id));
    }

    // ───────────────────────── الإلكتروني (R-5) ─────────────────────────

    #[Test]
    public function an_unpaid_online_order_is_not_alerted_and_payment_alerts_exactly_once(): void
    {
        $owner = $this->user($this->tenant, 'owner');
        $order = $this->onlineOrder(key: 'idem-al-online');
        $this->assertCount(0, $this->alerts(), 'R-5: غير مدفوع ⇒ لا تنبيه');

        $this->pay($order);
        $this->assertCount(1, $this->alerts($owner->id));
        $this->assertSame($order['order_id'], $this->alerts($owner->id)->first()->source_id);

        // إعادة القراءة/المطابقة/شبكة الأمان لا تضاعف.
        $this->paymentStatus($order)->assertOk();
        $this->artisan('payments:complete-commerce-captures')->assertSuccessful();
        $this->assertCount(1, $this->alerts($owner->id));
    }

    // ───────────────────────── العزل عن الإتمام ─────────────────────────

    #[Test]
    public function a_failing_delivery_never_fails_the_checkout_and_other_recipients_still_get_theirs(): void
    {
        $first = $this->user($this->tenant, 'owner');
        $second = $this->user($this->tenant, 'admin');

        $real = app(NotificationService::class);
        $this->app->instance(NotificationService::class, new class($real, $first->id) extends NotificationService {
            public function __construct(private readonly NotificationService $real, private readonly string $failFor) {}

            public function deliver(array $payload): Notification
            {
                if ($payload['recipient_id'] === $this->failFor) {
                    throw new RuntimeException('delivery boom');
                }

                return $this->real->deliver($payload);
            }
        });
        Log::spy();

        $this->pickupOrder('idem-al-fail'); // assertCreated داخل pickupOrder

        $this->assertCount(0, $this->alerts($first->id));
        $this->assertCount(1, $this->alerts($second->id));
        Log::shouldHaveReceived('warning')->withArgs(fn ($m) => $m === 'commerce.order_alert.recipient_failed')->atLeast()->once();
    }

    #[Test]
    public function the_listener_is_registered_once_per_event(): void
    {
        $listeners = Event::getRawListeners();
        foreach ([\App\Events\CommerceOrderPlaced::class, \App\Events\CommerceOrderPaymentPaid::class] as $event) {
            $mine = array_filter($listeners[$event] ?? [], fn ($l) => is_array($l) ? ($l[0] ?? null) === \App\Listeners\NotifyCommerceOrderAlert::class : (is_string($l) && str_contains($l, 'NotifyCommerceOrderAlert')));
            $this->assertCount(1, $mine, "مستمع التنبيه يُسجَّل مرة واحدة على {$event}");
        }
    }

    #[Test]
    public function the_notifier_is_idempotent_and_ignores_foreign_tenant_context(): void
    {
        $owner = $this->user($this->tenant, 'owner');
        $orderId = $this->pickupOrder('idem-al-idem');
        $this->assertCount(1, $this->alerts($owner->id));

        $notifier = app(CommerceOrderAlertNotifier::class);
        $this->assertSame(1, $notifier->notify($this->tenant->id, $orderId)); // يجد الإشعار القائم ولا يكرر
        $this->assertCount(1, $this->alerts($owner->id));

        $other = $this->makeStore('other-alert2.test', 'other-alert2')['tenant'];
        app(TenantContext::class)->set($other->id);
        $this->assertSame(0, $notifier->notify($this->tenant->id, $orderId), 'سياق مستأجر آخر لا يُخلط');
        app(TenantContext::class)->forget();
    }
}
