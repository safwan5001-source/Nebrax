<?php

namespace App\Http\Controllers\Api;

use App\Models\AiActionControl;
use App\Models\AiActionControlEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\AiActionControlService;
use App\Services\AiActionRegistry;
use App\Services\AiActionsAccessResolver;
use App\Support\AiActionControlChange;
use App\Support\AiActionControlException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ضوابط إجراءات المساعد من مساحة التشغيل الداخلية (IMP-X-01a): المفتاح الرئيسي والتوفّر لكل نوع على المنصة، ومنحة كل مستأجر لكل نوع.
 *
 * لا تمرّ عبر `SetTenant`. القراءة بقدرة `platform:read` والتغيير بـ`platform:manage` (routes/api.php)، وكل تغيير بسببٍ إلزامي وحدث تدقيق ثابت.
 * هذه الضوابط شرط لازم لا كافٍ: لا تمنح مستخدماً صلاحية ولا توسّع فرعاً ولا تتجاوز المعاينة والموافقة؛ وأعلام البيئة أرضية صلبة تُعرض هنا ولا تُغيَّر.
 */
class PlatformAiActionControlController extends ApiController
{
    public function __construct(
        private readonly AiActionControlService $service,
        private readonly AiActionsAccessResolver $resolver,
        private readonly AiActionRegistry $registry,
    ) {}

    /** المفتاح الرئيسي + توفّر كل نوع، مع أرضية البيئة (للقراءة فقط). */
    public function platform(): JsonResponse
    {
        $rows = AiActionControl::query()->where('scope', AiActionControl::SCOPE_PLATFORM)->get();

        $state = fn (string $type): array => collect(AiActionControl::CAPABILITIES)->mapWithKeys(function (string $capability) use ($rows, $type): array {
            $row = $rows->first(fn (AiActionControl $r) => $r->action_type === $type && $r->capability === $capability);

            return [$capability => ['enabled' => (bool) ($row?->enabled ?? false), 'version' => (int) ($row?->version ?? 0)]];
        })->all();

        return response()->json(['data' => [
            'env_floor' => [
                'use' => config('ai_actions.enabled') === true,
                'execution' => config('ai_actions.execution_enabled') === true,
            ],
            'master' => $state(AiActionControl::ALL_TYPES),
            'types' => collect($this->registry->types())->map(fn (string $type) => ['action_type' => $type] + ['state' => $state($type)])->all(),
            // سجل التدقيق لتغييرات نطاق المنصة (آخر 30): كل تغيير مرئي بسببه وفاعله.
            'events' => AiActionControlEvent::query()->where('scope', AiActionControl::SCOPE_PLATFORM)
                ->orderByDesc('occurred_at')->orderByDesc('version')->limit(30)->get()
                ->map(fn (AiActionControlEvent $event) => [
                    'action_type' => $event->action_type, 'capability' => $event->capability, 'version' => $event->version,
                    'previous_enabled' => $event->previous_enabled, 'new_enabled' => $event->new_enabled, 'reason' => $event->reason,
                    'platform_administrator_id' => $event->platform_administrator_id, 'occurred_at' => $event->occurred_at?->toIso8601String(),
                ])->all(),
        ]]);
    }

    public function setPlatform(Request $request): JsonResponse
    {
        $data = $this->validated($request, withTenant: false);

        $change = $this->guard(fn () => $this->service->setPlatformState($this->actor($request), $data['action_type'], $data['capability'], $data['enabled'], $data['reason']));

        return response()->json(['data' => $this->changePayload($change)]);
    }

    public function tenant(string $tenant): JsonResponse
    {
        $model = Tenant::query()->findOrFail($tenant);

        $grants = AiActionControl::query()->where('scope', AiActionControl::SCOPE_TENANT)->where('tenant_id', $model->id)->get()
            ->map(fn (AiActionControl $row) => ['action_type' => $row->action_type, 'capability' => $row->capability, 'enabled' => (bool) $row->enabled, 'version' => (int) $row->version])
            ->values()->all();

        $events = AiActionControlEvent::query()
            ->where('scope', AiActionControl::SCOPE_TENANT)->where('tenant_id', $model->id)
            ->orderByDesc('occurred_at')->orderByDesc('version')->limit(30)->get()
            ->map(fn (AiActionControlEvent $event) => [
                'action_type' => $event->action_type, 'capability' => $event->capability, 'version' => $event->version,
                'previous_enabled' => $event->previous_enabled, 'new_enabled' => $event->new_enabled, 'reason' => $event->reason,
                'platform_administrator_id' => $event->platform_administrator_id, 'occurred_at' => $event->occurred_at?->toIso8601String(),
            ])->all();

        return response()->json(['data' => [
            'tenant_id' => $model->id,
            'grants' => $grants,
            'effective' => $this->resolver->matrix($model->id),
            'events' => $events,
        ]]);
    }

    public function setTenant(Request $request, string $tenant): JsonResponse
    {
        $data = $this->validated($request, withTenant: true);

        $change = $this->guard(fn () => $this->service->setTenantState($this->actor($request), $tenant, $data['action_type'], $data['capability'], $data['enabled'], $data['reason']));

        return response()->json(['data' => $this->changePayload($change) + ['effective' => $this->resolver->matrix($tenant)]]);
    }

    /** @return array{action_type: string, capability: string, enabled: bool, reason: string} */
    private function validated(Request $request, bool $withTenant): array
    {
        return $request->validate([
            'action_type' => ['required', 'string', 'max:64'],
            'capability' => ['required', 'string', 'in:'.implode(',', AiActionControl::CAPABILITIES)],
            'enabled' => ['required', 'boolean'],
            'reason' => ['required', 'string', 'min:'.AiActionControlService::MIN_REASON_LENGTH, 'max:'.AiActionControlService::MAX_REASON_LENGTH],
        ]);
    }

    private function actor(Request $request): PlatformAdministrator
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return $administrator;
    }

    /** @return array<string, mixed> */
    private function changePayload(AiActionControlChange $change): array
    {
        return ['changed' => $change->changed, 'previous_enabled' => $change->previousEnabled, 'current_enabled' => $change->currentEnabled];
    }

    private function guard(callable $callback): AiActionControlChange
    {
        try {
            return $callback();
        } catch (AiActionControlException $e) {
            abort(match ($e->reason) {
                'unauthorized_actor' => 403,
                'tenant_not_found' => 404,
                default => 422,
            }, $e->getMessage(), ['X-Control-Reason' => $e->reason]);
        }
    }
}
