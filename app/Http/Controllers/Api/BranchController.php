<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreBranchRequest;
use App\Http\Resources\BranchResource;
use App\Models\Branch;
use App\Support\BranchSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class BranchController extends ApiController
{
    public function index(): JsonResponse
    {
        return BranchResource::collection(Branch::orderBy('code')->get())
            ->additional(['main_branch_id' => BranchSettings::current()['main_branch_id']])
            ->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new BranchResource(Branch::findOrFail($id)))->response();
    }

    public function store(StoreBranchRequest $request): JsonResponse
    {
        $data = $request->validated();

        // `is_main` لا يُقبل من المدخل — يتغيّر حصراً من «إعدادات الفروع».
        unset($data['is_main']);

        // التوليد داخل المعاملة: قفل المِرساة لا يُسلسِل شيئاً خارجها.
        $branch = DB::transaction(function () use ($data) {
            $code = $this->uniqueCode($data['code'] ?? null);

            return Branch::create([...$data, 'code' => $code]);
        });

        // يصير رئيسياً **فقط** إن لم يكن للمؤسسة فرع رئيسي بعد (أول فرع).
        // إضافة فرع لاحق لا تمسّ الرئيسي إطلاقاً.
        $branch->claimMainIfNone();

        return (new BranchResource($branch))->response()->setStatusCode(201);
    }

    public function update(StoreBranchRequest $request, string $id): JsonResponse
    {
        $branch = Branch::findOrFail($id);
        $data   = $request->validated();
        unset($data['is_main']); // لا يتغيّر من نموذج الفرع — بل من الإعدادات

        if (! empty($data['code']) && $data['code'] !== $branch->code) {
            $data['code'] = $this->uniqueCode($data['code'], $branch->id);
        } else {
            unset($data['code']);
        }

        $branch->update($data);

        return (new BranchResource($branch->fresh()))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $branch = Branch::findOrFail($id);

        if ($branch->is_main) {
            abort(422, 'لا يمكن حذف الفرع الرئيسي — عيّن فرعاً رئيسياً آخر أولاً.');
        }

        $branch->delete();

        return response()->json(['message' => 'deleted']);
    }

    /** كود فريد داخل المستأجر: المُعطى إن كان متاحاً، وإلا التسلسلي التالي. */
    private function uniqueCode(?string $code, ?string $exceptId = null): string
    {
        $code = trim((string) $code);
        if ($code === '') {
            return Branch::nextCode();
        }

        $taken = Branch::where('code', $code)
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();

        if ($taken) {
            abort(422, 'كود الفرع مستخدم مسبقاً.');
        }

        return $code;
    }
}
