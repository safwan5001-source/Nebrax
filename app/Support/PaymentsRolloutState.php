<?php

namespace App\Support;

/**
 * الحالة الفعّالة لميزة تفعيل المدفوعات لمستأجر — PAY-H1-02. قيمة غير قابلة للتغيير، تُحسب بعبارة قراءة واحدة.
 *
 * `enabled` = ضابط المستأجر مفعَّل **و**لا إيقاف طارئ للمنصة. `reason` رمز ثابت: `enabled` · `platform_stop` ·
 * `tenant_not_configured` (لا صف: الافتراضي معطَّل) · `tenant_disabled` · `no_tenant_context` (فشل مغلق).
 */
final class PaymentsRolloutState
{
    public function __construct(
        public readonly bool $enabled,
        public readonly string $reason,
        public readonly bool $tenantEnabled,
        public readonly bool $platformStopped,
    ) {}

    public static function disabled(string $reason): self
    {
        return new self(false, $reason, false, false);
    }
}
