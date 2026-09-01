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
 * يسجّل طبقة الـ Public API (v1) كطبقة **إضافية مستقلة** عن الـ Internal API.
 *
 * الفصل:
 *  - بادئة `/api/v1` مستقلة — لا تصادم مع مسارات `/api` الداخلية (بلا إصدار).
 *  - مجموعة وسائط خاصة (ForceJsonResponse + PublicApiRequestContext) لا تشترك
 *    مع مجموعات الـ Internal API في `routes/api.php`.
 *  - ملف مسارات منفصل `routes/api_public.php` لا يُحمَّل ضمن `withRouting` الداخلي.
 *  - عقد أخطاء خاص عبر renderable callback **محصور في `api/v1/*`**، فلا يتغيّر
 *    أيّ سلوك لأخطاء الـ Internal API.
 *
 * التسجيل: يُضاف هذا المزوّد إلى `bootstrap/providers.php` عبر سكربتات التجميع
 * (setup.sh · ci.yml · deploy/assemble.sh) بنفس نمط TenancyServiceProvider.
 *
 * قابلية التوسّع (PR-2+): يُبنى فوق هذا الأساس دون إعادة بنائه — تُضاف مصادقة
 * مفتاح الـ API وضبط المستأجر والحارس fail-closed وفحص الـ scope كمجموعة داخلية.
 */
class PublicApiServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->registerPublicApiRoutes();
        $this->registerPublicApiExceptionRendering();
    }

    private function registerPublicApiRoutes(): void
    {
        // تحت route:cache تُحمَّل المسارات من الذاكرة المؤقتة، فلا نعيد تسجيلها.
        if ($this->app->routesAreCached()) {
            return;
        }

        Route::middleware([ForceJsonResponse::class, PublicApiRequestContext::class])
            ->prefix('api/v1')
            ->as('public.v1.')
            ->group(base_path('routes/api_public.php'));
    }

    /**
     * عقد الأخطاء العام: renderable callback يُطبَّق **فقط** على مسارات api/v1.
     * يعيد null لغيرها فتتولّاها المعالجة الافتراضية — الـ Internal API لا يتأثر.
     */
    private function registerPublicApiExceptionRendering(): void
    {
        $handler = $this->app->make(ExceptionHandler::class);

        // في Laravel 11 المعالج الافتراضي يملك renderable()؛ حارس دفاعي لا أكثر.
        if (! method_exists($handler, 'renderable')) {
            return;
        }

        $handler->renderable(function (Throwable $e, Request $request) {
            if (! $request->is('api/v1/*')) {
                return null;
            }

            return PublicApiExceptionRenderer::render($e, $request);
        });
    }
}
