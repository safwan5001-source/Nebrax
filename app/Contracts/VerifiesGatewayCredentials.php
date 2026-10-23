<?php

namespace App\Contracts;

use App\Models\PaymentGateway;

/**
 * قدرة اختيارية لمحوّل المزوّد: إثبات أن بيانات اعتماد الاتصال مقبولة لدى المزوّد بقراءة آمنة (لا تنشئ شيئاً ولا تحرّك مالاً).
 * يرمي `PaymentGatewayException` برمز ثابت عند الرفض أو تعذّر الوصول، ولا يُرجع قيمة عند النجاح. لا يكتب في الاتصال:
 * ضبط `verified_at` وتسجيل التدقيق من اختصاص `PaymentGatewayService::verify()` وحدها.
 */
interface VerifiesGatewayCredentials
{
    public function verifyCredentials(PaymentGateway $gateway): void;
}
