<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ بيانات المكوّنات الوصفية — APP-BUILDER-3
 * ═══════════════════════════════════════════════════════════════
 *
 * يوسّع `RuntimeCapabilities::COMPONENTS` (هوية + إصدار فقط، من APP-BUILDER-2)
 * ببيان كامل لكل مكوّن: خصائصه، قاعدة أبنائه، وهل يحمل إجراءً. **كل حقل هنا
 * مُستخرَج من قراءة مباشرة لـ `mobile/lib/registry/component_widgets.dart`**
 * (الودجات الخمس عشرة الحقيقية المُختبَرة عبر `component_registry_test.dart`)،
 * لا من `COMPONENT_REGISTRY_V1.md` التوضيحي — ذاك يصف سطحاً أوسع (ألوان
 * دلالية، bindings، أحداث مسمّاة) لم يُبنَ فعلياً بعد.
 *
 * وصفي بحت: لا يغيّر هذا الصنف سلوك `AppSchemaParser`/`CompatibilityResolver`
 * — كلاهما يتحقق من هوية النوع فقط (عبر `RuntimeCapabilities`)، ولا يتحقق من
 * شكل `props` الداخلي، تماماً كما لا تتحقق الودجات الحقيقية بصرامة (تتعامل
 * دفاعياً مع خاصية غائبة/خطأ النوع). ربط هذا السجلّ بتحقّق فعلي في وقت الحفظ/
 * النشر قرار منفصل لمهمة لاحقة، لا لهذه.
 *
 * مفتاح المصفوفة المُعادة من `definitions()` يُطابق حرفياً
 * `RuntimeCapabilities::COMPONENTS` — يحرسه `ComponentRegistryTest`.
 */
final class ComponentRegistry
{
    private function __construct() {}

    public const CATEGORY_LAYOUT = 'layout';

    public const CATEGORY_CONTENT = 'content';

    public const CATEGORY_COMMERCE = 'commerce';

    public const CATEGORY_NAVIGATION = 'navigation';

