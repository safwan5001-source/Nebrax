<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * hostname مطلوب كنطاق مخصَّص (`StorefrontDomain::TYPE_CUSTOM`) يقع ضمن
 * نطاق AWJ المُدار (`ManagedStorefrontHostname::configuredBaseDomain()`) —
 * إما مطابقاً للنطاق الأساسي نفسه أو شريحةً فرعية واحدة تحته
 * (`ManagedStorefrontHostname::isUnderBaseDomain()`). يُرفض مغلقاً، لا يُنشأ
 * كنطاق مخصَّص أبداً — النطاقات المُدارة تأتي فقط من `StorefrontProvisioningService`.
 */
final class ManagedNamespaceHostnameException extends RuntimeException
{
}
