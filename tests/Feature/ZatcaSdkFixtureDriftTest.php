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
 * ولا UUID عشوائي) ويقارن SHA-256 للمخرجات بالبصمات الثابتة DIGESTS أدناه.
 *
 * لماذا بصمات لا ملفات؟ مشروع Laravel في CI يُركَّب بنسخ قوائم مجلدات محددة
 * (ci.yml/setup.sh)، وملفات tests/Fixtures/zatca-sdk لا تُنسخ إليه، وتعديل تلك
 * القوائم خارج نطاق هذا الـslice. فالمقارنة تتم على بصمات داخل هذا الملف؛
 * أما مطابقة ملفات الـfixtures الملتزَم بها لنفس البصمات فيفحصها
 * scripts/zatca-sdk/tests/test_repo_guards.py (يقرأ هذا الملف) في workflow
 * الـSDK الاستشاري. وحيث تتوفر الملفات محلياً يقارنها هذا الاختبار بايتاً ببايت.
 *
 * التحديث المتعمَّد (محلياً فقط، ثم راجع فرق git):
 *   ZATCA_SDK_FIXTURES_UPDATE=1 php artisan test --filter=ZatcaSdkFixtureDriftTest
 *   (يعيد كتابة الملفات ويطبع البصمات الجديدة لتلصقها في DIGESTS)، ثم أعد تسجيل
 *   baseline عبر scripts/zatca-sdk/conformance.py update-baseline.
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

    /** SHA-256 لمخرجات المولِّد لكل fixture. تُحدَّث مع الملفات وbaseline في الـPR نفسه. */
    private const DIGESTS = [
        'awj-simplified-single-line' => '62504f51c45f9f70d2883e0ebaccf904ba45a9316ef0ff8e3d6565041f179ad2',
        'awj-simplified-two-lines' => '4ddd2b0241d8067ef2d9c7e5ec8dfd0abb4627b20053d869863b112765d66c10',
        'awj-standard-single-line' => '544c4b48b9bdb225bbfdba0f52bee963b63cd6f83767b34397df321a487ead5e',
    ];

    #[DataProvider('fixtureProvider')]
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
            "ZatcaService output for {$name} drifted from the committed digest. If intended, regenerate with "
            . 'ZATCA_SDK_FIXTURES_UPDATE=1, paste the printed DIGESTs, and re-record the SDK baseline.'
        );

        // محلياً (حيث توجد ملفات الـfixtures) تُقارَن بايتاً ببايت أيضاً.
        $path = self::FIXTURE_DIR . "/{$name}.xml";
        if (is_file($path)) {
            $this->assertSame($actual, (string) file_get_contents($path), "Committed fixture {$name}.xml differs from generator output.");
        }
    }

    public function test_digest_table_and_data_provider_list_the_same_fixtures(): void
    {
        $this->assertSame(
            array_keys(self::DIGESTS),
            array_map(static fn (array $row) => $row[0], array_values(self::fixtureProvider())),
        );
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
        // REM-13a: لحظة الإصدار المخزَّنة (UTC) تُمثَّل في XML بتوقيت السعودية (AST) بلا Z — 07:30:00Z = 10:30:00 AST،
        // فيبقى IssueTime في الـfixtures كما كان؛ يتغيّر فقط نصّ الوسم 3 في QR (صيغة المرحلة الأولى من لحظة UTC).
        $invoice->setAttribute('issued_at', CarbonImmutable::parse('2026-01-15 07:30:00', 'UTC'));

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
