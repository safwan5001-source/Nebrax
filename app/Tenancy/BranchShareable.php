<?php

namespace App\Tenancy;

use Closure;
use Illuminate\Database\Eloquent\Builder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  BranchShareable — عزل **مشروط** بمفتاح مشاركة
 * ═══════════════════════════════════════════════════════════════
 *  يُضاف إلى نموذج `BranchScoped` تحكمه إحدى «مفاتيح مشاركة الفروع»:
 *  العملاء · المنتجات · الموردون · مراكز التكلفة.
 *
 *  الافتراضات كلها **مشاركة مفعّلة**، فالنموذج المشمول يسلك كما لو لا عزل
 *  عليه إطلاقاً حتى يُطفئ المستخدم المفتاح بيده.
 *
 *  @see design-system/foundations/multi-branch-architecture.md
 */
interface BranchShareable
{
    /**
     * ما الذي يُعفى من عزل الفرع بحكم مفاتيح المشاركة؟ ثلاثة أوضاع:
     *
     *  • `true`     مشترك بالكامل — يُلغى العزل عن النموذج كله (السلوك الافتراضي).
     *  • `false`    غير مشترك — العزل كامل.
     *  • `Closure`  مشترك جزئياً — شرط إضافي يُضاف بـ `orWhere` فتُستثنى صفوف
     *               بعينها. (الطرف مثلاً: العملاء ومفتاحهم، والموردون ومفتاحهم.)
     *
     * @return bool|Closure(Builder): void
     */
    public function branchSharingExemption(BranchSharing $sharing): bool|Closure;
}
