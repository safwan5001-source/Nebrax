<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\ApplicationAccessDecision;
use App\Services\EntitlementShadowEvaluator;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationAccessResult;
use App\Support\ApplicationOperationClass;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Tests\TestCase;

class EntitlementShadowModeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'Shadow', 'slug' => 'shadow', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
    }

    public function test_off_mode_has_no_entitlement_or_logging_impact(): void
    {
        config(['entitlements.mode' => 'off']);
        $decisions = $this->createMock(ApplicationAccessDecision::class);
        $decisions->expects($this->never())->method('decide');
        Log::spy();

        $this->observer($decisions)->observe($this->request(), 'sales.pos', ApplicationOperationClass::READ, ApplicationAccessResult::allowed());

        Log::shouldNotHaveReceived('warning');
        Log::shouldNotHaveReceived('error');
    }

    public function test_shadow_logs_old_allow_new_deny_with_safe_structured_context(): void
    {
        config(['entitlements.mode' => 'shadow']);
        $decisions = $this->decisionReturning(ApplicationAccessResult::denied(ApplicationAccessReason::NOT_ENTITLED));
        Log::spy();

        $this->observer($decisions)->observe($this->request(), 'sales.pos', ApplicationOperationClass::READ, ApplicationAccessResult::allowed());

        Log::shouldHaveReceived('warning')->once()->withArgs(function ($message, $context) {
            return $message === 'ENTITLEMENT_SHADOW_MISMATCH'
                && $context['tenant_id'] === $this->tenant->id
                && $context['capability_key'] === 'sales.pos'
                && $context['operation_class'] === 'read'
                && $context['old_reason'] === 'ACCESS_ALLOWED'
                && $context['new_reason'] === 'NOT_ENTITLED'
                && ! array_key_exists('request_body', $context)
                && ! str_contains(json_encode($context), 'card-secret');
        });
    }

    public function test_shadow_logs_old_deny_new_allow_but_never_returns_an_enforcement_result(): void
    {
        config(['entitlements.mode' => 'shadow']);
        Log::spy();

        $return = $this->observer($this->decisionReturning(ApplicationAccessResult::allowed()))
            ->observe($this->request(), 'sales.pos', ApplicationOperationClass::WRITE, ApplicationAccessResult::denied(ApplicationAccessReason::APPLICATION_DISABLED));

        $this->assertNull($return);
        Log::shouldHaveReceived('warning')->once()->withArgs(fn ($message, $context) => $context['mismatch'] === 'OLD_DENIED_NEW_ALLOWED');
    }

    public function test_matching_decisions_do_not_log_a_mismatch(): void
    {
        config(['entitlements.mode' => 'shadow']);
        Log::spy();

        $this->observer($this->decisionReturning(ApplicationAccessResult::allowed()))
            ->observe($this->request(), 'sales.pos', ApplicationOperationClass::READ, ApplicationAccessResult::allowed());

        Log::shouldNotHaveReceived('warning');
    }

    public function test_evaluation_exception_is_isolated_and_logged_without_payload(): void
    {
        config(['entitlements.mode' => 'shadow']);
        $decisions = $this->createStub(ApplicationAccessDecision::class);
        $decisions->method('decide')->willThrowException(new RuntimeException('resolver unavailable'));
        Log::spy();

        $this->observer($decisions)->observe($this->request(), 'sales.pos', ApplicationOperationClass::READ, ApplicationAccessResult::allowed());

        Log::shouldHaveReceived('error')->once()->withArgs(fn ($message, $context) => $message === 'SHADOW_EVALUATION_ERROR'
            && $context['tenant_id'] === $this->tenant->id
            && $context['exception'] === RuntimeException::class
            && ! array_key_exists('message', $context));
    }

    private function request(): Request
    {
        return Request::create('/api/pos-sessions?payment_token=card-secret', 'GET', ['private' => 'card-secret'], [], [], ['HTTP_X_REQUEST_ID' => 'req-123']);
    }

    private function decisionReturning(ApplicationAccessResult $result): ApplicationAccessDecision
    {
        $decision = $this->createStub(ApplicationAccessDecision::class);
        $decision->method('decide')->willReturn($result);
        return $decision;
    }

    private function observer(ApplicationAccessDecision $decisions): EntitlementShadowEvaluator
    {
        return new EntitlementShadowEvaluator($decisions, app(TenantContext::class));
    }
}
