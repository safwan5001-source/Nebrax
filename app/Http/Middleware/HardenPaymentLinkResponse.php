<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * رؤوس حماية رابط الدفع العام (PAY-H2-02e): `no-store` و`no-referrer` و`noindex` على **كل** رد، بما فيه 429 من المحدِّد و404 الموحّد.
 * أول الوسطاء في المجموعة (قبل `throttle:pay-link`) كي لا تُفقد رؤوس القدرة-في-الرابط تحت الضغط حيث تلزم أكثر.
 */
class HardenPaymentLinkResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('X-Robots-Tag', 'noindex, nofollow');

        return $response;
    }
}
