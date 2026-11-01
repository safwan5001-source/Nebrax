<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\BuilderLivePointerActionRequest;
use App\Models\BuilderApp;
use App\Models\BuilderLivePointer;
use App\Models\BuilderLivePointerEvent;
use App\Services\AppBuilder\BuilderLivePointerService;
use App\Services\AppBuilder\LivePointerConflictException;
use Illuminate\Http\JsonResponse;

/**
 * AD-06 / S05c — إدارة النسخة الحيّة لقناة الجوال (ترقية/تراجع/استعراض).
 *
 * خلف بوابة النشر `app_builder.live_pointer_enabled` (مغلقة افتراضياً ⇒ 404 مطابق لغير الموجود). صلاحية الفعل
 * `apps_builder.publish` (نفس حدّ النشر: يغيّر ما يراه العملاء) والقراءة `apps_builder.view`؛ كلاهما مع بوابة قدرة
 * `commerce.app_builder` في المسار. الكتابة كلها عبر `BuilderLivePointerService` (قفل + تدقيق).
 */
class BuilderLivePointerController extends ApiController
{
    public function __construct(private readonly BuilderLivePointerService $service) {}

    public function show(): JsonResponse
    {
        $this->gate();
        $channel = $this->service->channel();
        $pointer = $channel === null ? null : $this->service->current($channel->id);

        $events = $channel === null ? collect() : BuilderLivePointerEvent::query()
            ->where('sales_channel_id', $channel->id)
            ->with(['actor', 'fromVersion', 'toVersion'])
            ->orderByDesc('created_at')->orderByDesc('id')
            ->limit(20)
            ->get();

        return response()->json([
            'data' => [
                'channel_id' => $channel?->id,
                'live' => $pointer === null ? null : $this->pointerArray($pointer),
                'history' => $events->map(fn (BuilderLivePointerEvent $e) => [
                    'action' => $e->action,
                    'from_version' => $e->fromVersion?->version,
                    'from_app_id' => $e->fromVersion?->builder_app_id,
                    'to_version' => $e->toVersion?->version,
                    'to_app_id' => $e->toVersion?->builder_app_id,
                    'actor_name' => $e->actor?->name,
                    'reason' => $e->reason,
                    'at' => $e->created_at?->toIso8601String(),
                ])->values(),
            ],
        ]);
    }

    public function promote(BuilderLivePointerActionRequest $request, string $appId, string $version): JsonResponse
    {
        $this->gate();
        $app = BuilderApp::findOrFail($appId);
        $row = $app->publishedVersions()->where('version', (int) $version)->firstOrFail();

        $pointer = $this->conflicts(fn () => $this->domain(fn () => $this->service->promote(
            $row,
            $request->user()?->id,
            $request->validated('reason'),
        )));
        if ($pointer instanceof JsonResponse) {
            return $pointer;
        }

        return response()->json(['data' => $this->pointerArray($pointer)]);
    }

    public function rollback(BuilderLivePointerActionRequest $request): JsonResponse
    {
        $this->gate();

        $pointer = $this->conflicts(fn () => $this->domain(fn () => $this->service->rollback(
            $request->validated('version_id'),
            $request->user()?->id,
            $request->validated('reason'),
        )));
        if ($pointer instanceof JsonResponse) {
            return $pointer;
        }

        return response()->json(['data' => $this->pointerArray($pointer)]);
    }

    private function gate(): void
    {
        abort_unless(BuilderLivePointerService::enabled(), 404);
    }

    /** @return BuilderLivePointer|JsonResponse */
    private function conflicts(\Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (LivePointerConflictException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], 409);
        }
    }

    /** @return array<string, mixed> */
    private function pointerArray(BuilderLivePointer $pointer): array
    {
        $pointer->loadMissing('liveVersion');

        return [
            'builder_app_id' => $pointer->builder_app_id,
            'version_id' => $pointer->live_version_id,
            'version' => $pointer->liveVersion?->version,
            'schema_version' => $pointer->liveVersion?->schema_version,
            'updated_by' => $pointer->updated_by,
            'updated_at' => $pointer->updated_at?->toIso8601String(),
        ];
    }
}
