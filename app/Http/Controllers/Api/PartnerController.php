<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePartnerRequest;
use App\Http\Requests\UpdatePartnerRequest;
use App\Http\Resources\PartnerResource;
use App\Models\Classification;
use App\Models\Partner;
use App\Tenancy\BranchScope;
use App\Services\Accounting\PartnerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        $query = Partner::with(['customerClassification', 'supplierClassification'])->latest();

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
        $this->assertPartnerClassifications($data);

        // ذرّية: إنشاء الطرف وقيد الرصيد الافتتاحي معاملة واحدة —
        // فشل القيد يُرجع الطرف كله (لا طرف يتيم بلا قيده).
        $partner = $this->domain(fn () => DB::transaction(function () use ($data) {
            $partner = Partner::create($data); // opening_balance ليس عموداً — يحرسه fillable

            $this->partners->recordOpeningBalance(
                $partner,
                (int) ($data['opening_balance'] ?? 0),
                $data['opening_balance_date'] ?? null,
            );

            return $partner->load(['customerClassification', 'supplierClassification']);
        }));

        return (new PartnerResource($partner))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PartnerResource(Partner::with(['customerClassification', 'supplierClassification'])->findOrFail($id)))->response();
    }

    public function update(UpdatePartnerRequest $request, string $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        $data = $request->validated();
        $this->assertPartnerClassifications($data);
        $partner->update($data);

        return (new PartnerResource($partner->load(['customerClassification', 'supplierClassification'])))->response();
    }

    /** @param array<string, mixed> $data */
    private function assertPartnerClassifications(array $data): void
    {
        $type = $data['type'];
        $this->assertClassification($data['customer_classification_id'] ?? null, 'customer', in_array($type, ['customer', 'both'], true));
        $this->assertClassification($data['supplier_classification_id'] ?? null, 'supplier', in_array($type, ['supplier', 'both'], true));
    }

    private function assertClassification(?string $id, string $scope, bool $allowedForType): void
    {
        if ($id === null) {
            return;
        }
        if (! $allowedForType) {
            abort(422, 'لا يمكن إسناد تصنيف لا يطابق نوع الطرف.');
        }

        $classification = BranchScope::reference(Classification::class)->find($id);
        if (! $classification || $classification->scope !== $scope || ! $classification->is_active) {
            abort(422, 'التصنيف المختار غير نشط أو لا يطابق نوع الطرف.');
        }
    }

    public function destroy(string $id): JsonResponse
    {
        Partner::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
