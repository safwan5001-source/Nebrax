<?php

namespace App\Support;

/**
 * قرار الوصول الفعّال لإجراء مساعد — IMP-X-01a. قيمة غير قابلة للتغيير. `reason` رمز ثابت تترجمه الواجهة:
 * `allowed` · `env_floor_off` · `platform_off` · `type_off` · `tenant_not_granted` · `tenant_owner_not_approved` · `unknown_type` · `no_tenant_context` ·
 * ورمز التنفيذ المقابل لكل طبقة بلاحقة `execution_` حين تكون القدرة تنفيذاً (`execution_env_floor_off` · `execution_platform_off` · `execution_type_off` · `execution_tenant_not_granted`).
 */
final class AiActionsAccessDecision
{
    public function __construct(
        public readonly bool $allowed,
        public readonly string $reason,
        public readonly string $capability,
    ) {}

    public static function allowed(string $capability): self
    {
        return new self(true, 'allowed', $capability);
    }

    public static function denied(string $reason, string $capability): self
    {
        return new self(false, $reason, $capability);
    }
}
