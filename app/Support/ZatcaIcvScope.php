<?php

namespace App\Support;

use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  نطاق عدّاد ICV — الحلّ والحارس
 * ═══════════════════════════════════════════════════════════════
 *  `zatca_icv` عدّاد سلسلة إصدار الفاتورة الإلكترونية. نطاقه الافتراضي
 *  `tenant` — سلسلة واحدة للكيان القانوني — ويقبل `branch` بتفعيلٍ صريح.
 *
 *  **ليس رقم مستند، ولا يمرّ بـ `GeneratesDocumentNumbers`.** فبينما تُرقَّم
 *  المستندات بالفرع افتراضياً، يبقى هذا العدّاد على المستأجر حتى يُفعَّل
 *  خلافُه عمداً. المرجع: قسم «قواعد طبقة الترقيم» في CLAUDE.md.
 *
 *  ═══ لماذا حارسٌ لا مجرّد إعداد؟ ═══
 *
 *  ICV مرتبطٌ **برقم ضريبي مسجَّل لدى الهيئة**، لا بموقعٍ جغرافي. فسلسلتان
 *  متوازيتان تحت رقمٍ ضريبيٍّ واحد مخالفةٌ للمواصفة تُرفض عندها الفواتير عند
 *  تفعيل المرحلة الثانية. ولأن الضرر لا يظهر وقت الضبط بل وقت التكامل — بعد
 *  أن تكون سلاسل كثيرة قد كُتبت — لا يكفي تحذيرٌ في الواجهة: يُفرض الشرط هنا،
 *  ويُتجاهل المخزَّن إن لم يتحقّق.
 *
 *  ═══ شرطان تقنيان يُفحصان وقت التشغيل ═══
 *
 *  1. **رقم ضريبي مستقلّ لكل فرع** (`branches.vat_number`). اليوم لا وجود له:
 *     الرقم الضريبي الوحيد في النظام هو `tenants.vat_number`، فكل الفروع
 *     تشترك فيه بالضرورة — أي أن `branch` اليوم يعني حتماً سلاسل متوازية
 *     تحت رقمٍ واحد، وهو الخطأ عينه.
 *
 *  2. **فهرسٌ فريد يشمل الفرع** على `(tenant_id, branch_id, zatca_icv)`.
 *     الفهرس القائم `(tenant_id, zatca_icv)` يمنع بنيوياً أن يبدأ فرعان من
 *     ١ — فتفعيل `branch` قبل توسيعه لا يُنتج سلاسل خاطئة بل **يُسقط
 *     الترحيل بانتهاك قيد**. وهذا الشرط يُفحص هنا لا يُفترض.
 *
 *  الفحص بالاستبطان لا بثابتٍ مكتوب: فمتى استُوفي الشرطان في هجرةٍ لاحقة
 *  صار الخيار متاحاً بلا تعديل هذا الملف.
 */
class ZatcaIcvScope
{
    public const TENANT = 'tenant';
    public const BRANCH = 'branch';

    public const ALL = [self::TENANT, self::BRANCH];

    /**
     * النطاق الفعليّ المطبَّق الآن.
     *
     * يُرجِع `tenant` متى كان `branch` غير متاح مهما كانت القيمة المخزَّنة —
     * فقيمةٌ قديمة أو مكتوبة بتحايل لا تكسر سلسلةً أبداً.
     */
    public static function current(): string
    {
        $stored = (string) Settings::get('zatca', 'icv_scope');

        return $stored === self::BRANCH && self::branchAvailable()
            ? self::BRANCH
            : self::TENANT;
    }

    /** هل يجوز اختيار `branch`؟ الشرطان معاً لا أحدهما. */
    public static function branchAvailable(): bool
    {
        return self::branchesCarryOwnVatNumber() && self::icvIndexCoversBranch();
    }

    /** سبب التعطيل — للواجهة ولرسالة التحقّق. `null` حين يكون الخيار متاحاً. */
    public static function unavailableReason(): ?string
    {
        if (! self::branchesCarryOwnVatNumber()) {
            return 'no_branch_vat_number';
        }

        if (! self::icvIndexCoversBranch()) {
            return 'icv_index_not_branch_scoped';
        }

        return null;
    }

    /** الشرط ١: لكل فرع رقمه الضريبي المستقلّ. */
    private static function branchesCarryOwnVatNumber(): bool
    {
        return Schema::hasColumn('branches', 'vat_number');
    }

    /** الشرط ٢: الفهرس الفريد للعدّاد يشمل الفرع، وإلا انفجر الترحيل بالقيد. */
    private static function icvIndexCoversBranch(): bool
    {
        foreach (Schema::getIndexes('invoices') as $index) {
            $columns = $index['columns'] ?? [];

            if (($index['unique'] ?? false)
                && in_array('zatca_icv', $columns, true)
                && in_array('branch_id', $columns, true)) {
                return true;
            }
        }

        return false;
    }
}
