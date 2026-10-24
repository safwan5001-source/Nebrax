<?php

namespace Tests\Feature;

use App\Support\Commerce\FooterDesignContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use Tests\TestCase;

/**
 * CUST-HV V7e-1 — تخطيط التذييل ومجموعاته وتصميمه (V0 §10): مفاتيح اختيارية إضافية داخل `footer`، الإصدار يبقى 3.
 * نفس ملفَّي الحالات يشغّلهما توأما TS (`footer-design.test.ts` في web وstorefront).
 */
class StorefrontFooterDesignTest extends TestCase
{
    /** @return array<string,mixed> */
    private function normalize(array $input): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($input);
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/footer-design.json'), true, 512, JSON_THROW_ON_ERROR);
        $this->assertNotEmpty($fixture['cases']);
        foreach ($fixture['cases'] as $case) {
            $footer = $this->normalize(['footer' => $case['input']])['footer'];
            $extras = array_intersect_key($footer, array_flip(['layout', 'groups', 'design', 'paymentLogos']));
            if ($case['expected'] === null) {
                $this->assertSame([], $extras, $case['name']);
            } else {
                $this->assertSame($case['expected'], $extras, $case['name']);
                $this->assertSame(array_keys($case['expected']), array_keys($extras), $case['name']);
            }
        }
    }

    /** @test */
    public function a_footer_without_the_new_keys_is_byte_identical_and_the_version_stays_three(): void
    {
        $plain = $this->normalize([]);
        $this->assertSame(['tagline', 'showLogo', 'copyright'], array_keys($plain['footer']));
        $this->assertSame(3, $plain['version']);
        $this->assertSame($plain, $this->normalize(['footer' => ['layout' => 'mega', 'groups' => 'x', 'design' => ['align' => 'left']]]));
    }

    /** @test */
    public function the_new_keys_ride_after_the_legacy_footer_fields_without_touching_them(): void
    {
        $footer = $this->normalize(['footer' => [
            'tagline' => 'Hello',
            'copyright' => 'c',
            'layout' => 'centered',
            'groups' => [['id' => 'g', 'title' => 'G']],
            'design' => ['align' => 'center'],
        ]])['footer'];
        $this->assertSame('Hello', $footer['tagline']);
        $this->assertSame(['tagline', 'showLogo', 'copyright', 'layout', 'groups', 'design'], array_keys($footer));
    }

    /** @test */
    public function the_shared_contrast_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/footer-contrast.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            $config = $case['config'];
            $design = $config['design'];
            unset($config['design']);
            $issues = FooterDesignContrast::issues($design, $config);
            $this->assertCount(count($case['expected']), $issues, $case['name']);
            foreach ($case['expected'] as $i => $expected) {
                $this->assertSame($expected['field'], $issues[$i]['field'], $case['name']);
                $this->assertSame($expected['code'], $issues[$i]['code'], $case['name']);
                $this->assertEqualsWithDelta($expected['ratio'], $issues[$i]['ratio'], 0.006, $case['name']);
            }
        }
    }

    /** @test */
    public function contrast_errors_carry_the_exact_path_and_only_for_a_normalised_document(): void
    {
        $bad = $this->normalize(['footer' => ['design' => [
            'surface' => ['background' => ['hex' => '#f8fafc']],
            'text' => ['hex' => '#e2e8f0'],
            'link' => ['hex' => '#e2e8f0'],
        ]]]);
        $errors = FooterDesignContrast::errors($bad);
        $this->assertSame(['footer.design.text', 'footer.design.link'], array_keys($errors));
        $this->assertSame('contrast_insufficient', $errors['footer.design.text']['code']);

        $auto = $this->normalize(['footer' => ['design' => ['surface' => ['background' => ['hex' => '#12372a']]]]]);
        $this->assertSame([], FooterDesignContrast::errors($auto));
        $this->assertSame([], FooterDesignContrast::errors($this->normalize([])));
    }

    /** @test */
    public function the_publish_validator_rejects_an_unreadable_footer(): void
    {
        $validator = app(StorefrontPresentationPublishValidator::class);
        $errors = $validator->errors($this->normalize(['footer' => ['design' => ['heading' => ['hex' => '#111827']]]]));
        $this->assertArrayHasKey('footer.design.heading', $errors);
        $ok = $validator->errors($this->normalize(['footer' => ['design' => ['heading' => ['hex' => '#ffffff']]]]));
        $this->assertSame([], array_filter($ok, fn ($key) => str_starts_with($key, 'footer.'), ARRAY_FILTER_USE_KEY));
    }
}
