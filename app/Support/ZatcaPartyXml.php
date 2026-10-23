<?php

namespace App\Support;

use App\Models\Invoice;
use RuntimeException;

/**
 * كتلتا البائع والمشتري في UBL لـ ZATCA — REM-15a.
 *
 * دالة نقيّة تُبنى **من لقطة `invoices.party_snapshot` (v1) وحدها** (REM-14)، لا من `Tenant`/`Partner`/إعدادات الشركة
 * الحيّة: فتعديل بيانات رئيسية بعد الترحيل لا يغيّر ما أُصدر. لا تقرأ قاعدة البيانات ولا تكتب شيئاً.
 *
 * المبادئ (قرارات المالك لـ REM-15a):
 *  • **لا اختلاق**: عنصرٌ بلا قيمة في اللقطة لا يُكتب (لا عناصر فارغة)، ولا يُستبدل بقيمة أخرى. النقص الحقيقي يبقى ظاهراً
 *    كخطأ/تحذير في SDK الرسمي ويُعالَج بسياسة التحقق (REM-15b/14b)، لا بإخفائه هنا.
 *  • **لا إعادة كتابة**: الرقم الضريبي (بائعاً أو مشترياً) يُكتب كما التُقط؛ المشوَّه يظهر كخطأ BR-KSA-40/44 ولا يُحذف ولا يُنظَّف.
 *  • **معرّف السجل التجاري** (BT-29/BT-46) يُكتب بـ `schemeID="CRN"` فقط حين يستوفي قاعدة المواصفة المتحقَّق منها
 *    (BR-KSA-08/14: أحرف وأرقام فقط). غير ذلك يُحذف ولا يُستبدل بمخطّط آخر — الفجوة موثَّقة (التقرير) لا صامتة.
 *  • **رمز البلد** يُكتب فقط إن كان ISO 3166-1 alpha-2 معروفاً (BR-CL-14)؛ لا ترجمة لأسماء الدول ولا استنتاج.
 *  • **الاسم** كما التُقط بلا ترجمة.
 *
 * ترتيب أبناء `cac:Party` و`cac:PostalAddress` مطابق لـ XSD كما يتحقّق منه SDK (انظر تقرير REM-15a).
 */
final class ZatcaPartyXml
{
    /** رموز ISO 3166-1 alpha-2 (٢٤٩ رمزاً) — مشتقّة من قائمة BR-CL-14 في SDK 238-R3.4.8 بحذف 1A وXI (ليسا ضمن ISO). */
    private const ISO_COUNTRIES = <<<'CODES'
        AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
        BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS
        BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN
        CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE
        EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF
        GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM
        HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
        JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC
        LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK
        ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA
        NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG
        PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
        SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS
        ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
        TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI
        VN VU WF WS YE YT ZA ZM ZW
CODES;

    /** عنصر UBL ← مفتاح اللقطة، بترتيب XSD (CitySubdivisionName قبل CityName قبل PostalZone). */
    private const SUPPLIER_FIELDS = [
        'StreetName' => 'street',
        'BuildingNumber' => 'building_no',
        'PlotIdentification' => 'additional_no',
        'CitySubdivisionName' => 'district',
        'CityName' => 'city',
        'PostalZone' => 'postal_code',
    ];

    /** لقطة المشتري v1 لا تحمل الرقم الإضافي (KSA-19 اختياري) فلا يُختلق. */
    private const BUYER_FIELDS = [
        'StreetName' => 'street',
        'BuildingNumber' => 'building_no',
        'CitySubdivisionName' => 'district',
        'CityName' => 'city',
        'PostalZone' => 'postal_code',
    ];

    /** @var array<string, true>|null */
    private static ?array $countrySet = null;

    /**
     * يتحقّق من وجود لقطة v1 صالحة بنيوياً ويعيدها؛ وإلا فشل مغلق (لا رجوع صامت إلى بيانات حيّة).
     *
     * @return array{seller: array<string, mixed>, buyer: array<string, mixed>}
     */
    public static function requireSnapshot(Invoice $invoice): array
    {
        return self::requireSnapshotArray($invoice->party_snapshot);
    }

