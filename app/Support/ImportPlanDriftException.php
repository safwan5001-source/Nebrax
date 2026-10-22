<?php

namespace App\Support;

use RuntimeException;

/**
 * الصفّ تغيّر منذ المعاينة (IMP-H1-S3c): الفعل أو المنتج المستهدف وقت التنفيذ لا يطابق ما اعتُمد. يرث `RuntimeException` ليظهر
 * رفضاً 422 برسالةٍ عربيةٍ واضحة في مسار التنفيذ المتزامن، وتفشل به قطعة التشغيلة الدائمة (تُحفَظ الرسالة في `error_message`).
 */
class ImportPlanDriftException extends RuntimeException
{
    public function __construct(
        public readonly int $rowNumber,
        public readonly ?string $planned,
        public readonly string $live,
    ) {
        parent::__construct(
            "plan_drift: الصف {$rowNumber} تغيّر منذ المعاينة (قد يكون المنتج أُنشئ أو عُدّل في الأثناء). أعد فحص الملف قبل التنفيذ."
        );
    }
}
