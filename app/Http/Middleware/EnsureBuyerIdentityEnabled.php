<?php

namespace App\Http\Middleware;

use App\Services\Commerce\RetailAccountGate;
use App\Services\Commerce\WholesaleBuyerGate;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * B2C-ACCOUNTS — gate for the SHARED shopper-identity routes of `store/v1` (`auth/*`, `me`): open when EITHER the
 * wholesale buyer gate OR the retail account gate is open for the Host-resolved channel. Both gates fail closed and
 * the wholesale-only routes (`wholesale/*`, `buyer/*`) keep {@see EnsureWholesaleBuyerEnabled} untouched, so opening
 * retail accounts cannot open wholesale and vice versa. A closed host answers the uniform 404.
 */
class EnsureBuyerIdentityEnabled
{
    public function __construct(private WholesaleBuyerGate $wholesale, private RetailAccountGate $retail) {}

    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($this->wholesale->isOpen() || $this->retail->isOpen(), 404);

        return $next($request);
    }
}
