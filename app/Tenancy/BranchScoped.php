<?php

namespace App\Tenancy;

/**
 * **بيانات تشغيلية معزولة بالفرع** — التصنيف الافتراضي لأي كيان جديد.
 *
 * يجمع: وسم المستند بالفرع عند الإنشاء (BelongsToBranch) + عزل القراءة تلقائياً
 * (BranchScope). استخدمه لكل ما يخصّ العمل اليومي لفرع: الفواتير، العملاء،
 * المنتجات، المخزون، المصروفات… إلخ.
 *
 * للتجاوز المتعمَّد (كتقرير مجمّع عبر الفروع):
 *     Model::withoutGlobalScope(BranchScope::class)->…
 */
trait BranchScoped
{
    use BelongsToBranch;

    public static function bootBranchScoped(): void
    {
        static::addGlobalScope(new BranchScope());
    }
}
