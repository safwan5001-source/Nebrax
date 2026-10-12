<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V11 — توافق رجعي (V0 §2.2): مستند يستعمل مفاتيح ما قبل CUST-HV فقط يجب أن يخرج من المُطبِّع الحالي
 * بايتاً ببايت كما خرج من مُطبِّع ما قبل الأفق (commit 2a068b8c)، فلا يظهر مفتاح جديد لمستند لم يخترْه.
 * الناتج المتوقع في `tests/Fixtures/presentation/pre-hv-golden.json` مأخوذ من تشغيل ذلك الملف نفسه، وتشاركه توائم الويب والتطبيق التاجري.
 *
 * تشغيل: php artisan test --filter=PreHvBackwardCompatibilityTest
 */
class PreHvBackwardCompatibilityTest extends TestCase
{
    /** @return array{input:array<string,mixed>,expected:array<string,mixed>} */
    private function golden(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/pre-hv-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    private function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** @test */
    public function a_pre_horizon_document_normalizes_exactly_as_it_did_before_the_horizon(): void
    {
        $golden = $this->golden();
        $out = (new StorefrontPresentationNormalizer)->normalize($golden['input']);

        $this->assertSame($this->encode($golden['expected']), $this->encode($out));
    }

    /** @test */
    public function the_golden_output_is_a_fixed_point(): void
    {
        $golden = $this->golden();
        $normalizer = new StorefrontPresentationNormalizer;

        $this->assertSame($this->encode($golden['expected']), $this->encode($normalizer->normalize($golden['expected'])));
    }

    /** @test */
    public function no_horizon_only_key_appears_for_a_document_that_never_chose_one(): void
    {
        $out = $this->encode((new StorefrontPresentationNormalizer)->normalize($this->golden()['input']));

        foreach (['"cards"', '"zoom"', '"surfaces"', '"motion"', '"typography"', '"contentWidth"', '"slider"', '"gallery"', '"design"', '"titleOverride"', '"showTitle"'] as $key) {
            $this->assertStringNotContainsString($key, $out, "{$key} must not appear for a pre-Horizon document");
        }
    }
}
