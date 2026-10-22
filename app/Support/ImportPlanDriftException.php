<?php

namespace App\Support;

/**
 * الصفّ تغيّر منذ المعاينة (IMP-H1-S3c): الفعل أو المنتج المستهدف وقت التنفيذ لا يطابق ما اعتُمد. يرث `ImportPreviewException` فيظهر
 * في المسار المتزامن 422 `{message, code: "plan_drift"}` (لا نصّاً بلا رمز)، وتفشل به قطعة التشغيلة الدائمة فتُحفَظ الرسالة في `error_message`.
 * `rowNumber`/`planned`/`live` للتشخيص ولا تُعرَض للعميل.
 */
class ImportPlanDriftException extends ImportPreviewException
{
    public function __construct(
        public readonly int $rowNumber,
        public readonly ?string $planned,
        public readonly string $live,
    ) {
        parent::__construct(
            'plan_drift',
            "plan_drift: الصف {$rowNumber} تغيّر منذ المعاينة (قد يكون المنتج أُنشئ أو عُدّل في الأثناء). أعد فحص الملف قبل التنفيذ."
        );
    }
}
