<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ بيانات الإجراءات الوصفية — APP-BUILDER-3
 * ═══════════════════════════════════════════════════════════════
 *
 * يوسّع `RuntimeCapabilities::ACTIONS` (هوية + إصدار فقط) ببيان مُدخلات كل
 * إجراء. **كل قيد هنا مطابقٌ حرفياً لـ `decodeAction()` في
 * `mobile/lib/actions/app_action.dart`** — لا قيد أوسع أو أضيق ممّا يفحصه
 * ذلك المفكِّك فعلياً، ومُختبَر بمرآة في `mobile/test/actions/app_action_test.dart`.
 *
 * `dispatchStatus` (`ActionDefinition` — انظر توثيقها الكامل) يصف عقد
 * **مخطط App Builder تحديداً**: هل مسار مخطط يصل إلى تنفيذ حقيقي؟ لا علاقة
 * له بكون بناء الجوال المُثبَت ينفّذ الإجراء فعلياً في شاشاته المكتوبة يدوياً
 * (`RuntimeActionHandler` حقيقيٌّ لكلّ الستّة منذ أفق Mobile Runtime Proof V1
 * المُغلَق — ذلك محور مستقلّ تماماً). `APP-BUILDER-17`/`18` أثبتا مساراً
 * مربوطاً حقيقياً لـ`openProduct`/`updateCartQuantity`/`removeCartItem`
 * فقط (PR #1006) — الثلاثة الأخرى تبقى `DISPATCH_PROVEN_NOOP` لأسباب مختلفة
 * موثَّقة عند كل واحد أدناه.
 *
 * مفتاح المصفوفة المُعادة من `definitions()` يُطابق حرفياً
 * `RuntimeCapabilities::ACTIONS` — يحرسه `ActionRegistryTest`.
 *
 * **`label` (`APP-BUILDER-21`)**: تسمية بشرية ثنائية اللغة للتاجر — لا تغيّر
 * `type`/مفاتيح `params` الداخلية إطلاقاً، فقط تصف واجهة Inspector.
 */
final class ActionRegistry
{
    private function __construct() {}

    /**
     * @return array<string, ActionDefinition>
     */
    public static function definitions(): array
    {
        $definitions = [
            new ActionDefinition(
                type: 'navigate',
                version: 1,
                riskClass: ActionRiskClass::NAVIGATION,
                params: [
                    new ActionParamDefinition('pageId', PropType::STRING, required: true, label: new Label(ar: 'معرّف الصفحة', en: 'Page ID')),
                ],
                dispatchStatus: ActionDefinition::DISPATCH_PROVEN_NOOP,
                notes: 'يُفكَّك فقط حين تكون `pageId` سلسلة غير فارغة. لا يحتاج ربطاً إطلاقاً (لا `$item.*`) — `DISPATCH_PROVEN_NOOP` لأنه غير قابل للربط أصلاً، لا لعجزٍ في التنفيذ.',
                label: new Label(ar: 'الانتقال', en: 'Navigate'),
            ),
            new ActionDefinition(
                type: 'openProduct',
                version: 1,
                riskClass: ActionRiskClass::NAVIGATION,
                params: [
                    new ActionParamDefinition('productId', PropType::STRING, required: true, label: new Label(ar: 'معرّف المنتج', en: 'Product ID')),
                ],
                dispatchStatus: ActionDefinition::DISPATCH_LIVE,
                notes: 'يُفكَّك فقط حين تكون `productId` سلسلة غير فارغة. `DISPATCH_LIVE` (`APP-BUILDER-18`): `productId` يُحلّ عبر `$item.id` من ربط `commerce.products` (`ProductList`/`ProductCard`) — مُثبَتٌ بتبويب بطاقة منتج حقيقي في `vertical_slice_test.dart` (PR #1006).',
                label: new Label(ar: 'فتح المنتج', en: 'Open Product'),
            ),
            new ActionDefinition(
                type: 'addToCart',
                version: 1,
                riskClass: ActionRiskClass::COMMERCE_MUTATION,
                params: [
                    new ActionParamDefinition('productId', PropType::STRING, required: true, label: new Label(ar: 'معرّف المنتج', en: 'Product ID')),
                    new ActionParamDefinition('variantId', PropType::STRING, required: false, label: new Label(ar: 'معرّف المتغيّر', en: 'Variant ID'), nullable: true),
                    new ActionParamDefinition('quantity', PropType::INTEGER, required: false, label: new Label(ar: 'الكمية', en: 'Quantity'), default: 1, minValue: 1),
                ],
                dispatchStatus: ActionDefinition::DISPATCH_PROVEN_NOOP,
                notes: '`quantity` غائبة تفترض 1؛ موجودة يجب أن تكون عدداً صحيحاً موجباً (`> 0`) وإلا يُرفض الفكّ كاملاً. `DISPATCH_PROVEN_NOOP` رغم تنفيذه الحقيقي في `ProductScreen` — تلك شجرة Dart مملوكة للشاشة، لا مساراً مُحلَّلاً من مخطط (`ProductScreen` لا يستهلك `binding` إطلاقاً، انظر توثيقه).',
                label: new Label(ar: 'إضافة إلى السلة', en: 'Add to Cart'),
            ),
            new ActionDefinition(
                type: 'updateCartQuantity',
                version: 1,
                riskClass: ActionRiskClass::COMMERCE_MUTATION,
                params: [
                    new ActionParamDefinition('cartItemId', PropType::STRING, required: true, label: new Label(ar: 'معرّف عنصر السلة', en: 'Cart Item ID')),
                    new ActionParamDefinition('quantity', PropType::INTEGER, required: true, label: new Label(ar: 'الكمية', en: 'Quantity'), minValue: 0),
                ],
                dispatchStatus: ActionDefinition::DISPATCH_LIVE,
                notes: 'صفر مسموح صراحة (قرار "إزالة بالصفر" يخص المستدعي، لا هذا الفكّ) — السالب مرفوض. `DISPATCH_LIVE` (`APP-BUILDER-18`): `cartItemId`/`quantity` يُحلّان عبر `$item.id`/`$item.quantity` من ربط `commerce.cart` بـ`collect: "items"` — مُثبَتٌ بضغطة زيادة كمية حقيقية (تفويض ← PATCH ← إعادة عرض) في `vertical_slice_test.dart` (PR #1006).',
                label: new Label(ar: 'تحديث كمية السلة', en: 'Update Cart Quantity'),
            ),
            new ActionDefinition(
                type: 'removeCartItem',
                version: 1,
                riskClass: ActionRiskClass::COMMERCE_MUTATION,
                params: [
                    new ActionParamDefinition('cartItemId', PropType::STRING, required: true, label: new Label(ar: 'معرّف عنصر السلة', en: 'Cart Item ID')),
                ],
                dispatchStatus: ActionDefinition::DISPATCH_LIVE,
                notes: 'يُفكَّك فقط حين تكون `cartItemId` سلسلة غير فارغة. `DISPATCH_LIVE` (`APP-BUILDER-18`): `cartItemId` يُحلّ عبر `$item.id` من نفس ربط `commerce.cart`/`collect: "items"` — مُثبَتٌ بإزالة سطر حقيقية في `vertical_slice_test.dart` (PR #1006).',
                label: new Label(ar: 'إزالة عنصر من السلة', en: 'Remove Cart Item'),
            ),
            new ActionDefinition(
                type: 'refresh',
                version: 1,
                riskClass: ActionRiskClass::READ_CAPABILITY,
                params: [],
                dispatchStatus: ActionDefinition::DISPATCH_PROVEN_NOOP,
                notes: 'يتجاهل أي معاملات مُعطاة — يُفكَّك دوماً بنجاح بلا مُدخلات. لا يحتاج ربطاً إطلاقاً (بلا معاملات أصلاً) — `DISPATCH_PROVEN_NOOP` لأنه غير قابل للربط، لا لعجزٍ في التنفيذ.',
                label: new Label(ar: 'تحديث', en: 'Refresh'),
            ),
        ];

        $byType = [];
        foreach ($definitions as $definition) {
            $byType[$definition->type] = $definition;
        }

        return $byType;
    }
}
