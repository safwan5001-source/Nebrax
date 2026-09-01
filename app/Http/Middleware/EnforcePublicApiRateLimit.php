<?php

namespace App\Http\Middleware;

use App\Models\ApiClient;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiRateLimits;
use App\Support\PublicApiResponse;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * حدّ معدّل الـ Public API لكل **عميل API** (لا IP وحده) — يعمل بعد المصادقة
 * وحارس المستأجر. الهوية تُشتقّ من العميل المصادَق على الخادم، **لا** من أيّ
 * ترويسة يتحكّم بها العميل، فلا يمكن التملّص من الحدّ بترويسةٍ مزوَّرة.
 *
 * الاستخدام: `->middleware(EnforcePublicApiRateLimit::class.':read')`
 * الفئات: read | write | sensitive (بذور PR-5) | unauth (قبل المصادقة، مفتاح IP).
 *
 * عند التجاوز: 429 بمغلّف الـ Public الموحّد (`{error, meta}`) مع `Retry-After`
 * وترويسات `X-RateLimit-*`، ويُعلَّم الطلب `rate_limited` لسجلّ التدقيق. لا
 * يُكشف مفتاح المحدِّد الداخلي إطلاقًا.
 *
 * البنية التحتية: `RateLimiter` فوق `CACHE_STORE=file` بنسخةٍ واحدة (Render free)
 * فالعدّاد شامل عمليًا اليوم؛ قيد التوسّع الأفقي موثَّق في `PublicApiRateLimits`.
 */
class EnforcePublicApiRateLimit
{
    public function handle(Request $request, Closure $next, string $rateClass = PublicApiRateLimits::CLASS_READ): Response
    {
        $limit = PublicApiRateLimits::limitFor($rateClass);
        $key = self::resolveKey($request, $rateClass);

        if (RateLimiter::tooManyAttempts($key, $limit)) {
            $retryAfter = RateLimiter::availableIn($key);
            $request->attributes->set('public_api_rate_limited', true);

            $response = PublicApiResponse::error(
                $request,
                PublicApiErrorCode::RATE_LIMITED,
                'تجاوزت حدّ معدّل الطلبات المسموح؛ أعد المحاولة لاحقًا.',
                429,
            );

            return $this->withRateHeaders($response, $limit, 0, $retryAfter);
        }

        RateLimiter::hit($key, PublicApiRateLimits::WINDOW_SECONDS);

        $response = $next($request);
        $remaining = max(0, RateLimiter::retriesLeft($key, $limit));

        return $this->withRateHeaders($response, $limit, $remaining, null);
    }

    /**
     * مفتاح المحدِّد: عميلٌ مصادَق ⇒ (مستأجر + عميل)، وإلا IP مجزَّأ (لا نطبع IP
     * خامًا في مفتاح الكاش). غير مكشوفٍ للعميل في أيّ استجابة.
     */
    public static function resolveKey(Request $request, string $rateClass): string
    {
        $client = $request->user();

        if ($client instanceof ApiClient) {
            return self::keyFor($rateClass, (string) $client->tenant_id, (string) $client->getKey());
        }

        return 'pubapi:' . $rateClass . ':ip:' . sha1((string) $request->ip());
    }

    /** صيغة مفتاح المحدِّد لعميلٍ مصادَق — مرجعٌ واحد يستعمله الوسيط والاختبارات. */
    public static function keyFor(string $rateClass, string $tenantId, string $clientId): string
    {
        return 'pubapi:' . $rateClass . ':t:' . $tenantId . ':c:' . $clientId;
    }

    private function withRateHeaders(Response $response, int $limit, int $remaining, ?int $retryAfter): Response
    {
        $response->headers->set('X-RateLimit-Limit', (string) $limit);
        $response->headers->set('X-RateLimit-Remaining', (string) $remaining);

        if ($retryAfter !== null) {
            $response->headers->set('Retry-After', (string) $retryAfter);
            $response->headers->set('X-RateLimit-Reset', (string) (time() + $retryAfter));
        }

        return $response;
    }
}
