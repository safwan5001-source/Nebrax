<?php

namespace App\Services\AppBuilder;

/**
 * وصف خاصيّة واحدة (`props[key]`) لنوع مكوّن معيّن — يغذّي Inspector المستقبلي
 * (تسمية الحقل، نوعه، إلزاميّته، قيمته الافتراضية، وقيم `enum` إن وُجدت).
 *
 * وصفي فقط: لا يغيّر هذا الصنف أي تحقّق فعلي في `AppSchemaParser` — الودجات
 * الحقيقية (`component_widgets.dart`) تتعامل دفاعياً مع خاصية غائبة أو بنوعٍ
 * خطأ (تسقط لقيمة افتراضية آمنة، لا ترفض)، ومطابقة هذا الصنف لذلك السلوك
 * تعني أنه لا يفرض شيئاً لم يُثبَت فعلاً؛ يصف فقط الشكل المتوقَّع لمحرّر مرئي.
 */
final class PropDefinition
{
    /**
     * @param  array<int, string>|null  $enumValues  قيم مسموحة حين يكون النوع STRING وله مجموعة محدودة (مثال: أسلوب النص).
     */
    public function __construct(
        public readonly string $key,
        public readonly string $type,
        public readonly bool $required,
        public readonly Label $label,
        public readonly mixed $default = null,
        public readonly ?array $enumValues = null,
    ) {}
}
