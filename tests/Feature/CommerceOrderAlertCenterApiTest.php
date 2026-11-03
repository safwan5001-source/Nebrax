<?php

namespace Tests\Feature;

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
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H3-3 (ADR-30، D-H3-01/02) — الإضافات الخلفية لمركز التنبيه: `GET commerce/alerts/config` (بوابة، وضع، وتيرة)، `head_seq`/`tail` للتغذية،
 * ETag/304 للانتباه، وحقل `alert.pending` (حكم الخادم الوحيد: لم يُقبل ولم يبدأ تنفيذه). كلها قراءة فقط.
 */
class CommerceOrderAlertCenterApiTest extends TestCase
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
        $this->a = Warehouse::create(['name' => 'مخزن أ', 'code' => 'AC-A', 'is_default' => true]);
        $this->b = Warehouse::create(['name' => 'مخزن ب', 'code' => 'AC-B']);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->a->id);
        app(TenantContext::class)->forget();
        $this->enableApps($this->tenant);
        $this->ownerToken = $this->token($this->tenant, 'owner');
        config(['commerce.order_fulfillment_enabled' => true]);
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

    private function token(Tenant $tenant, string $role, array $warehouseIds = []): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(6).'@ac.test', 'password' => 'password123', 'role' => $role]);
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

    private function config(?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson('/api/commerce/alerts/config');
    }

    // ───────────────────────── config ─────────────────────────

    #[Test]
    public function the_config_reports_a_closed_gate_by_default_and_never_enables_anything_itself(): void
    {
        config(['commerce.order_alerts_enabled' => false]);
        $this->config()->assertOk()->assertJsonPath('data.enabled', false)->assertJsonPath('data.mode', 'feed_attention');

        config(['commerce.order_alerts_enabled' => true]);
        $this->config()->assertOk()
            ->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.polling.feed_ms', 10000)
            ->assertJsonPath('data.polling.attention_ms', 60000)
            ->assertJsonPath('data.polling.attention_only_ms', 15000)
            ->assertHeader('Cache-Control');
    }

    #[Test]
    public function a_warehouse_restricted_user_gets_attention_only_mode(): void
    {
        config(['commerce.order_alerts_enabled' => true]);
        $restricted = $this->token($this->tenant, 'admin', [$this->a->id]);

        $this->config($restricted)->assertOk()->assertJsonPath('data.mode', 'attention_only');
        // D-H3-01: ولا يُفتح له feed.
        $this->withToken($restricted)->getJson('/api/commerce/orders/feed')->assertForbidden();
        $this->withToken($restricted)->getJson('/api/commerce/orders/feed?tail=1')->assertForbidden();
    }

    #[Test]
    public function the_polling_cadence_is_server_driven_and_clamped(): void
    {
        config(['commerce.order_alerts_enabled' => true, 'commerce.order_alerts_polling' => ['feed_ms' => 100, 'attention_ms' => 1, 'attention_only_ms' => 5]]);
        $this->config()->assertOk()
            ->assertJsonPath('data.polling.feed_ms', 5000)
            ->assertJsonPath('data.polling.attention_ms', 15000)
            ->assertJsonPath('data.polling.attention_only_ms', 10000);
    }

    #[Test]
    public function the_config_requires_authentication_and_the_view_permission(): void
    {
        $this->getJson('/api/commerce/alerts/config')->assertUnauthorized();
        $this->config($this->token($this->tenant, 'accountant'))->assertForbidden();
    }

    // ───────────────────────── head_seq / tail ─────────────────────────

    #[Test]
    public function the_feed_reports_the_head_and_tail_returns_it_without_events(): void
    {
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?tail=1')
            ->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.head_seq', 0)->assertJsonPath('meta.next_after_seq', 0);

        $this->pickupOrder('idem-ac-head-1');
        $this->pickupOrder('idem-ac-head-2');
        $head = (int) CommerceOrderEvent::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->max('feed_seq');
        $this->assertGreaterThanOrEqual(2, $head);

        $tail = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?tail=1')->assertOk();
        $tail->assertJsonPath('data', [])->assertJsonPath('meta.head_seq', $head)->assertJsonPath('meta.next_after_seq', $head)->assertJsonPath('meta.has_more', false);

        $page = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?after_seq=0&limit=1')->assertOk();
        $page->assertJsonPath('meta.head_seq', $head)->assertJsonPath('meta.has_more', true);
        $this->assertCount(1, $page->json('data'));

        // معلومة رأس فقط: بعد آخر حدث لا أحداث و`head_seq` ثابت.
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?after_seq='.$head)->assertOk()
            ->assertJsonPath('data', [])->assertJsonPath('meta.head_seq', $head);
    }

    #[Test]
    public function the_head_is_per_tenant_and_the_tail_input_is_validated(): void
    {
        $this->pickupOrder('idem-ac-iso');
        $other = $this->makeStore('other-ac.test', 'other-ac')['tenant'];
        $this->enableApps($other);
        $otherToken = $this->token($other, 'owner');

        $this->withToken($otherToken)->getJson('/api/commerce/orders/feed?tail=1')->assertOk()->assertJsonPath('meta.head_seq', 0);
        $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/feed?tail=maybe')->assertStatus(422);
    }

    // ───────────────────────── attention ETag / alert.pending ─────────────────────────

    #[Test]
    public function attention_supports_etag_and_returns_not_modified_until_the_state_changes(): void
    {
        $this->pickupOrder('idem-ac-etag-1');
        $first = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk();
        $etag = $first->headers->get('ETag');
        $this->assertNotEmpty($etag);
        $this->assertStringContainsString('private', (string) $first->headers->get('Cache-Control'));

        $this->withHeader('If-None-Match', $etag)->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')
            ->assertStatus(304)->assertHeader('ETag', $etag);

        $this->pickupOrder('idem-ac-etag-2');
        $second = $this->withHeader('If-None-Match', $etag)->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk();
        $this->assertNotSame($etag, $second->headers->get('ETag'));
        $this->assertCount(2, $second->json('data'));

        // ETag مرتبط بالمستأجر: مستأجر آخر بقائمة فارغة لا يطابق.
        $other = $this->makeStore('other-ac2.test', 'other-ac2')['tenant'];
        $this->enableApps($other);
        $this->withHeader('If-None-Match', $etag)->withToken($this->token($other, 'owner'))->getJson('/api/commerce/orders/attention')->assertOk()->assertJsonPath('data', []);
    }

    #[Test]
    public function alert_pending_is_true_until_the_order_is_handled_and_the_row_stays_in_attention(): void
    {
        $orderId = $this->pickupOrder('idem-ac-pending');
        $rows = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk();
        $rows->assertJsonPath('data.0.order.id', $orderId)->assertJsonPath('data.0.alert.pending', true);

        // بدء التنفيذ = معالجة: يخرج من «يستدعي التنبيه» لكنه يبقى في الانتباه (قائمة العمل) — R-10: لا إخراج من القوائم.
        $this->withToken($this->ownerToken)->postJson("/api/commerce/orders/{$orderId}/fulfillment/start", ['expected_version' => 0])->assertOk();
        $after = $this->withToken($this->ownerToken)->getJson('/api/commerce/orders/attention')->assertOk();
        $row = collect($after->json('data'))->firstWhere('order.id', $orderId);
        $this->assertNotNull($row, 'الطلب يبقى في قائمة الانتباه');
        $this->assertFalse($row['alert']['pending']);
    }

    #[Test]
    public function a_restricted_user_sees_pending_only_for_their_warehouses_in_attention(): void
    {
        $this->pickupOrder('idem-ac-restricted');
        $forA = $this->token($this->tenant, 'admin', [$this->a->id]);
        $forB = $this->token($this->tenant, 'admin', [$this->b->id]);

        $this->withToken($forA)->getJson('/api/commerce/orders/attention')->assertOk()->assertJsonPath('data.0.alert.pending', true);
        $this->withToken($forB)->getJson('/api/commerce/orders/attention')->assertOk()->assertJsonPath('data', []);
    }
}
