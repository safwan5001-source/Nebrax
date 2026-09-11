<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceListing;
use App\Models\ProductMedia;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Public storefront catalog — عرض وسائط منتج محروس (COM-7-P1).
 *
 * `ProductMedia.path`/`disk` لا يُكشفان في أي استجابة JSON عمداً (انظر
 * تعليق النموذج) — هذا المسار وحده يخدم البايتات، وفقط إن كان منتج الوسائط
 * منشوراً فعلاً على قناة المتجر المحلولة من الرابط. صورة منتج غير منشور لا
 * تُخدَّم حتى بمعرّف صحيح — 404 غير كاشف، لا فرق بين معرّف خاطئ ومنتج مخفيّ.
 */
class StorefrontMediaController extends PublicApiController
{
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

        $disk = Storage::disk($media->disk);
        if (! $disk->exists($media->path)) {
            abort(404, 'الوسائط غير موجودة.');
        }

        return $disk->response($media->path, $media->original_name, [
            'Content-Type' => $media->mime_type ?? 'application/octet-stream',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }
}
