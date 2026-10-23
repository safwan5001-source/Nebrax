<?php

namespace App\Support;

/**
 * نتيجة استرداد **غير معروفة**: طُلب من المزوّد ثم انقطع الردّ (مهلة/5xx/استجابة غير مفهومة)؛ قد يكون المال خرج فعلاً. لا يُحرَّر الاحتجاز ولا تُعاد
 * المحاولة عمياء: يحسمها المطابِق بمقارنة `refundedMinor` التراكمي لدى المزوّد بخط الأساس المسجَّل قبل الإرسال.
 */
final class PaymentRefundUnknownException extends PaymentGatewayException {}
