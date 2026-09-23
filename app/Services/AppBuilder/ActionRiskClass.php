<?php

namespace App\Services\AppBuilder;

/**
 * تصنيف مخاطر الإجراء — تسمية وصفية من `ACTION_REGISTRY_V1.md` §4 فقط، بلا
 * أي إنفاذ فعلي يقترن بها هنا. الستّة إجراءات الحقيقية المُثبَتة
 * (`RuntimeCapabilities::ACTIONS`) تستعمل ثلاثاً فقط من الأصناف الستة
 * (`NAVIGATION`, `READ_CAPABILITY`, `COMMERCE_MUTATION`)؛ البقية معرَّفة هنا
 * كمفردات تصنيف جاهزة ليوم تُضاف إجراءات حسّاسة فعلاً (دفع/تسجيل دخول)، لا
 * لأنها مُستعمَلة اليوم.
 */
final class ActionRiskClass
{
    private function __construct() {}

    public const LOCAL_UI = 'localUi';

    public const NAVIGATION = 'navigation';

    public const READ_CAPABILITY = 'readCapability';

    public const COMMERCE_MUTATION = 'commerceMutation';

    public const SENSITIVE_COMMERCE = 'sensitiveCommerce';

    public const EXTERNAL_INTEGRATION = 'externalIntegration';
}
