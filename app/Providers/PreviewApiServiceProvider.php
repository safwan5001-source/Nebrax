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
 * ═══════════════════════════════════════════════════════════════
 *  Preview API V1 — MOBILE-PREVIEW-6
 * ═══════════════════════════════════════════════════════════════
 *
 * يسجّل `/preview/v1/*` كطبقة ثقة مستقلة تماماً عن `/commerce/v1` و`/api/v1`
 * — نفس بنية `CommerceApiServiceProvider` حرفياً (بادئة خاصة، ملف مسارات
 * خاص، عارض استثناءات مقيَّد بنطاقها)، لأن هذا بالضبط ما تنصّ عليه
 * `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §11:
 * "a new, dedicated preview/v1 surface — deliberately not nested under
 * commerce/v1".
 *
 * لا `ResolveCommerceLocale` هنا: `preview/v1` يعيد اللقطة المجمَّدة كما
 * أُصدرت (لا نصّاً يُترجَم وقت الاستجابة)، فلا حاجة لحلّ لغة الطلب.
 */
class PreviewApiServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->registerPreviewApiRoutes();
        $this->registerPreviewApiExceptionRendering();
    }

    private function registerPreviewApiRoutes(): void
    {
        if ($this->app->routesAreCached()) {
            return;
        }

        Route::middleware([ForceJsonResponse::class, PublicApiRequestContext::class])
            ->prefix('preview/v1')
            ->as('preview.v1.')
            ->group(base_path('routes/api_preview.php'));
    }

    private function registerPreviewApiExceptionRendering(): void
    {
        $handler = $this->app->make(ExceptionHandler::class);

        if (! method_exists($handler, 'renderable')) {
            return;
        }

        $handler->renderable(function (Throwable $e, Request $request) {
            if (! $request->is('preview/v1/*')) {
                return null;
            }

            return PublicApiExceptionRenderer::render($e, $request);
        });
    }
}
