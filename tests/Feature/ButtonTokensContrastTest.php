<?php

namespace Tests\Feature;

use App\Support\Commerce\ButtonTokensContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V5e-2b — بوّابة تباين تسمية الأزرار العامة. الحالات المشتركة في
 * `tests/Fixtures/presentation/button-contrast.json` يقرؤها توأما TS أيضاً.
 */
class ButtonTokensContrastTest extends TestCase
{
    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/button-contrast.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            $issues = ButtonTokensContrast::issues($case['config']);
            $this->assertCount(count($case['expected']), $issues, $case['name']);
            foreach ($case['expected'] as $i => $expected) {
                $this->assertSame($expected['field'], $issues[$i]['field'], $case['name']);
                $this->assertSame($expected['code'], $issues[$i]['code'], $case['name']);
                $this->assertEqualsWithDelta($expected['ratio'], $issues[$i]['ratio'], 0.006, $case['name']);
            }
        }
    }

    /** @test */
    public function errors_come_back_with_the_exact_path_and_only_for_a_normalised_document(): void
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $bad = $normalizer->normalize(['primaryColor' => '#fde68a', 'buttons' => ['style' => 'outline']]);
        $errors = ButtonTokensContrast::errors($bad);
        $this->assertSame(['buttons.colour'], array_keys($errors));
        $this->assertSame('contrast_insufficient', $errors['buttons.colour']['code']);

        $ok = $normalizer->normalize(['primaryColor' => '#fde68a', 'buttons' => ['style' => 'solid']]);
        $this->assertSame([], ButtonTokensContrast::errors($ok));
        $this->assertSame([], ButtonTokensContrast::errors($normalizer->normalize([])));
    }
}
