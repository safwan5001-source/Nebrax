<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreDeliveryHubOrderRequest;
use App\Http\Requests\TransitionDeliveryHubOrderRequest;
use App\Http\Resources\DeliveryHubOrderResource;
use App\Models\Branch;
use App\Models\DeliveryHubOrder;
use App\Models\DeliveryPlatformProfile;
use App\Services\DeliveryHub\DeliveryHubOrderService;
use App\Support\DeliveryPlatformCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * DLV-HUB-PROJECTION-1 — صندوق تشغيلي. القراءة view، والانتقال operate.
 * لا يرحّل فاتورة ولا يمس السداد أو المخزون أو جلسة البيع.
 */
class DeliveryHubOrderController extends ApiController
{
    public function __construct(private DeliveryHubOrderService $hub) {}

    public function context(Request $request): JsonResponse
    {
        $user = $request->user();
        $allowed = $user->allowedBranchIds();
        $branches = Branch::query()->orderBy('name');
        if ($allowed !== null) {
            $branches->whereIn('id', $allowed);
        }

        $platforms = DeliveryPlatformProfile::query()->orderBy('platform_key')->get()->map(function (DeliveryPlatformProfile $profile) {
            $meta = DeliveryPlatformCatalog::get((string) $profile->platform_key);

            return [
                'id' => $profile->id,
                'platform_key' => $profile->platform_key,
                'name' => $meta['name'] ?? null,
                'name_en' => $meta['name_en'] ?? null,
            ];
        })->values();

        return response()->json([
            'data' => [
                'can_see_unrouted' => $allowed === null,
                'platforms' => $platforms,
                'branches' => $branches->get(['id', 'name', 'is_active'])->map(fn (Branch $branch) => [
                    'id' => $branch->id,
                    'name' => $branch->name,
                    'is_active' => (bool) $branch->is_active,
                ])->values(),
            ],
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'unrouted' => ['nullable', 'boolean'],
            'state' => ['nullable', 'string', Rule::in(DeliveryHubOrder::STATES)],
            'branch_id' => ['nullable', 'uuid'],
            'delivery_platform_profile_id' => ['nullable', 'uuid'],
        ]);
        $perPage = (int) ($filters['per_page'] ?? 50);

        if ($request->boolean('unrouted') && $user->allowedBranchIds() !== null) {
            return response()->json(['data' => []]);
        }

        $query = $this->hub->visibleQuery($user)->with(['profile', 'branch']);
        if ($request->boolean('unrouted')) {
            $query->whereNull('branch_id')->where('state', DeliveryHubOrder::UNROUTED);
        } elseif (! empty($filters['state'])) {
            $query->where('state', $filters['state']);
        }

        $branchId = $filters['branch_id'] ?? null;
        if (is_string($branchId) && $branchId !== '') {
            if (! $user->canAccessBranch($branchId)) {
                return response()->json(['data' => []]);
            }
            $query->where('branch_id', $branchId);
        }

        $profileId = $filters['delivery_platform_profile_id'] ?? null;
        if (is_string($profileId) && $profileId !== '') {
            $profile = DeliveryPlatformProfile::query()->whereKey($profileId)->first();
            if ($profile === null) {
                return response()->json(['data' => []]);
            }
            $query->where('delivery_platform_profile_id', $profile->id);
        }

        return DeliveryHubOrderResource::collection(
            $query->orderByDesc('created_at')->paginate($perPage)
        )->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $order = DeliveryHubOrder::query()->with(['profile', 'branch'])->whereKey($id)->first();
        if ($order === null || ! $order->visibleTo($request->user())) {
            abort(404);
        }

        return (new DeliveryHubOrderResource($order))->response();
    }

    public function store(StoreDeliveryHubOrderRequest $request): JsonResponse
    {
        [$order, $replay] = $this->domain(fn () => $this->hub->intake($request->validated(), $request->user()));
        $order->load(['profile', 'branch']);

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
        $order->load(['profile', 'branch']);

        return (new DeliveryHubOrderResource($order))
            ->additional(['idempotent_replay' => $replay])
            ->response();
    }
}
