<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePosPaymentTerminalRequest;
use App\Http\Requests\StorePosTerminalRequestRequest;
use App\Http\Resources\PosPaymentTerminalResource;
use App\Http\Resources\PosTerminalRequestResource;
use App\Models\PosDevice;
use App\Models\PosPaymentTerminal;
use App\Models\PosSession;
use App\Models\PosTerminalRequest;
use App\Services\PosTerminalService;
use App\Support\PosTerminalException;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * أجهزة دفع POS وطلباتها (PAY-H6-02). تشغيلي: لا قيود ولا سندات هنا — البيع يستهلك الموافقة عبر `POST /pos/checkout` (`terminal_request_id`).
 */
class PosTerminalController extends ApiController
{
    public function __construct(private readonly PosTerminalService $terminals) {}

    // ───────────── الأجهزة ─────────────

    public function index(): JsonResponse
    {
        return PosPaymentTerminalResource::collection(PosPaymentTerminal::query()->orderBy('name')->get())->response();
    }

    public function store(StorePosPaymentTerminalRequest $request): JsonResponse
    {
        $data = $request->validated();
        $terminal = $this->terminalCall(function () use ($data) {
            $this->terminals->assertProviderAvailable($data['provider']);
            $this->assertDevice($data['pos_device_id'] ?? null);
            $this->assertUnique(trim($data['name']), $data['code'] ?? null, null);

            return PosPaymentTerminal::query()->create([
                'name' => trim($data['name']),
                'code' => $data['code'] ?? null,
                'provider' => $data['provider'],
                'pos_device_id' => $data['pos_device_id'] ?? null,
                'is_active' => (bool) ($data['is_active'] ?? true),
            ]);
        });

        return (new PosPaymentTerminalResource($terminal))->response()->setStatusCode(201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $terminal = PosPaymentTerminal::query()->findOrFail($id);
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'code' => ['sometimes', 'nullable', 'string', 'max:64'],
            'pos_device_id' => ['sometimes', 'nullable', 'uuid'],
            'is_active' => ['sometimes', 'boolean'],
            'provider' => ['prohibited'], // المزوّد لا يتغير بعد الإنشاء
        ]);
        if (array_key_exists('pos_device_id', $data)) {
            $this->assertDevice($data['pos_device_id']);
        }
        $this->assertUnique(isset($data['name']) ? trim($data['name']) : null, $data['code'] ?? null, $terminal->id);
        if (isset($data['is_active']) && $data['is_active'] === false
            && PosTerminalRequest::query()->where('pos_payment_terminal_id', $terminal->id)->whereIn('status', [...PosTerminalRequest::IN_FLIGHT, PosTerminalRequest::STATUS_COMPENSATION_REQUIRED])->exists()) {
            abort(422, 'لا يمكن تعطيل جهاز عليه طلب نشط أو تعويض لم يُحل.');
        }
        $terminal->update($data);