    /**
     * نفس التحقق على لقطة v1 مُمرَّرة صراحةً (REM-18a: إشعار الدائن يأخذ لقطة الفاتورة الأصلية ولا يلمسها).
     * فشل مغلق بالرسالة نفسها؛ لا رجوع صامت إلى بيانات حيّة.
     *
     * @return array{seller: array<string, mixed>, buyer: array<string, mixed>}
     */
    public static function requireSnapshotArray(mixed $rawSnapshot): array
    {
        $snapshot = InvoicePartySnapshot::parse($rawSnapshot);
        if ($snapshot === null) {
            throw new RuntimeException('لقطة طرفَي الفاتورة (party_snapshot v1) غير موجودة أو غير صالحة؛ لا يُولَّد XML لـ ZATCA بلا لقطة مثبّتة.');
        }

        foreach (['seller', 'buyer'] as $side) {
            foreach ($snapshot[$side] as $key => $value) {
                if ($key === 'address') {
                    if ($value !== null && ! is_array($value)) {
                        throw self::malformed($side, 'address');
                    }
                    foreach ((array) $value as $field => $inner) {
                        if (! self::isScalarOrNull($inner)) {
                            throw self::malformed($side, "address.{$field}");
                        }
                    }

                    continue;
                }
                if (! self::isScalarOrNull($value)) {
                    throw self::malformed($side, (string) $key);
                }
            }
        }

        return ['seller' => $snapshot['seller'], 'buyer' => $snapshot['buyer']];
    }

    /** نص مقصوص أو null — يُستعمل أيضاً لاسم/رقم البائع في QR كي يتّفق مع XML حرفياً. */
    public static function text(mixed $value): ?string
    {
        if ($value === null || ! is_scalar($value)) {
            return null;
        }
        $text = trim((string) $value);

        return $text === '' ? null : $text;
    }

    /** @param array<string, mixed> $seller */
    public static function supplier(array $seller): string
    {
        $inner = self::partyIdentification($seller['cr_number'] ?? null)
            . self::postalAddress(self::addressOf($seller), $seller['country'] ?? null, self::SUPPLIER_FIELDS)
            . self::partyTaxScheme($seller['vat_number'] ?? null)
            . self::legalEntity($seller['name'] ?? null);

        return "  <cac:AccountingSupplierParty>\n    <cac:Party>\n{$inner}    </cac:Party>\n  </cac:AccountingSupplierParty>\n";
    }

    /**
     * @param array<string, mixed> $buyer
     * @param string $documentType 'standard' | 'simplified'
     */
    public static function customer(array $buyer, string $documentType): string
    {
        $address = self::addressOf($buyer);
        $country = is_array($buyer['address'] ?? null) ? ($buyer['address']['country'] ?? null) : null;
        $vat = self::text($buyer['vat_number'] ?? null);

        // المبسّطة: العنوان اختياري → يُكتب مكتملاً فقط (BR-KSA-63/67)؛ الضريبية: كل ما وُجد (النقص يبقى مكشوفاً في SDK).
        $withAddress = $documentType === 'standard' || self::isCompleteBuyerAddress($address, $country);

        $inner = self::partyIdentification($vat === null ? ($buyer['cr_number'] ?? null) : null)
            . ($withAddress ? self::postalAddress($address, $country, self::BUYER_FIELDS) : '')
            . self::partyTaxScheme($vat)
            . self::legalEntity($buyer['name'] ?? null);

        // الحاوية مطلوبة في XSD لدى ZATCA حتى لو فُرِّغت (عيّنات SDK الرسمية للمبسّطة تحملها فارغة).
        if ($inner === '') {
            return "  <cac:AccountingCustomerParty></cac:AccountingCustomerParty>\n";
        }

        return "  <cac:AccountingCustomerParty>\n    <cac:Party>\n{$inner}    </cac:Party>\n  </cac:AccountingCustomerParty>\n";
    }

