<?php

namespace App\Services;

use App\Models\Classification;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Purchase;
use App\Support\Settings;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Model;
use RuntimeException;

/**
 * خدمة التصنيفات التحليلية للمستندات.
 *
 * المسار الوحيد لتعديل تصنيف مستند، كي تقرأ سياسة التقارير من نقطة قرار واحدة.
 * لا تمسّ هذه الخدمة مبلغاً أو سطراً أو حساباً أو قيداً مرحّلاً.
 */
class ClassificationService
{
    /** @param Invoice|Purchase|Payment $document */
    public function updateDocumentClassification(Model $document, ?string $classificationId, string $scope): Model
    {
        $isDraft = $document->status === 'draft';
        $setting = $isDraft
            ? 'allow_classification_edit_before_post'
            : 'allow_classification_edit_after_post';

        if (! Settings::get('reports', $setting)) {
            $when = $isDraft ? 'قبل الترحيل' : 'بعد الترحيل';
            throw new RuntimeException("سياسة التقارير تمنع تعديل تصنيف المستند {$when}.");
        }

        if ($classificationId !== null) {
            $classification = BranchScope::reference(Classification::class)->find($classificationId);
            if (! $classification || $classification->scope !== $scope || ! $classification->is_active) {
                throw new RuntimeException('التصنيف المختار غير نشط أو لا يطابق نوع المستند.');
            }
        }

        $document->update(['classification_id' => $classificationId]);

        return $document->fresh(['classification']);
    }
}
