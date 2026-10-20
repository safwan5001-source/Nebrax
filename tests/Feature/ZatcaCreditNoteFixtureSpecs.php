<?php

namespace Tests\Feature;

use App\Support\ZatcaCreditNoteInput;
use App\Support\ZatcaCreditNoteLine;
use Carbon\CarbonImmutable;

/**
 * REM-18a — مواصفات fixtures إشعار الدائن لـ SDK (مشتركة بين اختبار الانجراف بلا قاعدة بيانات واختبار التطابق مع الخدمات
 * الحقيقية). ليست اختباراً (لا لاحقة Test).
 *
 * كل قيمة مالية هنا **قيمة خزّنها فعلاً** `InvoiceService::post` ثم `CreditNoteService::create/post` (REM-02: أساس ضريبة
 * وخصم موروثة من سطر الفاتورة) — لا مبلغ كُتب بيد. ويثبت ذلك `ZatcaCreditNoteRealServiceParityTest` بترحيل الفاتورة والإشعار
 * عبر الخدمتين ومطابقة المخزَّن لهذه المواصفات ثم إنتاج XML نفسه بايتاً ببايت. بيانات اصطناعية بحتة: رقم ضريبي تجريبي معروف،
 * لا مكلّف حقيقي، لا مفاتيح ولا شهادات.
 *
 * كل fixture مستند **أول** في سلسلته (PIH = genesis الرسمي): مرحلة PIH في SDK تقارن بـ`pih.txt`، فسلسلة حقيقية متصلة
 * لا يمكن أن تمرّ بها (قيس في تدقيق REM-18) — تسلسل ICV/PIH بين الفواتير والإشعارات يُثبَت باختبارات PHP لا بـ SDK.
 */
trait ZatcaCreditNoteFixtureSpecs
{
    private const GENESIS_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

    private const ISSUED_AT = '2026-02-10 08:15:30'; // UTC ⇒ 11:15:30 بتوقيت السعودية

    private const SA_ADDRESS = [
        'building_no' => '1111', 'street' => 'Synthetic Buyer Street', 'district' => 'Synthetic Quarter',
        'city' => 'Riyadh', 'postal_code' => '12222', 'country' => 'SA',
    ];

    /** @return list<string> */
    public static function noteFixtureNames(): array
    {
        return array_keys(self::noteFixtureSpecs());
    }

    /** @return array<string, array<string, mixed>> */
    public static function noteFixtureProvider(): array
    {
        $rows = [];
        foreach (self::noteFixtureNames() as $name) {
            $rows[$name] = [$name];
        }

        return $rows;
    }

