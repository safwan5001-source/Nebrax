<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ZatcaService;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use Tests\TestCase;

/**
 * REM-11 — حارس انجراف مخرجات XML الخاصة بـ AWJ مقابل الـfixtures الملتزَم بها.
 *
 * الـfixtures في tests/Fixtures/zatca-sdk/awj/ هي المدخلات التي يفحصها harness
 * الـSDK الرسمي (scripts/zatca-sdk/) في CI. فلو تغيّر مولِّد XML دون تحديث
 * الـfixtures، لفحص الـharness مستنداً لم يعد ما يُنتجه التطبيق. هذا الاختبار
 * يمنع ذلك: يعيد البناء من بيانات اصطناعية ثابتة (بلا قاعدة بيانات وبلا ساعة
 * ولا UUID عشوائي) ويقارن بايتاً ببايت.
 *
 * التحديث المتعمَّد (محلياً فقط، ثم راجع فرق git):
 *   ZATCA_SDK_FIXTURES_UPDATE=1 php artisan test --filter=ZatcaSdkFixtureDriftTest
 *   ثم أعد تسجيل baseline عبر scripts/zatca-sdk/conformance.py --update-baseline.
 *
 * بيانات اصطناعية بحتة: رقم ضريبي تجريبي معروف، لا بيانات مكلّف حقيقية،
 * ولا مفاتيح أو شهادات. يُنتج المسار غير الموقّع (المرحلة الأولى) فقط؛ المسار
 * الموقّع يتطلب اعتماداً ومؤجَّل صراحةً.
 */
class ZatcaSdkFixtureDriftTest extends TestCase
{
    private const FIXTURE_DIR = __DIR__ . '/../Fixtures/zatca-sdk/awj';

    /** @return array<string, array{0:string}> */
    public static function fixtureProvider(): array
    {
        return [
            'simplified single line' => ['awj-simplified-single-line'],
            'simplified two lines'   => ['awj-simplified-two-lines'],
            'standard single line'   => ['awj-standard-single-line'],
        ];
    }

    #[DataProvider('fixtureProvider')]
    public function test_committed_fixture_matches_current_generator(string $name): void
    {
        $actual = $this->render($name);
        $path = self::FIXTURE_DIR . "/{$name}.xml";

        if (getenv('ZATCA_SDK_FIXTURES_UPDATE') === '1') {
            if (! is_dir(self::FIXTURE_DIR)) {
                mkdir(self::FIXTURE_DIR, 0775, true);
            }
            file_put_contents($path, $actual);
        }

        $this->assertFileExists($path, "Missing fixture {$name}.xml — regenerate with ZATCA_SDK_FIXTURES_UPDATE=1.");
        $this->assertSame(
            $actual,
            (string) file_get_contents($path),
            "Fixture {$name}.xml drifted from ZatcaService output. If the change is intended, regenerate with "
            . 'ZATCA_SDK_FIXTURES_UPDATE=1 and re-record the SDK baseline.'
        );
    }

    public function test_fixture_directory_has_no_unlisted_files(): void
    {
        $expected = array_map(static fn (array $row) => $row[0] . '.xml', array_values(self::fixtureProvider()));
        $found = array_map('basename', glob(self::FIXTURE_DIR . '/*') ?: []);
        sort($expected);
        sort($found);

        $this->assertSame($expected, $found, 'tests/Fixtures/zatca-sdk/awj must contain exactly the provider fixtures.');
    }

    public function test_fixtures_carry_no_key_material_or_real_looking_secrets(): void
    {
        foreach (glob(self::FIXTURE_DIR . '/*.xml') ?: [] as $file) {
            $body = (string) file_get_contents($file);
            $this->assertStringNotContainsString('PRIVATE KEY', $body, basename($file));
            $this->assertStringNotContainsString('BEGIN CERTIFICATE', $body, basename($file));
            $this->assertStringContainsString('<cbc:CompanyID>300000000000003</cbc:CompanyID>', $body, basename($file));
        }
    }

    private function render(string $name): string
    {
        $spec = $this->spec($name);

        $tenant = (new Tenant())->forceFill([
            'name'       => 'Synthetic Seller Co',
            'vat_number' => '300000000000003',
        ]);

        $invoice = new Invoice();
        $invoice->forceFill([
            'number'              => $spec['number'],
            'zatca_document_type' => $spec['doc'],
            'subtotal'            => $spec['subtotal'],
            'tax_amount'          => $spec['tax'],
            'total'               => $spec['total'],
        ]);
        $invoice->setAttribute('created_at', CarbonImmutable::parse('2026-01-15 10:30:00', 'UTC'));

        $lines = [];
        foreach ($spec['lines'] as $row) {
            $line = new InvoiceLine();
            $line->forceFill([
                'description'   => $row['desc'],
                'quantity'      => $row['qty'],
                'unit_price'    => $row['price'],
                'line_subtotal' => $row['subtotal'],
            ]);
            $lines[] = $line;
        }
        $invoice->setRelation('lines', collect($lines));
        $invoice->setRelation('partner', (new Partner())->forceFill(['name' => 'Synthetic Buyer']));

        $service = app(ZatcaService::class);

        $build = new ReflectionMethod($service, 'buildXml');
        $build->setAccessible(true);
        $unsigned = $build->invoke(
            $service,
            $invoice,
            $tenant,
            $spec['uuid'],
            $spec['icv'],
            $service->genesisHash(),
        );

        $attach = new ReflectionMethod($service, 'attachQr');
        $attach->setAccessible(true);

        return $attach->invoke($service, $unsigned, $service->qrFor($invoice, $tenant));
    }

    /** @return array<string, mixed> */
    private function spec(string $name): array
    {
        return match ($name) {
            'awj-simplified-single-line' => [
                'number' => 'SIM-000001', 'doc' => 'simplified', 'icv' => 1,
                'uuid' => '8e6000cf-1a98-4174-b3e7-b5d5954bc10d',
                'subtotal' => 10000, 'tax' => 1500, 'total' => 11500,
                'lines' => [['desc' => 'Item A', 'qty' => 1, 'price' => 10000, 'subtotal' => 10000]],
            ],
            'awj-simplified-two-lines' => [
                'number' => 'SIM-000002', 'doc' => 'simplified', 'icv' => 2,
                'uuid' => '2f5f6a4e-7c1d-4e0a-9d3b-6b1c8a7e4f21',
                'subtotal' => 35000, 'tax' => 5250, 'total' => 40250,
                'lines' => [
                    ['desc' => 'Item A', 'qty' => 2, 'price' => 10000, 'subtotal' => 20000],
                    ['desc' => 'Item B', 'qty' => 3, 'price' => 5000, 'subtotal' => 15000],
                ],
            ],
            'awj-standard-single-line' => [
                'number' => 'INV-000003', 'doc' => 'standard', 'icv' => 3,
                'uuid' => 'c3a9f0b2-5d44-4b8e-8a17-0e9d2f6b7c35',
                'subtotal' => 50000, 'tax' => 7500, 'total' => 57500,
                'lines' => [['desc' => 'Service X', 'qty' => 1, 'price' => 50000, 'subtotal' => 50000]],
            ],
            default => throw new \InvalidArgumentException("Unknown fixture {$name}"),
        };
    }
}
