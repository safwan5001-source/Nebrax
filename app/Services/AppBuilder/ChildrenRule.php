<?php

namespace App\Services\AppBuilder;

/**
 * قاعدة الأبناء لنوع مكوّن — مستخرجة من ملاحظة استدعاء `buildChildren(node, ...)`
 * (أو عدمه) في كل دالة `build*`. لا يوجد اليوم أي تقييد نوعي/عددي فعلي على
 * الأبناء في وقت التشغيل (`buildProductList` مثلاً يرسم أيّ ابن بلا تحقّق نوع) —
 * فالقاعدتان الوحيدتان المُثبَتتان هما «لا أبناء إطلاقاً» أو «أبناء غير محدودين
 * بلا قيد نوع». قيود slot/min/max الموصوفة في `COMPONENT_REGISTRY_V1.md` §6
 * تصنيفٌ توضيحي مستقبلي لا واقع مُختبَر اليوم.
 */
final class ChildrenRule
{
    public const NONE = 'none';

    public const UNBOUNDED_ANY = 'unboundedAny';

    private function __construct(
        public readonly string $kind,
        public readonly ?string $suggestedChildType = null,
    ) {}

    public static function none(): self
    {
        return new self(self::NONE);
    }

    /**
     * @param  string|null  $suggestedChildType  تلميح تحريري فقط (مثال: `ProductCard` لـ`ProductList`) — لا يفرضه وقت التشغيل.
     */
    public static function unboundedAny(?string $suggestedChildType = null): self
    {
        return new self(self::UNBOUNDED_ANY, $suggestedChildType);
    }
}
