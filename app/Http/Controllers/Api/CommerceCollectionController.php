<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceCollection;
use App\Services\Commerce\CommerceCollectionService;
use App\Services\Commerce\CommerceTaxonomyConflictException;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — إدارة المجموعات التسويقية. سطح إداري للمستأجر الحالي
 * فقط؛ `{id}` محدِّد صفّ والملكية عبر `TenantScope` (404 غير كاشف عند الاختلاف).
 */
final class CommerceCollectionController extends ApiController
{
    private const SLUG = 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public function index(Request $request, CommerceCollectionService $collections): JsonResponse
    {
        $this->denySelfService($request);

        return response()->json(['data' => ['collections' => $collections->list()]]);
    }

    public function store(Request $request, CommerceCollectionService $collections): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'title' => ['required', 'string', 'max:160', 'regex:/\S/'],
            'title_en' => ['sometimes', 'nullable', 'string', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:64', self::SLUG],
            'status' => ['sometimes', 'string', Rule::in(CommerceCollection::STATUSES)],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ]);

        return response()->json(['data' => ['collection' => $this->guard(fn () => $collections->create($data))]], 201);
    }

    public function update(Request $request, CommerceCollectionService $collections, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:160', 'regex:/\S/'],
            'title_en' => ['sometimes', 'nullable', 'string', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'slug' => ['sometimes', 'string', 'max:64', self::SLUG],
            'status' => ['sometimes', 'string', Rule::in(CommerceCollection::STATUSES)],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ]);

        $collection = $this->guard(fn () => $collections->update($id, $data));
        abort_if($collection === null, 404, 'المجموعة غير موجودة.');

        return response()->json(['data' => ['collection' => $collection]]);
    }

    public function destroy(Request $request, CommerceCollectionService $collections, string $id): JsonResponse
    {
        $this->denySelfService($request);
        abort_if($collections->delete($id) === null, 404, 'المجموعة غير موجودة.');

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function members(Request $request, CommerceCollectionService $collections, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $members = $collections->members($id);
        abort_if($members === null, 404, 'المجموعة غير موجودة.');

        return response()->json(['data' => ['products' => $members]]);
    }

    public function replaceMembers(Request $request, CommerceCollectionService $collections, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'product_ids' => ['present', 'array', 'max:'.CommerceCollectionService::MAX_MEMBERS],
            'product_ids.*' => ['string', 'uuid', 'distinct'],
        ]);

        $members = $this->guard(fn () => $collections->replaceMembers($id, array_values($data['product_ids'])));
        abort_if($members === null, 404, 'المجموعة غير موجودة.');

        return response()->json(['data' => ['products' => $members]]);
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
            abort(403, 'إدارة المجموعات غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
