<?php

namespace App\Support;

use DomainException;

/**
 * يرميه `Payable::assertStillPayable()` وحده حين لم يعد المستند قابلاً للدفع (مسدَّد، ملغى، منتهٍ).
 * المنسّق يغلق المحاولة العالقة بهذا الاستثناء الصريح فقط؛ أي استثناء آخر (قاعدة بيانات، خطأ برمجي) يُنشر دون المساس بالمحاولة.
 */
class PaymentNotPayableException extends DomainException {}
