<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V6c-2 (V0 §8.2) — Banner `ctas` (≤2) next to the legacy `ctaLabel/ctaHref`. حالات التطبيع مشتركة مع توأمَي TS
 * عبر `tests/Fixtures/presentation/banner-ctas.json`، فلا ينحرف أحد الثلاثة بصمت.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationBannerCtasTest
 */
class StorefrontPresentationBannerCtasTest extends TestCase
{
    private function contentOf(mixed $input): ?array
    {
        $doc = (new StorefrontPresentationNormalizer)->normalize(['version' => 3, 'homepage' => ['sections' => [
            ['id' => 'banner', 'type' => 'banner', 'visible' => true, 'content' => $input],
        ]]]);
        $row = collect($doc['homepage']['sections'])->firstWhere('id', 'banner');
        $this->assertNotNull($row, 'the banner section itself must survive normalization');

        return $row['content'] ?? null;
    }

    /** @test */
    public function the_shared_fixture_cases_normalize_identically_including_key_order(): void
    {
        $fixture = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/banner-ctas.json'), true);
        $this->assertNotEmpty($fixture['cases']);

        foreach ($fixture['cases'] as $case) {
            $actual = $this->contentOf($case['input']);
            if ($case['expected'] === null) {
                $this->assertNull($actual, $case['name']);

                continue;
            }
            $this->assertSame($case['expected'], $actual, $case['name']);
            $this->assertSame(json_encode($case['expected']), json_encode($actual), $case['name'].' (key order)');
            $this->assertSame($actual, $this->contentOf($actual), $case['name'].' (idempotent)');
        }
    }

    /** @test */
    public function only_a_banner_and_a_hero_accept_ctas(): void
    {
        $doc = (new StorefrontPresentationNormalizer)->normalize(['version' => 3, 'homepage' => ['sections' => [
            ['id' => 'cats', 'type' => 'categories', 'visible' => true, 'content' => ['ctas' => [['label' => 'x', 'href' => '/x']]]],
        ]]]);
        $this->assertArrayNotHasKey('content', $doc['homepage']['sections'][0] ?? []);
    }

    /** @test */
    public function the_hero_keeps_its_exact_cta_behaviour_after_sharing_the_list_normaliser(): void
    {
        $doc = (new StorefrontPresentationNormalizer)->normalize(['version' => 3, 'homepage' => ['sections' => [
            ['id' => 'hero', 'type' => 'hero', 'visible' => true, 'content' => [
                'headline' => 'H',
                'ctas' => [['label' => 'A', 'href' => '/a'], ['label' => '', 'href' => ''], ['label' => 'B', 'href' => 'javascript:x'], ['label' => 'C', 'href' => '/c']],
            ]],
        ]]]);
        $this->assertSame(
            ['headline' => 'H', 'ctas' => [['label' => 'A', 'href' => '/a'], ['label' => 'B', 'href' => '']]],
            collect($doc['homepage']['sections'])->firstWhere('id', 'hero')['content'],
        );
    }
}
