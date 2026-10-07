<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V5a — `palette` (V0 §4.1): مفتاح اختياري إضافي، الإصدار يبقى 3. نفس ملف
 * الحالات يشغّله توأما TS (`palette.test.ts` في web وstorefront).
 */
class StorefrontPresentationPaletteTest extends TestCase
{
    /** @return array<string,mixed> */
    private function normalize(array $input): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($input);
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/palette.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            $config = $this->normalize(['palette' => $case['input']]);
            if ($case['expected'] === null) {
                $this->assertArrayNotHasKey('palette', $config, $case['name']);
            } else {
                $this->assertSame($case['expected'], $config['palette'], $case['name']);
                $this->assertSame(array_keys($case['expected']), array_keys($config['palette']), $case['name'].' (order)');
            }
        }
    }

    /** @test */
    public function a_document_without_palette_is_byte_identical_and_the_version_stays_three(): void
    {
        $plain = $this->normalize([]);
        $this->assertArrayNotHasKey('palette', $plain);
        $this->assertSame(3, $plain['version']);
        $this->assertSame($plain, $this->normalize(['palette' => []]));
        $this->assertSame($plain, $this->normalize(['palette' => ['text' => 'nope']]));
    }

    /** @test */
    public function the_normalisation_is_idempotent_and_leaves_brand_and_accent_untouched(): void
    {
        $once = $this->normalize(['primaryColor' => '#12372a', 'accentColor' => '#C8A24A', 'palette' => ['SURFACE' => '#fff', 'surface' => '#FAFAFA']]);
        $this->assertSame(['surface' => '#fafafa'], $once['palette']);
        $this->assertSame('#12372a', $once['primaryColor']);
        $this->assertSame('#C8A24A', $once['accentColor']);
        $this->assertSame($once, $this->normalize($once));
    }
}