        return (new PosPaymentTerminalResource($terminal->fresh()))->response();
    }

    // ───────────── الطلبات ─────────────

    public function sessionRequests(Request $request, string $sessionId): JsonResponse
    {
        $this->authorizeSession(PosSession::query()->findOrFail($sessionId), $request);

        return PosTerminalRequestResource::collection(
            PosTerminalRequest::query()->where('pos_session_id', $sessionId)->orderBy('created_at')->get()
        )->response();
    }

    public function createRequest(StorePosTerminalRequestRequest $request): JsonResponse
    {
        $created = $this->terminalCall(fn () => $this->terminals->createRequest($request->user(), $request->validated()));

        return (new PosTerminalRequestResource($created))->response()->setStatusCode($created->getAttribute('idempotent_replay') ? 200 : 201);
    }

    public function showRequest(Request $request, string $id): JsonResponse
    {
        $found = $this->ownedRequest($request, $id);
        $synced = $this->terminalCall(fn () => $this->terminals->sync($found));

        return (new PosTerminalRequestResource($synced))->response();
    }

    public function cancelRequest(Request $request, string $id): JsonResponse
    {
        $found = $this->ownedRequest($request, $id);

        return (new PosTerminalRequestResource($this->terminalCall(fn () => $this->terminals->cancel($found))))->response();
    }

    public function voidRequest(Request $request, string $id): JsonResponse
    {
        $found = $this->ownedRequest($request, $id);

        return (new PosTerminalRequestResource($this->terminalCall(fn () => $this->terminals->void($found))))->response();
    }

    public function resolveRequest(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['note' => ['required', 'string', 'min:5', 'max:1000']]);
        $found = PosTerminalRequest::query()->findOrFail($id);

        return (new PosTerminalRequestResource($this->terminalCall(fn () => $this->terminals->resolve($found, $request->user(), $data['note']))))->response();
    }

    // ───────────── مساعدات ─────────────

    /**
     * طلب جهاز يخص جلسة كاشير: لا يعمل عليه (استعلام/إلغاء/إلغاء موافقة) إلا كاشير الجلسة أو معتمد (`pos.variance.approve`) —
     * كما يفرض الإنشاء والبيع (`requireOpenForCheckout`). كاشير آخر بالفرع نفسه لا يلغي بيع بطاقة مسجّل آخر.
     */
    private function ownedRequest(Request $request, string $id): PosTerminalRequest
    {
        $found = PosTerminalRequest::query()->findOrFail($id);
        $this->authorizeSession(PosSession::query()->findOrFail($found->pos_session_id), $request);

        return $found;
    }

    private function authorizeSession(PosSession $session, Request $request): void
    {
        $user = $request->user();
        if ($session->opened_by !== null && $session->opened_by !== $user?->id && ! $user?->hasPermission('pos.variance.approve')) {
            abort(403, 'طلب جهاز الدفع يخص جلسة كاشير آخر.');
        }
    }

    /** الاسم فريد في الفرع والرمز فريد في المؤسسة: يُفحصان قبل الكتابة فيعود 422 لا 500 من قيد القاعدة. */
    private function assertUnique(?string $name, ?string $code, ?string $exceptId): void
    {
        if ($name !== null) {
            $q = PosPaymentTerminal::query()->where('name', $name);
            if ($exceptId !== null) {
                $q->whereKeyNot($exceptId);
            }
            if ($q->exists()) {
                abort(422, 'يوجد جهاز دفع بهذا الاسم.');
            }
        }
        if ($code !== null && $code !== '') {
            // الرمز فريد على مستوى المؤسسة (كل الفروع): فحص بلا نطاق الفرع.
            $q = PosPaymentTerminal::query()->withoutGlobalScopes()->where('tenant_id', app(\App\Tenancy\TenantContext::class)->id())->where('code', $code);
            if ($exceptId !== null) {
                $q->whereKeyNot($exceptId);
            }
            if ($q->exists()) {
                abort(422, 'يوجد جهاز دفع بهذا الرمز.');
            }
        }
    }

    private function assertDevice(?string $deviceId): void
    {
        if ($deviceId !== null) {
            PosDevice::query()->findOrFail($deviceId); // نطاق المستأجر والفرع تلقائي
        }
    }

    /** يترجم أخطاء الأجهزة إلى {message, reason} برمز ثابت؛ بقية RuntimeException ⇒ 422 كالمعتاد (ما عدا أخطاء القاعدة فتُعاد رمياً). */
    private function terminalCall(Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (PosTerminalException $e) {
            $status = match ($e->reason) {
                'terminal_busy', 'idempotency_conflict', 'operation_in_progress' => 409,
                'terminal_unavailable_now' => 503,
                default => 422,
            };
            abort(response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $status));
        } catch (\PDOException $e) {
            throw $e;
        } catch (\RuntimeException $e) {
            abort(422, $e->getMessage());
        }
    }
}
