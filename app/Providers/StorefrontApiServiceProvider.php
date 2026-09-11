<?php

namespace App\Providers;

use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
use App\Support\PublicApiExceptionRenderer;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Throwable;

/**
 * يسجّل طبقة Storefront Public Catalog API (COM-7-P1) كطبقة إضافية مستقلة.
 *
 * الفصل (بنفس نمط PublicApiServiceProvider):
 *  - بادئة `/store/v1` مستقلة — لا تصادم مع `/api` الداخلي ولا `/api/v1`
 *    (M2M) ولا `/customer/v1` (عميل مصادَق).
 *  - مجموعة وسائط مشتركة عامّة فقط (ForceJsonResponse + PublicApiRequestContext)
 *    — كلاهما عامّان بلا أي افتراض M2M، يُعاد استخدامهما بأمان.
 *  - ملف مسارات منفصل `routes/api_storefront.php` لا يُحمَّل ضمن `withRouting`
 *    الداخلي ولا ضمن مزوّد الـ Public API الحالي — لا تعديل على ذاك المزوّد
 *    أو ملفه إطلاقاً.
 *  - عقد أخطاء موحّد (نفس `PublicApiExceptionRenderer`) محصور في `store/v1/*`.
 *
 * التسجيل: يُضاف إلى `bootstrap/providers.php` عبر سكربتات التجميع
 * (setup.sh · ci.yml) بنفس نمط PublicApiServiceProvider.
 */
class StorefrontApiServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->registerStorefrontApiRoutes();
        $this->registerStorefrontApiExceptionRendering();
    }

    private function registerStorefrontApiRoutes(): void
    {
        if ($this->app->routesAreCached()) {
            return;
        }

        Route::middleware([ForceJsonResponse::class, PublicApiRequestContext::class])
            ->prefix('store/v1')
            ->as('storefront.v1.')
            ->group(base_path('routes/api_storefront.php'));
    }

    private function registerStorefrontApiExceptionRendering(): void
    {
        $handler = $this->app->make(ExceptionHandler::class);

        if (! method_exists($handler, 'renderable')) {
            return;
        }

        $handler->renderable(function (Throwable $e, Request $request) {
            if (! $request->is('store/v1/*')) {
                return null;
            }

            return PublicApiExceptionRenderer::render($e, $request);
        });
    }
}
