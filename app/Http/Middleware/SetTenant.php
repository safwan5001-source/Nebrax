<?php

namespace App\Http\Middleware;

use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يضبط المستأجر الحالي من المستخدم المصادَق عليه.
 * كل الاستعلامات بعده ستُعزل تلقائياً.
 */
class SetTenant
{
    public function __construct(protected TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user->tenant_id) {
            return response()->json(['message' => 'لا يوجد مستأجر مرتبط بالحساب.'], 403);
        }

        if (! $user->tenant->is_active) {
            return response()->json(['message' => 'الاشتراك غير مفعّل.'], 403);
        }

        $this->tenant->set($user->tenant_id);

        return $next($request);
    }
}
