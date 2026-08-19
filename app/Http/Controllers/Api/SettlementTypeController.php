<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreSettlementTypeRequest;
use App\Http\Resources\SettlementTypeResource;
use App\Models\SettlementType;
use Illuminate\Http\JsonResponse;

/**
 * أنواع التسوية بيانات رئيسية مشتركة للمؤسسة. لا تُنشئ قيوداً ولا تتحكم في
 * الحسابات المدينة؛ يستخدمها الآن مسار تسويات العُهَد دون أن يفرض حساباً بعينه.
 */
class SettlementTypeController extends ApiController
{
    public function index(): JsonResponse
    {
        return SettlementTypeResource::collection(
            SettlementType::query()
                ->withCount('custodySettlements as settlements_count')
                ->orderBy('name')
                ->get()
        )->response();
    }

    public function store(StoreSettlementTypeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $name = trim($data['name']);
        $this->assertNameFree($name);

        $type = SettlementType::create([
            'name' => $name,
            'description' => $data['description'] ?? null,
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new SettlementTypeResource($type))->response()->setStatusCode(201);
    }

    public function update(StoreSettlementTypeRequest $request, string $id): JsonResponse
    {
        $type = SettlementType::findOrFail($id);
        $data = $request->validated();
        $name = trim($data['name']);
        $this->assertNameFree($name, $type->id);

        $type->update([
            'name' => $name,
            'description' => array_key_exists('description', $data) ? $data['description'] : $type->description,
            'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : $type->is_active,
        ]);

        return (new SettlementTypeResource($type))->response();
    }

    /** لا يحذف النوع المستخدم في سجلات تسوية؛ التعطيل يبقي الأثر التدقيقي قابلاً للقراءة. */
    public function destroy(string $id): JsonResponse
    {
        $type = SettlementType::findOrFail($id);
        if ($type->custodySettlements()->exists()) {
            abort(422, 'لا يمكن حذف نوع تسوية مرتبط بسجلات. عطّله بدلاً من ذلك.');
        }

        $type->delete();

        return response()->json(['message' => 'deleted']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = SettlementType::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد نوع تسوية بهذا الاسم.');
        }
    }
}
