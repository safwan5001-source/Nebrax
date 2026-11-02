<?php

namespace Tests\Feature;

use App\Models\CommerceOrderSchedule;
use App\Services\Commerce\CommerceOrderPreparationClock as Clock;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H2-6 (D-H2-19) — ساعة التحضير: استحقاق بمنطقة لقطة الطلب وحدود اليوم بمنطقة القناة، عبر DST والمناطق ±14/−12. حساب نقيّ بلا قاعدة بيانات.
 */
class CommerceOrderPreparationClockTest extends TestCase
{
    private function schedule(string $date, string $start, string $end, ?string $tz): CommerceOrderSchedule
    {
        return new CommerceOrderSchedule(['delivery_date' => $date, 'start_time' => $start, 'end_time' => $end, 'timezone' => $tz]);
    }

    #[Test]
    public function a_window_is_read_in_the_orders_own_snapshot_timezone(): void
    {
        $w = Clock::window($this->schedule('2026-11-02', '17:00', '20:00', 'Asia/Riyadh'));
        $this->assertSame('2026-11-02T14:00:00+00:00', $w['start']->toIso8601String());
        $this->assertSame('2026-11-02T17:00:00+00:00', $w['end']->toIso8601String());

        $berlin = Clock::window($this->schedule('2026-11-02', '09:00', '10:00', 'Europe/Berlin'));
        $this->assertSame('2026-11-02T08:00:00+00:00', $berlin['start']->toIso8601String());
    }

    #[Test]
    public function the_server_default_timezone_never_leaks_into_the_result(): void
    {
        $before = date_default_timezone_get();
        foreach (['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles'] as $serverZone) {
            date_default_timezone_set($serverZone);
            $w = Clock::window($this->schedule('2026-11-02', '17:00', '20:00', 'Asia/Riyadh'));
            $this->assertSame('2026-11-02T14:00:00+00:00', $w['start']->toIso8601String(), $serverZone);
        }
        date_default_timezone_set($before);
    }

    public static function extremeZones(): array
    {
        return [
            'UTC+14 (Kiritimati)' => ['Pacific/Kiritimati', '2026-11-02', '09:00', '2026-11-01T19:00:00+00:00'],
            'UTC-12 (Baker)' => ['Etc/GMT+12', '2026-11-02', '09:00', '2026-11-02T21:00:00+00:00'],
            'half-hour (Kolkata)' => ['Asia/Kolkata', '2026-11-02', '09:00', '2026-11-02T03:30:00+00:00'],
        ];
    }

    #[Test]
    #[DataProvider('extremeZones')]
    public function extreme_offsets_are_resolved_by_the_zone_database(string $tz, string $date, string $time, string $expectedUtc): void
    {
        $w = Clock::window($this->schedule($date, $time, '23:00', $tz));
        $this->assertSame($expectedUtc, $w['start']->toIso8601String());
    }

    #[Test]
    public function dst_transition_days_keep_wall_clock_times(): void
    {
        // خريف 2026-10-25 (برلين): 03:00 CEST → 02:00 CET؛ نافذة 09:00 تقع بعد التحويل (UTC+1).
        $autumn = Clock::window($this->schedule('2026-10-25', '09:00', '10:00', 'Europe/Berlin'));
        $this->assertSame('2026-10-25T08:00:00+00:00', $autumn['start']->toIso8601String());
        // ربيع 2026-03-29: 02:00 CET → 03:00 CEST؛ 09:00 بعد التحويل (UTC+2).
        $spring = Clock::window($this->schedule('2026-03-29', '09:00', '10:00', 'Europe/Berlin'));
        $this->assertSame('2026-03-29T07:00:00+00:00', $spring['start']->toIso8601String());
        // وقت محلي غير موجود (02:30 يوم القفزة) لا يرمي استثناءً.
        $this->assertNotNull(Clock::window($this->schedule('2026-03-29', '02:30', '03:30', 'Europe/Berlin')));
    }

    #[Test]
    public function a_window_crossing_midnight_ends_the_next_local_day(): void
    {
        $w = Clock::window($this->schedule('2026-11-02', '22:00', '01:00', 'Asia/Riyadh'));
        $this->assertSame('2026-11-02T19:00:00+00:00', $w['start']->toIso8601String());
        $this->assertSame('2026-11-02T22:00:00+00:00', $w['end']->toIso8601String());
    }

    #[Test]
    public function a_corrupt_snapshot_yields_null_not_a_guess(): void
    {
        $this->assertNull(Clock::window($this->schedule('2026-11-02', '17:00', '20:00', 'Mars/Olympus')));
        $this->assertNull(Clock::window($this->schedule('2026-11-02', '17:00', '20:00', null)));
        $this->assertNull(Clock::window($this->schedule('not-a-date', '17:00', '20:00', 'Asia/Riyadh')));
        $this->assertNull(Clock::window($this->schedule('2026-11-02', '', '20:00', 'Asia/Riyadh')));
    }

    #[Test]
    public function day_bounds_follow_the_channel_timezone_including_23_and_25_hour_days(): void
    {
        $now = CarbonImmutable::parse('2026-11-02 09:00:00', 'UTC');
        [$start, $end] = Clock::dayBounds('Asia/Riyadh', $now, 0);
        $this->assertSame('2026-11-01T21:00:00+00:00', $start->toIso8601String());
        $this->assertSame('2026-11-02T21:00:00+00:00', $end->toIso8601String());

        // الفارق بين نقطتين على جانبي منتصف الليل المحلي يغيّر «اليوم» رغم أنهما في يوم UTC واحد.
        [$s2] = Clock::dayBounds('Asia/Riyadh', CarbonImmutable::parse('2026-11-02 21:30:00', 'UTC'), 0);
        $this->assertSame('2026-11-02T21:00:00+00:00', $s2->toIso8601String());

        // يوم الخريف في برلين 25 ساعة، يوم الربيع 23 ساعة.
        [$a, $b] = Clock::dayBounds('Europe/Berlin', CarbonImmutable::parse('2026-10-25 10:00:00', 'UTC'), 0);
        $this->assertSame(25 * 3600, $b->getTimestamp() - $a->getTimestamp());
        [$c, $d] = Clock::dayBounds('Europe/Berlin', CarbonImmutable::parse('2026-03-29 10:00:00', 'UTC'), 0);
        $this->assertSame(23 * 3600, $d->getTimestamp() - $c->getTimestamp());

        // غداً = اليوم التالي المتصل بلا فجوة ولا تداخل.
        [$t0, $t1] = Clock::dayBounds('Pacific/Kiritimati', $now, 0);
        [$u0] = Clock::dayBounds('Pacific/Kiritimati', $now, 1);
        $this->assertTrue($t1->equalTo($u0));
        $this->assertTrue($t0->lessThan($t1));
    }

    #[Test]
    public function an_unknown_channel_timezone_falls_back_to_riyadh_for_the_day_boundary_only(): void
    {
        [$start] = Clock::dayBounds('Not/AZone', CarbonImmutable::parse('2026-11-02 09:00:00', 'UTC'), 0);
        $this->assertSame('2026-11-01T21:00:00+00:00', $start->toIso8601String());
    }

    #[Test]
    public function the_clock_is_read_only_and_never_reads_the_request_or_browser_time(): void
    {
        $source = (string) file_get_contents(app_path('Services/Commerce/CommerceOrderPreparationClock.php'));
        foreach (['DB::', 'Event::', '->save(', '->update(', 'request(', 'Request', 'now()', 'Carbon::now', 'date_default_timezone'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $source, "الساعة يجب ألا تذكر {$forbidden}");
        }
    }
}
