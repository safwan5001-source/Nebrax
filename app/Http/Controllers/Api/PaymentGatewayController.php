<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\RotatePaymentGatewayCredentialsRequest;
use App\Http\Requests\StorePaymentGatewayRequest;
use App\Http\Requests\TransitionPaymentGatewayRequest;
use App\Http\Requests\UpdatePaymentGatewayRequest;
use App\Http\Resources\PaymentGatewayResource;
use App\Models\PaymentConnectionEvent;
use App\Services\PaymentGatewayService;
use App\Support\PaymentGatewayException;
use Closure;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * اتصالات بوابات الدفع للمستأجر (PAY-H1-01). القراءة `payments.view` (بلا أسرار)،
 * الكتابة وسجل التدقيق `payment_gateways.manage`. لا استدعاء مزوّد ولا أثر محاسبي هنا.
 */
class PaymentGatewayController extends ApiController
{
    public function __construct(private PaymentGatewayService $gateways) {}

    public function index(): JsonResponse
    {
        return PaymentGatewayResource::collection($this->gateways->list())->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new PaymentGatewayResource($this->gateways->find($id)))->response();
    }

    public function events(string $id): JsonResponse
    {
        $events = $this->gateways->events($this->gateways->find($id));

        return response()->json([
            'data' => $events->map(fn (PaymentConnectionEvent $event) => [
                'id' => $event->id,
                'event_type' => $event->event_type,
                'from_status' => $event->from_status,
                'to_status' => $event->to_status,
                'credential_version' => $event->credential_version,
                'actor_user_id' => $event->actor_user_id,
                'reason' => $event->reason,
                'changed_fields' => $event->changed_fields,
                'occurred_at' => $event->occurred_at?->toISOString(),
            ])->values(),
        ]);
    }

    public function store(StorePaymentGatewayRequest $request): JsonResponse
    {
        return $this->guarded(function () use ($request) {
            $gateway = $this->gateways->create($request->validated(), $request->user());

            return (new PaymentGatewayResource($gateway))->response()->setStatusCode(201);
        });
    }

    public function update(UpdatePaymentGatewayRequest $request, string $id): JsonResponse
    {
        return $this->guarded(function () use ($request, $id) {
            $gateway = $this->gateways->update($this->gateways->find($id), $request->validated(), $request->user());

            return (new PaymentGatewayResource($gateway))->response();
        });
    }

    public function rotateCredentials(RotatePaymentGatewayCredentialsRequest $request, string $id): JsonResponse
    {
        return $this->guarded(function () use ($request, $id) {
            $data = $request->validated();
            $gateway = $this->gateways->rotateCredentials(
                $this->gateways->find($id),
                $data,
                (int) ($data['grace_minutes'] ?? 60),
                $request->user(),
                (bool) ($data['emergency'] ?? false),
                $data['reason'] ?? null,
            );

            return (new PaymentGatewayResource($gateway))->response();
        });
    }

    public function activate(TransitionPaymentGatewayRequest $request, string $id): JsonResponse
    {
        return $this->guarded(fn () => (new PaymentGatewayResource(
            $this->gateways->activate($this->gateways->find($id), $request->user(), $request->validated('reason'))
        ))->response());
    }

    public function verify(Request $request, string $id): JsonResponse
    {
        return $this->guarded(fn () => (new PaymentGatewayResource(
            $this->gateways->verify($this->gateways->find($id), $request->user())
        ))->response());
    }

    public function suspend(TransitionPaymentGatewayRequest $request, string $id): JsonResponse
    {
        return $this->guarded(fn () => (new PaymentGatewayResource(
            $this->gateways->suspend($this->gateways->find($id), $request->user(), $request->validated('reason'))
        ))->response());
    }

    public function revoke(TransitionPaymentGatewayRequest $request, string $id): JsonResponse
    {
        return $this->guarded(fn () => (new PaymentGatewayResource(
            $this->gateways->revoke($this->gateways->find($id), $request->user(), $request->validated('reason'))
        ))->response());
    }

    public function setFeeTaxPolicy(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'policy' => ['required', 'string', 'in:reject,input_vat'],
            'reason' => ['required', 'string', 'min:5', 'max:500'],
        ]);

        return $this->guarded(fn () => (new PaymentGatewayResource(
            $this->gateways->setFeeTaxPolicy($this->gateways->find($id), $data['policy'], $request->user(), $data['reason'])
        ))->response());
    }

    public function destroy(string $id): JsonResponse
    {
        return $this->guarded(function () use ($id) {
            $this->gateways->delete($this->gateways->find($id), request()->user());

            return response()->json(['message' => 'deleted']);
        });
    }

    /** أخطاء القاعدة بصيغة موحّدة `{error:{code,message}}` (الواجهة تترجم بالرمز). */
    private function guarded(Closure $fn): JsonResponse
    {
        try {
            return $fn();
        } catch (PaymentGatewayException $e) {
            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], 422);
        } catch (DomainException $e) {
            return response()->json(['error' => ['code' => 'gateway.invalid', 'message' => $e->getMessage()]], 422);
        }
    }
}
