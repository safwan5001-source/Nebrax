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
    public function __construct(private readonly DocumentStorageService $documentStorage) {}

    public function show(Request $request)
    {
        // يُقرأ صراحةً من الطلب لا كوسيط مربوط بالاسم — انظر تعليق
        // StorefrontProductController::show().
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
            'Cache-Control' => 'public, max-age=3600',
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
