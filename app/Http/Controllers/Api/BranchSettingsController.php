<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateBranchSettingsRequest;
use App\Models\Branch;
use App\Models\Product;
use App\Support\BranchSettings;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

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
        $this->assertProductSharingCanBeEnabled($data);

        return response()->json(['data' => BranchSettings::merge($data)]);
    }

    /**
     * عند فصل المنتجات، يجوز أن يستعمل فرعان SKU نفسه. إعادة المشاركة لا تدمج
     * السجلات ولا تعيد إسناد تاريخها؛ لذلك تُرفض حتى يزيل المستخدم التعارض.
     */
    private function assertProductSharingCanBeEnabled(array $data): void
    {
        $isEnabling = array_key_exists('share_products', $data)
            && $data['share_products'] === true
            && BranchSettings::sharing()['share_products'] === false;

        if (! $isEnabling) {
            return;
        }

        $duplicateSku = Product::withoutGlobalScope(BranchScope::class)
            ->whereNotNull('sku')
            ->whereNull('deleted_at')
            ->select('sku')
            ->groupBy('sku')
            ->havingRaw('COUNT(*) > 1')
            ->orderBy('sku')
            ->value('sku');

        if ($duplicateSku === null) {
            return;
        }

        throw ValidationException::withMessages([
            'share_products' => "لا يمكن تفعيل مشاركة المنتجات: رمز المنتج {$duplicateSku} مكرر بين الفروع. وحّد الكتالوج أو غيّر أحد الرموز أولاً.",
        ]);
    }
}
