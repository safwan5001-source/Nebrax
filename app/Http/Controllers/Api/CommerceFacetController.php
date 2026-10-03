<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceFacet;
use App\Models\Product;
use App\Services\Commerce\CommerceFacetService;
use App\Services\Commerce\CommerceTaxonomyConflictException;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * FLOWERS-H2 / ADR-14 — إدارة الأبعاد الوصفية للكتالوج التجاري (مناسبة، مُهدى
 * إليه، نوع الزهرة…) وإسنادها للمنتجات. سطح إداري للمستأجر الحالي فقط؛ لا
 * معرّف مستأجر من العميل. `{id}` يحدّد صفاً فقط، والملكية عبر `TenantScope`:
 * صفٌّ غير موجود أو يخص مستأجراً آخر → 404 غير كاشف.
 */
final class CommerceFacetController extends ApiController
{
    private const SLUG = 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public function index(Request $request, CommerceFacetService $facets): JsonResponse
    {
        $this->denySelfService($request);

        return response()->json(['data' => ['facets' => $facets->list()]]);
    }

    public function store(Request $request, CommerceFacetService $facets): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'key' => ['required', 'string', 'max:64', self::SLUG],
            'system_key' => ['sometimes', 'nullable', 'string', Rule::in(CommerceFacet::SYSTEM_KEYS)],
            'name' => ['required', 'string', 'max:120', 'regex:/\S/'],
            'name_en' => ['sometimes', 'nullable', 'string', 'max:120'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return response()->json(['data' => ['facet' => $this->guard(fn () => $facets->createFacet($data))]], 201);
    }

    public function update(Request $request, CommerceFacetService $facets, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120', 'regex:/\S/'],
            'name_en' => ['sometimes', 'nullable', 'string', 'max:120'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $facet = $this->guard(fn () => $facets->updateFacet($id, $data));
        abort_if($facet === null, 404, 'البُعد غير موجود.');

        return response()->json(['data' => ['facet' => $facet]]);
    }

    public function destroy(Request $request, CommerceFacetService $facets, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $deleted = $this->guard(fn () => $facets->deleteFacet($id));
        abort_if($deleted === null, 404, 'البُعد غير موجود.');

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function storeValue(Request $request, CommerceFacetService $facets, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120', 'regex:/\S/'],
            'name_en' => ['sometimes', 'nullable', 'string', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:64', self::SLUG],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $value = $this->guard(fn () => $facets->createValue($id, $data));
        abort_if($value === null, 404, 'البُعد غير موجود.');

        return response()->json(['data' => ['value' => $value]], 201);
    }

    public function updateValue(Request $request, CommerceFacetService $facets, string $id, string $valueId): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120', 'regex:/\S/'],
            'name_en' => ['sometimes', 'nullable', 'string', 'max:120'],
            'slug' => ['sometimes', 'string', 'max:64', self::SLUG],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $value = $this->guard(fn () => $facets->updateValue($id, $valueId, $data));
        abort_if($value === null, 404, 'القيمة غير موجودة.');

        return response()->json(['data' => ['value' => $value]]);
    }

    public function destroyValue(Request $request, CommerceFacetService $facets, string $id, string $valueId): JsonResponse
    {
        $this->denySelfService($request);
        $deleted = $this->guard(fn () => $facets->deleteValue($id, $valueId));
        abort_if($deleted === null, 404, 'القيمة غير موجودة.');

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function productAssignments(Request $request, CommerceFacetService $facets, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['value_ids' => $facets->assignedValueIds($product)]]);
    }

    public function replaceProductAssignments(Request $request, CommerceFacetService $facets, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'value_ids' => ['present', 'array', 'max:'.CommerceFacetService::MAX_ASSIGNMENTS_PER_PRODUCT],
            'value_ids.*' => ['string', 'uuid', 'distinct'],
        ]);
        $product = Product::query()->findOrFail($id);

        return response()->json([
            'data' => ['value_ids' => $this->guard(fn () => $facets->replaceAssignments($product, array_values($data['value_ids'])))],
        ]);
    }

    private function guard(callable $callback): mixed
    {
        try {
            return $callback();
        } catch (CommerceTaxonomyConflictException $e) {
            abort(409, $e->getMessage());
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة تصنيف الكتالوج غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
