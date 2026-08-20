<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreClassificationRequest;
use App\Http\Resources\ClassificationResource;
use App\Models\Classification;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ClassificationController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $scope = $request->query('scope');
        abort_unless(in_array($scope, Classification::SCOPES, true), 422, 'يجب تحديد نطاق تصنيف صالح.');

        return ClassificationResource::collection(
            Classification::query()
                ->where('scope', $scope)
                ->withCount(['customerPartners', 'supplierPartners', 'invoices', 'purchases', 'payments'])
                ->orderBy('name')
                ->get()
        )->response();
    }

    public function store(StoreClassificationRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['scope'], $data['name']);

        $classification = Classification::create([
            'scope' => $data['scope'],
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new ClassificationResource($classification))->response()->setStatusCode(201);
    }

    public function update(StoreClassificationRequest $request, string $id): JsonResponse
    {
        $classification = Classification::findOrFail($id);
        $data = $request->validated();

        if ($data['scope'] !== $classification->scope) {
            abort(422, 'لا يمكن تغيير نطاق التصنيف بعد إنشائه. أنشئ تصنيفاً جديداً بالنطاق المطلوب.');
        }

        $this->assertNameFree($classification->scope, $data['name'], $classification->id);
        $classification->update([
            'name' => $data['name'],
            'description' => array_key_exists('description', $data) ? $data['description'] : $classification->description,
            'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : $classification->is_active,
        ]);

        return (new ClassificationResource($classification))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $classification = Classification::withCount([
            'customerPartners', 'supplierPartners', 'invoices', 'purchases', 'payments',
        ])->findOrFail($id);

        $uses = (int) $classification->customer_partners_count
            + (int) $classification->supplier_partners_count
            + (int) $classification->invoices_count
            + (int) $classification->purchases_count
            + (int) $classification->payments_count;

        if ($uses > 0) {
            abort(422, "لا يمكن حذف التصنيف: مرتبط بـ {$uses} سجلّاً. عطّله بدلاً من ذلك.");
        }

        $classification->delete();

        return response()->json(['message' => 'deleted']);
    }

    private function assertNameFree(string $scope, string $name, ?string $exceptId = null): void
    {
        $query = BranchScope::reference(Classification::class)
            ->where('scope', $scope)
            ->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد تصنيف بهذا الاسم ضمن النطاق نفسه.');
        }
    }
}
