<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreDeliveryHubOrderRequest;
use App\Http\Requests\TransitionDeliveryHubOrderRequest;
use App\Http\Resources\DeliveryHubOrderResource;
use App\Models\DeliveryHubOrder;
use App\Services\DeliveryHub\DeliveryHubOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * DLV-HUB-PROJECTION-1 — صندوق تشغيلي. القراءة view، والانتقال operate.
 * لا يرحّل فاتورة ولا يمس السداد أو المخزون أو جلسة البيع.
 */
class DeliveryHubOrderController extends ApiController
{
    public function __construct(private DeliveryHubOrderService $hub) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $perPage = (int) ($request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']])['per_page'] ?? 50);

        if ($request->boolean('unrouted') && $user->allowedBranchIds() !== null) {
            return response()->json(['data' => []]);
        }

        $query = $this->hub->visibleQuery($user);
        if ($request->boolean('unrouted')) {
            $query->whereNull('branch_id')->where('state', DeliveryHubOrder::UNROUTED);
        }

        $branchId = $request->query('branch_id');
        if (is_string($branchId) && $branchId !== '') {
            if (! $user->canAccessBranch($branchId)) {
                return response()->json(['data' => []]);
            }
            $query->where('branch_id', $branchId);
        }

        return DeliveryHubOrderResource::collection(
            $query->orderByDesc('created_at')->paginate($perPage)
        )->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $order = DeliveryHubOrder::query()->whereKey($id)->first();
        if ($order === null || ! $order->visibleTo($request->user())) {
            abort(404);
        }

        return (new DeliveryHubOrderResource($order))->response();
    }

    public function store(StoreDeliveryHubOrderRequest $request): JsonResponse
    {
        [$order, $replay] = $this->domain(fn () => $this->hub->intake($request->validated(), $request->user()));

        return (new DeliveryHubOrderResource($order))
            ->additional(['idempotent_replay' => $replay])
            ->response()
            ->setStatusCode($replay ? 200 : 201);
    }

    public function transition(TransitionDeliveryHubOrderRequest $request, string $id): JsonResponse
    {
        [$order, $replay] = $this->domain(fn () => $this->hub->transition(
            $id,
            (string) $request->validated('action'),
            $request->validated('branch_id'),
            $request->user(),
        ));

        return (new DeliveryHubOrderResource($order))
            ->additional(['idempotent_replay' => $replay])
            ->response();
    }
}
