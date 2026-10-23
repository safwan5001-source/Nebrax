<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaService;
use App\Support\Settings;
use App\Support\ZatcaMonetaryXml;
use App\Tenancy\TenantContext;
use DOMDocument;
use DOMXPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-16 — المبالغ وسطور الفاتورة في UBL (XML فقط): تعيين القيم المخزَّنة كما هي
 * ═══════════════════════════════════════════════════════════════
 *  كل مبلغ في XML = قيمة مخزَّنة (لا إعادة حساب) · متطابقات UBL الحسابية تصحّ على XML نفسه للأشكال المدعومة ·
 *  التصنيف S لمعدل 15 فقط · لا توزيع خصم مستند على فئات · لا ربط للتسوية بـ PayableRoundingAmount ·
 *  لا رمز سبب للشحن · التناقضات (التقريب) موثَّقة لا مخفية · لا أثر على القيد/الإجماليات/ICV/PIH/الهاش.
 *
 *  تشغيل: php artisan test --filter=ZatcaMonetaryXmlTest
 */
class ZatcaMonetaryXmlTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;
    use InteractsWithApi;

    private const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
    private const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
    private const INV = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';

    private array $auth;
    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('monetary-xml', 'monetary-xml@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->customer = Partner::create(['name' => 'شركة الأمل', 'type' => 'customer', 'vat_number' => '300111222333003']);
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param array<string, mixed> $header @param list<array<string, mixed>> $items */
    private function issue(array $header, array $items, ?Partner $partner = null): Invoice
    {
        $service = app(InvoiceService::class);

        return $service->post($service->create(
            ['partner_id' => ($partner ?? $this->customer)->id, 'payment_type' => 'credit'] + $header,
            $items,
        ))->fresh('lines');
    }

    private function xp(string $xml): DOMXPath
    {
        $dom = new DOMDocument();
        $this->assertTrue($dom->loadXML($xml), 'XML غير صالح');
        $xp = new DOMXPath($dom);
        $xp->registerNamespace('cac', self::CAC);
        $xp->registerNamespace('cbc', self::CBC);
        $xp->registerNamespace('i', self::INV);

        return $xp;
    }

    private function text(DOMXPath $xp, string $path): ?string
    {
        $n = $xp->query($path);

        return $n !== false && $n->length === 1 ? $n->item(0)->textContent : null;
    }

    /** "123.45" ⇒ 12345 (بلا float). */
    private function minor(?string $amount): ?int
    {
        if ($amount === null) {
            return null;
        }
        $this->assertMatchesRegularExpression('/^-?\d+\.\d{2}$/', $amount, 'المبلغ في XML يجب أن يكون بخانتين عشريتين');

        return (int) str_replace('.', '', $amount);
    }

    /** @return list<string> */
    private function children(DOMXPath $xp, string $path): array
    {
        $out = [];
        foreach ($xp->query($path . '/*') as $node) {
            $out[] = $node->localName;
        }

        return $out;
    }

    /** @return array<string, array{0: array<string, mixed>, 1: list<array<string, mixed>>}> */
    public static function scenarios(): array
    {
        $a = static fn (string $d, int $q, int $p, int $r = 15, array $extra = []) => ['description' => $d, 'quantity' => $q, 'unit_price' => $p, 'tax_rate' => $r] + $extra;

        return [
            'single'        => [[], [$a('Service X', 1, 50000)]],
            'multi'         => [[], [$a('A', 2, 10000), $a('B', 3, 5000), $a('C', 1, 2575)]],
            'line discount' => [[], [$a('A', 2, 5000, 15, ['discount' => 1000])]],
            'doc discount'  => [['discount' => 5000], [$a('A', 1, 30000), $a('B', 1, 20000)]],
            'shipping'      => [['shipping' => 2000], [$a('A', 1, 50000)]],
            'discount+ship' => [['discount' => 5000, 'shipping' => 2000], [$a('A', 1, 30000), $a('B', 1, 20000)]],
            'inclusive'     => [['tax_inclusive' => true], [$a('A', 3, 10), $a('B', 1, 11500)]],
            'small lines'   => [[], array_fill(0, 5, $a('S', 1, 10))],
            'fractional'    => [[], [['description' => 'بنزين 95', 'unit' => 'L', 'quantity_numerator' => 1234, 'quantity_denominator' => 1000, 'unit_price' => 230, 'tax_rate' => 15]]],
            'zero rate'     => [[], [$a('Z', 1, 10000, 0)]],
            'adjustment'    => [['adjustment' => -3], [$a('A', 1, 50000)]],
        ];
    }

    // ───────────────────────── التعيين: XML = المخزَّن ─────────────────────────

    #[Test]
    #[DataProvider('scenarios')]
    public function every_xml_amount_equals_the_stored_value_in_the_right_element_and_order(array $header, array $items): void
    {
        $invoice = $this->issue($header, $items);
        $xp = $this->xp((string) $invoice->zatca_xml);

        $discount = (int) $invoice->discount;
        $shipping = (int) $invoice->shipping;
        $adjustment = (int) $invoice->adjustment;
        $taxExclusive = (int) $invoice->subtotal - $discount + $shipping;

        // ترتيب XSD على مستوى الوثيقة (بعد كتل الأطراف): AllowanceCharge* → TaxTotal×2 → LegalMonetaryTotal → InvoiceLine*
        $top = $this->children($xp, '/i:Invoice');
        $afterParties = array_slice($top, array_search('AccountingCustomerParty', $top, true) + 1);
        $expected = array_merge(
            array_fill(0, ($discount > 0 ? 1 : 0) + ($shipping > 0 ? 1 : 0), 'AllowanceCharge'),
            ['TaxTotal', 'TaxTotal', 'LegalMonetaryTotal'],
            array_fill(0, count($items), 'InvoiceLine'),
        );
        $this->assertSame($expected, $afterParties);
        $this->assertSame('SAR', $this->text($xp, '/i:Invoice/cbc:TaxCurrencyCode'));
        $this->assertSame(
            ['DocumentCurrencyCode', 'TaxCurrencyCode'],
            array_values(array_filter($top, fn ($n) => str_ends_with($n, 'CurrencyCode'))),
        );

        $lmt = '/i:Invoice/cac:LegalMonetaryTotal';
        $this->assertSame((int) $invoice->subtotal, $this->minor($this->text($xp, "$lmt/cbc:LineExtensionAmount")));
        $this->assertSame($taxExclusive, $this->minor($this->text($xp, "$lmt/cbc:TaxExclusiveAmount")));
        $this->assertSame($taxExclusive + (int) $invoice->tax_amount, $this->minor($this->text($xp, "$lmt/cbc:TaxInclusiveAmount")));
        $this->assertSame($discount, $this->minor($this->text($xp, "$lmt/cbc:AllowanceTotalAmount")));
        $this->assertSame($shipping > 0 ? $shipping : null, $this->minor($this->text($xp, "$lmt/cbc:ChargeTotalAmount")));
        $this->assertSame(0, $this->minor($this->text($xp, "$lmt/cbc:PrepaidAmount")));
        $this->assertSame((int) $invoice->total, $this->minor($this->text($xp, "$lmt/cbc:PayableAmount")));
        $this->assertSame(
            array_values(array_filter(['LineExtensionAmount', 'TaxExclusiveAmount', 'TaxInclusiveAmount', 'AllowanceTotalAmount', $shipping > 0 ? 'ChargeTotalAmount' : null, 'PrepaidAmount', 'PayableAmount'])),
            $this->children($xp, $lmt),
        );
        // التسوية التجارية لا تُعيَّن إلى PayableRoundingAmount أبداً (G-B5).
        $this->assertNull($this->text($xp, "$lmt/cbc:PayableRoundingAmount"));

        // TaxTotal #1: المبلغ المخزَّن فقط؛ #2: المبلغ نفسه (+ TaxSubtotal حين تنطبق فئة واحدة).
        $taxTotals = '/i:Invoice/cac:TaxTotal';
        $this->assertSame((int) $invoice->tax_amount, $this->minor($this->text($xp, $taxTotals . '[1]/cbc:TaxAmount')));
        $this->assertSame((int) $invoice->tax_amount, $this->minor($this->text($xp, $taxTotals . '[2]/cbc:TaxAmount')));
        $this->assertSame(['TaxAmount'], $this->children($xp, $taxTotals . '[1]'));

        // الأسطر
        foreach ($invoice->lines as $i => $line) {
            $p = '/i:Invoice/cac:InvoiceLine[' . ($i + 1) . ']';
            $this->assertSame((int) $line->line_subtotal - (int) $line->line_discount, $this->minor($this->text($xp, "$p/cbc:LineExtensionAmount")));
            $this->assertSame((int) $line->line_tax, $this->minor($this->text($xp, "$p/cac:TaxTotal/cbc:TaxAmount")));
            $this->assertSame((int) $line->line_total, $this->minor($this->text($xp, "$p/cac:TaxTotal/cbc:RoundingAmount")));
            $this->assertSame(['TaxAmount', 'RoundingAmount'], $this->children($xp, "$p/cac:TaxTotal"));
            $this->assertSame(
                (int) $line->line_discount > 0 ? [(int) $line->line_discount] : [],
                array_map(fn ($n) => $this->minor($n->textContent), iterator_to_array($xp->query("$p/cac:AllowanceCharge/cbc:Amount"))),
            );
            $this->assertSame(
                array_values(array_filter(['ID', 'InvoicedQuantity', 'LineExtensionAmount', (int) $line->line_discount > 0 ? 'AllowanceCharge' : null, 'TaxTotal', 'Item', 'Price'])),
                $this->children($xp, $p),
            );
            $price = $invoice->tax_inclusive ? $line->unit_price_before_tax : $line->unit_price;
            $this->assertSame((int) $price, $this->minor($this->text($xp, "$p/cac:Price/cbc:PriceAmount")));
            $this->assertSame((int) $line->tax_rate === 15 ? ['Name', 'ClassifiedTaxCategory'] : ['Name'], $this->children($xp, "$p/cac:Item"));
        }
    }

    #[Test]
    #[DataProvider('scenarios')]
    public function the_builders_inputs_are_exactly_what_is_persisted_by_the_posting(array $header, array $items): void
    {
        // XML يُبنى قبل update() في post(): هذا الاختبار يحرس أن القيم التي رآها البناء هي نفسها المخزَّنة لاحقاً.
        $invoice = $this->issue($header, $items);
        $stored = Invoice::query()->whereKey($invoice->id)->first();
        $xp = $this->xp((string) $stored->zatca_xml);
        $lmt = '/i:Invoice/cac:LegalMonetaryTotal';

        $this->assertSame((int) $stored->total, $this->minor($this->text($xp, "$lmt/cbc:PayableAmount")));
        $this->assertSame(
            (int) $stored->subtotal - (int) $stored->discount + (int) $stored->shipping,
            $this->minor($this->text($xp, "$lmt/cbc:TaxExclusiveAmount")),
        );
        $this->assertSame((int) $stored->tax_amount, $this->minor($this->text($xp, '/i:Invoice/cac:TaxTotal[1]/cbc:TaxAmount')));
    }

    // ───────────────────────── متطابقات UBL للأشكال المدعومة ─────────────────────────

    #[Test]
    #[DataProvider('supportedShapes')]
    public function supported_shapes_satisfy_the_ubl_arithmetic_identities_on_the_xml_itself(string $shape): void
    {
        [$header, $items] = self::scenarios()[$shape];
        $xp = $this->xp((string) $this->issue($header, $items)->zatca_xml);
        $m = fn (string $path) => $this->minor($this->text($xp, $path));
        $lmt = '/i:Invoice/cac:LegalMonetaryTotal';

        $lineNets = array_map(fn ($n) => $this->minor($n->textContent), iterator_to_array($xp->query('/i:Invoice/cac:InvoiceLine/cbc:LineExtensionAmount')));
        $bt106 = $m("$lmt/cbc:LineExtensionAmount");
        $bt107 = $m("$lmt/cbc:AllowanceTotalAmount");
        $bt108 = $m("$lmt/cbc:ChargeTotalAmount") ?? 0;
        $bt109 = $m("$lmt/cbc:TaxExclusiveAmount");
        $bt110 = $m('/i:Invoice/cac:TaxTotal[2]/cbc:TaxAmount');
        $bt112 = $m("$lmt/cbc:TaxInclusiveAmount");
        $bt115 = $m("$lmt/cbc:PayableAmount");

        $this->assertSame(array_sum($lineNets), $bt106, 'BR-CO-10');
        $this->assertSame($bt106 - $bt107 + $bt108, $bt109, 'BR-CO-13');
        $this->assertSame($bt109 + $bt110, $bt112, 'BR-CO-15');
        $this->assertSame($bt112 - 0, $bt115, 'BR-CO-16 (لا مدفوع مسبق ولا تقريب)');
        // BR-CO-14: مجموع TaxSubtotal = TaxTotal، وTaxableAmount = BT-109 (فئة واحدة).
        $subtotals = $xp->query('/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal');
        $this->assertSame(1, $subtotals->length);
        $this->assertSame($bt109, $m('/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal/cbc:TaxableAmount'));
        $this->assertSame($bt110, $m('/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal/cbc:TaxAmount'));
        $this->assertSame('S', $this->text($xp, '/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal/cac:TaxCategory/cbc:ID'));
        $this->assertSame('15.00', $this->text($xp, '/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent'));
        $this->assertSame('VAT', $this->text($xp, '/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:ID'));
        // BR-KSA-51 لكل سطر: KSA-12 = BT-131 + KSA-11.
        foreach ($xp->query('/i:Invoice/cac:InvoiceLine') as $i => $_) {
            $p = '/i:Invoice/cac:InvoiceLine[' . ($i + 1) . ']';
            $this->assertSame($m("$p/cbc:LineExtensionAmount") + $m("$p/cac:TaxTotal/cbc:TaxAmount"), $m("$p/cac:TaxTotal/cbc:RoundingAmount"));
        }
    }

    /** @return array<string, array{0: string}> */
    public static function supportedShapes(): array
    {
        $shapes = ['single', 'multi', 'line discount', 'doc discount', 'shipping', 'discount+ship', 'inclusive', 'small lines', 'fractional'];

        return array_combine($shapes, array_map(fn (string $n) => [$n], $shapes));
    }

    /** @test */
    public function the_line_net_identity_holds_exactly_without_tax_inclusive_pricing_and_within_a_halala_with_it(): void
    {
        $plain = $this->issue([], [['description' => 'A', 'quantity' => 2, 'unit_price' => 5000, 'tax_rate' => 15, 'discount' => 1000]]);
        $xp = $this->xp((string) $plain->zatca_xml);
        // BT-131 = BT-129 × BT-146 − BT-136 (EN16931-11) بالضبط: 2 × 50.00 − 10.00 = 90.00
        $this->assertSame(2 * 5000 - 1000, $this->minor($this->text($xp, '/i:Invoice/cac:InvoiceLine/cbc:LineExtensionAmount')));
        $this->assertSame('2', $this->text($xp, '/i:Invoice/cac:InvoiceLine/cbc:InvoicedQuantity'));

        // الشامل: السعر الصافي للوحدة مُقرَّب إلى هللة في المصدر ⇒ الفرق مع صافي السطر ≤ هللة لكل وحدة (موثَّق، لا يُخفى).
        $incl = $this->issue(['tax_inclusive' => true], [['description' => 'A', 'quantity' => 3, 'unit_price' => 10, 'tax_rate' => 15]]);
        $line = $incl->lines->first();
        $this->assertSame(26, (int) $line->line_subtotal);       // صافي السطر المخزَّن
        $this->assertSame(9, (int) $line->unit_price_before_tax); // 3 × 0.09 = 0.27 ≠ 0.26
        $xi = $this->xp((string) $incl->zatca_xml);
        $this->assertSame(9, $this->minor($this->text($xi, '/i:Invoice/cac:InvoiceLine/cac:Price/cbc:PriceAmount')));
        $this->assertSame(26, $this->minor($this->text($xi, '/i:Invoice/cac:InvoiceLine/cbc:LineExtensionAmount')));
    }

    // ───────────────────────── التصنيف ─────────────────────────

    /** @test */
    public function category_s_is_written_only_for_rate_15_and_never_inferred_from_zero_or_other_rates(): void
    {
        $invoice = $this->issue([], [
            ['description' => 'standard', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15],
            ['description' => 'zero', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0],
            ['description' => 'five', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 5],
        ]);
        $xp = $this->xp((string) $invoice->zatca_xml);

        $this->assertSame(['Name', 'ClassifiedTaxCategory'], $this->children($xp, '/i:Invoice/cac:InvoiceLine[1]/cac:Item'));
        $this->assertSame(['Name'], $this->children($xp, '/i:Invoice/cac:InvoiceLine[2]/cac:Item'), 'الصفر لا يُصنَّف Z/E/O');
        $this->assertSame(['Name'], $this->children($xp, '/i:Invoice/cac:InvoiceLine[3]/cac:Item'), '5٪ غير محسوم (G-I3)');
        $this->assertSame(0, $xp->query('//cbc:ID[normalize-space()="Z" or normalize-space()="E" or normalize-space()="O"]')->length);
        // فئات مختلطة ⇒ لا ملخّص ضريبة مُختلَق (تقسيم الضريبة المخزَّنة غير مخزَّن) — فجوة BR-CO-18 صريحة.
        $this->assertSame(0, $xp->query('//cac:TaxSubtotal')->length);
        // الضريبة المخزَّنة تبقى كما هي في TaxTotal وفي كل سطر.
        $this->assertSame((int) $invoice->tax_amount, $this->minor($this->text($xp, '/i:Invoice/cac:TaxTotal[2]/cbc:TaxAmount')));
        $this->assertSame(
            [1500, 0, 500],
            array_map(fn ($l) => (int) $l->line_tax, $invoice->lines->all()),
        );
    }

    /** @test */
    public function a_document_discount_on_a_mixed_or_unclassified_invoice_is_not_given_a_category_or_distributed(): void
    {
        $invoice = $this->issue(['discount' => 1000], [
            ['description' => 'standard', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15],
            ['description' => 'zero', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0],
        ]);
        $xp = $this->xp((string) $invoice->zatca_xml);

        $this->assertSame(1, $xp->query('/i:Invoice/cac:AllowanceCharge')->length);
        $this->assertSame(['ChargeIndicator', 'AllowanceChargeReason', 'Amount'], $this->children($xp, '/i:Invoice/cac:AllowanceCharge[1]'), 'بلا TaxCategory');
        $this->assertSame(1000, $this->minor($this->text($xp, '/i:Invoice/cac:AllowanceCharge/cbc:Amount')));
        $this->assertSame(0, $xp->query('//cac:TaxSubtotal')->length);
    }

    /** @test */
    public function the_document_discount_gets_the_single_known_category_when_every_line_is_standard_rated(): void
    {
        $xp = $this->xp((string) $this->issue(['discount' => 5000], self::scenarios()['doc discount'][1])->zatca_xml);

        $this->assertSame(['ChargeIndicator', 'AllowanceChargeReason', 'Amount', 'TaxCategory'], $this->children($xp, '/i:Invoice/cac:AllowanceCharge'));
        $this->assertSame('false', $this->text($xp, '/i:Invoice/cac:AllowanceCharge/cbc:ChargeIndicator'));
        $this->assertSame('S', $this->text($xp, '/i:Invoice/cac:AllowanceCharge/cac:TaxCategory/cbc:ID'));
    }

    // ───────────────────────── فجوات معروفة (تُوثَّق ولا تُخفى) ─────────────────────────

    /** @test */
    public function an_arbitrary_adjustment_is_never_mapped_to_a_rounding_element_and_the_gap_stays_visible(): void
    {
        $invoice = $this->issue(['adjustment' => -3], [['description' => 'A', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]]);
        $xp = $this->xp((string) $invoice->zatca_xml);
        $lmt = '/i:Invoice/cac:LegalMonetaryTotal';

        $this->assertSame(57497, (int) $invoice->total);
        $this->assertNull($this->text($xp, "$lmt/cbc:PayableRoundingAmount"));
        $this->assertSame(57500, $this->minor($this->text($xp, "$lmt/cbc:TaxInclusiveAmount")), 'BT-112 = BT-109 + BT-110');
        $this->assertSame(57497, $this->minor($this->text($xp, "$lmt/cbc:PayableAmount")), 'الإجمالي المخزَّن كما هو');
        $this->assertSame(-3, $this->minor($this->text($xp, "$lmt/cbc:PayableAmount")) - $this->minor($this->text($xp, "$lmt/cbc:TaxInclusiveAmount")), 'الفرق = التسوية (BR-CO-16 فجوة معروفة)');
    }

    /** @test */
    public function the_shipping_charge_carries_text_but_no_unverified_reason_code(): void
    {
        $xp = $this->xp((string) $this->issue(['shipping' => 2000], [['description' => 'A', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]])->zatca_xml);

        $this->assertSame('true', $this->text($xp, '/i:Invoice/cac:AllowanceCharge/cbc:ChargeIndicator'));
        $this->assertSame(0, $xp->query('//cbc:AllowanceChargeReasonCode')->length, 'لا رمز UNCL 7161 يطابق حقل «رسوم الشحن» حرفياً (SAA/DL/FC)');
        $this->assertNotEmpty($this->text($xp, '/i:Invoice/cac:AllowanceCharge/cbc:AllowanceChargeReason'));
        $this->assertSame(2000, $this->minor($this->text($xp, '/i:Invoice/cac:AllowanceCharge/cbc:Amount')));
        // ضريبة الشحن المخزَّنة 15٪ ⇒ فئته S/15.
        $this->assertSame('S', $this->text($xp, '/i:Invoice/cac:AllowanceCharge/cac:TaxCategory/cbc:ID'));
        $this->assertSame(2000, $this->minor($this->text($xp, '/i:Invoice/cac:LegalMonetaryTotal/cbc:ChargeTotalAmount')));
    }

    /** @test */
    public function per_line_rounding_versus_document_level_is_reported_not_corrected(): void
    {
        $invoice = $this->issue([], array_fill(0, 5, ['description' => 'S', 'quantity' => 1, 'unit_price' => 10, 'tax_rate' => 15]));
        $xp = $this->xp((string) $invoice->zatca_xml);

        // المخزَّن: 5 × 0.02 = 0.10 (نصف-لأعلى لكل سطر). على مستوى المستند: 0.50 × 15٪ = 0.075 → 0.08.
        $this->assertSame(10, (int) $invoice->tax_amount);
        $this->assertSame(10, $this->minor($this->text($xp, '/i:Invoice/cac:TaxTotal[2]/cac:TaxSubtotal/cbc:TaxAmount')), 'XML يعكس المخزَّن ولا يُصحِّح');
        $documentLevel = intdiv(2 * (int) $invoice->subtotal * 15 + 100, 200);
        $this->assertSame(8, $documentLevel);
        $this->assertNotSame($documentLevel, (int) $invoice->tax_amount, 'التناقض قائم ويتطلب قرار ADR-B (G-B1/G-B2)');
    }

    /** @test */
    public function a_header_discount_keeps_the_stored_document_tax_while_line_taxes_stay_pre_discount(): void
    {
        $invoice = $this->issue(['discount' => 5000], self::scenarios()['doc discount'][1]);
        $xp = $this->xp((string) $invoice->zatca_xml);

        $this->assertSame(6750, (int) $invoice->tax_amount);
        $this->assertSame(7500, (int) $invoice->lines->sum('line_tax'), 'ضريبة السطور قبل خصم الرأس');
        $this->assertSame(6750, $this->minor($this->text($xp, '/i:Invoice/cac:TaxTotal[2]/cbc:TaxAmount')));
        $this->assertSame(4500, $this->minor($this->text($xp, '/i:Invoice/cac:InvoiceLine[1]/cac:TaxTotal/cbc:TaxAmount')));
    }

    // ───────────────────────── المساعد النقي (بلا قاعدة بيانات) ─────────────────────────

    /** @test */
    public function an_inclusive_line_without_the_stored_net_price_snapshot_gets_no_price_instead_of_an_invented_one(): void
    {
        $invoice = (new Invoice())->forceFill(['tax_inclusive' => true]);
        $line = (new InvoiceLine())->forceFill([
            'description' => 'legacy', 'quantity' => 1, 'unit_price' => 11500, 'unit_price_before_tax' => null, 'tax_rate' => 15,
            'line_subtotal' => 10000, 'line_discount' => 0, 'line_tax' => 1500, 'line_total' => 11500,
        ]);

        $xml = ZatcaMonetaryXml::line($invoice, $line, 1, '1');
        $this->assertStringNotContainsString('<cac:Price>', $xml);
        $this->assertStringContainsString('<cbc:LineExtensionAmount currencyID="SAR">100.00</cbc:LineExtensionAmount>', $xml);
    }

    /** @test */
    public function the_standard_rate_constant_matches_the_shipping_rate_and_zero_is_never_standard(): void
    {
        $this->assertSame(15, ZatcaMonetaryXml::STANDARD_RATE);
        foreach ([0, 1, 5, 10, 14, 16, 100] as $rate) {
            $this->assertFalse(ZatcaMonetaryXml::isStandardRated((new InvoiceLine())->forceFill(['tax_rate' => $rate])), (string) $rate);
        }
        $this->assertTrue(ZatcaMonetaryXml::isStandardRated((new InvoiceLine())->forceFill(['tax_rate' => 15])));
        $this->assertFalse(ZatcaMonetaryXml::allStandardRated((new Invoice())->setRelation('lines', collect())), 'بلا أسطر ⇒ لا فئة');
    }

    // ───────────────────────── عدم الانحدار المالي والهاش ─────────────────────────

    /** @test */
    public function posting_math_ledger_and_hash_chain_are_unchanged_by_the_monetary_xml(): void
    {
        // قيم مرجعية كما يخزّنها post() على main قبل REM-16 (مقارنة تشغيلية موثَّقة في التقرير).
        $expected = [
            'multi'      => [37575, 0, 0, 0, 5636, 43211],
            'doc discount' => [50000, 5000, 0, 0, 6750, 51750],
            'shipping'   => [50000, 0, 2000, 0, 7800, 59800],
            'inclusive'  => [10026, 0, 0, 0, 1504, 11530],
            'small lines' => [50, 0, 0, 0, 10, 60],
            'fractional' => [284, 0, 0, 0, 43, 327],
            'zero rate'  => [10000, 0, 0, 0, 0, 10000],
            'adjustment' => [50000, 0, 0, -3, 7500, 57497],
        ];
        $hasher = app(ZatcaInvoiceHasher::class);
        $previous = app(ZatcaService::class)->genesisHash();

        $icv = 0;
        foreach ($expected as $shape => $figures) {
            [$header, $items] = self::scenarios()[$shape];
            $invoice = $this->issue($header, $items);

            $this->assertSame($figures, [(int) $invoice->subtotal, (int) $invoice->discount, (int) $invoice->shipping, (int) $invoice->adjustment, (int) $invoice->tax_amount, (int) $invoice->total], $shape);
            $lines = JournalLine::where('journal_entry_id', $invoice->journal_entry_id)->get();
            $this->assertSame($figures[5], (int) $lines->whereNotNull('partner_id')->sum('debit'), $shape . ': مدين العميل = الإجمالي');
            $this->assertSame((int) $lines->sum('debit'), (int) $lines->sum('credit'), $shape . ': القيد متوازن');
            $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count());
            $this->assertSame(++$icv, (int) $invoice->zatca_icv, $shape);
            $this->assertSame($previous, $invoice->zatca_previous_hash, $shape);
            $this->assertSame($hasher->hash((string) $invoice->zatca_xml), $invoice->zatca_hash, $shape);
            $previous = $hasher->hash((string) $invoice->zatca_xml);
        }
    }

    /** @test */
    public function the_stored_xml_never_changes_after_issuance_even_if_tax_settings_change(): void
    {
        $invoice = $this->issue([], self::scenarios()['multi'][1]);
        $before = [$invoice->zatca_xml, $invoice->zatca_hash, $invoice->zatca_qr];

        Settings::put('sales', ['default_tax_rate' => 5]);
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$invoice->id}")->assertOk();
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$invoice->id}/zatca")->assertOk();

        $after = $invoice->fresh();
        $this->assertSame($before, [$after->zatca_xml, $after->zatca_hash, $after->zatca_qr]);
    }

    /** @test */
    public function a_second_posting_attempt_is_rejected_and_the_artifacts_stay_identical(): void
    {
        $invoice = $this->issue(['discount' => 5000, 'shipping' => 2000], self::scenarios()['doc discount'][1]);
        $before = $invoice->only(['zatca_xml', 'zatca_hash', 'zatca_icv', 'total', 'journal_entry_id']);

        $this->thrown(fn () => app(InvoiceService::class)->post($invoice), 'الترحيل المزدوج يجب أن يُرفض.');

        $this->assertSame($before, $invoice->fresh()->only(array_keys($before)));
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count());
    }

    /** @test */
    public function tenants_never_see_each_others_amounts_and_icv_chains_are_independent(): void
    {
        $mine = $this->issue([], [['description' => 'mine', 'quantity' => 1, 'unit_price' => 12345, 'tax_rate' => 15]]);

        $other = $this->registerTenant('monetary-xml-b', 'monetary-xml-b@example.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirs = $this->issue(['shipping' => 777], [['description' => 'theirs', 'quantity' => 1, 'unit_price' => 99900, 'tax_rate' => 15]], Partner::create(['name' => 'عميلهم', 'type' => 'customer']));

        $this->assertStringNotContainsString('999.00', (string) $mine->zatca_xml);
        $this->assertStringNotContainsString('7.77', (string) $mine->zatca_xml);
        $this->assertStringNotContainsString('123.45', (string) $theirs->zatca_xml);
        $this->assertSame(1, (int) $mine->zatca_icv);
        $this->assertSame(1, (int) $theirs->zatca_icv);
    }
}
