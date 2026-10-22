<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentsRolloutControl;
use App\Models\PaymentsRolloutControlEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentsRolloutChange;
use App\Support\PaymentsRolloutControlException;
use App\Support\SchedulerHeartbeat;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ضوابط تفعيل المدفوعات الإلكترونية من مساحة التشغيل الداخلية (PAY-H1-02).
 *
 * لا تمرّ عبر `SetTenant`. القراءة بقدرة `platform:read` والتغيير بـ`platform:manage` (routes/api.php). التفعيل شرط لازم لا
 * كافٍ: لا يمنح أي مستخدم صلاحية ولا يغيّر عزل الشركات أو الفروع؛ كل مسار مدفوعات لاحق يبقى خلف RBAC وTenantScope.
 */
class PlatformPaymentsRolloutController extends ApiController
{
    private const FEATURE = PaymentsRolloutControl::FEATURE_ONLINE_PAYMENTS;

    public function __construct(private readonly PaymentsRolloutControlService $service) {}

    /** حالة الإيقاف الطارئ العام + دليل المجدول (شرط التفعيل). */
    public function platform(): JsonResponse
    {
        $stop = PaymentsRolloutControl::query()
            ->where('scope', PaymentsRolloutControl::SCOPE_PLATFORM)
            ->where('feature_key', self::FEATURE)
            ->first();

        return response()->json(['data' => [
            'feature' => self::FEATURE,
            'emergency_stop' => $stop !== null && ! $stop->enabled,
            'version' => (int) ($stop?->version ?? 0),
            'scheduler' => [
                'fresh' => SchedulerHeartbeat::isFresh(),
                'last_seen_at' => SchedulerHeartbeat::lastSeenAt()?->toIso8601String(),
                'max_age_minutes' => SchedulerHeartbeat::MAX_AGE_MINUTES,
            ],
        ]]);
    }

    public function setPlatform(Request $request): JsonResponse
    {
        $data = $request->validate([
            'stopped' => ['required', 'boolean'],
            'reason' => ['required', 'string', 'min:'.PaymentsRolloutControlService::MIN_REASON_LENGTH, 'max:'.PaymentsRolloutControlService::MAX_REASON_LENGTH],
        ]);

        $change = $this->guard(fn () => $this->service->setPlatformState($this->actor($request), ! $data['stopped'], $data['reason']));

        return response()->json(['data' => $this->changePayload($change) + ['emergency_stop' => (bool) $data['stopped']]]);
    }

    public function tenant(string $tenant): JsonResponse
    {
        $model = Tenant::query()->findOrFail($tenant);
        $state = $this->service->effectiveForTenant($model->id);

        $events = PaymentsRolloutControlEvent::query()
            ->where('scope', PaymentsRolloutControl::SCOPE_TENANT)
            ->where('tenant_id', $model->id)
            ->where('feature_key', self::FEATURE)
            ->orderByDesc('version')
            ->limit(20)
            ->get()
            ->map(fn (PaymentsRolloutControlEvent $event) => [
                'version' => $event->version,
                'previous_enabled' => $event->previous_enabled,
                'new_enabled' => $event->new_enabled,
                'reason' => $event->reason,
                'platform_administrator_id' => $event->platform_administrator_id,
                'occurred_at' => $event->occurred_at?->toIso8601String(),
            ])
            ->all();

        return response()->json(['data' => [
            'tenant_id' => $model->id,
            'feature' => self::FEATURE,
            'effective_enabled' => $state->enabled,
            'reason' => $state->reason,
            'tenant_enabled' => $state->tenantEnabled,
            'platform_stopped' => $state->platformStopped,
            'events' => $events,
        ]]);
    }

    public function setTenant(Request $request, string $tenant): JsonResponse
    {
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'reason' => ['required', 'string', 'min:'.PaymentsRolloutControlService::MIN_REASON_LENGTH, 'max:'.PaymentsRolloutControlService::MAX_REASON_LENGTH],
        ]);

        $change = $this->guard(fn () => $this->service->setTenantState($this->actor($request), $tenant, $data['enabled'], $data['reason']));
        $state = $this->service->effectiveForTenant($tenant);

        return response()->json(['data' => $this->changePayload($change) + [
            'effective_enabled' => $state->enabled,
            'reason_code' => $state->reason,
        ]]);
    }

    private function actor(Request $request): PlatformAdministrator
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return $administrator;
    }

    /** @return array<string, mixed> */
    private function changePayload(PaymentsRolloutChange $change): array
    {
        return [
            'changed' => $change->changed,
            'previous_enabled' => $change->previousEnabled,
            'current_enabled' => $change->currentEnabled,
        ];
    }

    private function guard(callable $callback): PaymentsRolloutChange
    {
        try {
            return $callback();
        } catch (PaymentsRolloutControlException $e) {
            abort(match ($e->reason) {
                'unauthorized_actor' => 403,
                'tenant_not_found' => 404,
                'scheduler_unproven' => 409,
                default => 422,
            }, $e->getMessage(), ['X-Rollout-Reason' => $e->reason]);
        }
    }
}
