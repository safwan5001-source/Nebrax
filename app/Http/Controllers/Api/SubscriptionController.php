<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\Tenant;
use App\Models\User;
use App\Support\PlanGate;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * معلومات اشتراك المؤسسة: الخطة، الحالة، الحدود، والاستهلاك.
 * متاح لأي مستخدم مصادَق (حتى مع اشتراك منتهٍ) ليرى حالته.
 */
class SubscriptionController extends ApiController
{
    public function show(): JsonResponse
    {
        $tenant = Tenant::find(app(TenantContext::class)->id());

        return response()->json([
            'plan'                 => $tenant->plan,
            'active'               => PlanGate::subscriptionActive($tenant),
            'trial_ends_at'        => optional($tenant->trial_ends_at)->toDateString(),
            'subscription_ends_at' => optional($tenant->subscription_ends_at)->toDateString(),
            'limits' => [
                'invoices_per_month' => PlanGate::limit($tenant, 'invoices_per_month'),
                'users'              => PlanGate::limit($tenant, 'users'),
                // DRF-07 (S02c): حدود صانع التطبيقات (إضافية).
                'builder_apps'             => PlanGate::limit($tenant, 'builder_apps'),
                'builder_versions_per_app' => PlanGate::limit($tenant, 'builder_versions_per_app'),
                'builder_active_previews'  => PlanGate::limit($tenant, 'builder_active_previews'),
            ],
            'usage' => [
                'invoices_this_month' => Invoice::whereBetween('created_at', [
                    now()->startOfMonth(), now()->endOfMonth(),
                ])->count(),
                'users' => User::where('tenant_id', $tenant->id)->count(),
                'builder_apps' => \App\Models\BuilderApp::query()->count(),
            ],
        ]);
    }
}
