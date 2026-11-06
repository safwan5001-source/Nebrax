<?php

namespace App\Services;

use App\Models\User;
use App\Support\PublicApiScopeCeiling;
use App\Support\PublicApiScopeCeilingException;
use App\Support\Rbac;
use App\Tenancy\TenantContext;

/**
 * حارس إصدار مفاتيح Public API (AIA-0.4 / D-08): نقطة التحقق الوحيدة من سقف صلاحيات المُصدِر.
 *
 * يُستدعى **قبل أي كتابة** في كل مسار إصدار أو تجديد: واجهة المطوّر (إنشاء عميل + مفتاح،
 * ومفتاح إضافي لعميل قائم) وأمر CLI `public-api:create-client`. صلاحيات المُصدِر تُحلّ
 * حيّةً (جدول الأدوار المخصّصة ثم المصفوفة الثابتة) داخل سياق مستأجره هو، لا سياق الطلب
 * ولا ما تركه مستدعٍ سابق — فلا تُقرأ صلاحية دور بالاسم نفسه من مستأجر آخر.
 *
 * `ApiClientKeyService::issueKey` يبقى بلا سقف عمداً (يستعمله الاختبارات والتهيئة الداخلية
 * والتوافق الرجعي)؛ ويحرس `PublicApiScopeCeilingArchitectureTest` ألّا يُستدعى من مسار
 * إنتاجي لا يمرّ بهذا الحارس.
 */
class PublicApiKeyIssuanceGuard
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @param  array<int, string>  $scopes
     * @return list<string> الـ scopes الممنوعة على هذا المُصدِر
     */
    public function denied(User $issuer, array $scopes): array
    {
        return PublicApiScopeCeiling::denied($this->permissionsOf($issuer), $scopes);
    }

    /**
     * @param  array<int, string>  $scopes
     *
     * @throws PublicApiScopeCeilingException إن احتوى الطلب على scope واحد غير مصرَّح به
     */
    public function assertIssuable(User $issuer, array $scopes): void
    {
        $denied = $this->denied($issuer, $scopes);

        if ($denied !== []) {
            throw new PublicApiScopeCeilingException($denied);
        }
    }

    /** @return list<string> */
    public function issuableScopes(User $issuer): array
    {
        return PublicApiScopeCeiling::issuable($this->permissionsOf($issuer));
    }

    /** @return array<int, string> */
    private function permissionsOf(User $issuer): array
    {
        $previous = $this->tenant->id();
        $this->tenant->set((string) $issuer->tenant_id);

        try {
            return Rbac::permissionsForRole((string) $issuer->role);
        } finally {
            $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
        }
    }
}
