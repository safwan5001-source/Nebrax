<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePartnerRequest;
use App\Http\Requests\UpdatePartnerRequest;
use App\Http\Resources\PartnerResource;
use App\Models\Classification;
use App\Models\Partner;
use App\Models\PriceList;
use App\Tenancy\BranchScope;
use App\Services\Accounting\PartnerService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PartnerController extends ApiController
{
    public function __construct(protected PartnerService $partners) {}

    /**
     * قائمة الأطراف مع فلترة اختيارية بالدور والبحث:
     *   ?type=customer  → العملاء (customer + both)
     *   ?type=supplier  → الموردون (supplier + both)
     *   ?search=...     → الاسم/الكود/الضريبة/السجل/الهاتف/البريد
     * الطرف كيان واحد؛ الفلترة عرضية فقط لفصل شاشتَي العملاء والمشتريات.
     */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Partner::with(['customerClassification', 'supplierClassification', 'defaultPriceList'])->latest();

        match ($request->query('type')) {
            'customer' => $query->whereIn('type', ['customer', 'both']),
            'supplier' => $query->whereIn('type', ['supplier', 'both']),
            default    => null,
        };

        if ($search = trim((string) ($filters['search'] ?? ''))) {
            // Use an explicit, single-character ESCAPE marker so literal LIKE wildcards
            // behave identically on SQLite and PostgreSQL.
            $escaped = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search);
            $pattern = "%{$escaped}%";
            $query->where(function (Builder $builder) use ($pattern) {
                $builder
                    ->whereRaw("name LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("name_en LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("code LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("vat_number LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("cr_number LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("phone LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("mobile LIKE ? ESCAPE '!'", [$pattern])
                    ->orWhereRaw("email LIKE ? ESCAPE '!'", [$pattern]);
            });
        }

        if (isset($filters['per_page'])) {
            $query->limit((int) $filters['per_page']);
        }

        return PartnerResource::collection($query->get())->response();
    }

    public function store(StorePartnerRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertPartnerClassifications($data);

        // مسار الإنشاء القانوني الموحّد (خدمة الدومين) — نفسه يستعمله الـ Public API.
        $partner = $this->domain(fn () => $this->partners->create($data));

        return (new PartnerResource($partner))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PartnerResource(Partner::with(['customerClassification', 'supplierClassification', 'defaultPriceList'])->findOrFail($id)))->response();
    }

    public function update(UpdatePartnerRequest $request, string $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        $data = $request->validated();
        $this->assertPartnerClassifications($data, $partner);
        $partner->update($data);

        return (new PartnerResource($partner->load(['customerClassification', 'supplierClassification', 'defaultPriceList'])))->response();
    }

    /** @param array<string, mixed> $data */
    private function assertPartnerClassifications(array $data, ?Partner $partner = null): void
    {
        $type = $data['type'];
        $isCustomer = in_array($type, ['customer', 'both'], true);
        $this->assertClassification($data['customer_classification_id'] ?? null, 'customer', $isCustomer);
        $this->assertClassification($data['supplier_classification_id'] ?? null, 'supplier', in_array($type, ['supplier', 'both'], true));

        // الغياب في التعديل يبقي المرجع القديم؛ الإرسال الفارغ يمحوه عمداً.
        $priceListId = array_key_exists('default_price_list_id', $data)
            ? $data['default_price_list_id']
            : $partner?->default_price_list_id;
        $this->assertDefaultPriceList($priceListId, $isCustomer, $partner?->default_price_list_id);
    }

    private function assertDefaultPriceList(?string $id, bool $allowedForType, ?string $currentId = null): void
    {
        if ($id === null) {
            return;
        }
        if (! $allowedForType) {
            abort(422, 'لا يمكن إسناد قائمة سعر افتراضية لطرف ليس عميلاً.');
        }

        $priceList = PriceList::find($id);
        if (! $priceList || (! $priceList->is_active && $priceList->id !== $currentId)) {
            abort(422, 'قائمة السعر الافتراضية غير موجودة أو غير نشطة.');
        }
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
