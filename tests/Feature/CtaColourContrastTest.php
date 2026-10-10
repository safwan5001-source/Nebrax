<?php

namespace Tests\Feature;

use App\Support\Commerce\CtaColourContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use Tests\TestCase;

/**
 * CUST-HV V6c-6 — بوّابة تباين لون زرّ الـCTA عند النشر (V0 §6.1).
 *
 * الحالات المشتركة في `tests/Fixtures/presentation/cta-colour.json` يقرؤها اختبارا web وstorefront أيضاً: المحرّر
 * والخادم يشغّلان الخوارزمية ذاتها.
 *
 * تشغيل: php artisan test --filter=CtaColourContrastTest
 */
class CtaColourContrastTest extends TestCase
{
    /** @return array<string, array{array<string,mixed>}> */
    public static function parityCases(): array
    {
        $cases = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/cta-colour.json'), true, 512, JSON_THROW_ON_ERROR)['cases'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /**
     * @test
     *
     * @dataProvider parityCases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_gate_matches_the_shared_cases(array $case): void
    {
        $media = $case['media'] ?? [];
        $actual = CtaColourContrast::issues(
            $case['type'],
            $case['ctas'],
            $case['design'] ?? null,
            $case['config'],
            static fn (array $ref): ?array => $media[$ref['mediaId']] ?? null,
        );

        $this->assertSame(
            array_map(static fn (array $i): array => [$i['index'], $i['code']], $case['expected']),
            array_map(static fn (array $i): array => [$i['index'], $i['code']], $actual),
            $case['name'],
        );
        foreach ($case['expected'] as $i => $expected) {
            $this->assertEqualsWithDelta($expected['ratio'], $actual[$i]['ratio'], 1e-4, $case['name']);
        }
    }

    /**
     * @param  list<array<string,mixed>>  $ctas
     * @return array<string,mixed>
     */
    private function document(array $ctas, bool $visible = true, string $type = 'hero'): array
    {
        $content = $type === 'hero'
            ? ['headline' => 'H', 'ctas' => $ctas]
            : ['title' => 'T', 'ctas' => $ctas];

        return (new StorefrontPresentationNormalizer)->normalize([
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => $type, 'type' => $type, 'visible' => $visible, 'content' => $content]]],
        ]);
    }

    /** @test */
    public function a_failing_colour_is_reported_at_the_exact_button_path(): void
    {
        $errors = (new StorefrontPresentationPublishValidator)->errors($this->document([
            ['label' => 'A', 'href' => '/a', 'style' => 'solid', 'colour' => 'text'],
            ['label' => 'B', 'href' => '/b', 'style' => 'outline', 'colour' => 'brand'],
        ]));

        $this->assertSame(['homepage.sections[0].content.ctas[1].colour'], array_keys($errors));
        $this->assertSame('contrast_insufficient', $errors['homepage.sections[0].content.ctas[1].colour']['code']);
    }

    /** @test */
    public function a_passing_or_uncoloured_or_solid_button_blocks_nothing(): void
    {
        $validator = new StorefrontPresentationPublishValidator;
        $this->assertSame([], $validator->errors($this->document([
            ['label' => 'A', 'href' => '/a', 'style' => 'solid', 'colour' => 'text'],
            ['label' => 'B', 'href' => '/b', 'style' => 'soft', 'colour' => 'brand'],
        ])));
        $this->assertSame([], $validator->errors($this->document([
            ['label' => 'A', 'href' => '/a', 'style' => 'outline'],
            ['label' => 'B', 'href' => '/b', 'style' => 'link'],
        ])));
        $this->assertSame([], $validator->errors($this->document([
            ['label' => 'A', 'href' => '/a', 'style' => 'link', 'colour' => 'brand'],
        ], type: 'banner')));
    }

    /** @test */
    public function a_hidden_section_does_not_block_publishing(): void
    {
        $this->assertSame([], (new StorefrontPresentationPublishValidator)->errors($this->document([
            ['label' => 'B', 'href' => '/b', 'style' => 'outline', 'colour' => 'brand'],
        ], visible: false)));
    }
}
