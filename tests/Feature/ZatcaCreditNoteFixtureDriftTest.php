<?php

namespace Tests\Feature;

use App\Support\ZatcaCreditNoteXml;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * REM-18a — حارس انجراف fixtures إشعار الدائن لـ SDK، بالآلية نفسها لـ`ZatcaSdkFixtureDriftTest` (REM-11): بلا قاعدة
 * بيانات ولا ساعة ولا UUID عشوائي، يقارن SHA-256 لمخرجات `ZatcaCreditNoteXml` بالبصمات الثابتة DIGESTS، وتُقارَن الملفات
 * المحلية بايتاً ببايت حيث تتوفر. مطابقة ملفات الـfixtures الملتزَم بها لهذه البصمات يفحصها
 * `scripts/zatca-sdk/tests/test_repo_guards.py` (يقرأ هذا الملف) في workflow الـSDK.
 *
 * مواصفات القيم في `ZatcaCreditNoteFixtureSpecs`، ويثبت `ZatcaCreditNoteRealServiceParityTest` أنها ما خزّنته الخدمات
 * الحقيقية وأن XML المبني منها هو نفسه المبني من الإشعار المرحَّل.
 *
 * التحديث المتعمَّد (محلياً فقط، ثم راجع فرق git وأعد تسجيل baseline):
 *   ZATCA_SDK_FIXTURES_UPDATE=1 php artisan test --filter=ZatcaCreditNoteFixtureDriftTest
 */
class ZatcaCreditNoteFixtureDriftTest extends TestCase
{
    use ZatcaCreditNoteFixtureSpecs;

    private const FIXTURE_DIR = __DIR__ . '/../Fixtures/zatca-sdk/awj';

    /** SHA-256 لمخرجات المولِّد لكل fixture. تُحدَّث مع الملفات وbaseline في الـPR نفسه. */
    private const DIGESTS = [
        'awj-note-standard-refund-single-line' => '3229e328348f7fe2a471a0f10e2c9c9c9e6f89f27f670a6520b05666bd16573e',
        'awj-note-standard-multi-line-discounts' => '7c45f548728abdc3f4867d47ae7792b2370e8f9b3cb7309c714fd796375a8bdb',
        'awj-note-simplified-refund-single-line' => '879619588678edf9c45629d7b88522c4fabfbdf098f9f5dc54ab50c15236ce16',
        'awj-note-simplified-two-lines-partial' => '09a8f0041ee64deeb334f1d791798b6ac703375a9ab46401f0403948b82882ec',
        'awj-note-standard-tax-inclusive' => '01231acac94ac69064bd7ff9ed9f9d64ed80c3c29eb1b88f14743420a7db01cb',
        'awj-note-standard-zero-rate' => '672fcc4bcaf8057e318eecd7923fbda64cd469216c1fc1a8e5b4c516942b0b7c',
    ];

    #[DataProvider('noteFixtureProvider')]
    public function test_generator_output_matches_the_committed_digest(string $name): void
    {
        $actual = $this->render($name);

        if (getenv('ZATCA_SDK_FIXTURES_UPDATE') === '1') {
            if (! is_dir(self::FIXTURE_DIR)) {
                mkdir(self::FIXTURE_DIR, 0775, true);
            }
            file_put_contents(self::FIXTURE_DIR . "/{$name}.xml", $actual);
            fwrite(STDERR, sprintf("DIGEST '%s' => '%s',\n", $name, hash('sha256', $actual)));
        }

        $this->assertArrayHasKey($name, self::DIGESTS);
        $this->assertSame(
            self::DIGESTS[$name],
            hash('sha256', $actual),
            "ZatcaCreditNoteXml output for {$name} drifted from the committed digest. If intended, regenerate with "
            . 'ZATCA_SDK_FIXTURES_UPDATE=1, paste the printed DIGESTs, and re-record the SDK baseline.'
        );

        $path = self::FIXTURE_DIR . "/{$name}.xml";
        if (is_file($path)) {
            $this->assertSame($actual, (string) file_get_contents($path), "Committed fixture {$name}.xml differs from generator output.");
        }
    }

    public function test_digest_table_and_specs_list_the_same_fixtures(): void
    {
        $this->assertSame(array_keys(self::DIGESTS), self::noteFixtureNames());
    }

    private function render(string $name): string
    {
        $input = self::noteInputFromSpec($name);

        // Phase-1 QR كما يفعل مسار الفاتورة (ZatcaService::attachQr) — الإشعار غير موقَّع هنا؛ التوقيع من خط REM-17 بلا تغيير.
        return ZatcaCreditNoteXml::withQr(ZatcaCreditNoteXml::build($input), ZatcaCreditNoteXml::phaseOneQr($input));
    }
}
