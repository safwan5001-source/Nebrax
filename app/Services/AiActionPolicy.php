<?php

namespace App\Services;

use App\Http\Middleware\EnsureApplicationActive;
use App\Models\Tenant;
use App\Models\User;
use App\Support\AiActionException;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class AiActionPolicy
{
    public const USE = 'ai.actions.use';
    public const APPROVE = 'ai.actions.approve';
    public const REPAIR = 'ai.actions.repair';

    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
        private readonly EnsureApplicationActive $applications,
        private readonly AiActionsAccessResolver $controls,
    ) {}

    /**
     * @param list<string> $domainPermissions كلها مطلوبة (AND) — صلاحيات واجهة المجال المباشرة.
     * @param ?string $applicationKey قدرة التطبيق التي تحرس واجهة المجال المباشرة، أو null إن لم تحرسها.
     *
     * `$actionType`: نوع الإجراء لضوابط المشغّل؛ كل استدعاء من `AiActionGateway` يمرّره (يحرس ذلك `AiActionControlWiringTest`).
     *
     * قدرة التطبيق تمرّ بـ`EnsureApplicationActive::authorize` نفسها (لا نسخة ثانية من القواعد):
     * `suspended` قراءة فقط فتمرّ القراءات (GET) وتُرفض الكتابات. كل استدعاءات AI Actions تأتي من طلب HTTP،
     * فتصنيف القراءة/الكتابة هو تصنيف الطلب الحالي.
     */
    public function authorize(string $actorId, string $actionPermission, array $domainPermissions, ?string $applicationKey = null, ?string $actionType = null): User
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
        if (! Rbac::allows((string) $actor->role, $actionPermission)) {
            throw new AiActionException('permission_denied', 'ليس لديك صلاحية AI Action أو صلاحية المجال المطلوبة.', 403);
        }
        foreach ($domainPermissions as $permission) {
            if (! Rbac::allows((string) $actor->role, $permission)) {
                throw new AiActionException('permission_denied', 'ليس لديك صلاحية AI Action أو صلاحية المجال المطلوبة.', 403);
            }
        }
        // IMP-X-01b: ضوابط المشغّل (معاينة/مراجعة) بعد RBAC لا قبله: مستخدمٌ بلا صلاحية يرى `permission_denied` لا حالة المنصة. خلف بوابة نشر مغلقة
        // افتراضياً؛ شرط لازم لا كافٍ — الفرع والمعاينة والموافقة تتبع كما هي.
        if ($actionType !== null) {
            $this->controls->assertAllowed($tenantId, $actionType, AiActionsAccessResolver::PREVIEW);
        }
        if ($applicationKey !== null) {
            // HTTP فقط: `request()` هو طلب المتحكّم الحالي (لا مسار طابور/أمر يصل هنا اليوم). مساراتٌ غير HTTP تحتاج
            // تمرير تصنيف القراءة/الكتابة صراحةً قبل أن يحمل أي نوعٍ مفتاح قدرة.
            try {
                $this->applications->authorize(request(), $applicationKey);
            } catch (HttpExceptionInterface $e) {
                throw new AiActionException('application_inactive', $e->getMessage(), 403);
            }
        }

        $branchId = $this->branchContext->id();
        if (! $actor->canAccessBranch($branchId)) {
            throw new AiActionException('branch_scope_denied', 'الفرع النشط خارج نطاق المستخدم.', 403);
        }

        return $actor;
    }
}
