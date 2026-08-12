<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreUnitTemplateRequest;
use App\Http\Resources\UnitTemplateResource;
use App\Models\UnitTemplate;
use App\Models\UnitTemplateUnit;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * قوالب الوحدات — وحدة أساس ووحدات بديلة بمعاملات صحيحة.
 *
 * **لا يولّد قيداً**، لكنه ليس بلا أثر محاسبي: المعامل يضرب الكمية الداخلة إلى
 * المخزون فيصيب أو يخطئ متوسط التكلفة. لذلك التعديل هنا **لا يعيد تفسير مستند
 * مرحَّل**: السطر ينسخ (الاسم، المعامل) وقت الإنشاء ولا يشير إلى القالب.
 */
class UnitTemplateController extends ApiController
{
    public function index(): JsonResponse
    {
        return UnitTemplateResource::collection(
            UnitTemplate::with('units')->withCount('products')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreUnitTemplateRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $template = $this->domain(fn () => DB::transaction(function () use ($data) {
            $template = UnitTemplate::create([
                'name'      => $data['name'],
                'base_unit' => $data['base_unit'],
                'is_active' => $data['is_active'] ?? true,
            ]);
            $this->syncUnits($template, $data);

            return $template;
        }));

        return (new UnitTemplateResource($template->load('units')))->response()->setStatusCode(201);
    }

    public function update(StoreUnitTemplateRequest $request, string $id): JsonResponse
    {
        $template = UnitTemplate::findOrFail($id);
        $data     = $request->validated();
        $this->assertNameFree($data['name'], $template->id);

        $this->domain(fn () => DB::transaction(function () use ($template, $data) {
            $template->update([
                'name'      => $data['name'],
                'base_unit' => $data['base_unit'],
                'is_active' => $data['is_active'] ?? $template->is_active,
            ]);

            // الوحدات تُستبدَل كاملةً: القائمة المرسَلة هي الحالة المطلوبة.
            // المستندات المرحَّلة لا تتأثّر — نسخت معاملها وقت إنشائها.
            $template->units()->delete();
            $this->syncUnits($template, $data);
        }));

        return (new UnitTemplateResource($template->fresh('units')))->response();
    }

    /** القالب المستعمَل لا يُحذف — منتجٌ بلا قالب يفقد وحداته بلا سبب مفهوم. */
    public function destroy(string $id): JsonResponse
    {
        $template = UnitTemplate::withCount('products')->findOrFail($id);

        if ($template->products_count > 0) {
            abort(422, "لا يمكن حذف القالب: مرتبط بـ {$template->products_count} منتجاً.");
        }

        $template->units()->delete();
        $template->delete();

        return response()->json(['message' => 'deleted']);
    }

    /**
     * يكتب الوحدات البديلة. **وحدة باسم الأساس تُرفض**: معاملان لوحدة واحدة
     * يجعلان `factorFor` تُرجع ١ أبداً بينما تعرض الشاشة غيره — تناقضٌ صامت
     * ينتهي بكمية خاطئة في المخزون.
     */
    private function syncUnits(UnitTemplate $template, array $data): void
    {
        $seen = [];

        foreach ($data['units'] ?? [] as $unit) {
            $name = trim($unit['name']);

            if ($name === $template->base_unit) {
                abort(422, 'لا تُضاف وحدة الأساس ضمن الوحدات البديلة — معاملها ١ ضمناً.');
            }
            if (isset($seen[$name])) {
                abort(422, "الوحدة «{$name}» مكرّرة في القالب.");
            }
            $seen[$name] = true;

            UnitTemplateUnit::create([
                'unit_template_id' => $template->id,
                'name'             => $name,
                'factor'           => (int) $unit['factor'],
            ]);
        }
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = BranchScope::reference(UnitTemplate::class)->where('name', $name);

        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد قالب وحدات بهذا الاسم.');
        }
    }
}
