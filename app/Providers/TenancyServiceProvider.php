<?php

namespace App\Providers;

use App\Support\RevisionBuffer;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchSharing;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class TenancyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TenantContext::class, fn () => new TenantContext());
        $this->app->scoped(CustomerContext::class, fn () => new CustomerContext());
        $this->app->singleton(BranchContext::class, fn () => new BranchContext());
        $this->app->singleton(BranchSharing::class, fn () => new BranchSharing());
        $this->app->scoped(RevisionBuffer::class, fn () => new RevisionBuffer());
        $this->app->register(PosServiceProvider::class);
        $this->app->register(InventoryWorkspaceServiceProvider::class);
    }

    public function boot(): void
    {
        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(3)->by('register|' . $request->ip()));

        RateLimiter::for('customer-register', function (Request $request): array {
            $tenant = (string) $request->route('tenantSlug');
            $email = Str::lower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(10)->by("customer-register|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(3)->by("customer-register|{$tenant}|email|{$email}"),
            ];
        });

        RateLimiter::for('customer-login', function (Request $request): array {
            $tenant = (string) $request->route('tenantSlug');
            $email = Str::lower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(20)->by("customer-login|{$tenant}|ip|{$request->ip()}"),
                Limit::perMinute(5)->by("customer-login|{$tenant}|email|{$email}"),
            ];
        });
    }
}
