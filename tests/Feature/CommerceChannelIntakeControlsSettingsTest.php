<?php

namespace Tests\Feature;

use App\Models\CommerceChannelOperationSetting;
use App\Models\CommerceChannelOpeningHour;
use App\Models\CommerceOrder;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H4-3 (D-OPS-7/8، D-H4-01..05) — تحكّمات استقبال طلبات القناة: إيقاف يدوي، ساعات عمل أسبوعية، سياسة ما خارج الساعات، حدّ أدنى للطلب.
 * على SQLite وPostgreSQL (القيود وتزامن الأقفال: `CommerceChannelOperationsSettingsPostgresTest`).
 *
 * يُثبت: الافتراضيات = السلوك الحالي؛ البوابة D-H4-03 المغلقة ترفض الانتقال إلى حالة حجب وتسمح بالتخزين غير الحاجب والرجوع للافتراضي؛ التحقق من القيم؛
 * الساعات تُستبدل كمجموعة بالنسخة نفسها وبتدقيق؛ العزل؛ **ولا إنفاذ** (Checkout لا يتأثر بأي قيمة مخزَّنة، فتحت البوابة أم لا).
 */
class CommerceChannelIntakeControlsSettingsTest extends TestCase
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
    }

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
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'مستخدم '.$role, 'email' => $role.'-'.Str::random(6).'@intake.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function url(?string $channelId = null): string
    {
        return '/api/commerce/channels/'.($channelId ?? $this->channel->id).'/operations-settings';
    }

    private function fetch(?string $channelId = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson($this->url($channelId));
    }

    private function save(array $body, ?string $channelId = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->putJson($this->url($channelId), $body);
    }

    private function openGate(): void
    {
        config(['commerce.channel_intake_controls_enabled' => true]);
    }

    private function version(): int
    {
        return (int) $this->fetch()->json('data.version');
    }

    private function rows(): int
    {
        return CommerceChannelOperationSetting::query()->withoutGlobalScopes()->count();
    }

    private function hourRows(): int
    {
        return CommerceChannelOpeningHour::query()->withoutGlobalScopes()->count();
    }

    private function auditKeys(): array
    {
        return SalesChannelSettingEvent::query()->withoutGlobalScopes()->get()->flatMap(fn ($e) => array_keys($e->changes))->unique()->sort()->values()->all();
    }

    private function future(string $modifier = '+2 hours'): string
    {
        return CarbonImmutable::now()->modify($modifier)->utc()->format('Y-m-d\TH:i:s\Z');
    }

    // ═════════════════════════ 1) الافتراضيات ═════════════════════════

    #[Test]
    public function a_channel_without_a_row_reads_open_always_accept_and_no_minimum_and_reading_writes_nothing(): void
    {
        $this->fetch()->assertOk()
            ->assertJsonPath('data.accepting_orders', true)
            ->assertJsonPath('data.paused_until', null)
            ->assertJsonPath('data.pause_message', null)
            ->assertJsonPath('data.outside_hours_policy', 'accept')
            ->assertJsonPath('data.opening_hours', [])
            ->assertJsonPath('data.min_order_minor', null)
            ->assertJsonPath('data.min_order_scope', 'all')
            ->assertJsonPath('data.intake_controls_deployment_enabled', false)
            ->assertJsonPath('data.version', 0);

        $this->assertSame(0, $this->rows());
        $this->assertSame(0, $this->hourRows());
        $this->assertSame(0, SalesChannelSettingEvent::query()->withoutGlobalScopes()->count());
    }

    #[Test]
    public function a_put_equal_to_the_defaults_writes_nothing(): void
    {
        $this->save(['expected_version' => 0, 'accepting_orders' => true, 'paused_until' => null, 'outside_hours_policy' => 'accept',
            'min_order_minor' => null, 'min_order_scope' => 'all', 'opening_hours' => [], 'pause_message' => null])
            ->assertOk()->assertJsonPath('data.version', 0)->assertJsonPath('data.configured', false);
        $this->assertSame(0, $this->rows());
        $this->assertSame(0, $this->hourRows());
    }

    // ═════════════════════════ 2) البوابة D-H4-03 ═════════════════════════

    #[Test]
    public function a_closed_gate_refuses_every_transition_into_a_blocking_state_without_writing(): void
    {
        foreach ([
            ['accepting_orders' => false],
            ['outside_hours_policy' => 'block'],
            ['min_order_minor' => 5000],
        ] as $change) {
            $this->save(['expected_version' => 0] + $change)->assertStatus(409)->assertJsonPath('reason', 'intake_controls_deployment_disabled');
        }
        $this->assertSame(0, $this->rows());
        $this->assertSame(0, SalesChannelSettingEvent::query()->withoutGlobalScopes()->count());
    }

    #[Test]
    public function a_closed_gate_still_stores_non_blocking_values_hours_and_message_and_allows_returning_to_defaults(): void
    {
        $hours = [['weekday' => 0, 'opens_at' => '09:00', 'closes_at' => '17:00']];
        $this->save(['expected_version' => 0, 'opening_hours' => $hours, 'pause_message' => 'نعود قريباً', 'min_order_scope' => 'delivery_only'])
            ->assertOk()->assertJsonPath('data.version', 1)->assertJsonPath('data.opening_hours', $hours)->assertJsonPath('data.min_order_scope', 'delivery_only');

        // مفتوحة مؤقتاً لتخزين حالة حجب، ثم تُغلق: المخزَّن يبقى، والإبقاء عليه والرجوع للافتراضي مسموحان.
        $this->openGate();
        $this->save(['expected_version' => 1, 'accepting_orders' => false, 'outside_hours_policy' => 'block', 'min_order_minor' => 5000])->assertOk();
        config(['commerce.channel_intake_controls_enabled' => false]);

        $this->fetch()->assertJsonPath('data.accepting_orders', false)->assertJsonPath('data.intake_controls_deployment_enabled', false);
        $this->save(['expected_version' => 2, 'min_order_minor' => 7000, 'pause_message' => 'تحديث'])->assertOk()->assertJsonPath('data.min_order_minor', 7000);
        $this->save(['expected_version' => 3, 'accepting_orders' => true, 'outside_hours_policy' => 'accept', 'min_order_minor' => null])
            ->assertOk()->assertJsonPath('data.accepting_orders', true)->assertJsonPath('data.min_order_minor', null);
    }

    // ═════════════════════════ 3) الإيقاف اليدوي ═════════════════════════

    #[Test]
    public function pausing_with_an_automatic_resume_and_a_message_is_stored_and_audited_with_prefixed_keys(): void
    {
        $this->openGate();
        $until = $this->future();
        $this->save(['expected_version' => 0, 'accepting_orders' => false, 'paused_until' => $until, 'pause_message' => '  نعود الساعة 5 مساءً  '])
            ->assertOk()
            ->assertJsonPath('data.accepting_orders', false)
            ->assertJsonPath('data.paused_until', $until)
            ->assertJsonPath('data.pause_message', 'نعود الساعة 5 مساءً')
            ->assertJsonPath('data.version', 1);

        $this->assertSame(['operations.accepting_orders', 'operations.pause_message', 'operations.paused_until'], $this->auditKeys());
        $event = SalesChannelSettingEvent::query()->withoutGlobalScopes()->first();
        $this->assertSame(['from' => true, 'to' => false], $event->changes['operations.accepting_orders']);

        // استئناف: الطلبات مقبولة ومسح موعد الاستئناف في الطلب نفسه.
        $this->save(['expected_version' => 1, 'accepting_orders' => true, 'paused_until' => null])->assertOk()->assertJsonPath('data.accepting_orders', true)->assertJsonPath('data.version', 2);
    }

    #[Test]
    public function a_resume_time_requires_a_pause_and_must_be_in_the_future(): void
    {
        $this->openGate();
        $this->save(['expected_version' => 0, 'paused_until' => $this->future()])->assertStatus(422)->assertJsonPath('reason', 'paused_until_requires_pause');
        $this->save(['expected_version' => 0, 'accepting_orders' => false, 'paused_until' => $this->future('-1 hour')])->assertStatus(422)->assertJsonPath('reason', 'paused_until_in_past');
        $this->save(['expected_version' => 0, 'accepting_orders' => false, 'paused_until' => 'not a date'])->assertStatus(422)->assertJsonPath('reason', 'paused_until_invalid');
        $this->save(['expected_version' => 0, 'accepting_orders' => true, 'paused_until' => $this->future()])->assertStatus(422)->assertJsonPath('reason', 'paused_until_requires_pause');
        $this->assertSame(0, $this->rows());
    }

    #[Test]
    public function a_stored_resume_time_that_has_since_passed_does_not_block_unrelated_edits(): void
    {
        $this->openGate();
        $this->save(['expected_version' => 0, 'accepting_orders' => false, 'paused_until' => $this->future('+1 hour')])->assertOk();
        $this->travelTo(CarbonImmutable::now()->addHours(3));
        $this->save(['expected_version' => 1, 'pause_message' => 'ما زلنا مشغولين'])->assertOk()->assertJsonPath('data.version', 2);
        $this->travelBack();
    }

    #[Test]
    public function the_pause_message_is_plain_short_text_and_empty_means_none(): void
    {
        foreach (['<b>x</b>', 'a > b', str_repeat('ا', 201), "bad\x07char"] as $bad) {
            $this->save(['expected_version' => 0, 'pause_message' => $bad])->assertStatus(422);
        }
        $this->assertSame(0, $this->rows());
        $this->save(['expected_version' => 0, 'pause_message' => str_repeat('ا', 200)])->assertOk();
        $this->save(['expected_version' => 1, 'pause_message' => '   '])->assertOk()->assertJsonPath('data.pause_message', null);
    }

    // ═════════════════════════ 4) ساعات العمل ═════════════════════════

    #[Test]
    public function opening_hours_are_replaced_as_a_set_sorted_audited_and_cleared_back_to_always_open(): void
    {
        $this->save(['expected_version' => 0, 'opening_hours' => [
            ['weekday' => 1, 'opens_at' => '16:00', 'closes_at' => '22:00'],
            ['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '13:00'],
            ['weekday' => 0, 'opens_at' => '00:00', 'closes_at' => '24:00'],
        ]])->assertOk()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.opening_hours', [
                ['weekday' => 0, 'opens_at' => '00:00', 'closes_at' => '24:00'],
                ['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '13:00'],
                ['weekday' => 1, 'opens_at' => '16:00', 'closes_at' => '22:00'],
            ]);
        $this->assertSame(3, $this->hourRows());
        $this->assertSame(['operations.opening_hours'], $this->auditKeys());

        // الاستبدال لا يُراكم.
        $this->save(['expected_version' => 1, 'opening_hours' => [['weekday' => 6, 'opens_at' => '10:00', 'closes_at' => '14:00']]])->assertOk()->assertJsonPath('data.version', 2);
        $this->assertSame(1, $this->hourRows());

        // نفس المجموعة (بترتيب مختلف/بعد الفرز) = لا تغيير ولا نسخة.
        $this->save(['expected_version' => 2, 'opening_hours' => [['weekday' => 6, 'opens_at' => '10:00', 'closes_at' => '14:00']]])->assertOk()->assertJsonPath('data.version', 2);

        // مسح = بلا ساعات = 24/7.
        $this->save(['expected_version' => 2, 'opening_hours' => []])->assertOk()->assertJsonPath('data.opening_hours', [])->assertJsonPath('data.version', 3);
        $this->assertSame(0, $this->hourRows());
        $this->save(['expected_version' => 3, 'opening_hours' => null])->assertOk()->assertJsonPath('data.version', 3);
    }

    public static function invalidHours(): array
    {
        $p = fn (array $o = []) => array_merge(['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '17:00'], $o);

        return [
            'weekday 7' => [[$p(['weekday' => 7])]],
            'weekday -1' => [[$p(['weekday' => -1])]],
            'weekday string' => [[$p(['weekday' => '1'])]],
            'opens 24:00' => [[$p(['opens_at' => '24:00'])]],
            'closes 24:01' => [[$p(['closes_at' => '24:01'])]],
            'bad format' => [[$p(['opens_at' => '9:00'])]],
            'seconds' => [[$p(['opens_at' => '09:00:00'])]],
            'opens == closes' => [[$p(['opens_at' => '10:00', 'closes_at' => '10:00'])]],
            'opens after closes (overnight not supported)' => [[$p(['opens_at' => '22:00', 'closes_at' => '02:00'])]],
            'overlap' => [[$p(), $p(['opens_at' => '16:00', 'closes_at' => '20:00'])]],
            'duplicate' => [[$p(), $p()]],
            'four periods in a day' => [[
                $p(['opens_at' => '01:00', 'closes_at' => '02:00']), $p(['opens_at' => '03:00', 'closes_at' => '04:00']),
                $p(['opens_at' => '05:00', 'closes_at' => '06:00']), $p(['opens_at' => '07:00', 'closes_at' => '08:00']),
            ]],
            'unknown key' => [[$p(['note' => 'x'])]],
            'missing key' => [[['weekday' => 1, 'opens_at' => '09:00']]],
            'not a list of objects' => [['09:00-17:00']],
            'object instead of list' => [['a' => $p()]],
        ];
    }

    #[Test]
    #[DataProvider('invalidHours')]
    public function invalid_opening_hours_are_rejected_without_any_write(array $hours): void
    {
        $this->save(['expected_version' => 0, 'opening_hours' => $hours])->assertStatus(422);
        $this->assertSame(0, $this->rows());
        $this->assertSame(0, $this->hourRows());
    }

    #[Test]
    public function more_than_twenty_one_periods_is_rejected(): void
    {
        $periods = [];
        for ($d = 0; $d < 7; $d++) {
            foreach ([['01:00', '02:00'], ['03:00', '04:00'], ['05:00', '06:00'], ['07:00', '08:00']] as [$o, $c]) {
                $periods[] = ['weekday' => $d, 'opens_at' => $o, 'closes_at' => $c];
            }
        }
        $this->save(['expected_version' => 0, 'opening_hours' => $periods])->assertStatus(422);
        $this->assertSame(0, $this->hourRows());
    }

    // ═════════════════════════ 5) الحد الأدنى والسياسة ═════════════════════════

    #[Test]
    public function the_minimum_order_and_its_scope_are_validated_stored_in_minor_units_and_clearable(): void
    {
        $this->openGate();
        foreach ([0, -5, 100000000001, 'abc', true, 12.5] as $bad) {
            $this->save(['expected_version' => 0, 'min_order_minor' => $bad])->assertStatus(422);
        }
        $this->save(['expected_version' => 0, 'min_order_scope' => 'pickup_only'])->assertStatus(422);
        $this->save(['expected_version' => 0, 'outside_hours_policy' => 'maybe'])->assertStatus(422);
        $this->assertSame(0, $this->rows());

        $this->save(['expected_version' => 0, 'min_order_minor' => 15000, 'min_order_scope' => 'delivery_only', 'outside_hours_policy' => 'block'])
            ->assertOk()->assertJsonPath('data.min_order_minor', 15000)->assertJsonPath('data.min_order_scope', 'delivery_only')->assertJsonPath('data.outside_hours_policy', 'block');
        $this->assertSame(15000, (int) \Illuminate\Support\Facades\DB::table('commerce_channel_operation_settings')->value('min_order_minor'));
        $this->save(['expected_version' => 1, 'min_order_minor' => null])->assertOk()->assertJsonPath('data.min_order_minor', null);
    }

    #[Test]
    public function the_stale_version_protection_and_missing_expected_version_still_apply_to_the_new_keys(): void
    {
        $this->save(['pause_message' => 'x'])->assertStatus(428)->assertJsonPath('reason', 'expected_version_required');
        $this->save(['expected_version' => 0, 'pause_message' => 'a'])->assertOk();
        $this->save(['expected_version' => 0, 'pause_message' => 'b'])->assertStatus(409)->assertJsonPath('reason', 'settings_version_conflict')->assertJsonPath('current_version', 1);
        $this->assertSame('a', CommerceChannelOperationSetting::query()->withoutGlobalScopes()->value('pause_message'));
    }

    // ═════════════════════════ 6) الصلاحيات والعزل ═════════════════════════

    #[Test]
    public function the_new_keys_need_the_same_dedicated_permission(): void
    {
        foreach (['accountant', 'staff'] as $role) {
            $this->save(['expected_version' => 0, 'pause_message' => 'x'], null, $this->tokenFor($this->tenant, $role))->assertForbidden();
        }
        $this->assertSame(0, $this->rows());
    }

    #[Test]
    public function a_tenant_cannot_touch_another_tenants_hours_and_hours_are_per_channel(): void
    {
        ['tenant' => $other] = $this->makeStore('intake-iso.test', 'intake-iso');
        $this->enableApplications($other);
        $otherToken = $this->tokenFor($other, 'owner');
        $hours = [['weekday' => 2, 'opens_at' => '08:00', 'closes_at' => '12:00']];

        $this->save(['expected_version' => 0, 'opening_hours' => $hours], null, $otherToken)->assertNotFound();
        $this->assertSame(0, $this->hourRows());

        $this->save(['expected_version' => 0, 'opening_hours' => $hours])->assertOk();
        $otherChannel = (string) SalesChannel::query()->withoutGlobalScopes()->where('tenant_id', $other->id)->where('type', SalesChannel::TYPE_WEB)->value('id');
        $this->fetch($otherChannel, $otherToken)->assertOk()->assertJsonPath('data.opening_hours', []);

        app(TenantContext::class)->set($this->tenant->id);
        $second = SalesChannel::create(['slug' => 'web-two-h', 'name' => 'Second', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $this->fetch($second->id)->assertOk()->assertJsonPath('data.opening_hours', []);
        $this->assertSame(1, $this->hourRows());
        $this->assertSame($this->tenant->id, CommerceChannelOpeningHour::query()->withoutGlobalScopes()->value('tenant_id'));
    }

    // ═════════════════════════ 7) لا إنفاذ ═════════════════════════

    #[Test]
    public function stored_blocking_values_change_nothing_in_checkout_while_the_deployment_gate_is_closed(): void
    {
        // (H4-4) الإنفاذ مع البوابة المفتوحة مغطّى في `CommerceChannelIntakeEnforcementTest`؛ هنا: قيم حجب مخزَّنة (حين كانت مفتوحة) ثم أُغلقت ⇒ لا أثر.
        $this->openGate();
        $this->save(['expected_version' => 0, 'accepting_orders' => false, 'outside_hours_policy' => 'block', 'min_order_minor' => 99999999,
            'opening_hours' => [['weekday' => (int) CarbonImmutable::now('Asia/Riyadh')->addDay()->dayOfWeek, 'opens_at' => '00:00', 'closes_at' => '01:00']]])->assertOk();
        config(['commerce.channel_intake_controls_enabled' => false]);

        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $orderId = (string) $this->complete($token, 'idem-intake-no-enforcement')->assertCreated()->json('data.order.id');
        $this->assertSame(CommerceOrder::STATUS_CONFIRMED, CommerceOrder::query()->findOrFail($orderId)->status);
    }

    #[Test]
    public function only_the_model_and_the_service_reference_the_new_table_and_the_model_is_company_wide_and_unfillable(): void
    {
        $allowed = ['app/Models/CommerceChannelOpeningHour.php', 'app/Services/Commerce/CommerceChannelOperationsSettingsService.php'];
        $offenders = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $relative = str_replace(base_path().'/', '', $file->getPathname());
            $source = (string) file_get_contents($file->getPathname());
            if (! in_array($relative, $allowed, true) && (str_contains($source, 'commerce_channel_opening_hours') || str_contains($source, 'CommerceChannelOpeningHour'))) {
                $offenders[] = $relative;
            }
        }
        $this->assertSame([], $offenders);
        $this->assertInstanceOf(CompanyWide::class, new CommerceChannelOpeningHour);
        $this->assertSame([], (new CommerceChannelOpeningHour)->getFillable());
    }

    #[Test]
    public function the_migration_refuses_to_roll_back_while_intake_controls_are_configured(): void
    {
        $this->save(['expected_version' => 0, 'opening_hours' => [['weekday' => 0, 'opens_at' => '09:00', 'closes_at' => '17:00']]])->assertOk();
        $migration = require base_path('database/migrations/2027_01_05_010000_extend_commerce_channel_operation_settings_for_intake_controls.php');
        $this->expectException(\RuntimeException::class);
        $migration->down();
    }
}
