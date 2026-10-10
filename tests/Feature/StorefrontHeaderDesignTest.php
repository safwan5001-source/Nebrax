<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontHeaderDesignNormalizer;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V7a — تصميم الترويسة البنيوي `header.design` (V0 §9.1): مفتاح اختياري إضافي،
 * الإصدار يبقى 3. نفس ملف الحالات يشغّله توأما TS (`header-design.test.ts` في web وstorefront).
 */
class StorefrontHeaderDesignTest extends TestCase
{
    /** @return array<string,mixed> */
    private function normalize(array $input): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($input);
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/header-design.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            $this->assertSame($case['expected'], StorefrontHeaderDesignNormalizer::normalize($case['input']), $case['name']);

            $config = $this->normalize(['header' => ['design' => $case['input']]]);
            if ($case['expected'] === null) {
                $this->assertArrayNotHasKey('design', $config['header'], $case['name']);
            } else {
                $this->assertSame($case['expected'], $config['header']['design'], $case['name']);
            }
        }
    }

    /** @test */
    public function a_document_without_header_design_is_byte_identical_and_the_version_stays_three(): void
    {
        $plain = $this->normalize([]);
        $this->assertArrayNotHasKey('design', $plain['header']);
        $this->assertSame(3, $plain['version']);
        $this->assertSame($plain, $this->normalize(['header' => ['design' => ['layout' => 'mega', 'sticky' => 'on-scroll-up']]]));
    }

    /** @test */
    public function the_design_rides_beside_the_legacy_header_fields_without_touching_them(): void
    {
        $config = $this->normalize(['header' => [
            'style' => 'compact',
            'showSearch' => false,
            'design' => ['layout' => 'centered'],
        ]]);
        $this->assertSame('compact', $config['header']['style']);
        $this->assertFalse($config['header']['showSearch']);
        $this->assertSame(['layout' => 'centered'], $config['header']['design']);
        $this->assertSame(['style', 'showSearch', 'showAccount', 'showCart', 'showCategoryNav', 'links', 'design'], array_keys($config['header']));
    }
}
