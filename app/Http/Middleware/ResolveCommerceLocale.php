<?php

namespace App\Http\Middleware;

use App\Support\CommerceLocale;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * COM-MOBILE-I18N-1 (ADR-12) — shared locale-resolution authority for the
 * public Commerce API surfaces. Applied once, at the same outer layer as
 * `ForceJsonResponse`/`PublicApiRequestContext` (see
 * `CommerceApiServiceProvider`/`StorefrontApiServiceProvider`), so every
 * `/commerce/v1` and `/store/v1` route shares identical locale behavior —
 * never a per-route or per-channel divergence.
 *
 * Reads `Accept-Language` (RFC 9110 §12.5.4), resolves it against
 * `CommerceLocale::SUPPORTED` via `CommerceLocale::resolve()`, and sets it
 * as the application locale for the lifetime of this request only — restored
 * afterward, matching the same request-scoped-state discipline
 * `EstablishCommerceCustomerContextIfPresent` already uses for
 * `CustomerContext`, so a shared PHP worker never leaks one request's
 * resolved locale into the next.
 *
 * This middleware does not itself change any response body: it establishes
 * the locale *authority* a controller/resource may consult
 * (`app()->getLocale()`) when choosing between an existing bilingual field
 * pair (e.g. `name`/`name_en`) or translating a message — no existing
 * resource is required to change by this middleware's addition alone. The
 * one observable, purely additive effect is a standard `Content-Language`
 * response header (RFC 9110 §12.5.5) echoing the resolved locale, so a
 * client (or a test) can always see what was resolved without any resource
 * needing to expose it itself.
 */
class ResolveCommerceLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $previousLocale = app()->getLocale();
        $resolvedLocale = CommerceLocale::resolve($request->header('Accept-Language'));

        app()->setLocale($resolvedLocale);

        try {
            $response = $next($request);
            $response->headers->set('Content-Language', $resolvedLocale);

            return $response;
        } finally {
            app()->setLocale($previousLocale);
        }
    }
}
