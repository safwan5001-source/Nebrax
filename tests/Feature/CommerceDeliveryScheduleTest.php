<?php

namespace Tests\Feature;

use App\Models\CommerceDeliveryBlockedDate;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceDeliverySlot;
use App\Models\CommerceShippingZone;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H7a / ADR-19 — سياسة جدولة التسليم: الإدارة (إعداد/نوافذ/تواريخ محجوبة)، التوفّر المشتق
 * (مهلة التجهيز، إغلاق اليوم، التواريخ المحجوبة، الأيام، المنطقة، المنطقة الزمنية)، والقراءة العامة.
 *
 * "الآن" يُمرَّر صراحةً للخدمة: الأربعاء 2026-10-07 10:00 بتوقيت الرياض = 07:00 UTC.
 *
 * تشغيل: php artisan test --filter=CommerceDeliveryScheduleTest
 */
class CommerceDeliveryScheduleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function now(): CarbonImmutable
    {
        return CarbonImmutable::parse('2026-10-07 07:00:00', 'UTC');
    }

    /** @return array{tenant_id: string, token: string, storefront: Storefront, channel_id: string} */
    private function store(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $auth + ['storefront' => $storefront, 'channel_id' => $channel->id];
    }

    private function url(array $store, string $suffix = ''): string
    {
        return "/api/commerce/workspace/storefronts/{$store['storefront']->id}/delivery-schedule{$suffix}";
    }

    /** يهيّئ سياسة وخدمة بسياق المستأجر مباشرةً (لاختبار التوفّر المشتق). */
    private function configure(array $store, array $settings = [], array $slots = [], array $blocked = []): CommerceDeliveryScheduleService
    {
        app(TenantContext::class)->set($store['tenant_id']);
        $service = app(CommerceDeliveryScheduleService::class);
        $service->saveSettings($store['channel_id'], $settings + ['is_enabled' => true]);
        $service->replaceSlots($store['channel_id'], $slots);
        $service->replaceBlockedDates($store['channel_id'], $blocked);

        return $service;
    }

    private function slot(string $label, string $start, string $end, array $extra = []): array
    {
        return array_merge(['method' => 'delivery', 'label' => $label, 'start_time' => $start, 'end_time' => $end], $extra);
    }

    private function threeSlots(): array
    {
        return [
            $this->slot('صباحاً', '09:00', '12:00'),
            $this->slot('عصراً', '14:00', '18:00'),
            $this->slot('مساءً', '19:00', '22:00'),
        ];
    }

    private function labels(array $options, string $date): array
    {
        foreach ($options['dates'] as $row) {
            if ($row['date'] === $date) {
                return array_column($row['slots'], 'label');
            }
        }

        return [];
    }

    // ── التوفّر المشتق ──────────────────────────────────────────────────

    /** @test */
    public function an_unconfigured_or_disabled_channel_has_no_scheduling(): void
    {
        $store = $this->store('ds-off');
        app(TenantContext::class)->set($store['tenant_id']);
        $service = app(CommerceDeliveryScheduleService::class);

        $none = $service->options($store['channel_id'], 'delivery', null, null, $this->now());
        $this->assertFalse($none['enabled']);
        $this->assertSame([], $none['dates']);

        $service->saveSettings($store['channel_id'], ['is_enabled' => false]);
        $service->replaceSlots($store['channel_id'], $this->threeSlots());
        $this->assertFalse($service->options($store['channel_id'], 'delivery', null, null, $this->now())['enabled']);

        // طريقة غير معروفة ⇒ لا جدولة أبداً
        $service->saveSettings($store['channel_id'], ['is_enabled' => true]);
        $this->assertFalse($service->options($store['channel_id'], 'teleport', null, null, $this->now())['enabled']);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function same_day_windows_that_already_started_are_not_offered(): void
    {
        $store = $this->store('ds-today');
        $service = $this->configure($store, [], $this->threeSlots());

        $options = $service->options($store['channel_id'], 'delivery', null, null, $this->now());

        $this->assertTrue($options['enabled']);
        $this->assertSame('Asia/Riyadh', $options['timezone']);
        $this->assertSame(['عصراً', 'مساءً'], $this->labels($options, '2026-10-07')); // 09:00 بدأت قبل 10:00
        $this->assertSame(['صباحاً', 'عصراً', 'مساءً'], $this->labels($options, '2026-10-08'));
        $this->assertSame('2026-10-07', $options['earliest']['date']);
        $this->assertCount(31, $options['dates']); // اليوم + 30
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function earliest_is_the_soonest_start_not_the_display_order(): void
    {
        $store = $this->store('ds-earliest');
        // المساءً مُرسَلة أولاً فيأخذ sort_order أدنى؛ العصر يبدأ أبكر
        $service = $this->configure($store, [], [
            $this->slot('مساءً', '19:00', '22:00'),
            $this->slot('عصراً', '14:00', '18:00'),
            $this->slot('تعادل', '14:00', '15:00'),
        ]);

        $options = $service->options($store['channel_id'], 'delivery', null, null, $this->now());

        $byLabel = collect($options['dates'][0]['slots'])->keyBy('label');
        $this->assertSame('2026-10-07', $options['earliest']['date']);
        $this->assertSame($byLabel['عصراً']['id'], $options['earliest']['slot_id']); // 14:00 أبكر من 19:00، والتعادل للأسبق ترتيباً
        $this->assertSame(['مساءً', 'عصراً', 'تعادل'], array_column($options['dates'][0]['slots'], 'label')); // العرض بترتيب الإدارة
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function lead_time_is_measured_to_the_window_start(): void
    {
        $store = $this->store('ds-lead');
        $service = $this->configure($store, ['lead_time_minutes' => 240], $this->threeSlots());

        // 10:00 + 4h = 14:00 ⇒ نافذة 14:00 مقبولة (>=)
        $this->assertSame(['عصراً', 'مساءً'], $this->labels($service->options($store['channel_id'], 'delivery', null, null, $this->now()), '2026-10-07'));

        $service->saveSettings($store['channel_id'], ['lead_time_minutes' => 300]);
        $this->assertSame(['مساءً'], $this->labels($service->options($store['channel_id'], 'delivery', null, null, $this->now()), '2026-10-07'));

        $service->saveSettings($store['channel_id'], ['lead_time_minutes' => 60 * 24]);
        $options = $service->options($store['channel_id'], 'delivery', null, null, $this->now());
        $this->assertSame([], $this->labels($options, '2026-10-07'));
        $this->assertSame(['عصراً', 'مساءً'], $this->labels($options, '2026-10-08')); // 10-08 10:00 فأكثر
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_daily_cutoff_closes_today_once_passed(): void
    {
        $store = $this->store('ds-cutoff');
        $service = $this->configure($store, ['cutoff_time' => '09:30'], $this->threeSlots());

        $closed = $service->options($store['channel_id'], 'delivery', null, null, $this->now());
        $this->assertSame([], $this->labels($closed, '2026-10-07'));
        $this->assertSame('2026-10-08', $closed['earliest']['date']);

        $service->saveSettings($store['channel_id'], ['cutoff_time' => '10:30']);
        $open = $service->options($store['channel_id'], 'delivery', null, null, $this->now());
        $this->assertSame(['عصراً', 'مساءً'], $this->labels($open, '2026-10-07'));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function blocked_dates_apply_to_all_methods_or_just_one(): void
    {
        $store = $this->store('ds-blocked');
        $slots = array_merge($this->threeSlots(), [$this->slot('استلام', '10:00', '20:00', ['method' => 'pickup'])]);
        $service = $this->configure($store, [], $slots, [
            ['date' => '2026-10-08', 'method' => 'all', 'reason' => 'إجازة'],
            ['date' => '2026-10-09', 'method' => 'pickup'],
        ]);

        $delivery = $service->options($store['channel_id'], 'delivery', null, null, $this->now());
        $pickup = $service->options($store['channel_id'], 'pickup', null, null, $this->now());

        $this->assertSame([], $this->labels($delivery, '2026-10-08'));
        $this->assertNotSame([], $this->labels($delivery, '2026-10-09')); // محجوب للاستلام فقط
        $this->assertSame([], $this->labels($pickup, '2026-10-08'));
        $this->assertSame([], $this->labels($pickup, '2026-10-09'));
        $this->assertSame(['استلام'], $this->labels($pickup, '2026-10-10'));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function weekday_masks_and_the_booking_horizon_are_respected(): void
    {
        $store = $this->store('ds-days');
        // الجمعة (5) فقط
        $service = $this->configure($store, ['max_days_ahead' => 10], [$this->slot('الجمعة', '09:00', '12:00', ['weekdays' => [5]])]);

        $options = $service->options($store['channel_id'], 'delivery', null, null, $this->now());

        // 2026-10-07 أربعاء ⇒ الجمعتان 09 و16 فقط، وآخر يوم 17 (7 + 10)
        $this->assertSame(['2026-10-09', '2026-10-16'], array_column($options['dates'], 'date'));
        $slots = $service->slots($store['channel_id']);
        $this->assertSame([5], $slots[0]['weekdays']);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function zone_restricted_windows_follow_the_destination_through_the_shipping_matcher(): void
    {
        $store = $this->store('ds-zone');
        app(TenantContext::class)->set($store['tenant_id']);
        $zone = CommerceShippingZone::create(['name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500]);
        $region = CommerceShippingZone::create(['name' => 'الشرقية', 'match_type' => 'region', 'match_value' => 'الشرقية', 'rate_amount_minor' => 3000]);
        app(TenantContext::class)->forget();

        $service = $this->configure($store, [], [
            $this->slot('عام', '19:00', '22:00'),
            $this->slot('الدمام فقط', '20:00', '22:00', ['shipping_zone_id' => $zone->id]),
            $this->slot('الشرقية فقط', '21:00', '22:00', ['shipping_zone_id' => $region->id]),
            $this->slot('استلام', '19:00', '22:00', ['method' => 'pickup']),
        ]);
        $names = fn (?string $city, ?string $reg, string $method = 'delivery') => $this->labels($service->options($store['channel_id'], $method, $city, $reg, $this->now()), '2026-10-08');

        $this->assertSame(['عام', 'الدمام فقط'], $names('الدمام', null));
        $this->assertSame(['عام', 'الدمام فقط'], $names('الدمام', 'الشرقية')); // المدينة قبل المنطقة
        $this->assertSame(['عام', 'الشرقية فقط'], $names('الخبر', 'الشرقية'));
        $this->assertSame(['عام'], $names('الرياض', null));
        $this->assertSame(['عام'], $names(null, null));
        $this->assertSame(['استلام'], $names('الدمام', null, 'pickup')); // الاستلام لا يتأثر بالوجهة
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function dates_are_computed_in_the_policy_timezone_not_the_clients(): void
    {
        $store = $this->store('ds-tz');
        $late = [$this->slot('متأخر', '23:00', '23:59')];
        $service = $this->configure($store, ['timezone' => 'UTC'], $late);
        $instant = CarbonImmutable::parse('2026-10-06 22:30:00', 'UTC'); // = 2026-10-07 01:30 الرياض

        $utc = $service->options($store['channel_id'], 'delivery', null, null, $instant);
        $this->assertSame('UTC', $utc['timezone']);
        $this->assertSame('2026-10-06', $utc['earliest']['date']); // 23:00 UTC ما زالت قادمة

        $service->saveSettings($store['channel_id'], ['timezone' => null]); // ⇒ منطقة المستأجر
        $riyadh = $service->options($store['channel_id'], 'delivery', null, null, $instant);
        $this->assertSame('Asia/Riyadh', $riyadh['timezone']);
        $this->assertSame('2026-10-07', $riyadh['earliest']['date']);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_window_inside_the_spring_forward_gap_is_not_offered_that_day(): void
    {
        $store = $this->store('ds-dst');
        // 2027-03-14 02:30 غير موجودة في نيويورك (02:00 → 03:00)
        $service = $this->configure($store, ['timezone' => 'America/New_York', 'max_days_ahead' => 3], [
            $this->slot('ليلاً', '02:30', '03:30'),
        ]);
        $instant = CarbonImmutable::parse('2027-03-13 12:00:00', 'UTC');

        $options = $service->options($store['channel_id'], 'delivery', null, null, $instant);

        $dates = array_column($options['dates'], 'date');
        $this->assertNotContains('2027-03-14', $dates);
        $this->assertContains('2027-03-15', $dates);
        $this->assertSame('02:30', $options['dates'][0]['slots'][0]['start_time']);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function inactive_windows_are_never_offered_and_the_required_flag_is_passed_through(): void
    {
        $store = $this->store('ds-inactive');
        $service = $this->configure($store, ['is_required' => false], [
            $this->slot('معطّلة', '19:00', '22:00', ['is_active' => false]),
            $this->slot('فعّالة', '20:00', '22:00'),
        ]);

        $options = $service->options($store['channel_id'], 'delivery', null, null, $this->now());

        $this->assertSame(['فعّالة'], $this->labels($options, '2026-10-08'));
        $this->assertFalse($options['required']);
        app(TenantContext::class)->forget();
    }

    // ── الإدارة ─────────────────────────────────────────────────────────

    /** @test */
    public function the_workspace_api_round_trips_settings_slots_and_blocked_dates(): void
    {
        $store = $this->store('ds-api');

        $default = $this->withToken($store['token'])->getJson($this->url($store))->assertOk();
        $this->assertFalse($default->json('data.settings.enabled'));
        $this->assertSame([], $default->json('data.slots'));

        $this->withToken($store['token'])->putJson($this->url($store, '/settings'), [
            'is_enabled' => true, 'is_required' => false, 'timezone' => 'Asia/Riyadh', 'lead_time_minutes' => 120, 'cutoff_time' => '15:00', 'max_days_ahead' => 14,
        ])->assertOk()->assertJsonPath('data.settings.lead_time_minutes', 120);

        $this->withToken($store['token'])->putJson($this->url($store, '/slots'), ['slots' => [
            ['method' => 'delivery', 'label' => 'صباحاً', 'label_en' => 'Morning', 'start_time' => '09:00', 'end_time' => '12:00', 'weekdays' => [0, 1, 2], 'capacity' => 5],
            ['method' => 'pickup', 'label' => 'استلام', 'start_time' => '10:00', 'end_time' => '20:00'],
        ]])->assertOk();

        $doc = $this->withToken($store['token'])->putJson($this->url($store, '/blocked-dates'), ['blocked_dates' => [
            ['date' => '2026-12-25', 'reason' => 'إجازة'],
            ['date' => '2026-12-26', 'method' => 'delivery'],
        ]])->assertOk();

        $this->assertTrue($doc->json('data.settings.enabled'));
        $this->assertFalse($doc->json('data.settings.required'));
        $this->assertSame('15:00', $doc->json('data.settings.cutoff_time'));
        $this->assertSame(['delivery', 'pickup'], array_column($doc->json('data.slots'), 'method'));
        $this->assertSame([0, 1, 2], $doc->json('data.slots.0.weekdays'));
        $this->assertSame(5, $doc->json('data.slots.0.capacity'));
        $this->assertSame([0, 1, 2, 3, 4, 5, 6], $doc->json('data.slots.1.weekdays'));
        $this->assertSame([['date' => '2026-12-25', 'method' => 'all', 'reason' => 'إجازة'], ['date' => '2026-12-26', 'method' => 'delivery', 'reason' => null]], $doc->json('data.blocked_dates'));

        $this->assertSame($doc->json('data'), $this->withToken($store['token'])->getJson($this->url($store))->assertOk()->json('data'));
    }

    /** @test */
    public function every_channel_lock_is_taken_inside_a_transaction(): void
    {
        $store = $this->store('ds-lock-tx');
        app(TenantContext::class)->set($store['tenant_id']);
        $service = app(CommerceDeliveryScheduleService::class);

        // الاختبار نفسه داخل معاملة (RefreshDatabase)، فالمعيار مستوى التداخل الأساسي + 1 على الأقل.
        $baseline = \Illuminate\Support\Facades\DB::transactionLevel();
        $levels = [];
        \Illuminate\Support\Facades\DB::listen(function ($q) use (&$levels) {
            // قفل القناة يقرأ `select *`؛ حارس النموذج يقرأ عمودين فقط ولا يُحتسب.
            if (str_contains($q->sql, 'select * from "sales_channels"') && str_contains($q->sql, 'limit 1')) {
                $levels[] = \Illuminate\Support\Facades\DB::transactionLevel();
            }
        });

        $service->saveSettings($store['channel_id'], ['is_enabled' => true]);
        $service->replaceSlots($store['channel_id'], [$this->slot('صباحاً', '09:00', '12:00')]);
        $service->replaceBlockedDates($store['channel_id'], [['date' => '2026-12-25']]);

        $this->assertCount(3, $levels);
        foreach ($levels as $level) {
            $this->assertGreaterThan($baseline, $level, 'the channel row lock was taken outside a transaction');
        }
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function invalid_settings_are_rejected_and_change_nothing(): void
    {
        $store = $this->store('ds-bad-settings');
        $put = fn (array $body) => $this->withToken($store['token'])->putJson($this->url($store, '/settings'), $body);

        $put(['lead_time_minutes' => CommerceDeliveryScheduleSetting::MAX_LEAD_TIME_MINUTES + 1])->assertStatus(422);
        $put(['lead_time_minutes' => -1])->assertStatus(422);
        $put(['max_days_ahead' => 0])->assertStatus(422);
        $put(['max_days_ahead' => CommerceDeliveryScheduleSetting::MAX_DAYS_AHEAD + 1])->assertStatus(422);
        $put(['cutoff_time' => '25:00'])->assertStatus(422);
        $put(['cutoff_time' => '9:00'])->assertStatus(422);
        $put(['timezone' => 'Mars/Phobos'])->assertStatus(422);
        $put(['is_enabled' => 'maybe'])->assertStatus(422);

        $this->assertSame(0, CommerceDeliveryScheduleSetting::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_slots_are_rejected_and_a_failed_replacement_keeps_the_existing_set(): void
    {
        $store = $this->store('ds-bad-slots');
        $good = [['method' => 'delivery', 'label' => 'صباحاً', 'start_time' => '09:00', 'end_time' => '12:00']];
        $this->withToken($store['token'])->putJson($this->url($store, '/slots'), ['slots' => $good])->assertOk();

        app(TenantContext::class)->set($store['tenant_id']);
        $zone = CommerceShippingZone::create(['name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500]);
        app(TenantContext::class)->forget();
        $foreign = $this->store('ds-bad-slots-b');
        app(TenantContext::class)->set($foreign['tenant_id']);
        $foreignZone = CommerceShippingZone::create(['name' => 'أخرى', 'match_type' => 'city', 'match_value' => 'جدة', 'rate_amount_minor' => 100]);
        app(TenantContext::class)->forget();

        $base = $good[0];
        $put = fn (array $slot) => $this->withToken($store['token'])->putJson($this->url($store, '/slots'), ['slots' => [$slot + $base]]);

        $put(['end_time' => '09:00'])->assertStatus(422);                       // نهاية = بداية
        $put(['start_time' => '13:00'])->assertStatus(422);                     // نهاية قبل البداية
        $put(['start_time' => '9:00'])->assertStatus(422);                      // صيغة
        $put(['method' => 'courier'])->assertStatus(422);
        $put(['label' => '   '])->assertStatus(422);
        $put(['weekdays' => [7]])->assertStatus(422);
        $put(['weekdays' => [1, 1]])->assertStatus(422);
        $put(['capacity' => 0])->assertStatus(422);
        $put(['capacity' => CommerceDeliverySlot::MAX_CAPACITY + 1])->assertStatus(422);
        $put(['method' => 'pickup', 'shipping_zone_id' => $zone->id])->assertStatus(422);   // المنطقة للتوصيل فقط
        $put(['shipping_zone_id' => $foreignZone->id])->assertStatus(422);                   // منطقة مستأجر آخر
        $put(['shipping_zone_id' => (string) Str::uuid()])->assertStatus(422);

        $tooMany = array_fill(0, CommerceDeliverySlot::MAX_PER_CHANNEL + 1, $base);
        $this->withToken($store['token'])->putJson($this->url($store, '/slots'), ['slots' => $tooMany])->assertStatus(422);

        $kept = $this->withToken($store['token'])->getJson($this->url($store))->json('data.slots');
        $this->assertCount(1, $kept);
        $this->assertSame('صباحاً', $kept[0]['label']);
    }

    /** @test */
    public function invalid_blocked_dates_are_rejected(): void
    {
        $store = $this->store('ds-bad-blocked');
        $put = fn (array $rows) => $this->withToken($store['token'])->putJson($this->url($store, '/blocked-dates'), ['blocked_dates' => $rows]);

        $put([['date' => '2026-13-40']])->assertStatus(422);
        $put([['date' => '2026-2-3']])->assertStatus(422);
        $put([['date' => 'tomorrow']])->assertStatus(422);
        $put([['date' => '2026-12-25', 'method' => 'drone']])->assertStatus(422);
        $put([['date' => '2026-12-25'], ['date' => '2026-12-25']])->assertStatus(422); // تكرار (نفس الطريقة)
        $put(array_map(fn ($i) => ['date' => CarbonImmutable::parse('2027-01-01')->addDays($i)->format('Y-m-d')], range(0, CommerceDeliveryBlockedDate::MAX_PER_CHANNEL)))->assertStatus(422);

        // نفس التاريخ بطريقتين مختلفتين مسموح
        $put([['date' => '2026-12-25', 'method' => 'delivery'], ['date' => '2026-12-25', 'method' => 'pickup']])->assertOk();
        $this->assertSame(2, CommerceDeliveryBlockedDate::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_workspace_api_is_manage_only_and_isolated_per_tenant(): void
    {
        $a = $this->store('ds-iso-a');
        $b = $this->store('ds-iso-b');

        // مستأجر آخر: 404 غير كاشف، ولا تغيير
        $this->withToken($a['token'])->getJson($this->url($b))->assertNotFound();
        $this->withToken($a['token'])->putJson($this->url($b, '/settings'), ['is_enabled' => true])->assertNotFound();
        $this->withToken($a['token'])->putJson($this->url($b, '/slots'), ['slots' => []])->assertNotFound();
        $this->withToken($a['token'])->putJson($this->url($b, '/blocked-dates'), ['blocked_dates' => []])->assertNotFound();
        $this->assertFalse($this->withToken($b['token'])->getJson($this->url($b))->json('data.settings.enabled'));

        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@ds-iso-a.test');
        $ss = $this->tokenForRole($a['tenant_id'], 'self_service', 'ss@ds-iso-a.test');
        foreach ([$staff, $ss] as $token) {
            $this->withToken($token)->getJson($this->url($a))->assertForbidden();
            $this->withToken($token)->putJson($this->url($a, '/settings'), ['is_enabled' => true])->assertForbidden();
            $this->withToken($token)->putJson($this->url($a, '/slots'), ['slots' => []])->assertForbidden();
            $this->withToken($token)->putJson($this->url($a, '/blocked-dates'), ['blocked_dates' => []])->assertForbidden();
        }
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson('/api/commerce/workspace/storefronts/'.Str::uuid().'/delivery-schedule')->assertUnauthorized();
    }

    /** @test */
    public function models_guard_structurally_and_a_deleted_zone_removes_its_window(): void
    {
        $a = $this->store('ds-model-a');
        $b = $this->store('ds-model-b');

        app(TenantContext::class)->set($a['tenant_id']);
        $zone = CommerceShippingZone::create(['name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500]);
        foreach ([
            fn () => CommerceDeliveryScheduleSetting::create(['sales_channel_id' => $b['channel_id']]),
            fn () => CommerceDeliverySlot::create(['sales_channel_id' => $b['channel_id'], 'method' => 'delivery', 'label' => 'x', 'start_time' => '09:00', 'end_time' => '10:00']),
            fn () => CommerceDeliveryBlockedDate::create(['sales_channel_id' => $b['channel_id'], 'date' => '2026-12-25']),
            fn () => CommerceDeliverySlot::create(['sales_channel_id' => $a['channel_id'], 'method' => 'delivery', 'label' => 'x', 'start_time' => '10:00', 'end_time' => '09:00']),
            fn () => CommerceDeliveryBlockedDate::create(['sales_channel_id' => $a['channel_id'], 'date' => '2026-02-30']),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('an invalid delivery-schedule row was accepted');
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }

        // سقوط المنطقة يُسقط نافذتها (فشلٌ مغلق) لا أن تتّسع إلى أي وجهة
        CommerceDeliverySlot::create(['sales_channel_id' => $a['channel_id'], 'method' => 'delivery', 'label' => 'مقيّدة', 'start_time' => '09:00', 'end_time' => '10:00', 'shipping_zone_id' => $zone->id]);
        $this->assertSame(1, CommerceDeliverySlot::query()->count());
        CommerceShippingZone::query()->whereKey($zone->id)->delete();
        $this->assertSame(0, CommerceDeliverySlot::query()->count());
        app(TenantContext::class)->forget();
    }

    // ── القراءة العامة ──────────────────────────────────────────────────

    /** @test */
    public function the_public_endpoint_exposes_only_selectable_windows_and_no_internal_fields(): void
    {
        $store = $this->store('ds-public');
        $tenantSlug = Tenant::query()->findOrFail($store['tenant_id'])->slug;
        $this->configure($store, ['lead_time_minutes' => 0, 'max_days_ahead' => 3], [
            $this->slot('صباحاً', '09:00', '12:00', ['capacity' => 3]),
            $this->slot('معطّلة', '14:00', '18:00', ['is_active' => false]),
        ]);
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenantSlug}/delivery-schedule")->assertOk();

        $this->assertTrue($res->json('data.enabled'));
        $this->assertSame('delivery', $res->json('data.method'));
        $slot = $res->json('data.dates.0.slots.0');
        $this->assertSame(['id', 'label', 'label_en', 'start_time', 'end_time'], array_keys($slot));
        $this->assertArrayNotHasKey('capacity', $slot);
        $this->assertNotContains('معطّلة', array_column(array_merge(...array_column($res->json('data.dates'), 'slots')), 'label'));
        $this->assertSame($res->json('data.earliest.slot_id'), $res->json('data.dates.0.slots.0.id'));

        $this->getJson("/store/v1/{$tenantSlug}/delivery-schedule?method=courier")->assertStatus(422);
        $this->assertSame([], $this->getJson("/store/v1/{$tenantSlug}/delivery-schedule?method=pickup")->assertOk()->json('data.dates')); // لا نوافذ استلام
    }

    /** @test */
    public function the_public_endpoint_is_disabled_by_default_and_isolated_per_tenant(): void
    {
        $a = $this->store('ds-pub-a');
        $b = $this->store('ds-pub-b');
        $slugA = Tenant::query()->findOrFail($a['tenant_id'])->slug;
        $this->configure($b, [], $this->threeSlots());
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$slugA}/delivery-schedule")->assertOk();

        $this->assertFalse($res->json('data.enabled'));
        $this->assertSame([], $res->json('data.dates'));
    }

    /** @test */
    public function the_mobile_endpoint_serves_the_same_contract(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر الجوال', 'slug' => 'dsm-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        $service = app(CommerceDeliveryScheduleService::class);
        $service->saveSettings($channel->id, ['is_enabled' => true, 'max_days_ahead' => 5]);
        $service->replaceSlots($channel->id, [$this->slot('مساءً', '23:00', '23:59')]);
        app(TenantContext::class)->forget();

        $keys = app(ApiClientKeyService::class);
        $headers = ['Authorization' => 'Bearer '.$keys->issueKey($keys->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken];

        $res = $this->getJson('/commerce/v1/delivery-schedule', $headers)->assertOk();

        $this->assertTrue($res->json('data.enabled'));
        $this->assertNotEmpty($res->json('data.dates'));
        $this->getJson('/commerce/v1/delivery-schedule?method=courier', $headers)->assertStatus(422);
    }
}
