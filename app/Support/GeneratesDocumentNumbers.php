<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\Tenant;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;

/**
 * ═══════════════════════════════════════════════════════════════
 *  طبقة الترقيم التسلسلي الموحَّدة — مصدر الحقيقة الوحيد لأرقام المستندات
 * ═══════════════════════════════════════════════════════════════
 *  تحلّ محلّ سبع عشرة نسخة مكرَّرة من `nextNumber()` كانت موزَّعة على ثلاث
 *  طبقات (خدمة/نموذج/متحكّم)، أربعَ عشرةَ منها بنمط `count()+1` المعطوب.
 *
 *  **لماذا على النموذج لا على الخدمة؟** لأن النموذج هو الذي يعلن تصنيفه
 *  الفرعي (`BelongsToBranch` أو `CompanyWide`)، وهو التصنيف نفسه الذي يحدّد
 *  نطاق التسلسل. فبوضع الترقيم هنا يُشتقّ النطاق من الإعلان ذاته ولا ينفصل
 *  عنه أبداً — بخلاف الخدمة التي كان عليها أن «تتذكّر» النطاق الصحيح، وقد
 *  نسيته فعلاً في أربعة مواضع.
 *
 *  ═══ ثلاث قواعد تحكم هذه الطبقة ═══
 *
 *  1. **`max()+1` لا `count()+1`.** النمط المطبَّق أصلاً في `Branch::nextCode()`
 *     و`Warehouse::nextCode()`، وتعليقهما يشرح السبب: «يُشتقّ من أكبر كود رقمي
 *     قائم **فلا يتصادم بعد الحذف**». `count()+1` يفترض تسلسلاً بلا ثغرات، فإذا
 *     حُذف مستند من وسط السلسلة أعاد إنتاج رقمٍ موجود وأقفل السنة كلها.
 *
 *  2. **البادئة هي مفتاح السلسلة.** كل سلسلة تُرشَّح بـ `LIKE 'PREFIX-YYYY-%'`،
 *     فتستقلّ سلاسل الأنواع المختلفة في الجدول الواحد تلقائياً (SRET/PRET،
 *     REC/PAY، CN/DN، PR/RFQ/PQ/PO، SR/SI/ST) بلا حاجة إلى مرشّح نوع منفصل.
 *
 *  3. **النطاق من التصنيف:** `CompanyWide` → تسلسل على مستوى المستأجر.
 *     وما عداه ممّا يوسم بالفرع → تسلسل مستقلّ لكل فرع.
 *
 *  ═══ ما لا يمرّ من هنا أبداً ═══
 *
 *  **`invoices.zatca_icv` ليس رقم مستند ولا يُرقَّم بهذه الطبقة.** هو عدّاد
 *  سلسلة إصدار ZATCA للكيان القانوني الواحد، فنطاقه `tenant_id` حصراً بحكم
 *  المواصفة، وترقيمه بالفرع يخالفها. منطقه يبقى في `ZatcaService` وحده.
 */
trait GeneratesDocumentNumbers
{
    /** عمود الرقم في الجدول. يُعاد تعريفه في النماذج التي تسمّيه غير ذلك. */
    public static function documentNumberColumn(): string
    {
        return 'number';
    }

    /**
     * الرقم التسلسلي التالي في السلسلة: `PREFIX-YYYY-00001`.
     *
     * @param  ?string  $prefix  بادئة السلسلة. `null` = بلا بادئة (أكواد الفروع والمخازن: `00001`).
     * @param  ?string  $date    تاريخ المستند — تُشتقّ منه سنة إعادة الضبط. `null` = سلسلة مستمرة بلا سنة (`EMP-00001`).
     */
    public static function nextDocumentNumber(?string $prefix = null, ?string $date = null): string
    {
        $column = static::documentNumberColumn();

        // الفروع تُرقَّم مستقلّةً، إلا ما صُنِّف `CompanyWide` صراحةً فيُرقَّم للمؤسسة كلها.
        $branchNumbered = static::isBranchNumbered();
        $branchId       = $branchNumbered ? app(BranchContext::class)->id() : null;

        // المِرساة تتبع نطاق السلسلة نفسه: قفلُ فرعٍ لا يُسلسِل سلسلةً مؤسسية.
        static::lockNumberingAnchor($branchId);

        $series = static::numberSeries($prefix, $date);
        $query  = static::query()->withoutGlobalScope(BranchScope::class);

        if ($branchNumbered) {
            $branchId === null
                ? $query->whereNull('branch_id')
                : $query->where('branch_id', $branchId);
        }

        if ($series !== '') {
            $query->where($column, 'like', $series . '%');
        }

        // الترتيب بالطول أولاً: الأرقام مصفَّرة بعرض ثابت، فيطابق الترتيب
        // المعجمي الترتيبَ العددي — إلا عند تجاوز خمس خانات (00001 → 100000)
        // حيث يسبق «1» الـ«9» معجمياً. الطول يحسم ذلك بلا دوالّ خاصة بمحرّك.
        $last = $query->orderByRaw('LENGTH(' . $column . ') DESC')
            ->orderByDesc($column)
            ->value($column);

        $sequence = $last === null
            ? 0
            : (int) preg_replace('/\D/', '', substr((string) $last, strlen($series)));

        return $series . str_pad((string) ($sequence + 1), 5, '0', STR_PAD_LEFT);
    }

    /** بادئة السلسلة كاملةً بفواصلها: `INV-2026-` · `EMP-` · `` (فارغة). */
    protected static function numberSeries(?string $prefix, ?string $date): string
    {
        $parts = array_filter(
            [$prefix, $date === null ? null : substr($date, 0, 4)],
            fn ($part) => (string) $part !== ''
        );

        return $parts === [] ? '' : implode('-', $parts) . '-';
    }

    /** هل يُرقَّم هذا النموذج بالفرع؟ كل ما يوسم بالفرع إلا ما أُعلن `CompanyWide`. */
    protected static function isBranchNumbered(): bool
    {
        if (is_subclass_of(static::class, CompanyWide::class)) {
            return false;
        }

        return in_array(BelongsToBranch::class, class_uses_recursive(static::class), true);
    }

    /**
     * قفل **مِرساة** التوليد: صفٌّ موجودٌ حتماً يُسلسِل الطلبات المتزامنة.
     *
     * قفل صفّ الحدّ الأقصى وحده لا يكفي، لسببين لا يعالجهما:
     *  - **السلسلة الفارغة:** أول مستند في السلسلة لا صفَّ له ليُقفَل، فيمرّ
     *    طلبان متزامنان معاً ويولّدان الرقم ١ كلاهما.
     *  - **القراءة الشبحية:** تحت `READ COMMITTED` يعيد الطلبُ الثاني تقييمَ
     *    الصفّ المقفول بعد تحرّره، لكنه لا يرى الصفَّ **الجديد** الذي أدرجه
     *    الأول — فيحسب الرقم نفسه.
     *
     * فالقفل هنا على صفّ الفرع (أو المستأجر للسلاسل المؤسسية): موجودٌ دائماً،
     * فيتسلسل التوليد فعلاً. هو نفسه نمط `lockForUpdate` المطبَّق في ترحيل
     * الفواتير والمشتريات وتخصيص المدفوعات.
     */
    protected static function lockNumberingAnchor(?string $branchId): void
    {
        if ($branchId !== null) {
            Branch::whereKey($branchId)->lockForUpdate()->first();

            return;
        }

        $tenantId = app(TenantContext::class)->id();

        if ($tenantId !== null) {
            Tenant::whereKey($tenantId)->lockForUpdate()->first();
        }
    }
}
