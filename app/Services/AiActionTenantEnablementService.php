<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\User;
use App\Support\AiActionException;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * قبول المؤسسة لـAI Actions (IMP-H2-S4) — مسار الكتابة الوحيد لمفتاح `ai_actions.enabled`.
 *
 * - المفتاح الثاني فقط: تفعيل المنصة (`config('ai_actions.enabled')`) يبقى حاجزاً أعلى لا تتجاوزه المؤسسة، ويُرفض تفعيلها
 *   بينه مطفأً (`platform_disabled`)؛ أما الإيقاف فمتاح دائماً.
 * - لا يمنح هذا المفتاح تنفيذاً: `ai_actions.execution_enabled` (المنصة) والصلاحيات والمعاينة والموافقة تبقى كما هي.
 * - ذرّي: معاملة بقفل صفّ المستأجر، وتدقيق وصفي إلزامي في المعاملة نفسها (فشله يُجهض التغيير).
 * - لا كتابة ولا تدقيق إن لم يتغيّر شيء. يسري التغيير في الطلب التالي: `AiActionPolicy` تقرأ المستأجر طازجاً.
 */
final class AiActionTenantEnablementService
{
    public function __construct(private readonly AiAuditRecorder $audit) {}

    /** @return array{platform_enabled:bool, tenant_enabled:bool, effective:bool, reason:string} */
    public function status(Tenant $tenant): array
    {
        $platform = config('ai_actions.enabled') === true;
        $enabled = (Settings::group('ai_actions', $tenant)['enabled'] ?? false) === true;

        return [
            'platform_enabled' => $platform,
            'tenant_enabled' => $enabled,
            'effective' => $platform && $enabled,
            'reason' => ! $platform ? 'platform_disabled' : ($enabled ? 'enabled' : 'tenant_not_enabled'),
        ];
    }

    /** @return array{platform_enabled:bool, tenant_enabled:bool, effective:bool, reason:string} */
    public function update(User $actor, bool $enabled): array
    {
        if ($enabled && config('ai_actions.enabled') !== true) {
            throw new AiActionException('platform_disabled', 'AI Actions غير مفعّلة على المنصة، فلا يمكن تفعيلها للمؤسسة.', 409);
        }

        return DB::transaction(function () use ($actor, $enabled): array {
            $tenant = Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
            $was = (Settings::group('ai_actions', $tenant)['enabled'] ?? false) === true;

            if ($was !== $enabled) {
                Settings::put('ai_actions', ['enabled' => $enabled], $tenant);
                $this->audit->record(
                    (string) Str::uuid(),
                    (string) $tenant->getKey(),
                    (string) $actor->getKey(),
                    'ai_actions.enablement.updated',
                    'allowed',
                    'ok',
                    ['meta' => ['ai_actions_enabled' => $enabled]],
                    required: true,
                );
            }

            return $this->status($tenant->refresh());
        });
    }
}
