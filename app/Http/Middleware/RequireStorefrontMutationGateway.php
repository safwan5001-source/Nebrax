<?php

namespace App\Http\Middleware;

use App\Tenancy\StorefrontContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Strict server-to-server boundary for storefront mutations only. */
class RequireStorefrontMutationGateway
{
    public function handle(Request $request, Closure $next): Response
    {
        $configured = (string) config('storefront.gateway_secret', '');
        $provided = (string) $request->header('X-Storefront-Gateway-Secret', '');
        $forwardedHost = $request->header('X-Storefront-Forwarded-Host');
        $context = app(StorefrontContext::class);

        if ($configured === ''
            || $provided === ''
            || ! hash_equals($configured, $provided)
            || ! is_string($forwardedHost)
            || trim($forwardedHost) === ''
            || ! $context->isEstablished()
            || ! $context->hasStorefront()
        ) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        return $next($request);
    }
}