    /**
     * @return array<string, ComponentDefinition>
     */
    public static function definitions(): array
    {
        $definitions = [
            new ComponentDefinition(
                type: 'Page',
                version: 1,
                category: self::CATEGORY_LAYOUT,
                props: [],
                childrenRule: ChildrenRule::unboundedAny(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'جذر الصفحة — قائمة قابلة للتمرير (`ListView`) تحوي أبناءه، بلا خصائص خاصة به.',
            ),
            new ComponentDefinition(
                type: 'Section',
                version: 1,
                category: self::CATEGORY_LAYOUT,
                props: [
                    new PropDefinition('title', PropType::STRING, required: false),
                ],
                childrenRule: ChildrenRule::unboundedAny(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'عنوان اختياري يظهر أعلى الأبناء إن وُجد فقط (`title == null` لا يعرض فراغاً).',
            ),
            new ComponentDefinition(
                type: 'Text',
                version: 1,
                category: self::CATEGORY_CONTENT,
                props: [
                    new PropDefinition('text', PropType::STRING, required: false, default: ''),
                    new PropDefinition('style', PropType::STRING, required: false, default: 'body', enumValues: ['title', 'body', 'caption']),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'خاصية غائبة أو بنوع خطأ تسقط لسلسلة فارغة/الأسلوب الافتراضي، لا رفض.',
            ),
            new ComponentDefinition(
                type: 'Image',
                version: 1,
                category: self::CATEGORY_CONTENT,
                props: [
                    new PropDefinition('url', PropType::ASSET_URL, required: true),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'رابط بلا بادئة `https://` يعرض بديلاً آمناً بدل طلب شبكة — لا استثناء، لا انهيار.',
            ),
            new ComponentDefinition(
                type: 'ProductList',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [],
                childrenRule: ChildrenRule::unboundedAny(suggestedChildType: 'ProductCard'),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'مُموِّج أفقي محدود يرسم أيّ نوع أبناء دون تحقّق فعلي — `ProductCard` تلميحٌ تحريري لا قيد تشغيلي.',
                bindableResources: ['commerce.products'],
            ),
            new ComponentDefinition(
                type: 'ProductCard',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('title', PropType::STRING, required: true, default: ''),
                    new PropDefinition('imageUrl', PropType::ASSET_URL, required: false),
                    new PropDefinition('amountMinor', PropType::AMOUNT_MINOR, required: true, default: 0),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: true,
                injectedRuntimeActionParams: [],
                notes: 'لا يرسم `children` إطلاقاً حتى لو وُجدت. بلا إجراء مرفق يظهر خامداً (شفافية مخفّضة، بلا استجابة لمسّية).',
            ),
            new ComponentDefinition(
                type: 'ProductDetail',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('title', PropType::STRING, required: true, default: ''),
                    new PropDefinition('description', PropType::STRING, required: false),
                    new PropDefinition('imageUrl', PropType::ASSET_URL, required: false),
                    new PropDefinition('amountMinor', PropType::AMOUNT_MINOR, required: true, default: 0),
                ],
                childrenRule: ChildrenRule::unboundedAny(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'يعرض الحقول الثابتة أولاً ثم أبناءه (عادة `VariantSelector`/`Quantity`/`AddToCart`) بالترتيب المُعطى.',
                bindableResources: ['commerce.products'],
            ),
            new ComponentDefinition(
                type: 'Price',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('amountMinor', PropType::AMOUNT_MINOR, required: true, default: 0),
                    new PropDefinition('currencySymbol', PropType::STRING, required: false, default: 'ر.س'),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'عرضٌ فقط — لا يحسب مبلغاً إطلاقاً، يهيّئ `amountMinor` المُعطى فقط.',
            ),
            new ComponentDefinition(
                type: 'VariantSelector',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('options', PropType::STRING_LIST, required: false),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'حالة واجهة محلية بحتة (mutable `_selectedIndex`) — لا يقرأ/يستعمل `node.action` إطلاقاً؛ إجراءٌ مرفَق له لا أثر تشغيلياً اليوم.',
            ),
            new ComponentDefinition(
                type: 'Quantity',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('value', PropType::INTEGER, required: false, default: 1),
                    new PropDefinition('min', PropType::INTEGER, required: false, default: 1),
                    new PropDefinition('max', PropType::INTEGER, required: false, default: 99),
                    new PropDefinition('decreaseLabel', PropType::STRING, required: false),
                    new PropDefinition('increaseLabel', PropType::STRING, required: false),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: true,
                injectedRuntimeActionParams: ['quantity'],
                notes: 'كل ضغطة +/- تُلحق القيمة الحيّة الحالية كـ `quantity` بمعاملات الإجراء المرفَق تلقائياً — المخطط لا يؤلّف هذا المفتاح.',
            ),
            new ComponentDefinition(
                type: 'AddToCart',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('label', PropType::STRING, required: false, default: 'إضافة للسلة'),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: true,
                injectedRuntimeActionParams: [],
                notes: 'زرٌ بلا إجراء مرفق يظهر مُعطَّلاً (`onPressed: null`) عبر الحالة القياسية للزر، لا نمط الشفافية.',
            ),
            new ComponentDefinition(
                type: 'CartList',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [],
                childrenRule: ChildrenRule::unboundedAny(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'عمود يرسم أبناءه فقط، بلا خصائص خاصة به.',
                bindableResources: ['commerce.cart'],
            ),
            new ComponentDefinition(
                type: 'CartSummary',
                version: 1,
                category: self::CATEGORY_COMMERCE,
                props: [
                    new PropDefinition('itemCount', PropType::INTEGER, required: false, default: 0),
                    new PropDefinition('subtotalAmountMinor', PropType::AMOUNT_MINOR, required: false, default: 0),
                    new PropDefinition('summaryLabel', PropType::STRING, required: false),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: false,
                injectedRuntimeActionParams: [],
                notes: 'بلا `summaryLabel` تُبنى تسمية غير مترجمة (`"$itemCount عنصر"`) — لا لغة للودجة نفسها.',
                bindableResources: ['commerce.cart'],
            ),
            new ComponentDefinition(
                type: 'Button',
                version: 1,
                category: self::CATEGORY_NAVIGATION,
                props: [
                    new PropDefinition('label', PropType::STRING, required: false, default: 'زر'),
                    new PropDefinition('style', PropType::STRING, required: false, default: 'primary', enumValues: ['primary', 'secondary']),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: true,
                injectedRuntimeActionParams: [],
                notes: 'زر عام (ليس تنقّلاً حصراً) — أي إجراء مسموح، لا `navigate` فقط.',
            ),
            new ComponentDefinition(
                type: 'NavigationTarget',
                version: 1,
                category: self::CATEGORY_NAVIGATION,
                props: [
                    new PropDefinition('label', PropType::STRING, required: false, default: ''),
                ],
                childrenRule: ChildrenRule::none(),
                actionable: true,
                injectedRuntimeActionParams: [],
                notes: 'سهم اتجاهه يُشتقّ من `Directionality` الفعلي (لا رمز ثابت) — `chevron_left` بالعربية، `chevron_right` بالإنجليزية.',
            ),
        ];

        $byType = [];
        foreach ($definitions as $definition) {
            $byType[$definition->type] = $definition;
        }

        return $byType;
    }
}
