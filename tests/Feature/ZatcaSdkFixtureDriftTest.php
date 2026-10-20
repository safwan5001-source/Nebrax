<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Services\Accounting\ZatcaService;
use App\Support\ZatcaPartyXml;
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

    private const SA_ADDRESS = [
        'building_no' => '1111', 'street' => 'Synthetic Buyer Street', 'district' => 'Synthetic Quarter',
        'city' => 'Riyadh', 'postal_code' => '12222', 'country' => 'SA',
    ];

    /** @return array<string, array{0:string}> */
    public static function fixtureProvider(): array
    {
        return [
            'simplified single line' => ['awj-simplified-single-line'],
            'simplified two lines' => ['awj-simplified-two-lines'],
            'standard single line' => ['awj-standard-single-line'],
            'standard buyer crn' => ['awj-standard-buyer-crn'],
            'standard multi line' => ['awj-standard-multi-line'],
            'standard line discount' => ['awj-standard-line-discount'],
            'standard document discount' => ['awj-standard-document-discount'],
            'standard shipping' => ['awj-standard-shipping'],
            'standard tax inclusive' => ['awj-standard-tax-inclusive'],
            'standard small lines' => ['awj-standard-small-lines'],
            'standard fractional quantity' => ['awj-standard-fractional-quantity'],
            'standard zero rate' => ['awj-standard-zero-rate'],
            'standard adjustment' => ['awj-standard-adjustment'],
            'simplified document discount' => ['awj-simplified-document-discount'],
        ];
    }

    /** SHA-256 لمخرجات المولِّد لكل fixture. تُحدَّث مع الملفات وbaseline في الـPR نفسه. */
    private const DIGESTS = [
        'awj-simplified-single-line' => '865ab5141c77c3182c7605d52c83a723a021604152d881af815cdf2b30ac61fd',
        'awj-simplified-two-lines' => '11def6febe548000024c06f90722143e1eb429938069f22daee068c6b111e86a',
        'awj-standard-single-line' => '63d88386fbd06c8bcebbb2d337df8956fd07d43b0837288bf39fd56475b0831e',
        'awj-standard-buyer-crn' => '54e233cb9c2c17abf397fe8bacc5b8294e0dce3769a9e67d7bb539438edcb130',
        'awj-standard-multi-line' => '17936740d1f3ada65059d3bc266aa4708fb2878693379eac496ccb786ccae0be',
        'awj-standard-line-discount' => '6a425149d02a5ccba95a10af15b871b659aa06f381e1cf6e3087fde1cb1bf0d0',
        'awj-standard-document-discount' => '81be7ecb54c3d2fa6b57df3ebdefc65fdd6244abcb65740cfecef7ac5238954f',
        'awj-standard-shipping' => '4e8a2f48deba02846e012cf02ed6e4bdbc56eed5e05322caadac1a286191f849',
        'awj-standard-tax-inclusive' => '9a9ad7242cef82783924cbb0fea7a910dc989146cf6033f8d2bdc5350c045f92',
        'awj-standard-small-lines' => 'd014026edfc9cc9444a5cbd7fb56cf6612fdc830e6b3d30880c7d39bc0593fdb',
        'awj-standard-fractional-quantity' => '53a14546baa53cb73676992642f66e45e6e9f5817d0946124aaaf33d3e6a69e2',
        'awj-standard-zero-rate' => '4f9c9be84a5a61e459ba73ecee44bf58b84b0559ad511444abee60713ba20f86',
        'awj-standard-adjustment' => '7c077d947d68c3ffb350c458b4ca35407da16380f6a2422a1925c2cd4d144b4a',
        'awj-simplified-document-discount' => 'eee6557648977d83d9dcd3f7a66d621da9144c0b092c45af456b08f7e4cbeef8',
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

        $invoice = new Invoice();
        // REM-16: الحقول المالية كما يخزّنها InvoiceService::post() (القيم مأخوذة من فواتير حقيقية رُحِّلت عبر الخدمة).
        $invoice->forceFill([
            'number'              => $spec['number'],
            'zatca_document_type' => $spec['doc'],
        ] + $spec['invoice']);
        // REM-13a: لحظة الإصدار المخزَّنة (UTC) تُمثَّل في XML بتوقيت السعودية (AST) بلا Z — 07:30:00Z = 10:30:00 AST،
        // فيبقى IssueTime في الـfixtures كما كان؛ يتغيّر فقط نصّ الوسم 3 في QR (صيغة المرحلة الأولى من لحظة UTC).
        $invoice->setAttribute('issued_at', CarbonImmutable::parse('2026-01-15 07:30:00', 'UTC'));
        // REM-15a: الطرفان من لقطة party_snapshot v1 (لا Tenant/Partner حيّين) — بيانات اصطناعية بحتة.
        $invoice->setAttribute('party_snapshot', $this->snapshot($spec['buyer']));

        $lines = [];
        foreach ($spec['lines'] as $row) {
            $line = new InvoiceLine();
            $line->forceFill($row);
            $lines[] = $line;
        }
        $invoice->setRelation('lines', collect($lines));

        $service = app(ZatcaService::class);

        $build = new ReflectionMethod($service, 'buildXml');
        $build->setAccessible(true);
        $unsigned = $build->invoke(
            $service,
            $invoice,
            ZatcaPartyXml::requireSnapshot($invoice),
            $spec['uuid'],
            $spec['icv'],
            $service->genesisHash(),
        );

        $attach = new ReflectionMethod($service, 'attachQr');
        $attach->setAccessible(true);

        return $attach->invoke($service, $unsigned, $service->qrFor($invoice));
    }

    /**
     * لقطة v1 بالشكل الذي تنتجه InvoicePartySnapshot::capture (البائع ثابت، والمشتري يختلف بين الـfixtures).
     *
     * @param array<string, mixed> $buyer
     * @return array<string, mixed>
     */
    private function snapshot(array $buyer): array
    {
        return [
            'v' => 1,
            'seller' => [
                'tenant_id' => '00000000-0000-4000-8000-000000000001',
                'branch_id' => null,
                'name' => 'Synthetic Seller Co',
                'vat_number' => '300000000000003',
                'cr_number' => '2050000001',
                'country' => 'SA',
                'address' => [
                    'building_no' => '2322', 'street' => 'Synthetic Street', 'additional_no' => '1234',
                    'district' => 'Synthetic District', 'city' => 'Dammam', 'postal_code' => '32241',
                    'short_address' => null,
                ],
                'phone' => null,
                'mobile' => null,
            ],
            'buyer' => $buyer + [
                'partner_id' => '00000000-0000-4000-8000-000000000002',
                'entity_type' => 'commercial',
                'name_en' => null,
                'vat_number' => null,
                'cr_number' => null,
                'address' => [
                    'building_no' => null, 'street' => null, 'district' => null,
                    'city' => null, 'postal_code' => null, 'country' => null,
                ],
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function spec(string $name): array
    {
        return match ($name) {
            'awj-simplified-single-line' => [
                'number' => 'SIM-000001', 'doc' => 'simplified', 'icv' => 1,
                'uuid' => '8e6000cf-1a98-4174-b3e7-b5d5954bc10d',
                // مستهلك نقدي: اسم فقط، بلا عنوان ولا معرّف (B-1: لا عنوان ناقصاً في المبسّطة).
                'buyer' => ['name' => 'Synthetic Buyer'],
                'invoice' => ['subtotal' => 10000, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 1500, 'total' => 11500, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 1, 'unit_price' => 10000, 'unit_price_before_tax' => 10000, 'tax_rate' => 15, 'line_subtotal' => 10000, 'line_discount' => 0, 'line_tax' => 1500, 'line_total' => 11500],
                ],
            ],
            'awj-simplified-two-lines' => [
                'number' => 'SIM-000002', 'doc' => 'simplified', 'icv' => 2,
                'uuid' => '2f5f6a4e-7c1d-4e0a-9d3b-6b1c8a7e4f21',
                // مبسّطة بعنوان سعودي مكتمل ⇒ يُكتب (BR-KSA-63/67).
                'buyer' => ['name' => 'Synthetic Buyer', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 35000, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 5250, 'total' => 40250, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 2, 'unit_price' => 10000, 'unit_price_before_tax' => 10000, 'tax_rate' => 15, 'line_subtotal' => 20000, 'line_discount' => 0, 'line_tax' => 3000, 'line_total' => 23000],
                    ['description' => 'Item B', 'quantity' => 3, 'unit_price' => 5000, 'unit_price_before_tax' => 5000, 'tax_rate' => 15, 'line_subtotal' => 15000, 'line_discount' => 0, 'line_tax' => 2250, 'line_total' => 17250],
                ],
            ],
            'awj-standard-single-line' => [
                'number' => 'INV-000003', 'doc' => 'standard', 'icv' => 3,
                'uuid' => 'c3a9f0b2-5d44-4b8e-8a17-0e9d2f6b7c35',
                // ضريبية: مشترٍ مسجَّل ضريبياً (BT-48) بعنوان سعودي مكتمل.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 50000, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 7500, 'total' => 57500, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Service X', 'quantity' => 1, 'unit_price' => 50000, 'unit_price_before_tax' => 50000, 'tax_rate' => 15, 'line_subtotal' => 50000, 'line_discount' => 0, 'line_tax' => 7500, 'line_total' => 57500],
                ],
            ],
            'awj-standard-buyer-crn' => [
                'number' => 'INV-000004', 'doc' => 'standard', 'icv' => 4,
                'uuid' => '5b1d7e90-3a2c-4f6b-9c84-1d0e7a3f2b68',
                // ضريبية: مشترٍ غير مسجَّل ضريبياً ⇒ معرّف آخر BT-46 (CRN) بلا رقم ضريبي (BR-KSA-81).
                'buyer' => ['name' => 'Synthetic Buyer', 'cr_number' => '1010000002', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 50000, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 7500, 'total' => 57500, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Service Y', 'quantity' => 1, 'unit_price' => 50000, 'unit_price_before_tax' => 50000, 'tax_rate' => 15, 'line_subtotal' => 50000, 'line_discount' => 0, 'line_tax' => 7500, 'line_total' => 57500],
                ],
            ],
            'awj-standard-multi-line' => [
                'number' => 'INV-000005', 'doc' => 'standard', 'icv' => 5,
                'uuid' => '2dd0db6c-d0df-5428-9410-7490e03a7705',
                // أسطر متعددة S/15.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 37575, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 5636, 'total' => 43211, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 2, 'unit_price' => 10000, 'unit_price_before_tax' => 10000, 'tax_rate' => 15, 'line_subtotal' => 20000, 'line_discount' => 0, 'line_tax' => 3000, 'line_total' => 23000],
                    ['description' => 'Item B', 'quantity' => 3, 'unit_price' => 5000, 'unit_price_before_tax' => 5000, 'tax_rate' => 15, 'line_subtotal' => 15000, 'line_discount' => 0, 'line_tax' => 2250, 'line_total' => 17250],
                    ['description' => 'Item C', 'quantity' => 1, 'unit_price' => 2575, 'unit_price_before_tax' => 2575, 'tax_rate' => 15, 'line_subtotal' => 2575, 'line_discount' => 0, 'line_tax' => 386, 'line_total' => 2961],
                ],
            ],
            'awj-standard-line-discount' => [
                'number' => 'INV-000006', 'doc' => 'standard', 'icv' => 6,
                'uuid' => '6557a7b4-a022-5ebf-aa0d-cfcbf30a0564',
                // خصم سطر: LineExtensionAmount = line_subtotal − line_discount + AllowanceCharge على السطر.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 9000, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 1350, 'total' => 10350, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 2, 'unit_price' => 5000, 'unit_price_before_tax' => 5000, 'tax_rate' => 15, 'line_subtotal' => 10000, 'line_discount' => 1000, 'line_tax' => 1350, 'line_total' => 10350],
                ],
            ],
            'awj-standard-document-discount' => [
                'number' => 'INV-000007', 'doc' => 'standard', 'icv' => 7,
                'uuid' => 'ec2edf9a-4bbb-5b9e-9abf-96224598bd0a',
                // خصم مستند بفئة واحدة S/15 (لا توزيع على فئات): AllowanceCharge على المستند.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 50000, 'discount' => 5000, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 6750, 'total' => 51750, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 1, 'unit_price' => 30000, 'unit_price_before_tax' => 30000, 'tax_rate' => 15, 'line_subtotal' => 30000, 'line_discount' => 0, 'line_tax' => 4500, 'line_total' => 34500],
                    ['description' => 'Item B', 'quantity' => 1, 'unit_price' => 20000, 'unit_price_before_tax' => 20000, 'tax_rate' => 15, 'line_subtotal' => 20000, 'line_discount' => 0, 'line_tax' => 3000, 'line_total' => 23000],
                ],
            ],
            'awj-standard-shipping' => [
                'number' => 'INV-000008', 'doc' => 'standard', 'icv' => 8,
                'uuid' => '7751f797-57da-5c79-86e2-571f807ec44d',
                // شحن: AllowanceCharge(true) بنص بلا رمز سبب (BR-KSA-19 فجوة صريحة).
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 50000, 'discount' => 0, 'shipping' => 2000, 'adjustment' => 0, 'tax_amount' => 7800, 'total' => 59800, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 1, 'unit_price' => 50000, 'unit_price_before_tax' => 50000, 'tax_rate' => 15, 'line_subtotal' => 50000, 'line_discount' => 0, 'line_tax' => 7500, 'line_total' => 57500],
                ],
            ],
            'awj-standard-tax-inclusive' => [
                'number' => 'INV-000009', 'doc' => 'standard', 'icv' => 9,
                'uuid' => '902248fe-7db5-5eae-8786-7f075395f6c7',
                // تسعير شامل: PriceAmount = unit_price_before_tax المخزَّن؛ فرق التقريب ضمن تسامح SDK موثَّق.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 10026, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 1504, 'total' => 11530, 'tax_inclusive' => true],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 3, 'unit_price' => 10, 'unit_price_before_tax' => 9, 'tax_rate' => 15, 'line_subtotal' => 26, 'line_discount' => 0, 'line_tax' => 4, 'line_total' => 30],
                    ['description' => 'Item B', 'quantity' => 1, 'unit_price' => 11500, 'unit_price_before_tax' => 10000, 'tax_rate' => 15, 'line_subtotal' => 10000, 'line_discount' => 0, 'line_tax' => 1500, 'line_total' => 11500],
                ],
            ],
            'awj-standard-small-lines' => [
                'number' => 'INV-000010', 'doc' => 'standard', 'icv' => 10,
                'uuid' => '4db2c8c0-1ee3-5c38-9877-8b236e4b34ad',
                // أسطر صغيرة: ضريبة السطر المخزَّنة 5×0.02 = 0.10 مقابل 0.075→0.08 على مستوى المستند — تناقض موثَّق لا يلتقطه SDK.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 50, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 10, 'total' => 60, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item 1', 'quantity' => 1, 'unit_price' => 10, 'unit_price_before_tax' => 10, 'tax_rate' => 15, 'line_subtotal' => 10, 'line_discount' => 0, 'line_tax' => 2, 'line_total' => 12],
                    ['description' => 'Item 2', 'quantity' => 1, 'unit_price' => 10, 'unit_price_before_tax' => 10, 'tax_rate' => 15, 'line_subtotal' => 10, 'line_discount' => 0, 'line_tax' => 2, 'line_total' => 12],
                    ['description' => 'Item 3', 'quantity' => 1, 'unit_price' => 10, 'unit_price_before_tax' => 10, 'tax_rate' => 15, 'line_subtotal' => 10, 'line_discount' => 0, 'line_tax' => 2, 'line_total' => 12],
                    ['description' => 'Item 4', 'quantity' => 1, 'unit_price' => 10, 'unit_price_before_tax' => 10, 'tax_rate' => 15, 'line_subtotal' => 10, 'line_discount' => 0, 'line_tax' => 2, 'line_total' => 12],
                    ['description' => 'Item 5', 'quantity' => 1, 'unit_price' => 10, 'unit_price_before_tax' => 10, 'tax_rate' => 15, 'line_subtotal' => 10, 'line_discount' => 0, 'line_tax' => 2, 'line_total' => 12],
                ],
            ],
            'awj-standard-fractional-quantity' => [
                'number' => 'INV-000011', 'doc' => 'standard', 'icv' => 11,
                'uuid' => '93d802a7-eb1e-5848-8f8b-6fceacf6e19b',
                // كمية كسرية (1.234 L) بسعر 2.30 ⇒ مبلغ مقرَّب رسمي مخزَّن 2.84.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 284, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 43, 'total' => 327, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Fuel 95', 'quantity' => 1, 'unit_name' => 'L', 'unit_price' => 230, 'unit_price_before_tax' => 230, 'tax_rate' => 15, 'quantity_numerator' => 1234, 'quantity_denominator' => 1000, 'rounded_gross_minor' => 284, 'line_subtotal' => 284, 'line_discount' => 0, 'line_tax' => 43, 'line_total' => 327],
                ],
            ],
            'awj-standard-zero-rate' => [
                'number' => 'INV-000012', 'doc' => 'standard', 'icv' => 12,
                'uuid' => 'e2f3e673-a62a-5f79-b1ef-e6153255d8f2',
                // معدل صفري: لا فئة (لا استنتاج Z/E/O) ⇒ BR-CO-04 وBR-CO-18 فجوتان معروفتان.
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 10000, 'discount' => 0, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 0, 'total' => 10000, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Zero rated item', 'quantity' => 1, 'unit_price' => 10000, 'unit_price_before_tax' => 10000, 'tax_rate' => 0, 'line_subtotal' => 10000, 'line_discount' => 0, 'line_tax' => 0, 'line_total' => 10000],
                ],
            ],
            'awj-standard-adjustment' => [
                'number' => 'INV-000013', 'doc' => 'standard', 'icv' => 13,
                'uuid' => '8c953c3b-886e-51c8-bfa0-f11d2042122f',
                // تسوية تجارية: لا تُعيَّن إلى PayableRoundingAmount ⇒ PayableAmount ≠ TaxInclusiveAmount (BR-CO-16 فجوة معروفة).
                'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 50000, 'discount' => 0, 'shipping' => 0, 'adjustment' => -3, 'tax_amount' => 7500, 'total' => 57497, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 1, 'unit_price' => 50000, 'unit_price_before_tax' => 50000, 'tax_rate' => 15, 'line_subtotal' => 50000, 'line_discount' => 0, 'line_tax' => 7500, 'line_total' => 57500],
                ],
            ],
            'awj-simplified-document-discount' => [
                'number' => 'SIM-000014', 'doc' => 'simplified', 'icv' => 14,
                'uuid' => '57f3b147-9d82-544e-8793-3fb2ac462554',
                // مبسّطة بخصم مستند.
                'buyer' => ['name' => 'Synthetic Buyer', 'address' => self::SA_ADDRESS],
                'invoice' => ['subtotal' => 20000, 'discount' => 2000, 'shipping' => 0, 'adjustment' => 0, 'tax_amount' => 2700, 'total' => 20700, 'tax_inclusive' => false],
                'lines' => [
                    ['description' => 'Item A', 'quantity' => 2, 'unit_price' => 10000, 'unit_price_before_tax' => 10000, 'tax_rate' => 15, 'line_subtotal' => 20000, 'line_discount' => 0, 'line_tax' => 3000, 'line_total' => 23000],
                ],
            ],
            default => throw new \InvalidArgumentException("Unknown fixture {$name}"),
        };
    }
}
