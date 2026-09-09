<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Resolves the tenant from its globally unique route slug before customer auth. */
class ResolveCustomerTenant
{
    public function __construct(
        private TenantContext $tenantContext,
        private BranchContext $branchContext,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->tenantContext->forget();
        $this->branchContext->forget();
        $slug = (string) $request->route('tenantSlug');

        if (! preg_match('/\A[A-Za-z0-9_-]{1,255}\z/', $slug)) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $tenant = Tenant::query()
            ->where('slug', $slug)
            ->where('is_active', true)
            ->first();

        if ($tenant === null) {
            abort(404, 'تعذّر تحديد متجر صالح.');
        }

        $this->tenantContext->set($tenant->id);

        try {
            return $next($request);
        } finally {
            $this->tenantContext->forget();
            $this->branchContext->forget();
        }
    }
}
