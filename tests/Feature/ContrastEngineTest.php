<?php

namespace Tests\Feature;

use App\Support\Commerce\ContrastEngine as E;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V5a — محرّك التباين (V0 §3.2.1/§4.5، AMEND-20): تكافؤ مع ملف الاختبار
 * المشترك (يُشغّله TS توأماً)، وسلامة مقابل القوة الغاشمة، والأمثلة المضادّة الموثّقة.
 * لا قاعدة بيانات — خوارزمية صرفة.
 */
class ContrastEngineTest extends TestCase
{
    /** @return list<array<string,mixed>> */
    private function cases(): array
    {
        $json = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/contrast.json'), true, 512, JSON_THROW_ON_ERROR);

        return $json['cases'];
    }

    /** @param array<string,mixed> $c @return array{min:float,max:float} */
    private function interval(array $c): array
    {
        $ov = isset($c['overlay']) ? ['rgb' => E::parseHex($c['overlay'][0]), 'alpha' => (float) $c['overlay'][1]] : null;

        return match ($c['kind']) {
            'solid' => E::solidInterval(E::parseHex($c['color']), $ov),
            'gradient' => E::gradientInterval(E::parseHex($c['from']), E::parseHex($c['to']), $ov),
            default => E::channelBoundsInterval($c['min'], $c['max'], $ov),
        };
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        foreach ($this->cases() as $c) {
            $iv = $this->interval($c);
            $worst = E::worstRatioForHex($c['fg'], $iv);
            $this->assertEqualsWithDelta($c['expected']['min'], $iv['min'], 1e-6, $c['name']);
            $this->assertEqualsWithDelta($c['expected']['max'], $iv['max'], 1e-6, $c['name']);
            $this->assertEqualsWithDelta($c['expected']['worst'], $worst, 1e-5, $c['name']);
            $this->assertSame($c['expected']['passesNormal'], E::passes($worst, E::TEXT_NORMAL), $c['name']);
            $this->assertSame($c['expected']['passesLarge'], E::passes($worst, E::TEXT_LARGE), $c['name']);
            $this->assertSame($c['expected']['auto'], E::autoForeground($iv), $c['name']);
        }
    }

    /** @test */
    public function it_never_overstates_compliance_against_a_dense_brute_force_of_the_real_interpolation(): void
    {
        mt_srand(20261007);
        $color = static fn (): array => [mt_rand(0, 255), mt_rand(0, 255), mt_rand(0, 255)];
        $worstOverstatement = 0.0;
        for ($i = 0; $i < 150; $i++) {
            $from = $color();
            $to = $color();
            $overlay = $i % 2 ? ['rgb' => $color(), 'alpha' => mt_rand(0, 18) * 0.05] : null;
            $fgL = $i % 4 < 2 ? 1.0 : 0.0;

            $a = $overlay ? E::composite($overlay['rgb'], $overlay['alpha'], $from) : $from;
            $b = $overlay ? E::composite($overlay['rgb'], $overlay['alpha'], $to) : $to;
            $truth = INF;
            for ($s = 0; $s <= 4096; $s++) {
                $t = $s / 4096;
                $l = E::luminance($a[0] + ($b[0] - $a[0]) * $t, $a[1] + ($b[1] - $a[1]) * $t, $a[2] + ($b[2] - $a[2]) * $t);
                $truth = min($truth, E::ratio($fgL, $l));
            }
            $engine = E::worstRatio($fgL, E::gradientInterval($from, $to, $overlay));
            $worstOverstatement = max($worstOverstatement, $engine - $truth);
        }

        $this->assertLessThanOrEqual(1e-9, $worstOverstatement);
    }

    /** @test */
    public function an_endpoints_only_check_would_pass_the_documented_counter_example_but_the_engine_does_not(): void
    {
        $from = E::parseHex('#d1456a');
        $to = E::parseHex('#1e8b9a');
        $endpoints = min(
            E::ratio(0.0, E::luminance(...$from)),
            E::ratio(0.0, E::luminance(...$to)),
        );
        $this->assertGreaterThan(4.5, $endpoints);

        $worst = E::worstRatio(0.0, E::gradientInterval($from, $to));
        $this->assertLessThan(4.5, $worst);
        $this->assertGreaterThan(3.9, $worst);
        $this->assertFalse(E::passes($worst));
    }

    /** @test */
    public function an_overlay_is_composited_on_encoded_channels_not_linear_light(): void
    {
        $worst = E::worstRatio(0.0, E::solidInterval([0, 0, 0], ['rgb' => [255, 255, 255], 'alpha' => 0.4]));
        $this->assertLessThan(3.66, $worst);
        $this->assertGreaterThan(3.5, $worst);
    }

    /** @test */
    public function a_region_is_judged_by_its_extremes_and_inside_range_is_one_to_one(): void
    {
        $this->assertLessThan(1.2, E::worstRatio(1.0, E::channelBoundsInterval([10, 10, 10], [245, 245, 245])));
        $this->assertSame(1.0, E::worstRatio(0.2, E::gradientInterval([0, 0, 0], [255, 255, 255])));
    }

    /** @test */
    public function unproven_is_non_compliant_and_every_opaque_background_has_an_automatic_foreground(): void
    {
        $this->assertSame(1.0, E::worstRatioForHex('white', E::solidInterval([255, 255, 255])));
        $this->assertNull(E::parseHex('#fff'));

        mt_srand(7);
        for ($i = 0; $i < 300; $i++) {
            $iv = E::solidInterval([mt_rand(0, 255), mt_rand(0, 255), mt_rand(0, 255)]);
            $this->assertGreaterThanOrEqual(4.5, E::worstRatioForHex(E::autoForeground($iv), $iv));
        }
    }
}
