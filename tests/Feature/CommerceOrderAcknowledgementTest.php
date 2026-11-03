<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderAcknowledgement;
use App\Models\CommerceOrderEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H3-4 (ADR-30 §4، R-10 المعتمد) — إقرار تنبيه الطلب لكل طلب.
 *
 * يُثبت: البوابة المغلقة ⇒ 404؛ الإقرار يُسكت الجميع (`attention.alert.pending=false` لكل المستخدمين) **دون تغيير حالة الطلب أو إخراجه من الانتباه**؛ حدث `order.acknowledged`
 * بلا PII؛ idempotent (لا حدث ثانٍ ولا تغيير للفاعل/الوقت حتى بعد الإلغاء)؛ R-5 (الإلكتروني غير المدفوع لا يُقَرّ)؛ الإلغاء يمنع الإقرار الأول؛ RBAC/عزل/نطاق المخازن؛
 * قيد شكل الحدث؛ وحراس ساكنة (الكاتب الوحيد، ترتيب الأقفال، الحدث آخر كتابة). لا قيد ولا مخزون. التزامن على PostgreSQL: `CommerceOrderAcknowledgementPostgresTest`.
 */
class CommerceOrderAcknowledgementTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private string $ownerToken;

    private Warehouse $a;

    private Warehouse $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->a = Warehouse::create(['name' => 'مخزن أ', 'code' => 'ACK-A', 'is_default' => true]);
        $this->b = Warehouse::create(['name' => 'مخزن ب', 'code' => 'ACK-B']);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->a->id);
        app(TenantContext::class)->forget();
        $this->enableApps($this->tenant);
        $this->ownerToken = $this->token($this->tenant, 'owner');
        config(['commerce.order_alerts_enabled' => true, 'commerce.order_cancellation_enabled' => true]);
    }

    private function enableApps(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        app(TenantContext::class)->forget();
    }

    /** @param list<string> $warehouseIds */
    private function token(Tenant $tenant, string $role, array $warehouseIds = []): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(6).'@ack.test', 'password' => 'password123', 'role' => $role]);
        if ($warehouseIds !== []) {
            $user->warehouses()->attach($warehouseIds);
        }
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function pickupOrder(string $key): string
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);

        return (string) $this->complete($token, $key)->assertCreated()->json('data.order.id');
    }

    private function ack(string $orderId, ?string $token = null, array $body = [])
    {
        return $this->withToken($token ?? $this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/acknowledge", $body);
    }

    private function attentionRow(string $orderId, ?string $token = null): ?array
    {
        $rows = $this->withToken($token ?? $this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk()->json('data');

        return collect($rows)->firstWhere('order.id', $orderId);
    }

    // ───────────────────────── البوابة والسلوك ─────────────────────────

    #[Test]
    public function the_closed_gate_answers_404_like_a_missing_order(): void
    {
        $orderId = $this->pickupOrder('idem-ack-closed');
        config(['commerce.order_alerts_enabled' => false]);

        $this->ack($orderId)->assertNotFound();
        $this->assertSame(0, CommerceOrderAcknowledgement::withoutGlobalScopes()->count());
    }

    #[Test]
    public function acknowledging_silences_the_alert_for_everyone_without_changing_or_removing_the_order(): void
    {
        $orderId = $this->pickupOrder('idem-ack-all');
        $other = $this->token($this->tenant, 'admin');
        $before = DB::table('commerce_orders')->where('id', $orderId)->first();
        $intentBefore = DB::table('commerce_payment_intents')->where('commerce_order_id', $orderId)->first();
        $this->assertTrue($this->attentionRow($orderId)['alert']['pending']);
        $this->assertTrue($this->attentionRow($orderId, $other)['alert']['pending']);

        $this->ack($orderId)->assertOk()
            ->assertJsonPath('data.order_id', $orderId)
            ->assertJsonPath('data.acknowledged', true)
            ->assertJsonPath('data.created', true)
            ->assertJsonStructure(['data' => ['acknowledged_at']]);

        // يُسكت المستخدم الآخر أيضاً (R-10: لكل طلب)، والطلب يبقى في الانتباه/قوائم العمل.
        foreach ([null, $other] as $token) {
            $row = $this->attentionRow($orderId, $token);
            $this->assertNotNull($row, 'الإقرار لا يُخرج الطلب من القائمة');
            $this->assertFalse($row['alert']['pending']);
            $this->assertTrue($row['alert']['acknowledged']);
            $this->assertNotNull($row['alert']['acknowledged_at']);
        }

        // لا تغيير في الطلب ولا نية الدفع ولا قبول ولا تنفيذ ولا أثر مالي/مخزني.
        $after = DB::table('commerce_orders')->where('id', $orderId)->first();
        foreach (['status', 'accepted_at', 'cancelled_at', 'total', 'acceptance_mode'] as $col) {
            $this->assertEquals($before->{$col}, $after->{$col}, $col);
        }
        $intentAfter = DB::table('commerce_payment_intents')->where('commerce_order_id', $orderId)->first();
        $this->assertSame($intentBefore->status, $intentAfter->status);
        $this->assertSame(0, DB::table('commerce_order_fulfillments')->where('commerce_order_id', $orderId)->count());
        $this->assertSame(0, DB::table('journal_entries')->where('tenant_id', $this->tenant->id)->count());
        $this->assertSame(0, DB::table('stock_movements')->where('tenant_id', $this->tenant->id)->count());
        // ويظهر في قراءة الطلب للموظف كما كان (الطلب ما زال قابلاً للقبول/التنفيذ/الإلغاء).
        $this->withToken($this->ownerToken)->getJson("/api/commerce/orders/{$orderId}")->assertOk()->assertJsonPath('data.status', 'confirmed');
    }

    #[Test]
    public function the_event_reaches_the_feed_with_the_acknowledging_actor_and_no_pii(): void
    {
        $orderId = $this->pickupOrder('idem-ack-event');
        $head = (int) $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?tail=1')->json('meta.head_seq');

        $this->ack($orderId)->assertOk();

        $page = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?after_seq='.$head)->assertOk();
        $event = collect($page->json('data'))->firstWhere('type', 'order.acknowledged');
        $this->assertNotNull($event);
        $this->assertSame($orderId, $event['order']['id']);
        $this->assertSame('user', $event['actor']['type']);
        $this->assertSame([], (array) $event['data']);
        $this->assertSame($head + 1, $event['seq']);
        $this->assertStringNotContainsString('0501234567', json_encode($page->json()));
    }

    #[Test]
    public function acknowledging_twice_is_idempotent_even_after_the_order_is_cancelled(): void
    {
        $orderId = $this->pickupOrder('idem-ack-twice');
        $first = $this->ack($orderId)->assertOk()->json('data');
        $other = $this->token($this->tenant, 'admin');

        $second = $this->ack($orderId, $other)->assertOk()->json('data');
        $this->assertFalse($second['created']);
        $this->assertSame($first['acknowledged_at'], $second['acknowledged_at'], 'لا تغيير للوقت');
        $ack = CommerceOrderAcknowledgement::withoutGlobalScopes()->where('commerce_order_id', $orderId)->get();
        $this->assertCount(1, $ack);
        $this->assertSame(1, CommerceOrderEvent::withoutGlobalScopes()->where('commerce_order_id', $orderId)->where('type', 'order.acknowledged')->count());

        // بعد إلغاء الطلب: يبقى الإقرار القائم 200 بلا أثر.
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'customer_request'])->assertOk();
        $this->ack($orderId)->assertOk()->assertJsonPath('data.created', false);
        $this->assertSame(1, CommerceOrderEvent::withoutGlobalScopes()->where('commerce_order_id', $orderId)->where('type', 'order.acknowledged')->count());
    }

    #[Test]
    public function a_cancelled_order_cannot_be_acknowledged_for_the_first_time(): void
    {
        $orderId = $this->pickupOrder('idem-ack-cancelled');
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/cancel", ['reason' => 'customer_request'])->assertOk();

        $this->ack($orderId)->assertStatus(409)->assertJsonPath('reason', 'already_cancelled');
        $this->assertSame(0, CommerceOrderAcknowledgement::withoutGlobalScopes()->count());
    }

    #[Test]
    public function an_unpaid_online_order_cannot_be_acknowledged_until_the_payment_is_confirmed(): void
    {
        $order = $this->onlineOrder(key: 'idem-ack-online');

        $this->ack($order['order_id'])->assertStatus(409)->assertJsonPath('reason', 'not_alertable');
        $this->assertSame(0, CommerceOrderAcknowledgement::withoutGlobalScopes()->count());

        $this->startPayment($order)->assertSuccessful();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt);
        $this->elapse($attempt);
        $this->paymentStatus($order)->assertOk();

        $this->ack($order['order_id'])->assertOk()->assertJsonPath('data.created', true);
    }

    // ───────────────────────── الأمان والعزل ─────────────────────────

    #[Test]
    public function permissions_isolation_scope_and_input_are_enforced(): void
    {
        $orderId = $this->pickupOrder('idem-ack-sec');

        $this->postJson("/api/commerce/orders/{$orderId}/acknowledge")->assertUnauthorized();
        $this->ack($orderId, $this->token($this->tenant, 'accountant'))->assertForbidden();
        $this->ack($orderId, $this->ownerToken, ['tenant_id' => (string) Str::uuid()])->assertStatus(422);
        $this->ack((string) Str::uuid())->assertNotFound();
        $this->withToken($this->ownerToken)->postJson('/api/commerce/orders/not-a-uuid/acknowledge')->assertNotFound();

        // مستأجر آخر لا يرى ولا يُقرّ (404 موحَّد) والطلب لم يُقَرّ.
        $other = $this->makeStore('other-ack.test', 'other-ack')['tenant'];
        $this->enableApps($other);
        $this->ack($orderId, $this->token($other, 'owner'))->assertNotFound();

        // المقيَّد بمخزن آخر: 404 موحَّد؛ بمخزن الطلب: 200.
        $this->ack($orderId, $this->token($this->tenant, 'admin', [$this->b->id]))->assertNotFound();
        $this->assertSame(0, CommerceOrderAcknowledgement::withoutGlobalScopes()->count());
        $this->ack($orderId, $this->token($this->tenant, 'admin', [$this->a->id]))->assertOk();
    }

    #[Test]
    public function the_event_shape_guard_accepts_the_new_type_and_still_rejects_unknown_ones(): void
    {
        $orderId = $this->pickupOrder('idem-ack-guard');
        $this->ack($orderId)->assertOk();
        $this->assertSame(1, DB::table('commerce_order_events')->where('type', 'order.acknowledged')->count());

        $seq = (int) DB::table('commerce_order_events')->where('tenant_id', $this->tenant->id)->max('feed_seq');
        $this->expectException(\Throwable::class);
        DB::table('commerce_order_events')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'commerce_order_id' => $orderId, 'feed_seq' => $seq + 1,
            'type' => 'order.not_a_type', 'actor_type' => 'system', 'actor_id' => null, 'occurred_at' => now(), 'created_at' => now(),
        ]);
    }

    // ───────────────────────── حراس ساكنة ─────────────────────────

    #[Test]
    public function only_the_service_writes_acknowledgements_and_the_locks_and_event_order_hold(): void
    {
        $root = dirname(__DIR__, 2);
        $service = (string) file_get_contents($root.'/app/Services/Commerce/CommerceOrderAcknowledgementService.php');

        // الكاتب الوحيد: لا إنشاء/إدراج للجدول أو النموذج خارجها.
        foreach (['app', 'database/seeders'] as $dir) {
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root.'/'.$dir, \FilesystemIterator::SKIP_DOTS));
            foreach ($it as $file) {
                if (! str_ends_with((string) $file, '.php') || str_ends_with((string) $file, 'CommerceOrderAcknowledgementService.php')) {
                    continue;
                }
                $src = (string) file_get_contents((string) $file);
                $this->assertDoesNotMatchRegularExpression('/new\s+CommerceOrderAcknowledgement\b|CommerceOrderAcknowledgement::(create|insert|updateOrCreate|firstOrCreate)|table\(\s*[\'"]commerce_order_acknowledgements[\'"]\s*\)\s*->\s*(insert|update|delete)/', $src, (string) $file);
            }
        }
        $this->assertSame([], (new CommerceOrderAcknowledgement)->getFillable(), 'بلا إسناد جماعي');

        // ترتيب الأقفال: النية ← الطلب، والحدث بعد الكتابة وفي آخر المعاملة.
        $intent = strpos($service, 'CommercePaymentIntent::query()');
        $order = strpos($service, 'CommerceOrder::query()->whereKey');
        $save = strpos($service, '->save();');
        $append = strpos($service, '$this->events->append(');
        $this->assertTrue($intent !== false && $intent < $order && $order < $save && $save < $append, 'النية ← الطلب ← الكتابة ← الحدث آخراً');
        $this->assertSame(1, substr_count($service, '$this->events->append('));
        $this->assertStringNotContainsString('Http::', $service, 'لا شبكة تحت القفل');
        $this->assertStringNotContainsString('LedgerService', $service);
        $this->assertStringNotContainsString('InventoryService', $service);
    }
}
