<?php

namespace App\Http\Requests;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تعديل طرف — كقواعد الإنشاء، **عدا الحقول التي هي أفعال محاسبية**
 * ═══════════════════════════════════════════════════════════════
 *  `opening_balance` و`opening_balance_date` ليسا عمودين في `partners`؛
 *  يستهلكهما `PartnerService::recordOpeningBalance` عند الإنشاء **مرة واحدة**
 *  فيولّد قيداً مرحّلاً. عند التعديل لا يقرؤهما أحد، وكانا يمرّان إلى
 *  `$partner->update()` فيسقطان صامتاً خارج `$fillable`.
 *
 *  النتيجة قبل هذا الطلب: **200 OK على عملية مالية لم تحدث** — أسوأ أنواع
 *  الفشل في نظام محاسبي. الآن تُرفض صراحةً بـ 422 برسالة تشرح البديل.
 *
 *  تصحيح الرصيد الافتتاحي يكون بقيد عكسي عبر `LedgerService::reverse()` —
 *  القيود بعد الترحيل لا تُعدَّل (قاعدة معمارية في CLAUDE.md).
 */
class UpdatePartnerRequest extends StorePartnerRequest
{
    public function rules(): array
    {
        return array_merge(parent::rules(), [
            // `prohibited` يمرّر الغياب والقيمة الفارغة، ويرفض أي قيمة فعلية —
            // فعميلٌ لا يرسل الحقل أصلاً لا يتأثّر، ومن يرسله يعرف فوراً أنه لا يعمل.
            'opening_balance'      => ['prohibited'],
            'opening_balance_date' => ['prohibited'],
        ]);
    }

    public function messages(): array
    {
        $why = 'الرصيد الافتتاحي قيد مرحّل لا حقل بيانات — لا يُعدَّل من هنا. صحّحه بقيد عكسي من حركة الحساب.';

        return [
            'opening_balance.prohibited'      => $why,
            'opening_balance_date.prohibited' => $why,
        ];
    }
}
