<?php

namespace App\Support;

/**
 * مصدر الحقيقة لحقول استيراد الأطراف (عملاء/موردون) — IMP-H3-S1. كما `ProductImportFields`: منه تُشتقّ ترويسات القالب والمطابقة التلقائية
 * وعقد الواجهة، فلا قائمة ثانية في أي طبقة.
 *
 * مستبعدٌ عمداً:
 *  - `type`: يحدّده **مدخل الاستيراد** (عملاء أو موردون) ولا يُستنتج ولا يُقرأ من الملف.
 *  - الرصيد الافتتاحي (`opening_balance*`): فعلٌ محاسبي بقيد لا عمود (قرار المالك D-01) — لا يقبله هذا المسار أبداً.
 *  - المراجع (التصنيفات، قائمة السعر): مرحلة لاحقة بعقد بيانات أساسية صريح.
 *
 * `required` مطلوب للإنشاء · `clearable` يقبل المسح الصريح · `update_locked` لا يغيّره الاستيراد على طرف قائم · `writable` يكتبه الاستيراد.
 */
final class PartnerImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_EMAIL = 'email';
    public const TYPE_VAT = 'vat';
    public const TYPE_MONEY = 'money';
    public const TYPE_INTEGER = 'integer';
    public const TYPE_BOOLEAN = 'boolean';
    public const TYPE_ENUM = 'enum';
    public const TYPE_IDENTIFIER = 'identifier';

    /** حقول تُعامَل «إشارات تكرار» بسياسة التشغيلة (error | skip | warn). */
    public const DUPLICATE_SIGNALS = ['vat_number', 'cr_number', 'phone', 'mobile', 'email'];

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= self::build();
    }

    /** @return array<string, array<string, mixed>> */
    private static function build(): array
    {
        $text = static fn (string $ar, string $en, array $aliases, bool $clearable = true, int $max = 255): array => [
            'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => $clearable, 'update_locked' => false, 'writable' => true,
            'max' => $max, 'label_ar' => $ar, 'label_en' => $en, 'aliases' => $aliases,
        ];

        return [
            'nebrax_id' => [
                'type' => self::TYPE_IDENTIFIER, 'required' => false, 'clearable' => false, 'update_locked' => true, 'writable' => false,
                'label_ar' => 'معرّف نبراكس', 'label_en' => 'Nebrax ID',
                'aliases' => ['nebraxid', 'partnerid', 'uuid', 'معرفنبراكس', 'المعرف', 'معرفالطرف'],
            ],
            'code' => $text('الكود', 'Code', ['code', 'partnercode', 'customercode', 'suppliercode', 'accountnumber', 'الكود', 'كود', 'رمزالعميل', 'رقمالعميل', 'كودالطرف'], false),
            'name' => ['required' => true, 'clearable' => false] + $text('الاسم', 'Name', ['name', 'partnername', 'customername', 'suppliername', 'companyname', 'الاسم', 'اسمالعميل', 'اسمالمورد', 'اسمالشركة']),
            'name_en' => $text('الاسم بالإنجليزية', 'English name', ['nameen', 'englishname', 'nameenglish', 'الاسمبالانجليزية', 'الاسمالانجليزي']),
            'entity_type' => [
                'type' => self::TYPE_ENUM, 'required' => false, 'clearable' => false, 'update_locked' => false, 'writable' => true,
                'values' => ['individual', 'commercial'],
                'label_ar' => 'نوع الكيان', 'label_en' => 'Entity type',
                'aliases' => ['entitytype', 'partnerkind', 'legalform', 'نوعالكيان', 'الكيان', 'نوعالطرف'],
            ],
            'vat_number' => [
                'type' => self::TYPE_VAT, 'required' => false, 'clearable' => true, 'update_locked' => false, 'writable' => true, 'max' => 15,
                'label_ar' => 'الرقم الضريبي', 'label_en' => 'VAT number',
                'aliases' => ['vat', 'vatnumber', 'vatno', 'taxnumber', 'taxid', 'trn', 'الرقمالضريبي', 'رقمضريبي', 'الرقمالضريبيللمنشاة'],
            ],
            'cr_number' => $text('السجل التجاري', 'CR number', ['cr', 'crnumber', 'crno', 'commercialregistration', 'السجلالتجاري', 'رقمالسجلالتجاري']),
            'email' => [
                'type' => self::TYPE_EMAIL, 'required' => false, 'clearable' => true, 'update_locked' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'البريد الإلكتروني', 'label_en' => 'Email',
                'aliases' => ['email', 'emailaddress', 'mail', 'البريدالالكتروني', 'البريد', 'ايميل'],
            ],
            'phone' => $text('الهاتف', 'Phone', ['phone', 'telephone', 'tel', 'phonenumber', 'الهاتف', 'تلفون', 'رقمالهاتف']),
            'mobile' => $text('الجوال', 'Mobile', ['mobile', 'cell', 'cellphone', 'mobilenumber', 'الجوال', 'رقمالجوال', 'موبايل']),
            'address' => $text('العنوان', 'Address', ['address', 'streetaddress', 'العنوان']),
            'city' => $text('المدينة', 'City', ['city', 'town', 'المدينة']),
            'building_no' => $text('رقم المبنى', 'Building number', ['buildingno', 'buildingnumber', 'building', 'رقمالمبنى', 'المبنى']),
            'street' => $text('الشارع', 'Street', ['street', 'streetname', 'الشارع']),
            'district' => $text('الحي', 'District', ['district', 'neighborhood', 'neighbourhood', 'الحي']),
            'postal_code' => $text('الرمز البريدي', 'Postal code', ['postalcode', 'zipcode', 'zip', 'postcode', 'الرمزالبريدي', 'الرمزالبريدى']),
            'country' => $text('الدولة', 'Country', ['country', 'countrycode', 'الدولة', 'البلد']),
            'credit_limit' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'clearable' => false, 'update_locked' => false, 'writable' => true,
                'label_ar' => 'حد الائتمان', 'label_en' => 'Credit limit',
                'aliases' => ['creditlimit', 'limit', 'حدالائتمان', 'الحدالائتماني', 'سقفالائتمان'],
            ],
            'credit_period' => [
                'type' => self::TYPE_INTEGER, 'required' => false, 'clearable' => false, 'update_locked' => false, 'writable' => true, 'min' => 0, 'max' => 3650,
                'label_ar' => 'مدة الائتمان (أيام)', 'label_en' => 'Credit period (days)',
                'aliases' => ['creditperiod', 'creditdays', 'paymentterms', 'مدةالائتمان', 'مدةالسداد', 'ايامالائتمان'],
            ],
            'is_active' => [
                'type' => self::TYPE_BOOLEAN, 'required' => false, 'clearable' => false, 'update_locked' => false, 'writable' => true,
                'label_ar' => 'نشط', 'label_en' => 'Active',
                'aliases' => ['isactive', 'active', 'status', 'enabled', 'نشط', 'الحالة', 'مفعل'],
            ],
        ];
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::all());
    }

    /** @return list<string> */
    public static function writableKeys(): array
    {
        return array_keys(array_filter(self::all(), static fn (array $field): bool => $field['writable'] === true));
    }

    /** @return array<string, mixed>|null */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    /** الأعمدة التي يُطابَق بها طرف قائم، بترتيب الأولوية. */
    public const IDENTIFIERS = ['nebrax_id', 'code'];

    /** @return list<string> ترويسات القالب (عربية) بترتيب الحقول. */
    public static function templateHeaders(): array
    {
        return array_values(array_map(static fn (array $field): string => (string) $field['label_ar'], self::all()));
    }

    /** @param list<string> $headers @return array<int, string|null> فهرس العمود → مفتاح الحقل أو null */
    public static function autoMap(array $headers): array
    {
        $aliasIndex = [];
        foreach (self::all() as $key => $field) {
            $aliasIndex[$key] = array_values(array_unique(array_merge(
                [ImportHeaderMatcher::normalize($key), ImportHeaderMatcher::normalize((string) $field['label_ar']), ImportHeaderMatcher::normalize((string) $field['label_en'])],
                array_map([ImportHeaderMatcher::class, 'normalize'], $field['aliases']),
            )));
        }

        return ImportHeaderMatcher::autoMap($headers, $aliasIndex);
    }
}
