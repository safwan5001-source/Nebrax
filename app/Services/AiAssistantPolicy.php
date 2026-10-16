<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\TenantContext;

/**
 * تفويض المساعد الذكي: المنصة ∩ المستأجر ∩ الفاعل (∩ صلاحية الأداة عند وجودها).
 *
 * **تعيد قراءة الفاعل والمستأجر من قاعدة البيانات في كل استدعاء** — لا تثق بكائن
 * مستخدم محمَّل سابقاً — فسحب دورٍ أو تعطيل حسابٍ أو سحب موافقةٍ بين طلبين، أو
 * بين التخطيط وتنفيذ أداة، يُرفض فوراً. الرفض يمنع بناء أي prompt أو إرسال بيانات.
 * المستأجر يُؤخذ من `TenantContext` الموثوق حصراً، لا من أي مُدخل.
 *
 * هذه السياسة **لا تقرأ** `allow_document_sending` ولا `document_intelligence`:
 * موافقة استخراج المستندات لا تُجيز المساعد.
 */
class AiAssistantPolicy
{
    public const PERMISSION = 'ai.assistant.use';

    public function __construct(private readonly TenantContext $tenantContext) {}

    public function platformEnabled(): bool
    {
        return config('ai_assistant.enabled') === true;
    }

    /**
     * @param  list<string>  $categories  فئات البيانات التي سينقلها هذا الإجراء.
     * @param  string|null  $toolPermission  صلاحية إضافية لأداة بعينها.
     * @throws AiAssistantDenied
     */
    public function authorize(string $actorId, array $categories, ?string $toolPermission = null): User
    {
        if (! $this->platformEnabled()) {
            throw AiAssistantDenied::for('platform_disabled');
        }

        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw AiAssistantDenied::for('actor_unavailable');
        }

        // طازج ومقيَّد بالمستأجر الحالي: مستخدم من مستأجر آخر لا يُحلّ أبداً.
        $actor = User::query()->where('tenant_id', $tenantId)->whereKey($actorId)->first();
        if ($actor === null) {
            throw AiAssistantDenied::for('actor_unavailable');
        }
        if ($actor->is_active === false) {
            throw AiAssistantDenied::for('actor_inactive');
        }

        $tenant = Tenant::query()->find($tenantId);
        if ($tenant === null || ! $tenant->is_active) {
            throw AiAssistantDenied::for('tenant_inactive');
        }

        if (! Rbac::allows((string) $actor->role, self::PERMISSION)) {
            throw AiAssistantDenied::for('permission_denied');
        }

        $settings = Settings::group('ai_assistant', $tenant);
        if (($settings['enabled'] ?? false) !== true) {
            throw AiAssistantDenied::for('tenant_not_enabled');
        }

        $consented = AiAssistantDataCategory::sanitize($settings['consented_categories'] ?? []);
        foreach ($categories as $category) {
            if (! is_string($category) || ! AiAssistantDataCategory::isKnown($category) || ! AiAssistantDataCategory::isAvailable($category)) {
                throw AiAssistantDenied::for('data_category_unavailable');
            }
            if (! in_array($category, $consented, true)) {
                throw AiAssistantDenied::for('consent_required');
            }
        }

        if ($toolPermission !== null && ! Rbac::allows((string) $actor->role, $toolPermission)) {
            throw AiAssistantDenied::for('tool_permission_denied');
        }

        return $actor;
    }
}
