<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V6a (V0 §8.1–8.2) — البطل لكل instance: محتوى (عنوان/فرعي/≤2 CTA) بنقاط ترميز، سقف 3 نسخ،
 * وتوافق رجعي (بطل بلا محتوى يقرأ النص القديم). الحالات مشتركة مع توأمَي TS عبر
 * `tests/Fixtures/presentation/hero-content.json`، فلا ينحرف أحد الثلاثة بصمت.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationHeroContentTest
 */
class StorefrontPresentationHeroContentTest extends TestCase
{
    private StorefrontPresentationNormalizer $normalizer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->normalizer = new StorefrontPresentationNormalizer();
    }

    /** @return array<string, mixed>|null */
    private function contentOf(mixed $input): ?array
    {
        $normalized = $this->normalizer->normalize([
            'version' => 3,
            'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'content' => $input]]],
        ]);
        $row = collect($normalized['homepage']['sections'])->firstWhere('id', 'hero');
        $this->assertNotNull($row, 'the hero section itself must survive normalization');

        return $row['content'] ?? null;
    }

    /** @test */
    public function the_shared_fixture_cases_normalize_identically_including_key_order(): void
    {
        $fixture = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/hero-content.json'), true);
        $this->assertNotEmpty($fixture['cases']);

        foreach ($fixture['cases'] as $case) {
            $this->assertSame('hero', $case['type']);
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
    public function only_a_hero_accepts_hero_content(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 3,
            'homepage' => ['sections' => [
                ['id' => 'cats', 'type' => 'categories', 'visible' => true, 'content' => ['headline' => 'H']],
                ['id' => 'who', 'type' => 'wholesale', 'visible' => true, 'content' => ['headline' => 'H']],
            ]],
        ]);

        foreach ($normalized['homepage']['sections'] as $row) {
            $this->assertArrayNotHasKey('content', $row);
        }
    }

    /** @test */
    public function several_heroes_are_kept_in_order_and_capped_at_three(): void
    {
        $this->assertSame(3, StorefrontPresentationNormalizer::MAX_HERO_INSTANCES);
        $heroes = [];
        foreach (range(1, 5) as $i) {
            $heroes[] = ['id' => "hero-$i", 'type' => 'hero', 'visible' => true, 'content' => ['headline' => "H$i"]];
        }
        $normalized = $this->normalizer->normalize([
            'version' => 3,
            'homepage' => ['sections' => [...$heroes, ['id' => 'cats', 'type' => 'categories', 'visible' => true]]],
        ]);

        $this->assertSame(['hero-1', 'hero-2', 'hero-3', 'cats'], array_column($normalized['homepage']['sections'], 'id'));
        $this->assertSame(['headline' => 'H3'], $normalized['homepage']['sections'][2]['content']);
    }

    /** @test */
    public function zero_heroes_are_allowed_in_a_v2_document(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 3,
            'homepage' => ['sections' => [['id' => 'cats', 'type' => 'categories', 'visible' => true]]],
        ]);

        $this->assertNotContains('hero', array_column($normalized['homepage']['sections'], 'type'));
    }

    /** @test */
    public function a_hero_without_content_stays_without_content_and_the_legacy_globals_are_untouched(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 3,
            'homepage' => [
                'heroHeadline' => 'Legacy',
                'heroSubheadline' => 'Line',
                'sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true]],
            ],
        ]);

        $this->assertSame(['id' => 'hero', 'type' => 'hero', 'visible' => true], $normalized['homepage']['sections'][0]);
        $this->assertSame('Legacy', $normalized['homepage']['heroHeadline']);
        $this->assertSame('Line', $normalized['homepage']['heroSubheadline']);
    }

    /** @test */
    public function the_default_document_keeps_exactly_one_visible_hero_without_content(): void
    {
        $default = $this->normalizer->defaultConfig();
        $heroes = array_values(array_filter($default['homepage']['sections'], static fn (array $s): bool => $s['type'] === 'hero'));

        $this->assertCount(1, $heroes);
        $this->assertTrue($heroes[0]['visible']);
        $this->assertArrayNotHasKey('content', $heroes[0]);
    }
}
