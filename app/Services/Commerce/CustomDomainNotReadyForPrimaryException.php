<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * STORE-ADMIN-ADOPT-1B-3B — محاولة جعل نطاق `custom` أساسياً.
 *
 * إثبات ملكية DNS TXT (`verification_status = verified`) يعني فقط
 * DOMAIN OWNERSHIP PROVEN، ولا يعني EDGE/TLS READY. لا يوجد في النظام حالياً
 * حالة persisted تُثبت جاهزية HTTPS/Edge (لا تسجيل Railway، لا ACME، لا
 * شهادة). المسار فشلٌ مغلق حتى يوجد ذلك الدليل — 422 لا 404: النطاق موجود
 * ومملوك للمستأجر الحالي.
 */
final class CustomDomainNotReadyForPrimaryException extends RuntimeException
{
}
