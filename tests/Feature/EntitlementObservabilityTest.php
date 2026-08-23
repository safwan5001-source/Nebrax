<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class EntitlementObservabilityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function grant_emits_safe_structured_observability_without_sensitive_reason_or_metadata(): void
    {
        $auth = $this->registerTenant('observability', 'owner@observability.test');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        Log::spy();
        app(EntitlementGrantService::class)->grant(
            $tenant, 'hr.employees', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON,
            CarbonImmutable::parse('2026-01-01T00:00:00Z'), null, 'commercial-product-version', '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000222',
            'COMMERCIAL_PRODUCT_VERSION', 'sensitive reason', null, ['secret' => 'must-not-log'],
        );

        Log::shouldHaveReceived('info')->once()->withArgs(function (string $message, array $context) use ($tenant): bool {
            return $message === 'COMMERCIAL_ASSIGNMENT_APPLIED'
                && $context['tenant_id'] === $tenant->id
                && $context['capability_key'] === 'hr.employees'
                && $context['source_type'] === 'addon'
                && $context['access_mode'] === 'full'
                && $context['reason'] === 'assignment_applied'
                && $context['operation_class'] === 'system'
                && array_key_exists('evaluation_latency_ms', $context)
                && array_key_exists('correlation_id', $context)
                && ! array_key_exists('metadata', $context)
                && $context['reason'] !== 'sensitive reason';
        });
    }
}
