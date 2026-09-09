<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureCustomerPrincipal
{
    public function __construct(private TenantContext $tenantContext) {}

    public function handle(Request $request, Closure $next): Response
    {
        $identity = $request->user();

        if (
            ! $identity instanceof CustomerIdentity
            || ! $identity->is_active
            || $identity->email_verified_at === null
            || ! $this->tenantContext->has()
            || $identity->tenant_id !== $this->tenantContext->id()
            || ! $identity->tokenCan('customer:access')
        ) {
            abort(403, 'هذا المسار مخصّص لهويات العملاء الموثقة.');
        }

        return $next($request);
    }
}
