<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateBranchSettingsRequest;
use App\Models\Branch;
use App\Support\BranchSettings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات الفروع: الفرع الرئيسي + مفاتيح مشاركة البيانات.
 * تفضيلات غير محاسبية في `tenants.settings['branches']` — لا تولّد قيوداً.
 */
class BranchSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => BranchSettings::current()]);
    }

    public function update(UpdateBranchSettingsRequest $request): JsonResponse
    {
        $data = $request->validated();

        // الفرع الرئيسي يجب أن يكون فرعاً يخصّ هذا المستأجر.
        $this->assertTenantOwned(Branch::class, $data['main_branch_id'] ?? null, 'الفرع');

        return response()->json(['data' => BranchSettings::merge($data)]);
    }
}
