<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePartnerRequest;
use App\Http\Resources\PartnerResource;
use App\Models\Partner;
use App\Services\Accounting\PartnerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PartnerController extends ApiController
{
    public function __construct(protected PartnerService $partners) {}

    /**
     * قائمة الأطراف مع فلترة اختيارية بالدور:
     *   ?type=customer  → العملاء (customer + both)
     *   ?type=supplier  → الموردون (supplier + both)
     * الطرف كيان واحد؛ الفلترة عرضية فقط لفصل شاشتَي العملاء والمشتريات.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Partner::latest();

        match ($request->query('type')) {
            'customer' => $query->whereIn('type', ['customer', 'both']),
            'supplier' => $query->whereIn('type', ['supplier', 'both']),
            default    => null,
        };

        return PartnerResource::collection($query->get())->response();
    }

    public function store(StorePartnerRequest $request): JsonResponse
    {
        $data = $request->validated();
        $partner = Partner::create($data); // opening_balance ليس عموداً — يحرسه fillable

        // رصيد افتتاحي (قيد ذمة الطرف مقابل 3130) عند تحديده.
        $this->domain(fn () => $this->partners->recordOpeningBalance(
            $partner,
            (int) ($data['opening_balance'] ?? 0),
            $data['opening_balance_date'] ?? null,
        ));

        return (new PartnerResource($partner))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PartnerResource(Partner::findOrFail($id)))->response();
    }

    public function update(StorePartnerRequest $request, string $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        $partner->update($request->validated());

        return (new PartnerResource($partner))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Partner::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
