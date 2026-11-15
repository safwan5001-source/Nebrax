<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelStation;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillAccountingReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-TZ-1 — نهاية الفترة الافتراضية لتقارير الحساب الوسيط (`clearing-account` و`accounting-control`) = «اليوم» بتوقيت محطات النطاق المرئي، لا بتوقيت الخادم (UTC).
 *
 * السبب الجذري: `now()->toDateString()` كان يحسب `to` بتاريخ UTC بينما قيود الترحيل تُؤرَّخ بتاريخ المحطة (`FuelStationSettingsService::businessDate`)؛
 * فمن 21:00 إلى 24:00 UTC (00:00–03:00 بالرياض) يقع قيد «اليوم» بعد نهاية الفترة فيُستثنى من الرصيد.
 *
 * كل اختبار هنا يثبّت الساعة (`Carbon::setTestNow`) فلا يتأثر بساعة تشغيل CI. يُشغَّل على SQLite وPostgreSQL ضمن مصفوفة CI نفسها (لا SQL خاص بمحرك).
 */
class FuelTankerFillReportsTimezoneTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;
    use BuildsTankerPostingWorld;

    private const BASE = '/api/fuel-stations/tanker-fill-reports/';

    protected function setUp(): void
    {
        parent::setUp();
        $this->freeze('2026-03-10 12:00:00');
        $this->bootPostingWorld();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function freeze(string $utc): void
    {
        Carbon::setTestNow(Carbon::parse($utc, 'UTC'));
    }

    /** @param array<string,mixed> $query */
    private function report(string $key, array $query = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($this->w['owner_token'])->getJson(self::BASE . $key . ($query === [] ? '' : '?' . http_build_query($query)));
    }

    /** @return array{from: string, to: string} */
    private function clearingPeriod(array $query = []): array
    {
        return $this->report('clearing-account', $query)->assertOk()->json('data.period');
    }

    /** محطة إضافية في فرع جديد بمنطقة معطاة (عمود `timezone` يتقدّم على الإعداد). */
    private function stationIn(string $branchCode, string $timezone): FuelStation
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        $branch = Branch::create(['name' => 'فرع ' . $branchCode, 'code' => $branchCode]);

        return FuelStation::create(['branch_id' => $branch->id, 'code' => 'TZ-' . $branchCode, 'name' => 'محطة ' . $branchCode, 'timezone' => $timezone]);
    }

    // ───────────────────────── السبب الجذري: النافذة 21:00–24:00 UTC ─────────────────────────

    /** @test */
    public function a_fill_posted_after_local_midnight_but_before_utc_midnight_is_inside_the_default_period(): void
    {
        $this->freeze('2026-03-10 22:30:00'); // 01:30 يوم 11 مارس بالرياض
        $fill = $this->fill(3_000_000);
        $this->postFill($fill)->assertCreated();

        // الشرط المسبق: القيد مؤرَّخ بتاريخ المحطة (11) لا تاريخ UTC (10) — وهذا بالضبط ما كان يسقط خارج الفترة.
        $entryDate = DB::table('journal_entries')->where('source_type', \App\Models\FuelTankerFill::class)->whereNull('reversal_of')->value('entry_date');
        $this->assertSame('2026-03-11', substr((string) $entryDate, 0, 10));
        $this->assertSame('2026-03-10', now()->toDateString(), 'UTC ما زال اليوم السابق');

        $data = $this->report('clearing-account')->assertOk()->json('data');
        $this->assertSame(['from' => '2026-03-01', 'to' => '2026-03-11'], $data['period']);
        $account = $data['accounts'][0];
        $this->assertSame(654_000, $account['closing_balance_minor']);
        $this->assertSame(654_000, $account['period_debits_minor']);
        $this->assertSame(654_000, $account['supported_balance_minor']);
        $this->assertSame(0, $account['unexplained_difference_minor']);

        // مركز الرقابة يشارك المسار نفسه.
        $control = $this->report('accounting-control')->assertOk()->json('data.clearing');
        $this->assertSame('2026-03-11', $control['period']['to']);
        $this->assertSame(654_000, $control['accounts'][0]['closing_balance_minor']);
    }

    /** @test */
    public function a_fill_posted_before_local_midnight_is_inside_the_default_period(): void
    {
        $this->freeze('2026-03-10 20:30:00'); // 23:30 يوم 10 مارس بالرياض (قبل منتصف الليل المحلي)
        $this->postFill($this->fill(3_000_000))->assertCreated();

        $entryDate = DB::table('journal_entries')->where('source_type', \App\Models\FuelTankerFill::class)->whereNull('reversal_of')->value('entry_date');
        $this->assertSame('2026-03-10', substr((string) $entryDate, 0, 10));

        $data = $this->report('clearing-account')->assertOk()->json('data');
        $this->assertSame('2026-03-10', $data['period']['to']);
        $this->assertSame(654_000, $data['accounts'][0]['closing_balance_minor']);
    }

    // ───────────────────────── حدود بداية الفترة ونهايتها ─────────────────────────

    /** @test */
    public function the_default_period_rolls_over_exactly_at_station_midnight_including_month_boundaries(): void
    {
        $cases = [
            // [لحظة UTC, from المتوقع, to المتوقع]
            ['2026-03-10 20:59:59', '2026-03-01', '2026-03-10'], // 23:59:59 بالرياض
            ['2026-03-10 21:00:00', '2026-03-01', '2026-03-11'], // 00:00:00 بالرياض
            ['2026-03-31 20:59:59', '2026-03-01', '2026-03-31'], // آخر ثانية في مارس محلياً
            ['2026-03-31 21:00:00', '2026-04-01', '2026-04-01'], // أول ثانية في أبريل محلياً ⇒ بداية الفترة تعبر الشهر مع النهاية
            ['2026-12-31 21:00:00', '2027-01-01', '2027-01-01'], // عبور السنة
        ];
        app(TenantContext::class)->set($this->w['tenant_id']);
        foreach ($cases as [$utc, $from, $to]) {
            $this->freeze($utc);
            // مباشرةً على الخدمة: القفزات الزمنية الطويلة (شهر/سنة) تُنهي صلاحية رمز الاختبار (7 أيام) وتجربة المستأجر فلا علاقة لها بما يُختبر هنا.
            $period = app(FuelTankerFillAccountingReportService::class)->clearingAccount($this->w['actor'], null, [])['period'];
            $this->assertSame(['from' => $from, 'to' => $to], $period, "UTC {$utc}");
        }
    }

    /** @test */
    public function an_explicit_period_is_used_verbatim_and_never_shifted_by_the_station_timezone(): void
    {
        $this->freeze('2026-03-10 22:30:00');
        $this->postFill($this->fill(3_000_000))->assertCreated(); // قيد بتاريخ 11 مارس

        // نهاية صريحة = 10: لا تُزاح إلى 11 ولو كان «اليوم» المحلي 11 ⇒ القيد خارج الفترة (الرصيد 0).
        $explicit = $this->report('clearing-account', ['from' => '2026-03-10', 'to' => '2026-03-10'])->assertOk()->json('data');
        $this->assertSame(['from' => '2026-03-10', 'to' => '2026-03-10'], $explicit['period']);
        $this->assertSame(0, $explicit['accounts'][0]['closing_balance_minor']);

        // نهاية صريحة = 11 تشمل القيد، والحد الأدنى للبداية شامل (from = to = تاريخ القيد).
        $inclusive = $this->report('clearing-account', ['from' => '2026-03-11', 'to' => '2026-03-11'])->assertOk()->json('data.accounts.0');
        $this->assertSame(654_000, $inclusive['closing_balance_minor']);
        $this->assertSame(654_000, $inclusive['period_debits_minor']);
        $this->assertSame(0, $inclusive['opening_balance_minor']);

        // بداية صريحة فقط (لا نهاية): النهاية تُشتق من يوم المحطة وتُحفظ البداية كما أُرسلت.
        $fromOnly = $this->clearingPeriod(['from' => '2026-03-05']);
        $this->assertSame(['from' => '2026-03-05', 'to' => '2026-03-11'], $fromOnly);

        // نهاية صريحة فقط: بداية الفترة = أول الشهر لتلك النهاية الصريحة لا لتاريخ اليوم.
        $toOnly = $this->clearingPeriod(['to' => '2026-02-20']);
        $this->assertSame(['from' => '2026-02-01', 'to' => '2026-02-20'], $toOnly);
    }

    // ───────────────────────── اختلاف المنطقة الزمنية بين المحطات ─────────────────────────

    /** @test */
    public function the_default_end_follows_each_visible_stations_own_timezone(): void
    {
        $this->freeze('2026-03-10 22:30:00'); // الرياض 11 مارس 01:30 · هونولولو (UTC−10) 10 مارس 12:30
        $honolulu = $this->stationIn('TZ-HNL', 'Pacific/Honolulu');
        $this->assertSame('2026-03-10', app(FuelStationSettingsService::class)->businessDate($honolulu));

        // المؤسسة كلها: الأحدث بين المحطات (الرياض = 11).
        $this->assertSame('2026-03-11', $this->clearingPeriod()['to']);
        // فرع هونولولو وحده: تاريخها 10 — لا يُزاح إلى يوم محطة لا يراها المستخدم.
        $this->assertSame('2026-03-10', $this->clearingPeriod(['branch_id' => $honolulu->branch_id])['to']);
        // فرع محطة الرياض وحده: 11.
        $this->assertSame('2026-03-11', $this->clearingPeriod(['branch_id' => $this->w['station']->branch_id])['to']);
    }

    /** @test */
    public function a_station_ahead_of_the_main_one_moves_the_organisation_wide_default_forward_only_within_its_own_branch_scope(): void
    {
        $this->freeze('2026-03-10 12:00:00'); // الرياض 10 مارس 15:00 · كيريتيماتي (UTC+14) 11 مارس 02:00
        $kiritimati = $this->stationIn('TZ-KIR', 'Pacific/Kiritimati');
        $this->assertSame('2026-03-11', app(FuelStationSettingsService::class)->businessDate($kiritimati));

        $this->assertSame('2026-03-11', $this->clearingPeriod()['to']);
        $this->assertSame('2026-03-10', $this->clearingPeriod(['branch_id' => $this->w['station']->branch_id])['to']);
        $this->assertSame('2026-03-11', $this->clearingPeriod(['branch_id' => $kiritimati->branch_id])['to']);
    }

    /** @test */
    public function another_tenants_station_timezone_never_affects_this_tenants_default_period(): void
    {
        $this->freeze('2026-03-10 12:00:00');
        $mainTenant = $this->w['tenant_id'];
        $other = $this->openingWorld(false, 'OTHER-TZ');
        DB::table('fuel_stations')->where('id', $other['station']->id)->update(['timezone' => 'Pacific/Kiritimati']);
        app(TenantContext::class)->set($mainTenant);

        $this->assertSame('2026-03-10', $this->clearingPeriod()['to']);
    }

    // ───────────────────────── منطقة غير صالحة / لا محطات ─────────────────────────

    /** @test */
    public function an_invalid_station_timezone_falls_back_safely_instead_of_failing_or_using_utc(): void
    {
        $this->freeze('2026-03-10 22:30:00');
        DB::table('fuel_stations')->where('id', $this->w['station']->id)->update(['timezone' => 'Mars/Phobos']);

        // لا استثناء، ويسقط إلى إعداد المستأجر (الافتراضي Asia/Riyadh) ⇒ 11 لا 10 (UTC).
        $this->assertSame('2026-03-11', $this->clearingPeriod()['to']);

        // إعداد مستأجر صالح يتقدّم على السقوط الأخير حين يكون عمود المحطة تالفاً.
        $this->configure(['operating_timezone' => 'Pacific/Honolulu']);
        $this->assertSame('2026-03-10', $this->clearingPeriod()['to']);
    }

    /** @test */
    public function with_no_visible_station_the_default_uses_the_approved_fallback_zone_not_utc(): void
    {
        $this->freeze('2026-03-10 22:30:00');
        app(TenantContext::class)->set($this->w['tenant_id']);
        $period = app(FuelTankerFillAccountingReportService::class)->clearingAccount($this->w['actor'], [], [])['period'];

        $this->assertSame(FuelStationSettingsService::FALLBACK_TIMEZONE, 'Asia/Riyadh');
        $this->assertSame(['from' => '2026-03-01', 'to' => '2026-03-11'], $period);
    }
}