    /**
     * @return array<string, array<string, mixed>>
     *   source = الفاتورة الأصلية كما تُنشأ بالخدمة؛ picks = بنود الإشعار [سطر المصدر، الكمية، سعر مخفَّض?]؛
     *   note = ما خزّنته الخدمة فعلاً.
     */
    public static function noteFixtureSpecs(): array
    {
        $line = static fn (string $d, int $q, int $price, int $sub, int $disc, int $tax, int $tot, int $rate = 15, ?int $net = null): array => [
            'description' => $d, 'quantity' => $q, 'unit_price' => $price, 'unit_price_before_tax' => $net ?? $price,
            'tax_rate' => $rate, 'line_subtotal' => $sub, 'line_discount' => $disc, 'line_tax' => $tax, 'line_total' => $tot,
        ];

        return [
            'awj-note-standard-refund-single-line' => [
                'uuid' => 'ae32d552-4ff4-585d-acea-ccec952c41e5', 'icv' => 101, 'class' => 'standard',
                'reason' => 'goods_or_services_refund', 'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                'source' => ['number' => 'INV-000101', 'head' => ['tax_inclusive' => false], 'items' => [
                    ['description' => 'Service X', 'quantity' => 2, 'unit_price' => 50000, 'tax_rate' => 15],
                ]],
                'picks' => [[0, 1]],
                'note' => ['number' => 'CN-000101', 'subtotal' => 50000, 'tax_amount' => 7500, 'total' => 57500, 'lines' => [
                    $line('Service X', 1, 50000, 50000, 0, 7500, 57500),
                ]],
            ],
            'awj-note-standard-multi-line-discounts' => [
                'uuid' => '840a2ad9-b046-53bd-8282-973022b1819a', 'icv' => 102, 'class' => 'standard',
                'reason' => 'supply_cancelled_or_suspended', 'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                // خصم سطر + خصم رأس + إشعار جزئي بسعر مخفَّض: ما خزّنه المخصِّص (REM-02) يُعرض كما هو، بفروق هللات موروثة.
                'source' => ['number' => 'INV-000102', 'head' => ['tax_inclusive' => false, 'discount' => 5000], 'items' => [
                    ['description' => 'Item A', 'quantity' => 3, 'unit_price' => 10000, 'tax_rate' => 15, 'discount' => 3000],
                    ['description' => 'Item B', 'quantity' => 1, 'unit_price' => 25000, 'tax_rate' => 15],
                ]],
                'picks' => [[0, 2], [1, 1, 20000]],
                'note' => ['number' => 'CN-000102', 'subtotal' => 34345, 'tax_amount' => 5151, 'total' => 39496, 'lines' => [
                    $line('Item A', 2, 10000, 19999, 3730, 2440, 18709),
                    $line('Item B', 1, 20000, 19999, 1923, 2711, 20787),
                ]],
            ],
            'awj-note-simplified-refund-single-line' => [
                'uuid' => 'd4c4ea9e-0536-5049-915f-c52a04f83df3', 'icv' => 103, 'class' => 'simplified',
                'reason' => 'goods_or_services_refund', 'buyer' => ['name' => 'Synthetic Buyer'],
                'source' => ['number' => 'SIM-000103', 'head' => ['tax_inclusive' => false], 'items' => [
                    ['description' => 'Item A', 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15],
                ]],
                'picks' => [[0, 1]],
                'note' => ['number' => 'CN-000103', 'subtotal' => 10000, 'tax_amount' => 1500, 'total' => 11500, 'lines' => [
                    $line('Item A', 1, 10000, 10000, 0, 1500, 11500),
                ]],
            ],
            'awj-note-simplified-two-lines-partial' => [
                'uuid' => 'e101c562-3c12-5edb-aea8-ca68eeb3d13c', 'icv' => 104, 'class' => 'simplified',
                'reason' => 'supply_value_amended_by_agreement', 'buyer' => ['name' => 'Synthetic Buyer', 'address' => self::SA_ADDRESS],
                'source' => ['number' => 'SIM-000104', 'head' => ['tax_inclusive' => false], 'items' => [
                    ['description' => 'Item A', 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15],
                    ['description' => 'Item B', 'quantity' => 3, 'unit_price' => 5000, 'tax_rate' => 15],
                ]],
                'picks' => [[0, 1], [1, 2, 4000]],
                'note' => ['number' => 'CN-000104', 'subtotal' => 18000, 'tax_amount' => 2700, 'total' => 20700, 'lines' => [
                    $line('Item A', 1, 10000, 10000, 0, 1500, 11500),
                    $line('Item B', 2, 4000, 8000, 0, 1200, 9200),
                ]],
            ],
            'awj-note-standard-tax-inclusive' => [
                'uuid' => '4725be46-a882-5b35-a38f-9e51a59d535b', 'icv' => 105, 'class' => 'standard',
                'reason' => 'supply_materially_changed', 'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                // مصدر بتسعير شامل: سعر الوحدة قبل الضريبة المخزَّن هو ما يُعرض (PriceAmount)؛ فروق التقريب موروثة وموثَّقة.
                'source' => ['number' => 'INV-000105', 'head' => ['tax_inclusive' => true], 'items' => [
                    ['description' => 'Item A', 'quantity' => 3, 'unit_price' => 10, 'tax_rate' => 15],
                    ['description' => 'Item B', 'quantity' => 2, 'unit_price' => 11500, 'tax_rate' => 15],
                ]],
                'picks' => [[1, 1], [0, 2]],
                'note' => ['number' => 'CN-000105', 'subtotal' => 10017, 'tax_amount' => 1502, 'total' => 11519, 'lines' => [
                    $line('Item B', 1, 11500, 10000, 0, 1500, 11500, 15, 10000),
                    $line('Item A', 2, 10, 17, 0, 2, 19, 15, 9),
                ]],
            ],
            'awj-note-standard-zero-rate' => [
                'uuid' => '17300a7a-4639-5df2-96d1-a536ec12a5e6', 'icv' => 106, 'class' => 'standard',
                'reason' => 'party_details_changed', 'buyer' => ['name' => 'Synthetic Buyer', 'vat_number' => '300000000000113', 'address' => self::SA_ADDRESS],
                // معدل صفري: لا تصنيف يُستنتج (REM-12 مفتوح) ⇒ فجوة BR-CO-04/BR-CO-18 صريحة كفاتورة المعدل الصفري.
                'source' => ['number' => 'INV-000106', 'head' => ['tax_inclusive' => false], 'items' => [
                    ['description' => 'Zero rated', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0],
                ]],
                'picks' => [[0, 1]],
                'note' => ['number' => 'CN-000106', 'subtotal' => 10000, 'tax_amount' => 0, 'total' => 10000, 'lines' => [
                    $line('Zero rated', 1, 10000, 10000, 0, 0, 10000, 0),
                ]],
            ],
        ];
    }

    /**
     * لقطة v1 بالشكل الذي يلتقطه `InvoicePartySnapshot::capture` عند ترحيل الفاتورة الأصلية (بائع ثابت، ومشترٍ يختلف).
     *
     * @param array<string, mixed> $buyer
     * @return array<string, mixed>
     */
    public static function noteSnapshot(array $buyer): array
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

    /** المدخل الصريح من المواصفة (بلا قاعدة بيانات). */
    public static function noteInputFromSpec(string $name): ZatcaCreditNoteInput
    {
        $spec = self::noteFixtureSpecs()[$name];
        $lines = array_map(static fn (array $l) => new ZatcaCreditNoteLine(
            $l['description'], $l['quantity'], $l['unit_price_before_tax'], $l['tax_rate'],
            $l['line_subtotal'], $l['line_discount'], $l['line_tax'], $l['line_total'],
        ), $spec['note']['lines']);

        return new ZatcaCreditNoteInput(
            $spec['note']['number'], $spec['uuid'], $spec['icv'], self::GENESIS_PIH,
            CarbonImmutable::parse(self::ISSUED_AT, 'UTC'), $spec['class'], self::noteSnapshot($spec['buyer']),
            $spec['source']['number'], $spec['reason'], 'cash',
            $spec['note']['subtotal'], $spec['note']['tax_amount'], $spec['note']['total'], $lines,
        );
    }
}
