<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceListing;
use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\ProductMedia;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\ProductMediaService;
use App\Services\R2StorageService;
use App\Tenancy\StorefrontContext;
use App\Tenancy\BranchScope;
use Aws\Exception\AwsException;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * Public storefront catalog — عرض وسائط منتج محروس (COM-7-P1).
 *
 * `ProductMedia.path`/`disk` لا يُكشفان في أي استجابة JSON عمداً (انظر
 * تعليق النموذج) — هذا المسار وحده يخدم البايتات، وفقط إن كان منتج الوسائط
 * منشوراً فعلاً على قناة المتجر المحلولة من الرابط. صورة منتج غير منشور لا
 * تُخدَّم حتى بمعرّف صحيح — 404 غير كاشف، لا فرق بين معرّف خاطئ ومنتج مخفيّ.
 *
 * **`disk = 'document'` ليس اسم قرص Laravel حقيقياً** (COM-MOBILE-MEDIA-1 —
 * اكتُشف أثناء بناء نظير `/commerce/v1`) — هو القيمة الحارسة التي يكتبها
 * `ProductMediaService::store()` (مسار الرفع الفعلي لكل وسائط المنتج/قيمة
 * الخيار/المتغيّر) لتعني «القرص الفعلي يُحسم ديناميكياً عبر
 * `DocumentStorageService`»، تماماً كما يحسمه `ProductController::downloadMedia()`
 * الداخلي فعلاً. `Storage::disk('document')` مباشرةً كان يفشل لكل وسائط منتجٍ
 * حقيقية مرفوعة عبر المسار القياسي — فرع القرص المباشر أدناه توافقٌ رجعي مع
 * سجلاتٍ قديمة محتملة فقط.
 */
class StorefrontMediaController extends PublicApiController
{
    use ServesProductMediaBytes;

    public function __construct(
        private readonly DocumentStorageService $documentStorage,
        private readonly R2StorageService $r2,
        private readonly ProductMediaService $productMedia,
    ) {}

    public function show(Request $request)
    {
        $media = $this->publishedMedia($request);
        return $this->streamProductMediaBytes($media, $this->documentStorage, $this->r2, 'public, max-age=3600');
    }

    /**
     * Public counterpart of the protected ERP derivative endpoint. The
     * derivative name is route-constrained; the resolved storage path is
     * deterministic server state, never request input. Missing derivatives
     * deliberately fall back to the original for legacy ProductMedia rows.
     */
    public function showDerivative(Request $request)
    {
        $media = $this->publishedMedia($request);
        $derivative = (string) $request->route('derivative');
        $path = $this->productMedia->existingDerivativePath($media, $derivative);

        if ($path === null) {
            return $this->streamProductMediaBytes($media, $this->documentStorage, $this->r2, 'public, max-age=3600');
        }

        return $this->streamProductMediaPath(
            $media,
            $path,
            $this->productMedia->derivativeDownloadName($media, $derivative),
            $this->productMedia->derivativeMimeType($media),
            $this->documentStorage,
            $this->r2,
            'public, max-age=3600',
        );
    }

    private function publishedMedia(Request $request): ProductMedia
    {
        // يُقرأ صراحةً من الطلب لا كوسيط مربوط بالاسم — انظر تعليق
        // StorefrontProductController::show().
        $id = (string) $request->route('id');
        $media = ProductMedia::query()->find($id);
        if ($media === null) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $isPublished = CommerceListing::query()
            ->where('product_id', $media->product_id)
            ->where('sales_channel_id', app(StorefrontContext::class)->salesChannelId())
            ->where('is_published', true)
            ->exists();

        if (! $isPublished) {
            abort(404, 'الوسائط غير موجودة.');
        }

        return $media;
    }

    /**
     * Serve a merchant category image only when that category is published on
     * the resolved storefront channel. The stored path is deliberately never
     * returned to the client and the same host/channel context gates the bytes.
     */
    public function showCategory(Request $request)
    {
        $id = (string) $request->route('id');
        $category = ProductCategory::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceCategoryListing::publishedOn(app(StorefrontContext::class)->salesChannelId())->select('category_id'))
            ->find($id);

        if ($category === null || ! $category->image_path) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $headers = [
            'Content-Type' => $category->image_mime_type ?: 'application/octet-stream',
            'Cache-Control' => 'public, max-age=3600',
        ];

        if (ProductCategory::isR2ImagePath($category->image_path)) {
            try {
                $body = $this->r2->get(
                    ProductCategory::R2_DOMAIN,
                    (string) $category->id,
                    basename($category->image_path),
                );
            } catch (RuntimeException|AwsException) {
                abort(404, 'الوسائط غير موجودة.');
            }

            return response()->streamDownload(function () use ($body): void {
                echo (string) $body;
            }, $category->image_original_name ?: "category-{$category->id}", $headers, 'inline');
        }

        try {
            $stream = $this->documentStorage->readStream(
                $this->documentStorage->profile(),
                $category->image_path,
            );
        } catch (RuntimeException) {
            abort(404, 'الوسائط غير موجودة.');
        }

        return response()->streamDownload(function () use ($stream): void {
            fpassthru($stream);
            fclose($stream);
        }, $category->image_original_name ?: "category-{$category->id}", $headers, 'inline');
    }
}
