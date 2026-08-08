<?php

namespace App\Tenancy;

/**
 * يحمل معرّف الفرع النشط خلال الطلب (singleton).
 * يُضبط في SetBranch middleware من ترويسة `X-Branch-Id` أو الفرع الرئيسي.
 *
 * **الفرق الجوهري عن `TenantContext`:** هذا بُعد **كتابة** فقط — يوسم به
 * المستندُ الجديد وسطورُ قيده. لا يوجد Global Scope للفرع، فلا يُصفّى به أي
 * استعلام قراءة تلقائياً (وإلا اختفت قيود عن ميزان المراجعة المجمّع).
 */
class BranchContext
{
    protected ?string $branchId = null;

    public function set(?string $branchId): void
    {
        $this->branchId = $branchId;
    }

    public function id(): ?string
    {
        return $this->branchId;
    }

    public function has(): bool
    {
        return $this->branchId !== null;
    }

    public function forget(): void
    {
        $this->branchId = null;
    }
}
