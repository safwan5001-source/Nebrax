<?php

namespace App\Support;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;

/**
 * REM-14 — لقطة البائع والمشتري كما كانا لحظة إصدار الفاتورة (Snapshot v1).
 *
 * تُلتقط مرة واحدة في `InvoiceService::post()` (بعد قفلَي الفاتورة والمستأجر، وقبل توليد مخرجات ZATCA) وتُخزَّن
 * في `invoices.party_snapshot`؛ ولا تتغيّر بعدها حتى لو تغيّر العميل أو المستأجر أو ملف المؤسسة.
 *
 * **تقليل البيانات:** حقول موجودة أصلاً فقط، ولا حقل هوية جديد. لا شعار، لا بريد، لا هاتف عميل، لا عنوان نصّي حرّ
 * للعميل، لا بيانات اعتماد، ولا إعدادات غير ذات صلة. هاتف/جوال البائع (جهة اتصال المنشأة المطبوعة في رأس الفاتورة)
 * هما الاستثناء الوحيد من «الهوية القانونية»، ويُلتقطان كي لا يختلط في المستند المطبوع اسمٌ مجمَّد بهاتفٍ حيّ.
 *
 * **المعنى والمصدر والقابلية للفراغ** (القيمة الفارغة/المسافات ⇒ `null`؛ لا اختراع قيم افتراضية):
 *
 *  seller.tenant_id / branch_id  ← الفاتورة (سياق الالتقاط، لا هوية)
 *  seller.name / vat_number / cr_number / country ← أعمدة `tenants`
 *  seller.address.* / phone / mobile ← إعدادات `company` (`CompanyProfile::SETTINGS_FIELDS`)
 *  buyer.partner_id ← الفاتورة؛ entity_type / name / name_en / vat_number / cr_number ← `partners`
 *  buyer.address.{street,building_no,district,city,postal_code,country} ← `partners`
 *
 * `cr_number` يُلتقط كما هو بلا مخطط تعريف (scheme) — نمذجة معرّفات البائع/المشتري الأخرى (CRN/MOM/MLS/700/NAT…)
 * مسألة تنظيمية غير محسومة (P1) ولا تُحسم هنا. اللقطة نفسها لا تغيّر التوقيع/الهاش؛ وكتلتا البائع/المشتري داخل XML
 * ووسما QR 1–2 تُبنى منها (REM-15a: `ZatcaPartyXml`).
 */
final class InvoicePartySnapshot
{
    public const VERSION = 1;

    /** يلتقط لقطة v1 للفاتورة (تُستدعى داخل معاملة الترحيل). */
    public static function capture(Invoice $invoice): array
    {
        $tenant = Tenant::find($invoice->tenant_id);
        $company = Settings::group('company', $tenant);
        $partner = $invoice->partner;

        return [
            'v' => self::VERSION,
            'seller' => [
                'tenant_id'  => $invoice->tenant_id,
                'branch_id'  => $invoice->branch_id,
                'name'       => self::clean($tenant?->name),
                'vat_number' => self::clean($tenant?->vat_number),
                'cr_number'  => self::clean($tenant?->cr_number),
                'country'    => self::clean($tenant?->country),
                'address'    => [
                    'building_no'   => self::clean($company['building_no'] ?? null),
                    'street'        => self::clean($company['street'] ?? null),
                    'additional_no' => self::clean($company['additional_no'] ?? null),
                    'district'      => self::clean($company['district'] ?? null),
                    'city'          => self::clean($company['city'] ?? null),
                    'postal_code'   => self::clean($company['postal_code'] ?? null),
                    'short_address' => self::clean($company['short_address'] ?? null),
                ],
                'phone'      => self::clean($company['phone'] ?? null),
                'mobile'     => self::clean($company['mobile'] ?? null),
            ],
            'buyer' => self::buyer($invoice, $partner),
        ];
    }

    /** @return array<string, mixed> */
    private static function buyer(Invoice $invoice, ?Partner $partner): array
    {
        return [
            'partner_id'  => $invoice->partner_id,
            'entity_type' => self::clean($partner?->entity_type),
            'name'        => self::clean($partner?->name),
            'name_en'     => self::clean($partner?->name_en),
            'vat_number'  => self::clean($partner?->vat_number),
            'cr_number'   => self::clean($partner?->cr_number),
            'address'     => [
                'building_no' => self::clean($partner?->building_no),
                'street'      => self::clean($partner?->street),
                'district'    => self::clean($partner?->district),
                'city'        => self::clean($partner?->city),
                'postal_code' => self::clean($partner?->postal_code),
                'country'     => self::clean($partner?->country),
            ],
        ];
    }

    /**
     * يقبل لقطة v1 سليمة البنية فقط. المجهول (إصدار آخر، أو شكل ناقص) يعود `null` فيُعامَل كأن لا لقطة، فلا يُعرض
     * نصف-لقطة ولا تُفسَّر لقطة بإصدار لا يعرفه هذا الكود.
     *
     * @return array{v:int, seller:array<string,mixed>, buyer:array<string,mixed>}|null
     */
    public static function parse(mixed $raw): ?array
    {
        if (is_string($raw)) {
            $raw = json_decode($raw, true);
        }

        if (! is_array($raw) || ($raw['v'] ?? null) !== self::VERSION
            || ! is_array($raw['seller'] ?? null) || ! is_array($raw['buyer'] ?? null)) {
            return null;
        }

        return $raw;
    }

    /**
     * التمثيل المكشوف في الـAPI: اللقطة نفسها بلا معرّف المستأجر (داخلي) — `branch_id` و`partner_id` ظاهران أصلاً
     * في رأس الفاتورة نفسه فلا تسريب جديد.
     *
     * @param  array{v:int, seller:array<string,mixed>, buyer:array<string,mixed>}  $snapshot
     * @return array{version:int, seller:array<string,mixed>, buyer:array<string,mixed>}
     */
    public static function forApi(array $snapshot): array
    {
        $seller = $snapshot['seller'];
        unset($seller['tenant_id']);

        return ['version' => $snapshot['v'], 'seller' => $seller, 'buyer' => $snapshot['buyer']];
    }

    private static function clean(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);

        return $text === '' ? null : $text;
    }
}
