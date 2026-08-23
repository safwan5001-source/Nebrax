<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\ApplicationAccessDecision;
use App\Services\EntitlementRolloutPolicy;
use App\Services\EntitlementCohortEnforcer;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationAccessResult;
use App\Support\ApplicationOperationClass;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class EntitlementCohortEnforcementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    public function test_rollout_policy_defaults_off_and_parses_only_exact_non_empty_uuid_memberships(): void
    {
        $context = app(TenantContext::class);
        $tenantA = '11111111-1111-4111-8111-111111111111';
        $tenantB = '22222222-2222-4222-8222-222222222222';
        $context->set($tenantA);

        config(['entitlements.mode' => null, 'entitlements.enforce_tenants' => '']);
        $policy = app(EntitlementRolloutPolicy::class);
        $this->assertSame(EntitlementRolloutPolicy::MODE_OFF, $policy->mode());
        $this->assertFalse($policy->isAuthoritativeForCurrentTenant());

        config(['entitlements.mode' => 'shadow', 'entitlements.enforce_tenants' => " {$tenantA}, ,not-a-uuid,{$tenantB}, {$tenantA} "]);
        $this->assertTrue($policy->isShadow());
        $this->assertFalse($policy->isAuthoritativeForCurrentTenant());
        $this->assertSame([$tenantA, $tenantB], $policy->cohortTenantIds());

        config(['entitlements.mode' => 'enforce_cohort']);
        $this->assertTrue($policy->isAuthoritativeForCurrentTenant());
        $context->set($tenantB);
        $this->assertTrue($policy->isAuthoritativeForCurrentTenant());
        $context->set('33333333-3333-4333-8333-333333333333');
        $this->assertFalse($policy->isAuthoritativeForCurrentTenant());

        config(['entitlements.mode' => 'enforce_all']);
        $this->assertSame(EntitlementRolloutPolicy::MODE_OFF, $policy->mode());
        $this->assertFalse($policy->isAuthoritativeForCurrentTenant());
    }

    public function test_off_shadow_and_non_cohort_modes_leave_a_legacy_allowed_request_allowed(): void
    {
        foreach (['off', 'shadow', 'enforce_cohort'] as $mode) {
            $slug = str_replace('_', '-', "cohort-legacy-{$mode}");
            $auth = $this->registerTenant($slug, "owner@{$slug}.test");
            $this->bindDecision(ApplicationAccessResult::denied(ApplicationAccessReason::NOT_ENTITLED));
            config([
                'entitlements.mode' => $mode,
                'entitlements.enforce_tenants' => $mode === 'enforce_cohort'
                    ? '99999999-9999-4999-8999-999999999999'
                    : $auth['tenant_id'],
            ]);

            $this->withToken($auth['token'])->getJson('/api/pos-sessions')->assertOk();
        }
    }

    public function test_enforce_cohort_denies_new_decision_and_logs_safe_structured_context(): void
    {
        $auth = $this->registerTenant('cohort-denied', 'owner@cohort-denied.test');
        config(['entitlements.mode' => 'enforce_cohort', 'entitlements.enforce_tenants' => " {$auth['tenant_id']} "]);
        $this->bindDecision(ApplicationAccessResult::denied(ApplicationAccessReason::NOT_ENTITLED));
        Log::spy();

        $this->withToken($auth['token'])->withHeader('X-Request-ID', 'cohort-request-1')
            ->getJson('/api/pos-sessions?payment_token=private')->assertStatus(403);

        Log::shouldHaveReceived('warning')->once()->withArgs(function ($message, $context) use ($auth) {
            return $message === 'ENTITLEMENT_COHORT_ENFORCEMENT'
                && $context['event'] === 'denied'
                && $context['tenant_id'] === $auth['tenant_id']
                && $context['capability_key'] === 'sales.pos'
                && $context['decision'] === 'denied'
                && $context['reason'] === 'NOT_ENTITLED'
                && $context['correlation_id'] === 'cohort-request-1'
                && ! array_key_exists('request_body', $context)
                && ! str_contains(json_encode($context), 'private');
        });
        Log::shouldHaveReceived('info')->once()->withArgs(fn ($message, $context) => $message === 'ENTITLEMENT_ACCESS_DENIED'
            && $context['tenant_id'] === $auth['tenant_id']
            && $context['capability_key'] === 'sales.pos'
            && $context['reason'] === 'NOT_ENTITLED'
            && $context['operation_class'] === 'read'
            && $context['correlation_id'] === 'cohort-request-1'
            && array_key_exists('evaluation_latency_ms', $context));
    }

    public function test_enforce_cohort_allows_new_allowed_decision(): void
    {
        $auth = $this->registerTenant('cohort-allowed', 'owner@cohort-allowed.test');
        config(['entitlements.mode' => 'enforce_cohort', 'entitlements.enforce_tenants' => $auth['tenant_id']]);
        $this->bindDecision(ApplicationAccessResult::allowed());

        $this->withToken($auth['token'])->getJson('/api/pos-sessions')->assertOk();
    }

    public function test_enforce_cohort_allows_read_only_read_and_denies_write(): void
    {
        $auth = $this->registerTenant('cohort-read-only', 'owner@cohort-read-only.test');
        config(['entitlements.mode' => 'enforce_cohort', 'entitlements.enforce_tenants' => $auth['tenant_id']]);
        $this->bindDecision(ApplicationAccessResult::readOnly(ApplicationAccessReason::ENTITLEMENT_READ_ONLY));
        Log::spy();

        app(TenantContext::class)->set($auth['tenant_id']);
        try {
            app(EntitlementCohortEnforcer::class)->enforce(request()->duplicate([], [], [], [], [], ['REQUEST_METHOD' => 'POST']), 'sales.pos', ApplicationOperationClass::WRITE);
            $this->fail('The cohort enforcer must fail closed for a READ_ONLY write.');
        } catch (HttpException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }
        Log::shouldHaveReceived('info')->once()->withArgs(fn ($message, $context) => $message === 'ENTITLEMENT_READ_ONLY_BLOCK'
            && $context['tenant_id'] === $auth['tenant_id']
            && $context['capability_key'] === 'sales.pos'
            && $context['reason'] === 'ENTITLEMENT_READ_ONLY'
            && $context['operation_class'] === 'write');
    }

    public function test_enforce_cohort_applies_to_purchase_credit_note_operation_after_source_ownership_resolution(): void
    {
        $auth = $this->registerTenant('cohort-purchase-note', 'owner@cohort-purchase-note.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $supplier = Partner::create(['name' => 'مورد cohort', 'type' => 'supplier']);
        $purchase = Purchase::create([
            'number' => 'BILL-COHORT-1',
            'partner_id' => $supplier->id,
            'purchase_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
        ]);
        config(['entitlements.mode' => 'enforce_cohort', 'entitlements.enforce_tenants' => $auth['tenant_id']]);
        $this->bindDecision(ApplicationAccessResult::denied(ApplicationAccessReason::NOT_ENTITLED));

        $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id' => $supplier->id,
            'original_purchase_id' => $purchase->id,
            'items' => [['description' => 'خصم cohort', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertStatus(403);
    }

    public function test_enforce_cohort_fails_closed_on_evaluation_exception_but_non_cohort_keeps_legacy_access(): void
    {
        $cohort = $this->registerTenant('cohort-exception', 'owner@cohort-exception.test');
        config(['entitlements.mode' => 'enforce_cohort', 'entitlements.enforce_tenants' => $cohort['tenant_id']]);
        $this->bindException(new RuntimeException('commercial resolver failure'));
        Log::spy();

        $this->withToken($cohort['token'])->getJson('/api/pos-sessions')->assertStatus(403);
        Log::shouldHaveReceived('warning')->once()->withArgs(fn ($message, $context) => $message === 'ENTITLEMENT_COHORT_ENFORCEMENT'
            && $context['event'] === 'evaluation_failure'
            && ! array_key_exists('message', $context));
        Log::shouldHaveReceived('info')->once()->withArgs(fn ($message, $context) => $message === 'ENTITLEMENT_ACCESS_DENIED'
            && $context['tenant_id'] === $cohort['tenant_id']
            && $context['reason'] === 'evaluation_failure'
            && $context['operation_class'] === 'read');

        $nonCohort = $this->registerTenant('outside-exception', 'owner@outside-exception.test');
        config(['entitlements.enforce_tenants' => $cohort['tenant_id']]);
        $this->withToken($nonCohort['token'])->getJson('/api/pos-sessions')->assertOk();
    }

    private function bindDecision(ApplicationAccessResult $result): void
    {
        $decision = $this->createStub(ApplicationAccessDecision::class);
        $decision->method('decide')->willReturn($result);
        app()->instance(ApplicationAccessDecision::class, $decision);
    }

    private function bindException(\Throwable $exception): void
    {
        $decision = $this->createStub(ApplicationAccessDecision::class);
        $decision->method('decide')->willThrowException($exception);
        app()->instance(ApplicationAccessDecision::class, $decision);
    }
}
