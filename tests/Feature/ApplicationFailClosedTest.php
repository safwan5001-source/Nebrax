<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureApplicationActive;
use App\Http\Middleware\EnsureApplicationOperationActive;
use App\Models\Tenant;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * المفاتيح وأسماء العمليات حواجز أمنية: الخطأ الإملائي لا يتحول إلى وصول فعّال.
 * تشغيل: php artisan test --filter=ApplicationFailClosedTest
 */
class ApplicationFailClosedTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function known_capabilities_keep_enabled_disabled_and_grandfathered_semantics(): void
    {
        $new = $this->registerTenant('known-state-new', 'owner@known-state-new.test', autoEnableApplications: false);
        app(TenantContext::class)->set($new['tenant_id']);
        $applications = app(TenantApplicationService::class);

        $this->assertSame('disabled', $applications->statusFor('sales.pos'));
        $applications->enable('sales.pos', null);
        $this->assertSame('enabled', $applications->statusFor('sales.pos'));

        $legacy = Tenant::create([
            'name' => 'مؤسسة موروثة',
            'slug' => 'known-state-legacy',
            'vat_number' => '300000000000084',
            'currency' => 'SAR',
        ]);
        $legacy->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();
        app(TenantContext::class)->set($legacy->id);

        $this->assertSame('enabled', $applications->statusFor('sales.pos'));
    }

    /** @test */
    public function unknown_and_mistyped_capability_keys_fail_closed(): void
    {
        $auth = $this->registerTenant('unknown-capability', 'owner@unknown-capability.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $applications = app(TenantApplicationService::class);

        $this->assertSame('disabled', $applications->statusFor('not.a.real.capability'));
        $this->assertSame('disabled', $applications->statusFor('purchases.cycel'));

        foreach (['not.a.real.capability', 'purchases.cycel'] as $key) {
            try {
                app(EnsureApplicationActive::class)->handle(
                    Request::create('/api/application-probe', 'GET'),
                    fn () => response()->noContent(),
                    $key,
                );
                $this->fail("Unknown key {$key} must not pass EnsureApplicationActive.");
            } catch (HttpException $exception) {
                $this->assertSame(Response::HTTP_FORBIDDEN, $exception->getStatusCode());
            }
        }
    }

    /** @test */
    public function known_shared_operations_are_allowed_but_unsupported_names_fail_closed(): void
    {
        $auth = $this->registerTenant('operation-names', 'owner@operation-names.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $middleware = app(EnsureApplicationOperationActive::class);

        foreach (['return', 'credit-note'] as $operation) {
            $response = $middleware->handle(
                Request::create('/api/operation-probe', 'GET'),
                fn () => response()->noContent(),
                $operation,
            );
            $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
        }

        foreach (['credit_note', 'return-typo'] as $operation) {
            try {
                $middleware->handle(
                    Request::create('/api/operation-probe', 'GET'),
                    fn () => response()->noContent(),
                    $operation,
                );
                $this->fail("Unsupported operation {$operation} must fail closed.");
            } catch (HttpException $exception) {
                $this->assertSame(Response::HTTP_FORBIDDEN, $exception->getStatusCode());
            }
        }
    }
}
