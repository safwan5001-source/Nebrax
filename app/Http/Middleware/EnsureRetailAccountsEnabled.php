<?php

namespace App\Http\Middleware;

use App\Services\Commerce\RetailAccountGate;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** B2C-ACCOUNTS — gate for the retail-only `account/*` routes: the deployment flag AND the host channel's flag, else uniform 404. */
class EnsureRetailAccountsEnabled
{
    public function __construct(private RetailAccountGate $gate) {}

    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($this->gate->isOpen(), 404);

        return $next($request);
    }
}
