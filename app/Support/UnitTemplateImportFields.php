<?php

namespace App\Support;

/**
 * مصدر الحقيقة لحقول استيراد قوالب الوحدات — IMP-H4-S3 (إنشاء فقط، **بلا مسار ذكاء اصطناعي** — قرار المالك D-08). الصف يمثّل **وحدة بديلة واحدة** داخل قالب
 * (صيغة طويلة): صفوف القالب الواحد تتشارك `template_name` وتتكرّر فيها وحدة الأساس؛ قالبٌ بلا وحدات بديلة صفٌّ واحد بلا `unit_name`.
 *
 * مستبعدٌ عمداً: تعديل قالب قائم أو إضافة وحدات إليه (تعديلٌ دلاليّ يخضع لحارس المتحكّم PR-UOM-1: أثرٌ مخزني ومراجع حيّة)، وأي ربط بالمنتجات
 * (المنتج يشير إلى قالبه من استيراد المنتجات). المعامل يضرب الكمية الداخلة إلى المخزون: لذلك لا قيمة مفترضة ولا مرونة في الصيغة.
 */
final class UnitTemplateImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_INTEGER = 'integer';
    public const TYPE_BOOLEAN = 'boolean';

    /** حدود `StoreUnitTemplateRequest` نفسها. */
    public const MIN_FACTOR = 2;
    public const MAX_FACTOR = 1000000;
    public const MAX_UNITS = 50;

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= [
            'template_name' => [
                'type' => self::TYPE_TEXT, 'required' => true, 'max' => 255,
                'label_ar' => 'اسم القالب', 'label_en' => 'Template name',
                'aliases' => ['templatename', 'template', 'name', 'اسمالقالب', 'القالب', 'الاسم'],
            ],
            'base_unit' => [
                'type' => self::TYPE_TEXT, 'required' => true, 'max' => 255,
                'label_ar' => 'وحدة الأساس', 'label_en' => 'Base unit',
                'aliases' => ['baseunit', 'base', 'basicunit', 'وحدةالاساس', 'الوحدةالاساسية', 'الاساس'],
            ],
            'unit_name' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 255,
                'label_ar' => 'الوحدة البديلة', 'label_en' => 'Alternate unit',
                'aliases' => ['unitname', 'alternateunit', 'altunit', 'unit', 'الوحدةالبديلة', 'الوحدة', 'اسمالوحدة'],
            ],
            'factor' => [
                'type' => self::TYPE_INTEGER, 'required' => false, 'min' => self::MIN_FACTOR, 'max' => self::MAX_FACTOR,
                'label_ar' => 'المعامل', 'label_en' => 'Factor',
                'aliases' => ['factor', 'conversionfactor', 'multiplier', 'qty', 'المعامل', 'معاملالتحويل', 'عددالوحدات'],
            ],
            'is_active' => [
                'type' => self::TYPE_BOOLEAN, 'required' => false,
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

    /** @return array<string, mixed>|null */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    /** @return list<string> */
    public static function templateHeaders(): array
    {
        return array_values(array_map(static fn (array $field): string => (string) $field['label_ar'], self::all()));
    }

    /** @param list<string> $headers @return array<int, string|null> */
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
