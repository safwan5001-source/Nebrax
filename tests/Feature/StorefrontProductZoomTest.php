<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V9e — تكبير صورة صفحة المنتج (V0 §14.2): `pagePresentation.product.zoom` لا يُخزَّن إلا `off`، والغياب = مفعّل (سلوك اليوم).
 * الحالات مشتركة مع توأمَي TS عبر `tests/Fixtures/presentation/product-zoom.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontProductZoomTest
 */
class StorefrontProductZoomTest extends TestCase
{
    /** @return array<string,array{0:array<string,mixed>}> */
    public static function cases(): array
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/product-zoom.json'), true, 512, JSON_THROW_ON_ERROR);
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
    public function the_namespace_normalizes_like_the_shared_fixture(array $case): void
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $document = fn (mixed $page): array => $normalizer->normalize(['version' => 2, 'primaryColor' => '#12372a', 'pagePresentation' => $page]);

        $first = $document($case['input']);
        $this->assertSame(
            json_encode($case['expected'], JSON_UNESCAPED_UNICODE),
            json_encode($first['pagePresentation'] ?? null, JSON_UNESCAPED_UNICODE),
        );

        // idempotence: a normalised namespace normalises to itself
        if (isset($first['pagePresentation'])) {
            $this->assertSame(
                json_encode($first['pagePresentation'], JSON_UNESCAPED_UNICODE),
                json_encode($document($first['pagePresentation'])['pagePresentation'], JSON_UNESCAPED_UNICODE),
            );
        }
    }
}
