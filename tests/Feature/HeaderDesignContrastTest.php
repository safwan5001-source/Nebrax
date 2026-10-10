<?php

namespace Tests\Feature;

use App\Support\Commerce\HeaderDesignContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V7b — بوّابة تباين ألوان الترويسة الصريحة. الحالات المشتركة في
 * `tests/Fixtures/presentation/header-contrast.json` يقرؤها توأما TS أيضاً.
 */
class HeaderDesignContrastTest extends TestCase
{
    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/header-contrast.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            $config = $case['config'];
            $design = $config['design'];
            unset($config['design']);
            $issues = HeaderDesignContrast::issues($design, $config);
            $this->assertCount(count($case['expected']), $issues, $case['name']);
            foreach ($case['expected'] as $i => $expected) {
                $this->assertSame($expected['field'], $issues[$i]['field'], $case['name']);
                $this->assertSame($expected['code'], $issues[$i]['code'], $case['name']);
                $this->assertEqualsWithDelta($expected['ratio'], $issues[$i]['ratio'], 0.006, $case['name']);
            }
        }
    }

    /** @test */
    public function errors_carry_the_exact_path_and_only_for_a_normalised_document(): void
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $bad = $normalizer->normalize(['header' => ['design' => [
            'surface' => ['background' => ['hex' => '#12372a']],
            'text' => ['hex' => '#1f2937'],
            'icon' => ['hex' => '#1f2937'],
        ]]]);
        $errors = HeaderDesignContrast::errors($bad);
        $this->assertSame(['header.design.text', 'header.design.icon'], array_keys($errors));
        $this->assertSame('contrast_insufficient', $errors['header.design.text']['code']);

        $auto = $normalizer->normalize(['header' => ['design' => ['surface' => ['background' => ['hex' => '#12372a']]]]]);
        $this->assertSame([], HeaderDesignContrast::errors($auto));
        $this->assertSame([], HeaderDesignContrast::errors($normalizer->normalize([])));
    }

    /** @test */
    public function the_publish_validator_rejects_an_unreadable_header(): void
    {
        $validator = app(\App\Support\Commerce\StorefrontPresentationPublishValidator::class);
        $normalizer = new StorefrontPresentationNormalizer;
        $errors = $validator->errors($normalizer->normalize(['header' => ['design' => ['text' => ['hex' => '#ffffff']]]]));
        $this->assertArrayHasKey('header.design.text', $errors);
        $this->assertSame([], array_filter($validator->errors($normalizer->normalize(['header' => ['design' => ['text' => ['hex' => '#111827']]]])), fn ($key) => str_starts_with($key, 'header.'), ARRAY_FILTER_USE_KEY));
    }
}
