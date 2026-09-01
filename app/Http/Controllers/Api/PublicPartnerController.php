<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PublicPartnerResource;
use App\Models\Partner;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public API — الأطراف (عملاء/موردون) للقراءة فقط.
 *
 * يستعلم نموذج `Partner` المعزول بالمستأجر (`TenantScope`) مباشرةً. تنطبق دلالات
 * الأعمال القائمة: بلا سياق فرع (عميل الـ API على مستوى المستأجر)، فـ `BranchScope`
 * لا يصفّي والنتيجة تشمل المستأجر كاملًا عبر فروعه. لا كتابة.
 */
class PublicPartnerController extends PublicApiController
{
    private const SORTS = ['name' => 'name', 'code' => 'code', 'created_at' => 'created_at'];

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search'    => ['sometimes', 'nullable', 'string', 'max:120'],
            'type'      => ['sometimes', 'nullable', 'in:customer,supplier'],
            'is_active' => ['sometimes', 'nullable', 'boolean'],
            'sort'      => ['sometimes', 'nullable', 'string', 'max:40'],
            'page'      => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page'  => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Partner::query();

        if (filled($filters['search'] ?? null)) {
            $like = $this->likeTerm((string) $filters['search']);
            $query->where(fn ($q) => $q
                ->where('name', 'like', $like)
                ->orWhere('name_en', 'like', $like)
                ->orWhere('code', 'like', $like)
                ->orWhere('vat_number', 'like', $like));
        }

        match ($filters['type'] ?? null) {
            'customer' => $query->whereIn('type', ['customer', 'both']),
            'supplier' => $query->whereIn('type', ['supplier', 'both']),
            default    => null,
        };

        if (array_key_exists('is_active', $filters) && $filters['is_active'] !== null && $filters['is_active'] !== '') {
            $query->where('is_active', filter_var($filters['is_active'], FILTER_VALIDATE_BOOLEAN));
        }

        $this->applySort($query, $filters['sort'] ?? null, self::SORTS, '-created_at');

        return PublicApiResponse::paginated($request, $query->paginate($this->perPage($request)), PublicPartnerResource::class);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        // استعلام معزول بالمستأجر: معرّف مستأجر آخر = «غير موجود» بلا كشف وجود.
        $partner = Partner::findOrFail($id);

        return PublicApiResponse::resource($request, new PublicPartnerResource($partner));
    }
}
