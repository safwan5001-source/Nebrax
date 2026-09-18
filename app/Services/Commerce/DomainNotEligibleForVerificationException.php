<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * محاولة تشغيل تحقّق DNS TXT (`POST .../domains/{domainId}/verify`) على نطاق
 * ليس من نوع `custom` — عادةً نطاق AWJ المُدار (`awj_subdomain`)، الذي
 * يُثبَّت `verified` فوراً عبر `StorefrontProvisioningService`/
 * `RegisterStorefrontDomainCommand` ولا يدخل مسار تحقّق DNS إطلاقاً. النطاق
 * موجود ومملوك فعلاً للمستأجر الحالي (لا تسريب وجود هنا) — الرفض دلالي 422،
 * لا 404.
 */
final class DomainNotEligibleForVerificationException extends RuntimeException
{
}
