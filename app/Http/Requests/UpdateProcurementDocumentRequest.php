<?php

namespace App\Http\Requests;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تعديل مستند شراء — كقواعد الإنشاء، عدا ما يُعرِّف هوية المستند
 * ═══════════════════════════════════════════════════════════════
 *  `type` و`source_document_id` يُحدَّدان عند الإنشاء ولا يُقرآن في
 *  `ProcurementService::update`. لو مرّا لكانا يسقطان صامتاً — نفس نمط
 *  العطل الذي كشفه #150: **200 OK على تعديل لم يحدث**.
 *
 *  ولتغيير النوع معنى أخطر من السقوط الصامت: الرقم التسلسلي مشتقّ من النوع
 *  (PR/RFQ/PQ/PO)، فتحويل أمر شراء إلى طلبٍ بعد ترقيمه يترك مستنداً رقمُه
 *  يكذّب نوعه. النوع يتغيّر بالتحويل (`convert`) الذي ينشئ مستنداً جديداً
 *  موسوماً بمصدره — لا بتعديلٍ في المكان.
 */
class UpdateProcurementDocumentRequest extends StoreProcurementDocumentRequest
{
    public function rules(): array
    {
        return array_merge(parent::rules(), [
            // `prohibited` يمرّر الغياب ويرفض أي قيمة فعلية.
            'type'               => ['prohibited'],
            'source_document_id' => ['prohibited'],
            // السطور اختيارية عند التعديل: تعديل الرأس وحده مسموح.
            'items'              => ['nullable', 'array', 'min:1'],
        ]);
    }

    public function messages(): array
    {
        return [
            'type.prohibited'               => 'نوع المستند لا يُعدَّل — الرقم التسلسلي مشتقّ منه. انقل المستند بالتحويل إلى النوع التالي.',
            'source_document_id.prohibited' => 'مصدر المستند يُثبَّت عند التحويل ولا يُعدَّل — هو سلسلة التتبّع.',
        ];
    }
}
