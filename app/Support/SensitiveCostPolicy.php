<?php

namespace App\Support;

use App\Models\Product;
use App\Models\User;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سياسة التكلفة الحسّاسة — مصدر تصنيف واحد لكل الأسطح
 * ═══════════════════════════════════════════════════════════════
 *  PR-INV-1: `products.view_cost` كانت موجودة كصلاحية لكن غير مُنفَّذة مركزياً؛
 *  كل سطح (مورد، تصدير، فلترة، استيراد) كان يقرّر بمفرده. هذا الملف هو
 *  المصدر الوحيد لتصنيف الحقول الحسّاسة وقرار التفويض، فلا تنحرف قائمتان.
 *
 *  **الحسّاس (بحدّ أدنى):** سعر الشراء، متوسط التكلفة، هامش الربح، قيمة
 *  المخزون، تكلفة الحركة (وحدة/إجمالي). **سعر البيع ليس تكلفة.**
 *
 *  المستخدم غير المصرَّح يبقى قادراً على العمليات التشغيلية العادية على
 *  المنتج/المخزون؛ فقط الاستجابة/التصدير/الفلترة/الكتابة لا تكشف أو تسرّب
 *  التكلفة. الرفض هنا 403 — نفس دلالة `EnsurePermission` — لا 422 عام،
 *  لأن السبب صلاحية مفقودة لا خطأ مدخلات.
 */
class SensitiveCostPolicy
{
    /** حقول Product الحسّاسة — لا تشمل sale_price. */
    public const PRODUCT_FIELDS = ['purchase_price', 'avg_cost', 'profit_margin'];

    /** حقول Product القابلة للكتابة ضمن الحسّاسة (تُفحص عند create/update/import). */
    public const PRODUCT_WRITABLE_FIELDS = ['purchase_price', 'profit_margin'];

    /** حقول حركة المخزون الحسّاسة. */
    public const MOVEMENT_FIELDS = ['unit_cost', 'total_cost'];

    /** مفاتيح فرز قائمة المنتجات المشتقّة من التكلفة. */
    public const PRODUCT_SORT_KEYS = ['purchase_price'];

    /** مفاتيح تصفية قائمة/تصدير المنتجات المشتقّة من التكلفة. */
    public const PRODUCT_FILTER_KEYS = ['purchase_price_gte', 'purchase_price_lte', 'purchase_price_eq'];

    /** مفاتيح فرز تقرير أرصدة المخزون المشتقّة من التكلفة. */
    public const INVENTORY_SORT_KEYS = ['avg_cost', 'stock_value'];

    /** مفاتيح تصفية تقرير/تصدير أرصدة المخزون المشتقّة من التكلفة. */
    public const INVENTORY_FILTER_KEYS = ['avg_cost_min', 'avg_cost_max', 'stock_value_min', 'stock_value_max'];

    /** هل يملك المستخدم صلاحية عرض/كتابة التكلفة الحسّاسة؟ owner/admin عبر `*` دائماً. */
    public static function authorized(?User $user): bool
    {
        return $user !== null && Rbac::allows($user->role, 'products.view_cost');
    }

    /**
     * هل تطلب مصفوفة/فرزٌ حقلاً مشتقّاً من التكلفة بلا صلاحية؟ يُستدعى قبل
     * تطبيق الفلترة/الفرز الفعلي — الرفض يمنع قناة استدلال (binary search
     * عبر حدود المدى) لا يكتفي بإخفاء العمود في الاستجابة فقط.
     *
     * @param  array<string, mixed>  $filters
     * @param  array<int, string>  $filterKeys
     * @param  array<int, string>  $sortKeys
     */
    public static function queryBlocked(array $filters, ?string $sort, bool $authorized, array $filterKeys, array $sortKeys): bool
    {
        if ($authorized) {
            return false;
        }

        foreach ($filterKeys as $key) {
            if (filled($filters[$key] ?? null)) {
                return true;
            }
        }

        if ($sort !== null && $sort !== '' && in_array(ltrim($sort, '-'), $sortKeys, true)) {
            return true;
        }

        return false;
    }

    /**
     * هل تحاول بيانات الكتابة تغيير سعر شراء أو هامش ربح فعلياً بلا صلاحية؟
     * القيمة المعادة دون تغيير (إعادة إرسال نموذج كامل) لا تُحسب محاولة كتابة.
     *
     * @param  array<string, mixed>  $data
     */
    public static function productWriteBlocked(array $data, bool $authorized, ?Product $existing = null): bool
    {
        if ($authorized) {
            return false;
        }

        $baseline = [
            'purchase_price' => $existing?->purchase_price ?? 0,
            'profit_margin' => $existing?->profit_margin,
        ];

        foreach (self::PRODUCT_WRITABLE_FIELDS as $field) {
            if (array_key_exists($field, $data) && $data[$field] !== $baseline[$field]) {
                return true;
            }
        }

        return false;
    }

    /**
     * هل تحاول مطابقة استيراد كتابة سعر الشراء بلا صلاحية؟
     *
     * @param  array<int, string>  $mapping  فهرس عمود الملف => مفتاح الحقل
     */
    public static function importMappingBlocked(array $mapping, bool $authorized): bool
    {
        return ! $authorized && in_array('purchase_price', $mapping, true);
    }

    /**
     * يقصّ الحقول الحسّاسة من مصفوفة صفٍّ (تصدير) — يستبدل القيمة بـ`null`
     * فيبقى العمود قائماً بترويسته (لا يكسر عقد إعادة الاستيراد round-trip)
     * دون كشف قيمته.
     *
     * @param  array<string, mixed>  $row
     * @param  array<int, string>  $fields
     * @return array<string, mixed>
     */
    public static function redactRow(array $row, bool $authorized, array $fields): array
    {
        if ($authorized) {
            return $row;
        }

        foreach ($fields as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = null;
            }
        }

        return $row;
    }

    /**
     * يحذف إدخالات الحقول الحسّاسة كاملة (القديمة والجديدة معاً) من diff نشاط
     * المنتج — لا يُبقي مفتاحاً بقيمة مقنَّعة، فلا يُستدَلّ حتى على أن تغييراً
     * وقع في حقل بعينه من مجرّد وجود مفتاحه.
     *
     * @param  array<string, mixed>  $diff
     * @return array<string, mixed>
     */
    public static function redactActivityDiff(array $diff, bool $authorized): array
    {
        if ($authorized) {
            return $diff;
        }

        foreach (self::PRODUCT_FIELDS as $field) {
            unset($diff[$field]);
        }

        return $diff;
    }
}
