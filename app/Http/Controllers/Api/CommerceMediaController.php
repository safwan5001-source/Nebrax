<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceListing;
use App\Models\ProductMedia;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-MEDIA-1
 * ═══════════════════════════════════════════════════════════════
 *  يخدم بايتات وسائط المنتج لتصفّح الجوال الموثوق، بنفس عقد الحراسة الحرفي
 *  الذي يفرضه `StorefrontMediaController` على `/store/v1` — نفس نموذج
 *  `ProductMedia` وسلطة التخزين نفسها، لا سلطة موازية: الفرق الوحيد هو حدّ
 *  الثقة (bearer/ApiClient + قناة الجوال المحلولة بدل نطاق/شريحة متجر ويب).
 *
 *  **`Cache-Control: private`، لا `public` كنظيرها في `/store/v1`:** ذاك مسارٌ
 *  مجهولٌ بلا `Authorization` أصلاً، فـ`public` آمنة هناك — أي طرفٍ يطلب نفس
 *  الرابط يحصل على نفس الحق أصلاً. هذا المسار محروسٌ بـ`bearer` (`ApiClient`)
 *  + قناة/نشر مُحلّين؛ ذاكرة تخزين مؤقت مشتركة (وسيط/CDN) تُكرِّم `public` قد
 *  تُعيد تقديم الاستجابة لطالبٍ آخر بلا إعادة التحقّق من العميل/القناة/الاشتراك،
 *  وتُبقي البايتات المخزَّنة متاحةً حتى بعد إلغاء نشر المنتج أو إبطال العميل.
 *
 *  الحراسة (مطابقة تماماً لتوثيق الفجوة في `CommerceProductController`):
 *   1. `ProductMedia::query()->find($id)` — معزول تلقائياً بـ`TenantScope`
 *      (يضبطه `AuthenticateApiClient` من عميل الـ API الموثَّق، لا من مدخل
 *      عميل) فمعرّف وسائط مستأجرٍ آخر لا يُحلّ من الأساس.
 *   2. نشرٌ فعلي: صفّ `CommerceListing` منشور لمنتج هذه الوسائط على القناة
 *      المحلولة تحديداً (`StorefrontContext::salesChannelId()`، تضبطها
 *      `ResolveCommerceChannel`/`MobileSalesChannelResolver` — قناة الجوال
 *      النشطة الوحيدة لهذا المستأجر، لا قيمة من العميل). منتجٌ غير منشور أو
 *      منشورٌ على قناةٍ أخرى (مثلاً `web` فقط) لا يُخدَّم هنا.
 *  فشل أي شرطٍ → 404 غير كاشف موحَّد، لا فرق بين معرّف خاطئ ووسائط محجوبة.
 *
 *  **`disk = 'document'` ليس اسم قرص Laravel حقيقياً** — هو القيمة الحارسة
 *  التي يكتبها `ProductMediaService::store()` (مسار الرفع الفعلي لكل وسائط
 *  المنتج/قيمة الخيار/المتغيّر) لتعني «القرص الفعلي يُحسم ديناميكياً عبر
 *  `DocumentStorageService`»، تماماً كما يحسمه `ProductController::downloadMedia()`
 *  الداخلي فعلاً. `Storage::disk('document')` مباشرةً يفشل (لا قرص بهذا الاسم
 *  في `config/filesystems.php`) لكل وسائط منتجٍ حقيقية مرفوعة عبر المسار
 *  القياسي — لا فرع القرص المباشر أدناه إلا توافقاً رجعياً مع سجلاتٍ قديمة
 *  محتملة كتبت مباشرةً على قرصٍ مسمّى.
 */
class CommerceMediaController extends PublicApiController
{
    public function __construct(private readonly DocumentStorageService $documentStorage) {}

    public function show(Request $request)
    {
        $id = (string) $request->route('id');

        $media = ProductMedia::query()->find($id);
        if ($media === null) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $storefront = app(StorefrontContext::class);

        $isPublished = CommerceListing::query()
            ->where('product_id', $media->product_id)
            ->where('sales_channel_id', $storefront->salesChannelId())
            ->where('is_published', true)
            ->exists();

        if (! $isPublished) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $headers = [
            'Content-Type' => $media->mime_type ?? 'application/octet-stream',
            'Cache-Control' => 'private, max-age=3600',
        ];

        if ($media->disk === 'document') {
            try {
                $stream = $this->documentStorage->readStream($this->documentStorage->profile(), $media->path);
            } catch (RuntimeException) {
                abort(404, 'الوسائط غير موجودة.');
            }

            return response()->streamDownload(function () use ($stream): void {
                fpassthru($stream);
                fclose($stream);
            }, $media->original_name, $headers, 'inline');
        }

        // توافق قراءة فقط مع سجلاتٍ قديمة محتملة كتبت مباشرةً على قرصٍ مسمّى
        // (راجع تعليق الصنف أعلاه) — يطابق `ProductController::downloadMedia()` حرفياً.
        $disk = Storage::disk($media->disk);
        if (! $disk->exists($media->path)) {
            abort(404, 'الوسائط غير موجودة.');
        }

        return $disk->response($media->path, $media->original_name, $headers);
    }
}
