<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\User;
use App\Support\AiActionException;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;

final class AiActionPolicy
{
    public const USE = 'ai.actions.use';
    public const APPROVE = 'ai.actions.approve';
    public const REPAIR = 'ai.actions.repair';

    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
    ) {}

    public function authorize(string $actorId, string $actionPermission, string $domainPermission): User
    {
        if (config('ai_actions.enabled') !== true) {
            throw new AiActionException('platform_disabled', 'AI Actions غير مفعّلة على المنصة.', 403);
        }

        $tenantId = $this->tenantContext->id();
        $actor = $tenantId === null ? null : User::query()->where('tenant_id', $tenantId)->whereKey($actorId)->first();
        if ($actor === null || $actor->is_active === false) {
            throw new AiActionException('actor_unavailable', 'المستخدم غير متاح لتنفيذ AI Action.', 403);
        }
        $tenant = Tenant::query()->find($tenantId);
        if ($tenant === null || ! $tenant->is_active) {
            throw new AiActionException('tenant_inactive', 'المؤسسة غير نشطة.', 403);
        }
        if ((Settings::group('ai_actions', $tenant)['enabled'] ?? false) !== true) {
            throw new AiActionException('tenant_not_enabled', 'AI Actions غير مفعّلة لهذه المؤسسة.', 403);
        }
        if (! Rbac::allows((string) $actor->role, $actionPermission)
            || ! Rbac::allows((string) $actor->role, $domainPermission)) {
            throw new AiActionException('permission_denied', 'ليس لديك صلاحية AI Action أو صلاحية المجال المطلوبة.', 403);
        }

        $branchId = $this->branchContext->id();
        if (! $actor->canAccessBranch($branchId)) {
            throw new AiActionException('branch_scope_denied', 'الفرع النشط خارج نطاق المستخدم.', 403);
        }

        return $actor;
    }
}
