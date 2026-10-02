<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreDeliveryPlatformRequest;
use App\Http\Requests\UpdateDeliveryPlatformRequest;
use App\Http\Resources\DeliveryPlatformResource;
use App\Http\Resources\DeliveryPlatformVersionResource;
use App\Models\DeliveryPlatformProfile;
use App\Services\DeliveryPlatformConfigService;
use App\Support\DeliveryPlatformCatalog;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * DLV-FOUNDATION-1 — إعداد منصات التوصيل (ملف + نسخ + حلّ تاريخي).
 * إعداد فقط: لا قيد ولا سند ولا مخزون ولا تغيير لسلوك POS. الصلاحيات من
 * `routes/api.php`: القراءة `invoices.view`، والتعديل `company.manage`.
 */
class DeliveryPlatformController extends ApiController
{
    private const WITH = ['salesChannel', 'versions.overrides'];

    public function __construct(private DeliveryPlatformConfigService $config) {}

    public function catalog(): JsonResponse
    {
        $items = [];
        foreach (DeliveryPlatformCatalog::all() as $key => $row) {
            $items[] = ['platform_key' => $key, 'name' => $row['name'], 'name_en' => $row['name_en']];
        }

        return response()->json(['data' => $items]);
    }

    public function index(): JsonResponse
    {
        return DeliveryPlatformResource::collection(
            DeliveryPlatformProfile::query()->with(self::WITH)->orderBy('platform_key')->get()
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new DeliveryPlatformResource($this->profile($id)))->response();
    }

    public function store(StoreDeliveryPlatformRequest $request): JsonResponse
    {
        $profile = $this->domain(fn () => $this->config->create($request->validated(), $request->user()));

        return (new DeliveryPlatformResource($profile->load(self::WITH)))->response()->setStatusCode(201);
    }

    public function update(UpdateDeliveryPlatformRequest $request, string $id): JsonResponse
    {
        $profile = $this->profile($id);
        $updated = $this->domain(fn () => $this->config->update($profile, $request->validated(), $request->user()));

        return (new DeliveryPlatformResource($updated->load(self::WITH)))->response();
    }

    public function versions(string $id): JsonResponse
    {
        $profile = $this->profile($id);

        return DeliveryPlatformVersionResource::collection($profile->versions)->response();
    }

    /** الإعداد الفعلي لنسخة (`version_id`) أو لتاريخ (`at`) أو الأحدث، مع تجاوز الفرع (`branch_id`). */
    public function resolve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'version_id' => ['nullable', 'uuid'],
            'at' => ['nullable', 'date'],
            'branch_id' => ['nullable', 'uuid'],
        ]);
        $profile = $this->profile($id);

        // فرع خارج نطاق المستخدم يُعامَل كغير موجود، لا كمرفوض: لا كشف.
        if (! empty($data['branch_id']) && ! $request->user()->canAccessBranch($data['branch_id'])) {
            abort(404);
        }

        $resolved = $this->domain(fn () => $this->config->resolve(
            $profile,
            $data['branch_id'] ?? null,
            $data['version_id'] ?? null,
            isset($data['at']) ? Carbon::parse($data['at']) : null,
        ));
        if ($resolved === null) {
            abort(404);
        }

        return response()->json(['data' => $resolved]);
    }

    private function profile(string $id): DeliveryPlatformProfile
    {
        return DeliveryPlatformProfile::query()->with(self::WITH)->findOrFail($id);
    }
}
