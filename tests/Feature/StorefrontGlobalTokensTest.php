<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontGlobalTokensNormalizer;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V5e-2a — الرموز العامة `typography` · `surfaces` · `layout` · `motion` (V0 §5.1، §6.2،
 * §6.3، §6.6): مفاتيح اختيارية إضافية، الإصدار يبقى 3. نفس ملف الحالات يشغّله توأما TS
 * (`global-tokens.test.ts` في web وstorefront).
 */
class StorefrontGlobalTokensTest extends TestCase
{
    /** @return array<string,mixed> */
    private function normalize(array $input): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($input);
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/global-tokens.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            $this->assertSame($case['expected'], StorefrontGlobalTokensNormalizer::normalize($case['input']), $case['name']);

            // والوثيقة الكاملة تحمل المفاتيح نفسها (وأي مفتاح غائب لا يظهر).
            $config = $this->normalize($case['input']);
            foreach (['typography', 'surfaces', 'layout', 'motion'] as $key) {
                if (array_key_exists($key, $case['expected'])) {
                    $this->assertSame($case['expected'][$key], $config[$key], $case['name'].' → '.$key);
                } else {
                    $this->assertArrayNotHasKey($key, $config, $case['name'].' → '.$key);
                }
            }
        }
    }

    /** @test */
    public function a_document_without_global_tokens_is_byte_identical_and_the_version_stays_three(): void
    {
        $plain = $this->normalize([]);
        foreach (['typography', 'surfaces', 'layout', 'motion'] as $key) {
            $this->assertArrayNotHasKey($key, $plain);
        }
        $this->assertSame(3, $plain['version']);
        $this->assertSame($plain, $this->normalize(['typography' => [], 'surfaces' => 'x', 'layout' => ['contentWidth' => 'huge'], 'motion' => ['duration' => 5]]));
    }

    /** @test */
    public function the_normalisation_is_idempotent_and_leaves_the_legacy_presets_untouched(): void
    {
        $once = $this->normalize([
            'radius' => 'subtle',
            'density' => 'compact',
            'surfaces' => ['radius' => 'lg', 'border' => ['width' => 'medium'], 'shadow' => 'soft'],
            'layout' => ['contentWidth' => 'narrow'],
            'typography' => ['headingScale' => 'lg', 'headingWeight' => 700],
            'motion' => ['duration' => 'base', 'easing' => 'standard'],
        ]);
        $this->assertSame('subtle', $once['radius']);
        $this->assertSame('compact', $once['density']);
        $this->assertSame($once, $this->normalize($once));
    }
}
