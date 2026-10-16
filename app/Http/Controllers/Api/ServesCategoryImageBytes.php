<?php

namespace App\Http\Controllers\Api;

use App\Models\ProductCategory;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\R2StorageService;
use Aws\Exception\AwsException;
use RuntimeException;

/**
 * AWJ-STORE-CAT-DESIGN-01 — سلطة قراءة بايتات صورة تصنيف الواحدة، مُستخرجة حرفياً من
 * `StorefrontMediaController::showCategory()` (كانت تُنفَّذ فيه فقط) لتضيف حدّ ثقةٍ ثانياً
 * (`CommerceWorkspaceCategoryMediaController` — معاينة Canvas) بلا نسخةٍ موازية. **لا تغيير في السلوك**
 * لمسار المتجر العام: نفس الترتيب والشروط والرؤوس والرسائل؛ فقط `Cache-Control` يبقى بيد كل متحكّمٍ.
 *
 * المُستدعي مسؤولٌ عن إثبات سلطة المستأجر/النشر قبل الوصول إلى هنا؛ مسار التخزين لا يُقبل أبداً من العميل.
 */
trait ServesCategoryImageBytes
{
    protected function streamCategoryImageBytes(
        ProductCategory $category,
        DocumentStorageService $documentStorage,
        R2StorageService $r2,
        string $cacheControl,
    ) {
        if (! $category->image_path) {
            abort(404, 'الوسائط غير موجودة.');
        }

        $headers = [
            'Content-Type' => $category->image_mime_type ?: 'application/octet-stream',
            'Cache-Control' => $cacheControl,
            'X-Content-Type-Options' => 'nosniff',
        ];

        if (ProductCategory::isR2ImagePath($category->image_path)) {
            try {
                $body = $r2->get(
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
            $stream = $documentStorage->readStream(
                $documentStorage->profile(),
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