    /** ISO 3166-1 alpha-2 معروف وإلا null — تطبيع الحالة فقط (sa ⇒ SA)، بلا ترجمة لأسماء الدول. */
    public static function countryCode(mixed $value): ?string
    {
        $code = self::text($value);
        if ($code === null || preg_match('/^[A-Za-z]{2}$/', $code) !== 1) {
            return null;
        }

        self::$countrySet ??= array_fill_keys(preg_split('/\s+/', trim(self::ISO_COUNTRIES)) ?: [], true);

        $code = strtoupper($code);

        return isset(self::$countrySet[$code]) ? $code : null;
    }

    // ───────────────────────── تفاصيل ─────────────────────────

    /** @return array<string, ?string> */
    private static function addressOf(array $party): array
    {
        $address = is_array($party['address'] ?? null) ? $party['address'] : [];

        return array_map(self::text(...), $address);
    }

    /**
     * @param array<string, ?string> $address
     * @param array<string, string> $fields عنصر UBL ⇒ مفتاح اللقطة (بترتيب XSD)
     */
    private static function postalAddress(array $address, mixed $country, array $fields): string
    {
        $out = '';
        foreach ($fields as $element => $key) {
            $value = $address[$key] ?? null;
            if ($value !== null) {
                $out .= "        <cbc:{$element}>" . self::e($value) . "</cbc:{$element}>\n";
            }
        }
        $code = self::countryCode($country);
        if ($code !== null) {
            $out .= "        <cac:Country><cbc:IdentificationCode>{$code}</cbc:IdentificationCode></cac:Country>\n";
        }

        return $out === '' ? '' : "      <cac:PostalAddress>\n{$out}      </cac:PostalAddress>\n";
    }

    private static function partyIdentification(mixed $crNumber): string
    {
        $id = self::text($crNumber);
        if ($id === null || preg_match('/^[A-Za-z0-9]+$/', $id) !== 1) {
            return '';
        }

        return '      <cac:PartyIdentification><cbc:ID schemeID="CRN">' . self::e($id) . "</cbc:ID></cac:PartyIdentification>\n";
    }

    /** الرقم الضريبي كما التُقط (لا تنظيف ولا حذف)؛ عدمه ⇒ لا عنصر (BR-KSA-39 يبقى خطأً حقيقياً للبائع). */
    private static function partyTaxScheme(mixed $vat): string
    {
        $vat = self::text($vat);
        if ($vat === null) {
            return '';
        }

        return '      <cac:PartyTaxScheme><cbc:CompanyID>' . self::e($vat)
            . "</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>\n";
    }

    private static function legalEntity(mixed $name): string
    {
        $name = self::text($name);

        return $name === null
            ? ''
            : '      <cac:PartyLegalEntity><cbc:RegistrationName>' . self::e($name) . "</cbc:RegistrationName></cac:PartyLegalEntity>\n";
    }

    /**
     * اكتمال عنوان المشتري للمبسّطة: SA ⇒ BR-KSA-63 (شارع/مبنى/حي/مدينة/رمز بريدي/بلد) + BR-KSA-67 (رمز بريدي ٥ أرقام)؛
     * بلد أجنبي معروف ⇒ BR-KSA-10 (شارع/مدينة/بلد)؛ بلد غائب/غير معروف ⇒ غير مكتمل.
     *
     * @param array<string, ?string> $address
     */
    private static function isCompleteBuyerAddress(array $address, mixed $country): bool
    {
        $code = self::countryCode($country);
        if ($code === null) {
            return false;
        }
        $has = static function (string ...$keys) use ($address): bool {
            foreach ($keys as $key) {
                if (($address[$key] ?? null) === null) {
                    return false;
                }
            }

            return true;
        };

        if ($code !== 'SA') {
            return $has('street', 'city');
        }

        return $has('street', 'building_no', 'district', 'city', 'postal_code')
            && preg_match('/^[0-9]{5}$/', (string) $address['postal_code']) === 1;
    }

    private static function e(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    private static function isScalarOrNull(mixed $value): bool
    {
        return $value === null || is_scalar($value);
    }

    private static function malformed(string $side, string $field): RuntimeException
    {
        return new RuntimeException("لقطة طرفَي الفاتورة تالفة البنية ({$side}.{$field})؛ لا يُولَّد XML لـ ZATCA منها.");
    }
}
