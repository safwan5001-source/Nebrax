<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V9d-3 — عنوان رفوف المنتجات والعروض (V0 §14.2): `title` اختياري (≤ 80 بنقاط الترميز) و`showTitle` لا يُخزَّن إلا `false`.
 * الحالات مشتركة مع توأمَي TS عبر `tests/Fixtures/presentation/shelf-titles.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontShelfTitlesTest
 */
class StorefrontShelfTitlesTest extends TestCase
{
    /** @return array<string,array{0:array<string,mixed>}> */
    public static function cases(): array
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/shelf-titles.json'), true, 512, JSON_THROW_ON_ERROR);
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
    public function the_content_normalizes_like_the_shared_fixture(array $case): void
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $document = fn (mixed $content): array => $normalizer->normalize([
            'version' => 2,
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => $case['type'], 'visible' => true, 'content' => $content]]],
        ]);

        $section = collect($document($case['input'])['homepage']['sections'])->firstWhere('id', 'sec-a');
        $this->assertNotNull($section, 'the section itself survives');

        // الترتيب جزءٌ من العقد: التكافؤ الحرفي لا القيمي.
        $this->assertSame(
            json_encode($case['expected'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode($section['content'] ?? null, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $case['name'],
        );
        $this->assertSame(
            $section['content'] ?? null,
            collect($document($section['content'] ?? null)['homepage']['sections'])->firstWhere('id', 'sec-a')['content'] ?? null,
            'idempotent: '.$case['name'],
        );
    }
}
