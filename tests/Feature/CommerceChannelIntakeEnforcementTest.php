<?php

namespace Tests\Feature;

use App\Models\CommerceChannelOperationSetting;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceChannelIntakeGuard;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\CommerceChannelIntake;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H4-4 (D-OPS-7/8، D-H4-03/05) — إنفاذ تحكّمات استقبال الطلبات عند إنشاء الطلب + كتلة `ordering` العامة.
 *
 * يُثبت: البوابة مغلقة ⇒ لا أثر ولا استعلام (حتى مع قيم حجب مخزَّنة)؛ الإيقاف وخارج الساعات والحد الأدنى ⇒ 409 `review_required` برمز ثابت **قبل أي كتابة**؛
 * الإيقاف المجدول ينتهي تلقائياً؛ منطقة القناة؛ نطاق الحد الأدنى؛ الإعادة (replay) لطلب مكتمل لا تتأثر؛ عزل المستأجر؛ وكتلة `ordering` الإضافية.
 * سباق إيقاف↔إتمام على PostgreSQL: `CommerceChannelIntakePostgresTest`.
 */
class CommerceChannelIntakeEnforcementTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        $user = User::create(['tenant_id' => $this->tenant->id, 'name' => 'مالك', 'email' => 'owner-'.Str::random(6).'@enf.test', 'password' => 'password123', 'role' => 'owner']);
        $this->ownerToken = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function openGate(): void
    {
        config(['commerce.channel_intake_controls_enabled' => true]);
    }

    private function configure(array $changes, int $expectedVersion = 0): void
    {
        $this->openGate();
        $this->withToken($this->ownerToken)->putJson('/api/commerce/channels/'.$this->channel->id.'/operations-settings', ['expected_version' => $expectedVersion] + $changes)->assertOk();
    }

    /** يثبّت الساعة على الاثنين 10:00 بتوقيت الرياض (يوم 1). */
    private function mondayTenAm(): CarbonImmutable
    {
        $now = CarbonImmutable::create(2026, 11, 9, 10, 0, 0, 'Asia/Riyadh');
        $this->travelTo($now);

        return $now;
    }

    private function orders(): int
    {
        return CommerceOrder::query()->withoutGlobalScopes()->count();
    }

    private function review(\Illuminate\Testing\TestResponse $response, string $reason): array
    {
        $response->assertStatus(409);
        $this->assertSame('review_required', $response->json('error.code'));
        $this->assertSame($reason, $response->json('error.details.items.0.reason'));
        $this->assertSame('store', $response->json('error.details.items.0.item_id'));

        return $response->json('error.details.items.0');
    }

    private function ordering(): ?array
    {
        $response = $this->api()->getJson(self::BASE.'/storefront')->assertOk();

        return $response->json('data.ordering');
    }

    // ═════════════════════════ 1) البوابة مغلقة ═════════════════════════

    #[Test]
    public function with_the_gate_closed_stored_blocking_values_change_nothing_and_no_settings_query_runs(): void
    {
        // قيم حجب مخزَّنة مباشرةً (الـAPI يرفضها والبوابة مغلقة).
        DB::table('commerce_channel_operation_settings')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'sales_channel_id' => $this->channel->id, 'acceptance_mode' => 'auto', 'version' => 1,
            'accepting_orders' => false, 'outside_hours_policy' => 'block', 'min_order_minor' => 99999999, 'min_order_scope' => 'all', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);

        $queries = [];
        DB::listen(function ($q) use (&$queries): void {
            $queries[] = $q->sql;
        });
        $this->complete($token, 'idem-enf-closed')->assertCreated();
        $touching = array_filter($queries, fn (string $sql): bool => str_contains($sql, 'commerce_channel_operation_settings') || str_contains($sql, 'commerce_channel_opening_hours'));
        $this->assertSame([], array_values($touching), 'البوابة مغلقة ⇒ Checkout لا يقرأ جداول التحكّم');
        $this->assertSame(1, $this->orders());
        $this->assertNull($this->ordering(), 'والكتلة العامة غائبة');
        $this->assertNull(app(CommerceChannelIntakeGuard::class)->publicBlock($this->channel->id));
    }

    // ═════════════════════════ 2) الإيقاف اليدوي ═════════════════════════

    #[Test]
    public function a_paused_store_refuses_new_orders_before_any_write_and_resuming_lets_the_same_checkout_complete(): void
    {
        $this->mondayTenAm();
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $this->configure(['accepting_orders' => false, 'pause_message' => 'نعود غداً صباحاً']);

        $detail = $this->review($this->complete($token, 'idem-enf-pause'), 'store_paused');
        $this->assertArrayNotHasKey('min_order_minor', $detail);
        $response = $this->complete($token, 'idem-enf-pause');
        $this->assertSame('نعود غداً صباحاً', $response->json('error.message'), 'رسالة التاجر القصيرة');
        $this->assertSame(0, $this->orders());
        $this->assertSame(0, CommercePaymentIntent::query()->withoutGlobalScopes()->count());

        // استئناف: الـCheckout نفسه (لم يُستهلك) يُتمّ بنجاح.
        $this->configure(['accepting_orders' => true], 1);
        $this->complete($token, 'idem-enf-pause')->assertCreated();
        $this->assertSame(1, $this->orders());
    }

    #[Test]
    public function a_scheduled_pause_blocks_until_its_resume_time_and_then_ends_by_itself(): void
    {
        $now = $this->mondayTenAm();
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $this->configure(['accepting_orders' => false, 'paused_until' => $now->addMinutes(5)->utc()->format('Y-m-d\TH:i:s\Z')]);

        $this->review($this->complete($token, 'idem-enf-sched'), 'store_paused');

        // الإيقاف المجدول ينتهي وحده (قبل انتهاء صلاحية السلة/Checkout).
        $this->travelTo($now->addMinutes(5)->addSecond());
        $this->complete($token, 'idem-enf-sched')->assertCreated();
        $this->assertSame(1, $this->orders());
    }

    // ═════════════════════════ 3) ساعات العمل ═════════════════════════

    #[Test]
    public function outside_the_opening_hours_a_block_policy_refuses_and_inside_them_or_with_accept_the_order_goes_through(): void
    {
        $this->mondayTenAm();
        $product = $this->product($this->tenant, $this->channel);
        $mondayEvening = [['weekday' => 1, 'opens_at' => '16:00', 'closes_at' => '22:00']];
        $mondayDay = [['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '17:00']];

        $this->configure(['opening_hours' => $mondayEvening, 'outside_hours_policy' => 'block']);
        $this->review($this->complete($this->readyCheckout($product, null), 'idem-enf-h1'), 'outside_opening_hours');
        $this->assertSame(0, $this->orders());

        $this->configure(['opening_hours' => $mondayDay], 1);
        $this->complete($this->readyCheckout($product, null), 'idem-enf-h2')->assertCreated();

        // سياسة accept: الساعات معلوماتية فقط.
        $this->configure(['opening_hours' => $mondayEvening, 'outside_hours_policy' => 'accept'], 2);
        $this->complete($this->readyCheckout($product, null), 'idem-enf-h3')->assertCreated();

        // لا ساعات + block = مفتوح 24/7.
        $this->configure(['opening_hours' => [], 'outside_hours_policy' => 'block'], 3);
        $this->complete($this->readyCheckout($product, null), 'idem-enf-h4')->assertCreated();
        $this->assertSame(3, $this->orders());
    }

    #[Test]
    public function the_opening_hours_follow_the_channel_timezone_not_the_server_clock(): void
    {
        $this->mondayTenAm(); // 10:00 الرياض = 02:00 نيويورك (الاثنين)
        $product = $this->product($this->tenant, $this->channel);
        $this->configure(['opening_hours' => [['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '17:00']], 'outside_hours_policy' => 'block']);

        // المنطقة الافتراضية (الرياض): مفتوح.
        $this->complete($this->readyCheckout($product, null), 'idem-enf-tz1')->assertCreated();

        app(TenantContext::class)->set($this->tenant->id);
        CommerceDeliveryScheduleSetting::create(['sales_channel_id' => $this->channel->id, 'timezone' => 'America/New_York']);
        app(TenantContext::class)->forget();
        $this->review($this->complete($this->readyCheckout($product, null), 'idem-enf-tz2'), 'outside_opening_hours');
    }

    // ═════════════════════════ 4) الحد الأدنى ═════════════════════════

    #[Test]
    public function a_cart_below_the_minimum_is_refused_with_the_shortfall_and_a_cart_at_the_minimum_passes(): void
    {
        $this->mondayTenAm();
        $product = $this->product($this->tenant, $this->channel); // 5000 هللة
        $this->configure(['min_order_minor' => 5001]);

        $detail = $this->review($this->complete($this->readyCheckout($product, null), 'idem-enf-min1'), 'below_minimum_order');
        $this->assertSame(5001, $detail['min_order_minor']);
        $this->assertSame(1, $detail['shortfall_minor']);
        $this->assertSame(0, $this->orders());

        $this->configure(['min_order_minor' => 5000], 1);
        $this->complete($this->readyCheckout($product, null), 'idem-enf-min2')->assertCreated();
        $this->assertSame(1, $this->orders());
    }

    #[Test]
    public function the_delivery_only_scope_exempts_pickup_while_all_applies_to_it(): void
    {
        $this->mondayTenAm();
        $product = $this->product($this->tenant, $this->channel);

        $this->configure(['min_order_minor' => 999999, 'min_order_scope' => 'delivery_only']);
        // readyCheckout يختار الاستلام (pickup): معفى.
        $this->complete($this->readyCheckout($product, null), 'idem-enf-scope1')->assertCreated();

        $this->configure(['min_order_scope' => 'all'], 1);
        $this->review($this->complete($this->readyCheckout($product, null), 'idem-enf-scope2'), 'below_minimum_order');
    }

    #[Test]
    public function a_pause_is_reported_before_the_minimum_when_both_apply(): void
    {
        $this->mondayTenAm();
        $this->configure(['accepting_orders' => false, 'min_order_minor' => 999999]);
        $this->review($this->complete($this->readyCheckout($this->product($this->tenant, $this->channel), null), 'idem-enf-order'), 'store_paused');
    }

    // ═════════════════════════ 5) الإعادة والعزل ═════════════════════════

    #[Test]
    public function a_replay_of_an_already_completed_checkout_is_not_affected_by_a_later_pause(): void
    {
        $this->mondayTenAm();
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $first = $this->complete($token, 'idem-enf-replay')->assertCreated();
        $orderId = $first->json('data.order.id');

        $this->configure(['accepting_orders' => false]);
        $again = $this->complete($token, 'idem-enf-replay');
        $this->assertContains($again->status(), [200, 201]);
        $this->assertSame($orderId, $again->json('data.order.id'));
        $this->assertSame(1, $this->orders());
    }

    #[Test]
    public function another_tenants_settings_never_affect_this_tenants_checkout(): void
    {
        $this->mondayTenAm();
        ['tenant' => $other] = $this->makeStore('enf-other.test', 'enf-other');
        $otherChannel = (string) \App\Models\SalesChannel::query()->withoutGlobalScopes()->where('tenant_id', $other->id)->where('type', 'web')->value('id');
        $this->openGate();
        DB::table('commerce_channel_operation_settings')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $other->id, 'sales_channel_id' => $otherChannel, 'acceptance_mode' => 'auto', 'version' => 1,
            'accepting_orders' => false, 'outside_hours_policy' => 'block', 'min_order_minor' => 99999999, 'min_order_scope' => 'all', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->complete($this->readyCheckout($this->product($this->tenant, $this->channel), null), 'idem-enf-iso')->assertCreated();
        $this->assertSame(1, CommerceOrder::query()->withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());
        $this->assertSame(['accepting' => true, 'reason' => null, 'message' => null, 'resumes_at' => null, 'min_order_minor' => null, 'min_order_scope' => 'all'], $this->ordering());
    }

    // ═════════════════════════ 6) كتلة ordering العامة ═════════════════════════

    #[Test]
    public function the_public_ordering_block_reports_pause_hours_and_minimum_without_internal_data(): void
    {
        $now = $this->mondayTenAm();
        $this->openGate();
        $this->assertSame(['accepting' => true, 'reason' => null, 'message' => null, 'resumes_at' => null, 'min_order_minor' => null, 'min_order_scope' => 'all'], $this->ordering());

        $until = $now->addHour()->utc()->format('Y-m-d\TH:i:s\Z');
        $this->configure(['accepting_orders' => false, 'paused_until' => $until, 'pause_message' => 'استراحة قصيرة', 'min_order_minor' => 15000, 'min_order_scope' => 'delivery_only']);
        $block = $this->ordering();
        $this->assertSame(['accepting' => false, 'reason' => 'paused', 'message' => 'استراحة قصيرة', 'resumes_at' => $until, 'min_order_minor' => 15000, 'min_order_scope' => 'delivery_only'], $block);

        $this->configure(['accepting_orders' => true, 'paused_until' => null, 'opening_hours' => [['weekday' => 1, 'opens_at' => '16:00', 'closes_at' => '22:00']], 'outside_hours_policy' => 'block'], 1);
        $this->assertSame('outside_hours', $this->ordering()['reason']);
        $this->assertNull($this->ordering()['message'], 'رسالة الإيقاف لا تُعرض لخارج الساعات');

        // لا حقول داخلية (قناة/مستأجر/مستخدم/نسخة) في الكتلة.
        $this->assertSame(['accepting', 'message', 'min_order_minor', 'min_order_scope', 'reason', 'resumes_at'], collect(array_keys($this->ordering()))->sort()->values()->all());
    }

    // ═════════════════════════ 7) الدالة النقية ═════════════════════════

    public static function states(): array
    {
        $utc = fn (string $s) => CarbonImmutable::parse($s, 'UTC');
        $hours = [['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '17:00'], ['weekday' => 1, 'opens_at' => '20:00', 'closes_at' => '24:00'], ['weekday' => 2, 'opens_at' => '00:00', 'closes_at' => '01:00']];
        $base = ['accepting' => true, 'paused_until' => null, 'pause_message' => null, 'policy' => 'block', 'hours' => $hours, 'min_order_minor' => null, 'min_order_scope' => 'all'];

        return [
            'open inside a period (Mon 10:00 Riyadh)' => [$base, $utc('2026-11-09 07:00'), 'Asia/Riyadh', true, null],
            'start is inclusive (Mon 09:00)' => [$base, $utc('2026-11-09 06:00'), 'Asia/Riyadh', true, null],
            'end is exclusive (Mon 17:00)' => [$base, $utc('2026-11-09 14:00'), 'Asia/Riyadh', false, 'outside_hours'],
            'gap between periods' => [$base, $utc('2026-11-09 16:30'), 'Asia/Riyadh', false, 'outside_hours'],
            'until 24:00 (Mon 23:59)' => [$base, $utc('2026-11-09 20:59'), 'Asia/Riyadh', true, null],
            'a day with no periods is closed (Wed)' => [$base, $utc('2026-11-11 07:00'), 'Asia/Riyadh', false, 'outside_hours'],
            'Sunday before the week (weekday 0 closed)' => [$base, $utc('2026-11-08 07:00'), 'Asia/Riyadh', false, 'outside_hours'],
            'timezone moves the weekday (NY Sun 23:00 = Mon 07:00 Riyadh)' => [$base, $utc('2026-11-09 04:00'), 'America/New_York', false, 'outside_hours'],
            'invalid timezone falls back to Riyadh' => [$base, $utc('2026-11-09 07:00'), 'Not/AZone', true, null],
            'no hours means always open' => [['hours' => []] + $base, $utc('2026-11-11 07:00'), 'Asia/Riyadh', true, null],
            'accept policy never blocks on hours' => [['policy' => 'accept'] + $base, $utc('2026-11-11 07:00'), 'Asia/Riyadh', true, null],
            'paused wins over open hours' => [['accepting' => false] + $base, $utc('2026-11-09 07:00'), 'Asia/Riyadh', false, 'paused'],
            'paused with a future resume' => [['accepting' => false, 'paused_until' => '2026-11-09T08:00:00Z'] + $base, $utc('2026-11-09 07:00'), 'Asia/Riyadh', false, 'paused'],
            'a resume time that equals now has ended' => [['accepting' => false, 'paused_until' => '2026-11-09T07:00:00Z'] + $base, $utc('2026-11-09 07:00'), 'Asia/Riyadh', true, null],
            'a resume time in the past has ended' => [['accepting' => false, 'paused_until' => '2026-11-09T06:00:00Z'] + $base, $utc('2026-11-09 07:00'), 'Asia/Riyadh', true, null],
        ];
    }

    #[Test]
    #[DataProvider('states')]
    public function the_pure_state_function_matches_the_contract(array $snapshot, CarbonImmutable $now, string $timezone, bool $accepting, ?string $reason): void
    {
        $state = CommerceChannelIntake::state($snapshot, $now, $timezone);
        $this->assertSame($accepting, $state['accepting']);
        $this->assertSame($reason, $state['reason']);
    }

    #[Test]
    public function the_minimum_shortfall_is_exact_and_scoped(): void
    {
        $s = ['min_order_minor' => 10000, 'min_order_scope' => 'all'];
        $this->assertNull(CommerceChannelIntake::minimumShortfall(['min_order_minor' => null] + $s, 1, 'standard'));
        $this->assertSame(1, CommerceChannelIntake::minimumShortfall($s, 9999, 'standard'));
        $this->assertNull(CommerceChannelIntake::minimumShortfall($s, 10000, 'standard'));
        $this->assertSame(10000, CommerceChannelIntake::minimumShortfall($s, 0, 'pickup'));
        $this->assertNull(CommerceChannelIntake::minimumShortfall(['min_order_scope' => 'delivery_only'] + $s, 1, 'pickup'));
        $this->assertSame(9999, CommerceChannelIntake::minimumShortfall(['min_order_scope' => 'delivery_only'] + $s, 1, 'standard'));
    }

    #[Test]
    public function the_only_readers_of_the_settings_and_hours_tables_remain_the_model_and_the_service(): void
    {
        $this->assertSame([], []);
        $this->assertTrue(class_exists(CommerceChannelOperationSetting::class));
        // الحارس والصنف النقي لا يقرآن الجدول مباشرةً (يمرّان بـ`intakeSnapshot`): يحرسه اختبار الحصر في اختباري H1-3/H4-3.
        foreach (['app/Services/Commerce/CommerceChannelIntakeGuard.php', 'app/Support/CommerceChannelIntake.php', 'app/Services/Commerce/CommerceIntakeCheck.php'] as $file) {
            $source = (string) file_get_contents(base_path($file));
            $this->assertStringNotContainsString('commerce_channel_operation_settings', $source);
            $this->assertStringNotContainsString('commerce_channel_opening_hours', $source);
            $this->assertStringNotContainsString('CommerceChannelOperationSetting::query', $source);
        }
    }
}
