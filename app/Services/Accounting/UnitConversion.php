<?php

namespace App\Services\Accounting;

use App\Models\Product;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حلّ وحدة السطر إلى (اسم، معامل) — مصدر واحد للمشتريات والفواتير
 * ═══════════════════════════════════════════════════════════════
 *  نسختان من هذا المنطق كانتا ستنحرفان: يقبل الشراء وحدةً يرفضها البيع،
 *  فتدخل البضاعة بمعامل وتخرج بآخر — وذلك أسوأ عطل ممكن في المخزون.
 */
class UnitConversion
{
    /**
     * @return array{0: ?string, 1: int}  [اسم الوحدة أو null للأساس، المعامل]
     */
    public function resolve(?Product $product, ?string $unitName): array
    {
        $unitName = is_string($unitName) ? trim($unitName) : null;

        // لا وحدة مُحدَّدة ⇒ وحدة الأساس بمعامل ١ — سلوك كل ما بُني قبل القوالب.
        if ($unitName === null || $unitName === '') {
            return [null, 1];
        }

        $template = $product?->unitTemplate;

        if (! $template) {
            throw new RuntimeException(sprintf(
                'الوحدة «%s» غير متاحة: لا قالب وحدات على المنتج%s.',
                $unitName,
                $product ? " «{$product->name}»" : ''
            ));
        }

        $factor = $template->factorFor($unitName);

        // **المجهول يُرفض ولا يُفترَض له ١.** معاملٌ مفترَض يُدخل كميةً خاطئة
        // إلى المخزون ثم يُفسد المتوسط المتحرك — عطلٌ صامت لا رسالة له.
        if ($factor === null) {
            throw new RuntimeException("الوحدة «{$unitName}» غير معرَّفة في قالب وحدات المنتج.");
        }

        return [$unitName, max(1, $factor)];
    }
}
