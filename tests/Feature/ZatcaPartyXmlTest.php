<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaService;
use App\Support\InvoicePartySnapshot;
use App\Support\Settings;
use App\Support\ZatcaPartyXml;
use App\Support\ZatcaIssueTimestamp;
use App\Tenancy\TenantContext;
use DOMDocument;
use DOMXPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-15a — كتلتا البائع والمشتري في UBL من لقطة `party_snapshot`
 * ═══════════════════════════════════════════════════════════════
 *  الطرفان يُبنيان من اللقطة وحدها (لا Tenant/Partner حيّين) · ترتيب XSD · لا عناصر فارغة ولا اختلاق ·
 *  CRN فقط حين يستوفي القاعدة · الرقم الضريبي كما التُقط (المشوَّه يبقى ظاهراً) · بلد ISO معروف فقط ·
 *  عنوان المبسّطة عند اكتماله فقط · فشل مغلق عند غياب اللقطة/تلفها · لا أثر على القيد/الإجماليات/ICV/PIH/الهاش ·
 *  QR يتّفق مع XML · عزل المستأجرين.
 *
 *  تشغيل: php artisan test --filter=ZatcaPartyXmlTest
 */
class ZatcaPartyXmlTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
    private const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

    private array $auth;
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('party-xml', 'party-xml@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->tenant = Tenant::findOrFail($this->auth['tenant_id']);
        $this->tenant->update(['name' => 'شركة الأفق', 'vat_number' => '300000000000003', 'cr_number' => '1010101010', 'country' => 'SA']);
        Settings::put('company', [
            'building_no' => '8228', 'street' => 'شارع الملك فهد', 'additional_no' => '1234', 'district' => 'العليا',
            'city' => 'الرياض', 'postal_code' => '12643',
        ]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param array<string, mixed> $attributes */
    private function partner(array $attributes = []): Partner
    {
        return Partner::create($attributes + [
            'name' => 'شركة الأمل', 'type' => 'customer', 'entity_type' => 'commercial',
            'vat_number' => '300111222333003', 'cr_number' => '2050000000',
            'street' => 'شارع القدس', 'building_no' => '1234', 'district' => 'الفيحاء', 'city' => 'الدمام',
            'postal_code' => '31411', 'country' => 'SA',
        ]);
    }

    private function issue(Partner $partner, ?string $documentType = null): Invoice
    {
        $service = app(InvoiceService::class);
        $data = ['partner_id' => $partner->id, 'payment_type' => 'credit'];
        if ($documentType !== null) {
            $data['zatca_document_type'] = $documentType;
        }

        return $service->post($service->create(
            $data,
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ))->fresh();
    }

    private function xpath(string $xml): DOMXPath
    {
        $dom = new DOMDocument();
        $this->assertTrue($dom->loadXML($xml), 'XML غير صالح');
        $xp = new DOMXPath($dom);
        $xp->registerNamespace('cac', self::CAC);
        $xp->registerNamespace('cbc', self::CBC);
        $xp->registerNamespace('ubl', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');

        return $xp;
    }

    private function value(DOMXPath $xp, string $path): ?string
    {
        $nodes = $xp->query($path);

        return $nodes !== false && $nodes->length === 1 ? $nodes->item(0)->textContent : null;
    }

    /** @return list<string> أسماء أبناء عقدة (لفحص ترتيب XSD) */
    private function childNames(DOMXPath $xp, string $path): array
    {
        $out = [];
        foreach ($xp->query($path . '/*') as $node) {
            $out[] = $node->localName;
        }

        return $out;
    }

    private const SUPPLIER = '/ubl:Invoice/cac:AccountingSupplierParty/cac:Party';
    private const CUSTOMER = '/ubl:Invoice/cac:AccountingCustomerParty/cac:Party';

    // ───────────────────────── الضريبية ─────────────────────────

    /** @test */
    public function a_standard_invoice_carries_complete_seller_and_buyer_blocks_in_xsd_order(): void
    {
        $invoice = $this->issue($this->partner());
        $this->assertSame('standard', $invoice->zatca_document_type);
        $xp = $this->xpath((string) $invoice->zatca_xml);

        // البائع
        $this->assertSame(['PartyIdentification', 'PostalAddress', 'PartyTaxScheme', 'PartyLegalEntity'], $this->childNames($xp, self::SUPPLIER));
        $this->assertSame('CRN', $xp->query(self::SUPPLIER . '/cac:PartyIdentification/cbc:ID/@schemeID')->item(0)->nodeValue);
        $this->assertSame('1010101010', $this->value($xp, self::SUPPLIER . '/cac:PartyIdentification/cbc:ID'));
        $this->assertSame(
            ['StreetName', 'BuildingNumber', 'PlotIdentification', 'CitySubdivisionName', 'CityName', 'PostalZone', 'Country'],
            $this->childNames($xp, self::SUPPLIER . '/cac:PostalAddress'),
        );
        $this->assertSame('شارع الملك فهد', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cbc:StreetName'));
        $this->assertSame('8228', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cbc:BuildingNumber'));
        $this->assertSame('1234', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cbc:PlotIdentification'));
        $this->assertSame('العليا', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cbc:CitySubdivisionName'));
        $this->assertSame('الرياض', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cbc:CityName'));
        $this->assertSame('12643', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cbc:PostalZone'));
        $this->assertSame('SA', $this->value($xp, self::SUPPLIER . '/cac:PostalAddress/cac:Country/cbc:IdentificationCode'));
        // الخلل المؤكَّد في المسار: PartyTaxScheme بلا TaxScheme/ID=VAT (XSD + BR-KSA-39).
        $this->assertSame('300000000000003', $this->value($xp, self::SUPPLIER . '/cac:PartyTaxScheme/cbc:CompanyID'));
        $this->assertSame('VAT', $this->value($xp, self::SUPPLIER . '/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID'));
        $this->assertSame('شركة الأفق', $this->value($xp, self::SUPPLIER . '/cac:PartyLegalEntity/cbc:RegistrationName'));

        // المشتري: له رقم ضريبي ⇒ لا PartyIdentification (BT-46 مشروط بغياب BT-48) رغم وجود سجل تجاري.
        $this->assertSame(['PostalAddress', 'PartyTaxScheme', 'PartyLegalEntity'], $this->childNames($xp, self::CUSTOMER));
        $this->assertSame(
            ['StreetName', 'BuildingNumber', 'CitySubdivisionName', 'CityName', 'PostalZone', 'Country'],
            $this->childNames($xp, self::CUSTOMER . '/cac:PostalAddress'),
        );
        $this->assertSame('300111222333003', $this->value($xp, self::CUSTOMER . '/cac:PartyTaxScheme/cbc:CompanyID'));
        $this->assertSame('VAT', $this->value($xp, self::CUSTOMER . '/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID'));
        $this->assertSame('شركة الأمل', $this->value($xp, self::CUSTOMER . '/cac:PartyLegalEntity/cbc:RegistrationName'));
        $this->assertSame('31411', $this->value($xp, self::CUSTOMER . '/cac:PostalAddress/cbc:PostalZone'));
        $this->assertSame('SA', $this->value($xp, self::CUSTOMER . '/cac:PostalAddress/cac:Country/cbc:IdentificationCode'));
    }

    /** @test */
    public function a_buyer_without_vat_is_identified_by_crn_and_nothing_is_invented(): void
    {
        $xml = (string) $this->issue($this->partner(['vat_number' => null]), 'standard')->zatca_xml;
        $xp = $this->xpath($xml);

        $this->assertSame(['PartyIdentification', 'PostalAddress', 'PartyLegalEntity'], $this->childNames($xp, self::CUSTOMER));
        $this->assertSame('CRN', $xp->query(self::CUSTOMER . '/cac:PartyIdentification/cbc:ID/@schemeID')->item(0)->nodeValue);
        $this->assertSame('2050000000', $this->value($xp, self::CUSTOMER . '/cac:PartyIdentification/cbc:ID'));
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PartyTaxScheme')->length, 'لا رقم ضريبي مُختلق');
    }

    /** @test */
    public function a_standard_buyer_with_neither_vat_nor_crn_keeps_the_genuine_gap_visible(): void
    {
        $xp = $this->xpath((string) $this->issue($this->partner(['vat_number' => null, 'cr_number' => null]), 'standard')->zatca_xml);

        $this->assertSame(['PostalAddress', 'PartyLegalEntity'], $this->childNames($xp, self::CUSTOMER));
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PartyIdentification')->length);
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PartyTaxScheme')->length);
    }

    /** @test */
    public function a_standard_buyer_with_a_partial_address_keeps_whatever_exists_without_filling_gaps(): void
    {
        $partner = $this->partner(['building_no' => null, 'district' => null, 'postal_code' => null, 'country' => null]);
        $xp = $this->xpath((string) $this->issue($partner, 'standard')->zatca_xml);

        $this->assertSame(['StreetName', 'CityName'], $this->childNames($xp, self::CUSTOMER . '/cac:PostalAddress'));
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PostalAddress/cac:Country')->length, 'لا بلد مفترض');
    }

    /** @test */
    public function a_malformed_buyer_vat_is_preserved_verbatim_never_dropped_or_rewritten(): void
    {
        $xp = $this->xpath((string) $this->issue($this->partner(['vat_number' => ' 12345 ', 'cr_number' => '2050000000']), 'standard')->zatca_xml);

        // اللقطة تقصّ الفراغ فقط (REM-14)؛ والقيمة المشوَّهة تُكتب كما هي ليظهر BR-KSA-44 في SDK، ولا يحلّ CRN محلّها.
        $this->assertSame('12345', $this->value($xp, self::CUSTOMER . '/cac:PartyTaxScheme/cbc:CompanyID'));
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PartyIdentification')->length);
    }

    // ───────────────────────── المبسّطة ─────────────────────────

    /** @test */
    public function a_simplified_buyer_address_is_written_only_when_complete(): void
    {
        // مكتمل (SA): شارع/مبنى/حي/مدينة/رمز بريدي ٥ أرقام/بلد ⇒ يُكتب.
        $complete = $this->xpath((string) $this->issue($this->partner(['vat_number' => null]), 'simplified')->zatca_xml);
        $this->assertSame(1, $complete->query(self::CUSTOMER . '/cac:PostalAddress')->length);
        $this->assertSame('شركة الأمل', $this->value($complete, self::CUSTOMER . '/cac:PartyLegalEntity/cbc:RegistrationName'));

        // ناقص (بلا حي) ⇒ لا عنوان إطلاقاً، ويبقى الاسم.
        $partial = $this->xpath((string) $this->issue($this->partner(['vat_number' => null, 'district' => null]), 'simplified')->zatca_xml);
        $this->assertSame(0, $partial->query(self::CUSTOMER . '/cac:PostalAddress')->length);
        $this->assertSame('شركة الأمل', $this->value($partial, self::CUSTOMER . '/cac:PartyLegalEntity/cbc:RegistrationName'));

        // رمز بريدي بلا ٥ أرقام (BR-KSA-67) ⇒ غير مكتمل.
        $badZip = $this->xpath((string) $this->issue($this->partner(['vat_number' => null, 'postal_code' => '314']), 'simplified')->zatca_xml);
        $this->assertSame(0, $badZip->query(self::CUSTOMER . '/cac:PostalAddress')->length);

        // بلا بلد ⇒ غير مكتمل (لا نفترض SA).
        $noCountry = $this->xpath((string) $this->issue($this->partner(['vat_number' => null, 'country' => null]), 'simplified')->zatca_xml);
        $this->assertSame(0, $noCountry->query(self::CUSTOMER . '/cac:PostalAddress')->length);
    }

    /** @test */
    public function a_simplified_foreign_buyer_needs_only_street_city_and_country(): void
    {
        $partner = $this->partner(['vat_number' => null, 'country' => 'AE', 'building_no' => null, 'district' => null, 'postal_code' => null]);
        $xp = $this->xpath((string) $this->issue($partner, 'simplified')->zatca_xml);

        $this->assertSame(['StreetName', 'CityName', 'Country'], $this->childNames($xp, self::CUSTOMER . '/cac:PostalAddress'));
        $this->assertSame('AE', $this->value($xp, self::CUSTOMER . '/cac:PostalAddress/cac:Country/cbc:IdentificationCode'));
    }

    /** @test */
    public function a_simplified_cash_customer_with_only_a_name_has_no_address_or_identifier(): void
    {
        $partner = $this->partner([
            'name' => 'عميل نقدي', 'vat_number' => null, 'cr_number' => null, 'street' => null, 'building_no' => null,
            'district' => null, 'city' => null, 'postal_code' => null, 'country' => null,
        ]);
        $xp = $this->xpath((string) $this->issue($partner)->zatca_xml);

        $this->assertSame(['PartyLegalEntity'], $this->childNames($xp, self::CUSTOMER));
        $this->assertSame('عميل نقدي', $this->value($xp, self::CUSTOMER . '/cac:PartyLegalEntity/cbc:RegistrationName'));
    }

    // ───────────────────────── المعرّفات والبلد ─────────────────────────

    /** @test */
    public function a_crn_that_breaks_the_alphanumeric_rule_is_omitted_for_both_parties_without_substitution(): void
    {
        $this->tenant->update(['cr_number' => '1010-101010']);
        $xp = $this->xpath((string) $this->issue($this->partner(['vat_number' => null, 'cr_number' => '20 50']), 'standard')->zatca_xml);

        $this->assertSame(0, $xp->query(self::SUPPLIER . '/cac:PartyIdentification')->length);
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PartyIdentification')->length);
        $this->assertSame(0, $xp->query('//cbc:ID[@schemeID][not(@schemeID="CRN")]')->length, 'لا مخطّط بديل مُخترَع');
    }

    /** @test */
    public function an_alphanumeric_crn_is_accepted_but_no_other_scheme_is_ever_emitted(): void
    {
        $this->tenant->update(['cr_number' => 'CR7788AB']);
        $xp = $this->xpath((string) $this->issue($this->partner(), 'standard')->zatca_xml);

        $this->assertSame('CR7788AB', $this->value($xp, self::SUPPLIER . '/cac:PartyIdentification/cbc:ID'));
        foreach ($xp->query('//cbc:ID/@schemeID') as $attr) {
            $this->assertSame('CRN', $attr->nodeValue);
        }
    }

    /** @test */
    public function country_codes_must_be_recognised_iso_alpha2_not_merely_two_letters(): void
    {
        foreach (['SA' => 'SA', 'sa' => 'SA', ' ae ' => 'AE', 'US' => 'US', 'ZW' => 'ZW'] as $input => $expected) {
            $this->assertSame($expected, ZatcaPartyXml::countryCode($input), $input);
        }
        foreach (['XX', 'ZZ', 'AA', 'Saudi Arabia', 'السعودية', 'KSA', 'S', '', null, '1A', 'XI', 'UK'] as $input) {
            $this->assertNull(ZatcaPartyXml::countryCode($input), (string) $input);
        }

        // وفي المسار الكامل: بلد غير معروف ⇒ لا عنصر Country ولا افتراض.
        $xp = $this->xpath((string) $this->issue($this->partner(['country' => 'XX']), 'standard')->zatca_xml);
        $this->assertSame(0, $xp->query(self::CUSTOMER . '/cac:PostalAddress/cac:Country')->length);
        $this->assertSame('الدمام', $this->value($xp, self::CUSTOMER . '/cac:PostalAddress/cbc:CityName'));
    }

    // ───────────────────────── بلا عناصر فارغة، وهروب XML ─────────────────────────

    /** @test */
    public function no_empty_or_whitespace_only_element_is_ever_emitted_in_either_block(): void
    {
        $this->tenant->update(['cr_number' => null]);
        Settings::put('company', ['additional_no' => null, 'building_no' => '8228', 'street' => 'شارع', 'district' => 'حي', 'city' => 'الرياض', 'postal_code' => '12643']);
        $partner = $this->partner(['vat_number' => null, 'cr_number' => null, 'district' => '   ', 'country' => '']);

        $xp = $this->xpath((string) $this->issue($partner, 'standard')->zatca_xml);
        foreach (['SUPPLIER' => self::SUPPLIER, 'CUSTOMER' => self::CUSTOMER] as $label => $path) {
            $this->assertSame(0, $xp->query($path . '//*[not(*) and not(normalize-space())]')->length, $label);
        }
    }

    /** @test */
    public function xml_special_characters_in_names_and_addresses_are_escaped_and_round_trip(): void
    {
        $name = 'شركة "الأمل" & <شركاه> \'ذ.م.م\'';
        $xp = $this->xpath((string) $this->issue($this->partner(['name' => $name, 'street' => 'شارع <1> & "2"']), 'standard')->zatca_xml);

        $this->assertSame($name, $this->value($xp, self::CUSTOMER . '/cac:PartyLegalEntity/cbc:RegistrationName'));
        $this->assertSame('شارع <1> & "2"', $this->value($xp, self::CUSTOMER . '/cac:PostalAddress/cbc:StreetName'));
    }

    /** @test */
    public function a_character_that_cannot_exist_in_xml_fails_closed_and_rolls_the_posting_back(): void
    {
        $service = app(InvoiceService::class);
        $draft = $service->create(
            ['partner_id' => $this->partner(['name' => "عميل\x08سيّئ"])->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        try {
            $service->post($draft);
            $this->fail('كان يجب أن يفشل الترحيل مغلقاً — لا تنظيف صامت للبيانات.');
        } catch (\Throwable) {
            // المتوقَّع
        }

        $fresh = $draft->fresh();
        $this->assertSame('draft', $fresh->status);
        $this->assertNull($fresh->zatca_icv);
        $this->assertNull($fresh->party_snapshot);
        $this->assertNull($fresh->issued_at);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->where('source_id', $draft->id)->count());
    }

    // ───────────────────────── اللقطة مصدر الحقيقة ─────────────────────────

    /** @test */
    public function the_stored_artifacts_follow_the_snapshot_not_live_master_data(): void
    {
        $partner = $this->partner();
        $invoice = $this->issue($partner);
        $before = [$invoice->zatca_xml, $invoice->zatca_qr, $invoice->zatca_hash];

        // تعديل كل البيانات الحيّة بعد الترحيل.
        $this->tenant->update(['name' => 'اسم جديد', 'vat_number' => '399999999999993', 'cr_number' => '9999999999', 'country' => 'AE']);
        Settings::put('company', ['street' => 'شارع جديد', 'building_no' => '0001', 'city' => 'جدة', 'postal_code' => '99999']);
        $partner->update(['name' => 'عميل جديد', 'vat_number' => null, 'street' => 'x', 'city' => 'جدة', 'country' => 'AE']);

        $after = $invoice->fresh();
        $this->assertSame($before, [$after->zatca_xml, $after->zatca_qr, $after->zatca_hash], 'المخرجات المخزَّنة لا تتغيّر');

        // إعادة بناء QR من الفاتورة المخزَّنة تعطي القيمة نفسها حرفياً: الوسمان 1–2 من اللقطة لا من Tenant الحيّ.
        $this->assertSame($before[1], app(ZatcaService::class)->qrFor($after));
    }

    /** @test */
    public function qr_seller_name_and_vat_match_the_xml_seller_block_exactly(): void
    {
        $invoice = $this->issue($this->partner());
        $xp = $this->xpath((string) $invoice->zatca_xml);

        $payload = base64_decode((string) $invoice->zatca_qr, true);
        $tags = [];
        for ($i = 0, $n = strlen($payload); $i < $n;) {
            $tag = ord($payload[$i++]);
            $len = ord($payload[$i++]);
            $tags[$tag] = substr($payload, $i, $len);
            $i += $len;
        }
        $this->assertSame($this->value($xp, self::SUPPLIER . '/cac:PartyLegalEntity/cbc:RegistrationName'), $tags[1]);
        $this->assertSame($this->value($xp, self::SUPPLIER . '/cac:PartyTaxScheme/cbc:CompanyID'), $tags[2]);
        $this->assertSame(ZatcaIssueTimestamp::phase1QrText($invoice->issued_at), $tags[3]);
    }

    // ───────────────────────── الفشل المغلق ─────────────────────────

    /** @test */
    public function generation_fails_closed_without_a_valid_v1_snapshot_before_any_lock_or_icv(): void
    {
        $service = app(ZatcaService::class);
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->partner()->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $draft->forceFill(['issued_at' => ZatcaIssueTimestamp::capture()]);

        $good = InvoicePartySnapshot::capture($draft);
        $malformed = [
            'missing'            => null,
            'wrong version'      => ['v' => 2] + $good,
            'no seller'          => ['v' => 1, 'buyer' => $good['buyer']],
            'seller is a string' => ['v' => 1, 'seller' => 'x', 'buyer' => $good['buyer']],
            'array in a field'   => ['v' => 1, 'seller' => ['name' => ['x']] + $good['seller'], 'buyer' => $good['buyer']],
            'address is scalar'  => ['v' => 1, 'seller' => $good['seller'], 'buyer' => ['address' => 'free text'] + $good['buyer']],
            'nested array'       => ['v' => 1, 'seller' => $good['seller'], 'buyer' => ['address' => ['city' => ['x']]] + $good['buyer']],
        ];

        foreach ($malformed as $label => $snapshot) {
            $draft->setAttribute('party_snapshot', $snapshot);
            try {
                $service->buildFor($draft);
                $this->fail("كان يجب الفشل المغلق: {$label}");
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('لقطة', $e->getMessage(), $label);
            }
            try {
                $service->qrFor($draft);
                $this->fail("qrFor كان يجب أن يفشل مغلقاً: {$label}");
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }

        $this->assertSame(0, Invoice::whereNotNull('zatca_icv')->count(), 'لا ICV استُهلك');
    }

    // ───────────────────────── عدم الانحدار المالي ─────────────────────────

    /** @test */
    public function ledger_totals_icv_pih_and_hash_are_unchanged_by_the_new_party_blocks(): void
    {
        $first = $this->issue($this->partner());
        $second = $this->issue($this->partner(['name' => 'عميل ثانٍ']));

        $hasher = app(ZatcaInvoiceHasher::class);
        $this->assertSame([1, 2], [(int) $first->zatca_icv, (int) $second->zatca_icv]);
        $this->assertSame($hasher->hash((string) $first->zatca_xml), $first->zatca_hash, 'الهاش = هاش XML المخزَّن');
        $this->assertSame($hasher->hash((string) $second->zatca_xml), $second->zatca_hash);
        $this->assertSame($hasher->hash((string) $first->zatca_xml), $second->zatca_previous_hash, 'سلسلة PIH');
        $this->assertSame(app(ZatcaService::class)->genesisHash(), $first->zatca_previous_hash);

        foreach ([$first, $second] as $invoice) {
            $this->assertSame([100000, 15000, 115000], [(int) $invoice->subtotal, (int) $invoice->tax_amount, (int) $invoice->total]);
            $lines = JournalLine::where('journal_entry_id', $invoice->journal_entry_id)->get();
            $this->assertSame([115000, 115000], [(int) $lines->sum('debit'), (int) $lines->sum('credit')]);
            $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count());
        }
    }

    /** @test */
    public function a_second_posting_attempt_is_rejected_and_leaves_every_artifact_untouched(): void
    {
        $invoice = $this->issue($this->partner());
        $before = $invoice->only(['zatca_xml', 'zatca_qr', 'zatca_hash', 'zatca_icv', 'party_snapshot', 'issued_at']);

        try {
            app(InvoiceService::class)->post($invoice);
            $this->fail('الترحيل المزدوج يجب أن يُرفض.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }

        $this->assertEquals($before, $invoice->fresh()->only(array_keys($before)));
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count());
    }

    // ───────────────────────── العزل ─────────────────────────

    /** @test */
    public function another_tenants_identity_never_reaches_this_tenants_xml_and_internal_ids_are_not_emitted(): void
    {
        $mine = $this->issue($this->partner());

        $other = $this->registerTenant('party-xml-b', 'party-xml-b@example.test');
        app(TenantContext::class)->set($other['tenant_id']);
        Tenant::findOrFail($other['tenant_id'])->update(['name' => 'منشأة أخرى', 'vat_number' => '311111111111113', 'cr_number' => '7777777777']);
        Settings::put('company', ['street' => 'شارع آخر', 'building_no' => '4444', 'city' => 'أبها', 'postal_code' => '61321', 'district' => 'حي آخر']);
        $theirs = $this->issue(Partner::create(['name' => 'عميل منشأة أخرى', 'type' => 'customer']), 'simplified');

        // XML الخاص بي لا يحوي أي أثر لهم، والعكس.
        foreach (['منشأة أخرى', '311111111111113', '7777777777', 'أبها', 'عميل منشأة أخرى'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $mine->zatca_xml, $needle);
        }
        foreach (['شركة الأفق', '300000000000003', '1010101010', 'شركة الأمل', 'الدمام'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $theirs->zatca_xml, $needle);
        }
        // معرّفات داخلية (tenant/branch/partner) لا تُكتب في XML.
        $snapshot = $mine->party_snapshot;
        foreach ([$snapshot['seller']['tenant_id'], $snapshot['buyer']['partner_id']] as $internal) {
            $this->assertStringNotContainsString((string) $internal, (string) $mine->zatca_xml);
        }
        $this->assertSame(1, (int) DB::table('invoices')->where('id', $theirs->id)->value('zatca_icv'), 'ICV مستقل لكل مستأجر');
    }
}
