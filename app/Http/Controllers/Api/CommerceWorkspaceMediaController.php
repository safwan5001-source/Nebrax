<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceListing;
use App\Models\ProductMedia;
use App\Models\Storefront;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\R2StorageService;
use App\Tenancy\TenantScope;
use Illuminate\Http\Request;

/**
 * CUST-H4-8b — وسائط منتجٍ محروسة لمعاينة مساحة عمل Commerce (Canvas: وصل
 * حديثاً/مميّزة/عروض). المشكلة التي يغلقها: `CommerceWorkspaceStorefrontProductController`
 * و`StorefrontOfferResource::workspace()` كانا يبنيان `thumbnail_url` بعنوان
 * `/commerce/v1/media/{id}` — حدّ ثقة الجوال (`bearer`/`ApiClient`)، الذي لا
 * يستطيع `<img src>` عادي في متصفح التاجر تزويده بترويسة Authorization (تقرير
 * CUST-H4-8 §15، B1). واجهة الويب (`web/`) نفسها تُصادِق بـ`Authorization: Bearer`
 * من `localStorage` لا بكعكة جلسة (`web/src/lib/api.ts`) — فلا كعكةٌ متاحةٌ
 * أصلاً يحملها طلب `<img>` العادي لهذا المسار.
 *
 * **نموذج الثقة المختار: رابطٌ موقَّعٌ قصير الأجل** (`URL::temporarySignedRoute`،
 * ميزة Laravel القياسية لا اختراعاً) — يُولَّد فقط داخل السياق المُصادَق
 * بالكامل (`auth:sanctum` + `commerce.manage` + `ownedStorefront()`) حين يبني
 * الخادم حمولة المنتجات/العروض، لا يُكشَف توكن Bearer الفعلي أبداً، والمسار
 * هنا نفسه **بلا** `auth:sanctum` — التوقيع هو السلطة الوحيدة فيُحمَّل بوسم
 * `<img src>` عادي بلا أي طبقة JS/blob. انتهاء صلاحيةٍ قصير (دقائق) يحدّ
 * التعرّض دون كسر تحميل الصفحة الفعلي؛ كل تحميل قائمةٍ جديد يُصدِر روابط
 * جديدة، فلا حاجة لتخزينٍ طويل الأجل لرابطٍ واحد.
 *
 * **لا `TenantContext`/`SetTenant` هنا** — الطلب غير مُصادَق أصلاً، فكلا
 * الاستعلامين أدناه يتجاوز `TenantScope` صراحةً ويُحسَم تطابق المستأجر يدوياً
 * (دفاعٌ في العمق مطابقٌ لما توثّقه `ProductMedia`/الوسائط الأخرى، لا اعتماداً
 * ضمنياً على غياب سياقٍ نشط).
 *
 * **إعادة استخدام كاملة لسلطة التخزين**: `ServesProductMediaBytes` (المُستخرجة
 * من `CommerceMediaController`/`StorefrontMediaController` لهذه المهمة بالذات)
 * — لا سلطة قراءة بايتات موازية رابعة.
 */
class CommerceWorkspaceMediaController extends PublicApiController
{
    use ServesProductMediaBytes;

    public function __construct(
        private readonly DocumentStorageService $documentStorage,
        private readonly R2StorageService $r2,
    ) {}

    public function show(Request $request, string $id, string $media)
    {
        $storefront = Storefront::query()
            ->withoutGlobalScope(TenantScope::class)
            ->find($id);

        if ($storefront === null) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $mediaModel = ProductMedia::query()
            ->withoutGlobalScope(TenantScope::class)
            ->find($media);

        if ($mediaModel === null || $mediaModel->tenant_id !== $storefront->tenant_id) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $isEligible = CommerceListing::query()
            ->where('product_id', $mediaModel->product_id)
            ->where('sales_channel_id', $storefront->sales_channel_id)
            ->where('is_published', true)
            ->exists();

        if (! $isEligible) {
            abort(404, 'الوسائط غير موجودة.');
        }

        return $this->streamProductMediaBytes($mediaModel, $this->documentStorage, $this->r2, 'private, max-age=600');
    }
}
