<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\Storefront;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\R2StorageService;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Http\Request;

/**
 * AWJ-STORE-CAT-DESIGN-01 — صورة تصنيفٍ محروسة لمعاينة مساحة عمل Commerce (Canvas: قسم «التصنيفات» في الصفحة الرئيسية).
 *
 * المشكلة: صورة التصنيف تُخدَّم للمتجر العام على `/store/v1/media/categories/{id}` المحسومة بالمضيف (نطاق المتجر)، وهو
 * مسارٌ لا يستطيع متصفّح التاجر (أصلٌ آخر، يُصادِق بـBearer من localStorage لا بكعكة) استدعاءه من `<img src>`. فكان
 * Canvas يعجز عن عرض صور التصنيفات الحقيقية، وبالتالي لا يعرض أثر `object-fit`/الموضع/الشكل بأمانة.
 *
 * **نموذج الثقة نفسه المعتمد في CUST-H4-8b لوسائط المنتج** (`CommerceWorkspaceMediaController`): رابطٌ موقَّعٌ قصير الأجل
 * (`URL::temporarySignedRoute`، ميزة Laravel القياسية) يُولَّد فقط داخل سياقٍ مُصادَقٍ بالكامل (`commerce.manage` +
 * `ownedStorefront()`) حين يبني `CommerceWorkspaceStorefrontCategoryController::index()` الحمولة؛ هذا المسار نفسه **بلا**
 * `auth:sanctum` فالتوقيع هو السلطة الوحيدة. لا يُكشف مسار التخزين، ولا يُمنح وصولٌ جديد: التصنيف يجب أن يكون
 * (أ) لمستأجر هذا المتجر، (ب) فعّالاً، (ج) منشوراً على قناة هذا المتجر تحديداً — وإلا 404 غير كاشف (لا فرق بين معرّفٍ
 * خاطئ وتصنيفٍ مخفيّ أو من مستأجر آخر). كلا الاستعلامين يتجاوز `TenantScope` صراحةً ويُحسم التطابق يدوياً (الطلب غير
 * مُصادَق فلا سياق مستأجر ضمنياً)، ويُضبط سياق المستأجر لحظة قراءة R2 فقط (مفتاح التخزين يُشتقّ منه).
 *
 * بايتات الصورة: السلطة نفسها التي يستعملها المتجر العام (`ServesCategoryImageBytes`) — لا قارئ موازٍ.
 */
class CommerceWorkspaceCategoryMediaController extends PublicApiController
{
    use ServesCategoryImageBytes;

    public function __construct(
        private readonly DocumentStorageService $documentStorage,
        private readonly R2StorageService $r2,
    ) {}

    public function show(Request $request, string $id, string $category)
    {
        $storefront = Storefront::query()
            ->withoutGlobalScope(TenantScope::class)
            ->find($id);

        if ($storefront === null) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $categoryModel = ProductCategory::query()
            ->withoutGlobalScope(TenantScope::class)
            ->withoutGlobalScope(BranchScope::class)
            ->where('tenant_id', $storefront->tenant_id)
            ->where('is_active', true)
            ->find($category);

        if ($categoryModel === null || ! $categoryModel->image_path) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $published = CommerceCategoryListing::query()
            ->withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $storefront->tenant_id)
            ->where('category_id', $categoryModel->id)
            ->where('sales_channel_id', $storefront->sales_channel_id)
            ->where('is_published', true)
            ->exists();

        if (! $published) {
            abort(404, 'الوسائط غير موجودة.');
        }

        // مفتاح R2 يُشتقّ من سياق المستأجر؛ الطلب غير مُصادَق فيُضبط هنا لهذا الاستدعاء وحده ثم يُترك كما وُجد.
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($storefront->tenant_id);
        try {
            return $this->streamCategoryImageBytes($categoryModel, $this->documentStorage, $this->r2, 'private, max-age=600');
        } finally {
            if ($previous === null) {
                $context->forget();
            } else {
                $context->set($previous);
            }
        }
    }
}
