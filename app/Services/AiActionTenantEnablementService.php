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
    public function __construct(private readonly AiAuditRecorder $audit, private readonly AiActionsAccessResolver $controls) {}

    /**
     * `execution_approved` (IMP-X-01c) موافقة المالك على التنفيذ. `controls_enforced`/`access`: سبب الإتاحة لكل نوع وقدرة كما تحكم به ضوابط المشغّل —
     * يُعرض فقط حين تكون بوابة النشر مفتوحة (وإلا `null`) برموز ثابتة لا تكشف إعدادات المنصة الداخلية أكثر من «متاح/غير متاح ولماذا».
     *
     * @return array{platform_enabled:bool, tenant_enabled:bool, effective:bool, reason:string, execution_approved:bool, controls_enforced:bool, access:?array<string, array<string, array{allowed:bool, reason:string}>>}
     */
    public function status(Tenant $tenant): array
    {
        $platform = config('ai_actions.enabled') === true;
        $settings = Settings::group('ai_actions', $tenant);
        $enabled = ($settings['enabled'] ?? false) === true;
        $enforced = AiActionsAccessResolver::enforced();

        return [
            'platform_enabled' => $platform,
            'tenant_enabled' => $enabled,
            'effective' => $platform && $enabled,
            'reason' => ! $platform ? 'platform_disabled' : ($enabled ? 'enabled' : 'tenant_not_enabled'),
            'execution_approved' => ($settings['execution_approved'] ?? false) === true,
            'controls_enforced' => $enforced,
            'access' => $enforced ? $this->tenantFacing($this->controls->matrix((string) $tenant->getKey())) : null,
        ];
    }

    /**
     * موافقة **مالك** المؤسسة على تنفيذ AI Actions (IMP-X-01c، قرار المالك D-11): لا admin ولا دور مخصّص مهما مُنحت الصلاحية. الموافقة تتطلب قبول المؤسسة
     * (`enabled`) أولاً؛ والسحب متاح دائماً ويوقف التنفيذ الجاري خلال صفٍّ واحد (IMP-X-01b). لا تمنح تنفيذاً: منحة المشغّل وأعلام البيئة والصلاحيات
     * والمعاينة والموافقة تبقى كما هي. ذرّي مع تدقيق وصفي إلزامي؛ لا كتابة إن لم يتغيّر شيء.
     *
     * @return array<string, mixed>
     */
    public function updateExecutionApproval(User $actor, bool $approved): array
    {
        if ((string) $actor->role !== 'owner') {
            throw new AiActionException('owner_required', 'موافقة التنفيذ لمالك المؤسسة وحده.', 403);
        }

        return DB::transaction(function () use ($actor, $approved): array {
            $tenant = Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
            $settings = Settings::group('ai_actions', $tenant);
            if ($approved && ($settings['enabled'] ?? false) !== true) {
                throw new AiActionException('tenant_not_enabled', 'فعّل AI Actions للمؤسسة أولاً قبل الموافقة على التنفيذ.', 409);
            }

            if ((($settings['execution_approved'] ?? false) === true) !== $approved) {
                Settings::put('ai_actions', ['execution_approved' => $approved], $tenant);
                $this->audit->record(
                    (string) Str::uuid(),
                    (string) $tenant->getKey(),
                    (string) $actor->getKey(),
                    'ai_actions.execution_approval.updated',
                    'allowed',
                    'ok',
                    ['meta' => ['ai_actions_execution_approved' => $approved]],
                    required: true,
                );
            }

            return $this->status($tenant->refresh());
        });
    }

    /** @return array<string, mixed> */
    public function update(User $actor, bool $enabled): array
    {
        if ($enabled && config('ai_actions.enabled') !== true) {
            throw new AiActionException('platform_disabled', 'AI Actions غير مفعّلة على المنصة، فلا يمكن تفعيلها للمؤسسة.', 409);
        }

        return DB::transaction(function () use ($actor, $enabled): array {
            $tenant = Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
            $was = (Settings::group('ai_actions', $tenant)['enabled'] ?? false) === true;

            if ($was !== $enabled) {
                // إيقاف قبول المؤسسة يسحب موافقة التنفيذ معه (IMP-X-01c، من مراجعة مستقلة): إعادة التفعيل لاحقاً — ولو بيد admin — لا تُعيد صلاحية
                // تنفيذ منحها المالك قبل أن تُوقف المؤسسة AI Actions؛ يلزم موافقة مالك جديدة (D-11).
                $dropsApproval = ! $enabled && (Settings::group('ai_actions', $tenant)['execution_approved'] ?? false) === true;
                Settings::put('ai_actions', ['enabled' => $enabled] + ($dropsApproval ? ['execution_approved' => false] : []), $tenant);
                $this->audit->record(
                    (string) Str::uuid(),
                    (string) $tenant->getKey(),
                    (string) $actor->getKey(),
                    'ai_actions.enablement.updated',
                    'allowed',
                    'ok',
                    ['meta' => ['ai_actions_enabled' => $enabled] + ($dropsApproval ? ['ai_actions_execution_approved' => false] : [])],
                    required: true,
                );
            }

            return $this->status($tenant->refresh());
        });
    }

    /**
     * أسباب مستوى المنصة (أرضية البيئة، المفتاح الرئيسي، توفّر النوع) تُدمج في `platform_unavailable` للمستأجر: يعرف أن الميزة غير متاحة من المنصة
     * دون أن تُكشف أعلام البيئة أو تفاصيل ضوابط المشغّل؛ أسباب مستواه هو (المنحة، قبول المؤسسة، موافقة المالك) تبقى كما هي.
     *
     * @param  array<string, array<string, array{allowed: bool, reason: string}>>  $matrix
     * @return array<string, array<string, array{allowed: bool, reason: string}>>
     */
    private function tenantFacing(array $matrix): array
    {
        $platform = ['env_floor_off', 'platform_off', 'type_off', 'execution_env_floor_off', 'execution_platform_off', 'execution_type_off'];
        foreach ($matrix as $type => $capabilities) {
            foreach ($capabilities as $capability => $decision) {
                if (in_array($decision['reason'], $platform, true)) {
                    $matrix[$type][$capability]['reason'] = 'platform_unavailable';
                }
            }
        }

        return $matrix;
    }
}
