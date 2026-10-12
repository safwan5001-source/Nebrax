<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V10c — اسم القسم (V0 §17.1): بيانات محرر فقط؛ ≤ 60 نقطة ترميز، الفراغ/غير النص = غياب، وترتيب المفاتيح
 * id · type · visible · label · content · design. الحالات مشتركة مع توأم التطبيق التاجري عبر `tests/Fixtures/presentation/section-labels.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontSectionLabelsTest
 */
class StorefrontSectionLabelsTest extends TestCase
{
    /** @return array<string,array{0:array<string,mixed>}> */
    public static function cases(): array
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/section-labels.json'), true, 512, JSON_THROW_ON_ERROR);
        $cases = $fixture['cases'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /**
     * @test
     *
     * @dataProvider cases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_section_normalizes_like_the_shared_fixture(array $case): void
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $document = fn (array $section): array => $normalizer->normalize([
            'version' => 2,
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [$section]],
        ]);

        $first = $document($case['input'])['homepage']['sections'][0];
        $this->assertSame(json_encode($case['expected'], JSON_UNESCAPED_UNICODE), json_encode($first, JSON_UNESCAPED_UNICODE));

        // idempotence
        $this->assertSame(
            json_encode($first, JSON_UNESCAPED_UNICODE),
            json_encode($document($first)['homepage']['sections'][0], JSON_UNESCAPED_UNICODE),
        );
    }
}
