<?php

namespace App\Support;

/**
 * مصدر الحقيقة لحقول استيراد تصنيفات المنتجات وعلاماتها التجارية — IMP-H4-S1. النوع (`category` | `brand`) يحدّده مدخل الاستيراد لا الملف.
 *
 * مستبعدٌ عمداً: صورة التصنيف (ملف وسائط لا عمود نصي)، وإعادة التسمية أو النقل لعنصر قائم (يبقيان للشاشة بتحقق الدورة والإخوة)،
 * وأي ربط بالمنتجات (المنتج يشير إلى تصنيفه من استيراد المنتجات، لا العكس). لا أثر محاسبي إطلاقاً.
 *
 * هوية التصنيف **مساره** (الأب + الاسم): الاسم فريدٌ بين الإخوة بقاعدة المتحكّم نفسها، فالمسار مفتاحٌ طبيعي لا يحتمل الغموض — بخلاف
 * المنتج الذي لا يُعدّ اسمه معرّفاً. وهوية العلامة اسمها (فريد على المؤسسة). معرّف نبراكس يتقدّم دوماً متى وُجد.
 */
final class ProductTaxonomyImportFields
{
    public const KIND_CATEGORY = 'category';
    public const KIND_BRAND = 'brand';
    public const KINDS = [self::KIND_CATEGORY, self::KIND_BRAND];

    public const TYPE_TEXT = 'text';
    public const TYPE_COLOR = 'color';
    public const TYPE_BOOLEAN = 'boolean';
    public const TYPE_IDENTIFIER = 'identifier';
    public const TYPE_PATH = 'path';

    /** فاصلا المسار المقبولان في الخلية (الشرطة المائلة ليست منهما: قد تكون من اسم التصنيف). */
    public const PATH_SEPARATORS = ['>', '›', '»'];

    /** أقصى عدد مستويات في المسار (الأجداد + الاسم). */
    public const MAX_DEPTH = 8;

    /** @var array<string, array<string, array<string, mixed>>> */
    private static array $cache = [];

    /** @return array<string, array<string, mixed>> */
    public static function all(string $kind): array
    {
        return self::$cache[$kind] ??= self::build($kind);
    }

    /** @return array<string, array<string, mixed>> */
    private static function build(string $kind): array
    {
        self::assertKind($kind);
        $nebrax = [
            'type' => self::TYPE_IDENTIFIER, 'required' => false, 'clearable' => false, 'writable' => false,
            'label_ar' => 'معرّف نبراكس', 'label_en' => 'Nebrax ID',
            'aliases' => ['nebraxid', 'uuid', 'معرفنبراكس', 'المعرف'],
        ];
        $isActive = [
            'type' => self::TYPE_BOOLEAN, 'required' => false, 'clearable' => false, 'writable' => true,
            'label_ar' => 'نشط', 'label_en' => 'Active',
            'aliases' => ['isactive', 'active', 'status', 'enabled', 'نشط', 'الحالة', 'مفعل'],
        ];

        if ($kind === self::KIND_BRAND) {
            return [
                'nebrax_id' => $nebrax,
                'name' => [
                    'type' => self::TYPE_TEXT, 'required' => true, 'clearable' => false, 'writable' => true, 'max' => 255,
                    'label_ar' => 'الاسم', 'label_en' => 'Name',
                    'aliases' => ['name', 'brand', 'brandname', 'الاسم', 'العلامة', 'العلامةالتجارية', 'اسمالعلامة'],
                ],
                'is_active' => $isActive,
            ];
        }

        return [
            'nebrax_id' => $nebrax,
            'name' => [
                'type' => self::TYPE_TEXT, 'required' => true, 'clearable' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'الاسم', 'label_en' => 'Name',
                'aliases' => ['name', 'category', 'categoryname', 'الاسم', 'التصنيف', 'اسمالتصنيف'],
            ],
            'parent_path' => [
                'type' => self::TYPE_PATH, 'required' => false, 'clearable' => false, 'writable' => true,
                'label_ar' => 'مسار التصنيف الأب', 'label_en' => 'Parent path',
                'aliases' => ['parentpath', 'parent', 'path', 'parentcategory', 'مسارالتصنيفالاب', 'التصنيفالاب', 'الاب', 'المسار'],
            ],
            'description' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => true, 'writable' => true, 'max' => 4000,
                'label_ar' => 'الوصف', 'label_en' => 'Description',
                'aliases' => ['description', 'desc', 'details', 'الوصف', 'التفاصيل'],
            ],
            'color' => [
                'type' => self::TYPE_COLOR, 'required' => false, 'clearable' => true, 'writable' => true,
                'label_ar' => 'اللون', 'label_en' => 'Color',
                'aliases' => ['color', 'colour', 'hex', 'اللون'],
            ],
            'is_active' => $isActive,
        ];
    }

    /** @return list<string> */
    public static function keys(string $kind): array
    {
        return array_keys(self::all($kind));
    }

    /** اتحاد المفاتيح لكل الأنواع (قاعدة تحقق الطلب البنيوية؛ الخدمة تحكم بالنوع الفعلي). @return list<string> */
    public static function allKeys(): array
    {
        return array_values(array_unique(array_merge(self::keys(self::KIND_CATEGORY), self::keys(self::KIND_BRAND))));
    }

    /** @return list<string> */
    public static function writableKeys(string $kind): array
    {
        return array_keys(array_filter(self::all($kind), static fn (array $field): bool => $field['writable'] === true));
    }

    /** @return array<string, mixed>|null */
    public static function get(string $kind, string $key): ?array
    {
        return self::all($kind)[$key] ?? null;
    }

    /** @return list<string> */
    public static function templateHeaders(string $kind): array
    {
        return array_values(array_map(static fn (array $field): string => (string) $field['label_ar'], self::all($kind)));
    }

    /** @param list<string> $headers @return array<int, string|null> */
    public static function autoMap(string $kind, array $headers): array
    {
        $aliasIndex = [];
        foreach (self::all($kind) as $key => $field) {
            $aliasIndex[$key] = array_values(array_unique(array_merge(
                [ImportHeaderMatcher::normalize($key), ImportHeaderMatcher::normalize((string) $field['label_ar']), ImportHeaderMatcher::normalize((string) $field['label_en'])],
                array_map([ImportHeaderMatcher::class, 'normalize'], $field['aliases']),
            )));
        }

        return ImportHeaderMatcher::autoMap($headers, $aliasIndex);
    }

    public static function assertKind(string $kind): void
    {
        if (! in_array($kind, self::KINDS, true)) {
            throw new \RuntimeException('نوع الاستيراد يجب أن يكون تصنيفات أو علامات تجارية.');
        }
    }
}
