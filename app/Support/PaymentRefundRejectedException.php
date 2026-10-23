<?php

namespace App\Support;

/**
 * رفض استرداد **قاطع**: لم يُنفَّذ أي استرداد لدى المزوّد (رفض/اعتماد/سقف/دفعة غامضة/لم يُرسَل الطلب أصلاً). يُحرِّر المستدعي حصة الاحتجاز ولا قيد.
 */
final class PaymentRefundRejectedException extends PaymentGatewayException {}
