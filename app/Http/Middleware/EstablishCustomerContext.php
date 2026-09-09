<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EstablishCustomerContext
{
    public function __construct(
        private TenantContext $tenantContext,
        private CustomerContext $customerContext,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->customerContext->forget();
        $identity = $request->user();

        if (
            ! $identity instanceof CustomerIdentity
            || ! $this->tenantContext->has()
            || $identity->tenant_id !== $this->tenantContext->id()
        ) {
            abort(403, 'تعذّر إنشاء سياق عميل موثوق.');
        }

        $partnerId = CustomerPartnerLink::query()
            ->where('customer_identity_id', $identity->id)
            ->where('status', 'active')
            ->whereHas('partner', fn ($query) => $query
                ->where('is_active', true)
                ->whereIn('type', ['customer', 'both']))
            ->value('partner_id');

        $this->customerContext->set($this->tenantContext->id(), $identity->id, $partnerId);

        try {
            return $next($request);
        } finally {
            $this->customerContext->forget();
        }
    }
}
