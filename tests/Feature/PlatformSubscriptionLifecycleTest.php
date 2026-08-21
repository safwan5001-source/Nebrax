<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformSubscription;
use App\Models\PlatformSubscriptionEvent;
use App\Support\PlatformMetrics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformSubscriptionLifecycleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{administrator: PlatformAdministrator, token: string} */
    private function platformAdministrator(array $abilities = ['platform:read', 'platform:manage']): array
    {
        $administrator = PlatformAdministrator::create([
            'name'     => 'مشغّل دورة العقود',
            'email'    => 'lifecycle+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [
            'administrator' => $administrator,
            'token'         => $administrator->createToken('platform-lifecycle', $abilities)->plainTextToken,
        ];
    }

    private function createPrice(string $token, string $plan, int $monthlyAmount, string $effectiveOn): string
    {
        return $this->withToken($token)
            ->postJson('/api/platform/prices', [
                'plan'           => $plan,
                'currency'       => 'SAR',
                'monthly_amount' => $monthlyAmount,
                'effective_on'   => $effectiveOn,
            ])
            ->assertCreated()
            ->json('data.id');
    }

    /** @test */
    public function a_platform_administrator_creates_a_contract_from_an_effective_price_without_changing_tenant_access(): void
    {
        $tenant = $this->registerTenant('contract-lifecycle', 'owner@contract-lifecycle.test');
        $platform = $this->platformAdministrator();
        $today = now()->toDateString();
        $priceId = $this->createPrice($platform['token'], 'pro', 199000, $today);

        $response = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan'               => 'pro',
                'currency'           => 'SAR',
                'starts_on'          => $today,
                'external_reference' => 'contract-lifecycle-001',
                'reason'             => 'تعاقد سنوي داخلي',
            ])
            ->assertCreated()
            ->assertJsonPath('data.plan', 'pro')
            ->assertJsonPath('data.monthly_amount_minor', 199000)
            ->assertJsonPath('data.price_version.id', $priceId);

        $subscriptionId = $response->json('data.id');
        $this->assertDatabaseHas('platform_subscriptions', [
            'id'                        => $subscriptionId,
            'tenant_id'                 => $tenant['tenant_id'],
            'platform_price_version_id' => $priceId,
            'monthly_amount'            => 199000,
        ]);
        $this->assertDatabaseHas('platform_subscription_events', [
            'platform_subscription_id' => $subscriptionId,
            'tenant_id'               => $tenant['tenant_id'],
            'action'                  => PlatformSubscriptionEvent::ACTION_CREATED,
            'to_plan'                 => 'pro',
            'to_monthly_amount'       => 199000,
        ]);
        $this->assertDatabaseHas('tenants', [
            'id'        => $tenant['tenant_id'],
            'plan'      => 'free',
            'is_active' => true,
        ]);
    }

    /** @test */
    public function a_future_plan_transition_keeps_current_mrr_until_its_effective_date_and_records_the_change(): void
    {
        $tenant = $this->registerTenant('scheduled-transition', 'owner@scheduled-transition.test');
        $platform = $this->platformAdministrator();
        $today = now()->toDateString();
        $tomorrow = now()->addDay()->toDateString();
        $this->createPrice($platform['token'], 'basic', 99000, $today);
        $this->createPrice($platform['token'], 'pro', 199000, $tomorrow);

        $current = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan' => 'basic', 'currency' => 'SAR', 'starts_on' => $today,
            ])
            ->assertCreated();
        $currentId = $current->json('data.id');

        $next = $this->withToken($platform['token'])
            ->postJson("/api/platform/subscriptions/{$currentId}/transition", [
                'plan' => 'pro', 'currency' => 'SAR', 'effective_on' => $tomorrow, 'reason' => 'ترقية مجدولة',
            ])
            ->assertOk()
            ->assertJsonPath('data.plan', 'pro')
            ->assertJsonPath('data.starts_on', $tomorrow);

        $previous = PlatformSubscription::findOrFail($currentId);
        $this->assertSame(PlatformSubscription::STATUS_ACTIVE, $previous->status);
        $this->assertSame($today, $previous->ends_on?->toDateString());
        $upgradeEvent = \App\Models\PlatformSubscriptionEvent::query()
            ->where('platform_subscription_id', $next->json('data.id'))
            ->where('action', PlatformSubscriptionEvent::ACTION_UPGRADED)
            ->firstOrFail();
        $this->assertSame('basic', $upgradeEvent->from_plan);
        $this->assertSame('pro', $upgradeEvent->to_plan);
        $this->assertSame($tomorrow, $upgradeEvent->effective_on?->toDateString());
        $this->assertSame(99000, app(PlatformMetrics::class)->overview()['subscriptions']['monthly_recurring_revenue_minor']);
    }

    /** @test */
    public function a_cancellation_is_audited_and_never_changes_tenant_access_or_creates_a_financial_record(): void
    {
        $tenant = $this->registerTenant('cancelled-contract', 'owner@cancelled-contract.test');
        $platform = $this->platformAdministrator();
        $today = now()->toDateString();
        $this->createPrice($platform['token'], 'basic', 99000, $today);

        $subscriptionId = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan' => 'basic', 'currency' => 'SAR', 'starts_on' => $today,
            ])
            ->assertCreated()
            ->json('data.id');

        $this->withToken($platform['token'])
            ->postJson("/api/platform/subscriptions/{$subscriptionId}/cancel", [
                'effective_on' => $today,
                'reason'       => 'طلب الإلغاء',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', PlatformSubscription::STATUS_CANCELLED);

        $cancelEvent = \App\Models\PlatformSubscriptionEvent::query()
            ->where('platform_subscription_id', $subscriptionId)
            ->where('action', PlatformSubscriptionEvent::ACTION_CANCELLED)
            ->firstOrFail();
        $this->assertSame($today, $cancelEvent->effective_on?->toDateString());
        $this->assertDatabaseHas('tenants', ['id' => $tenant['tenant_id'], 'plan' => 'free', 'is_active' => true]);
        $this->assertSame(0, app(PlatformMetrics::class)->overview()['subscriptions']['monthly_recurring_revenue_minor']);
    }

    /** @test */
    public function a_contract_requires_an_effective_price_and_rejects_an_overlapping_live_contract(): void
    {
        $tenant = $this->registerTenant('no-overlap', 'owner@no-overlap.test');
        $platform = $this->platformAdministrator();
        $today = now()->toDateString();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan' => 'basic', 'currency' => 'SAR', 'starts_on' => $today,
            ])
            ->assertStatus(422);

        $this->createPrice($platform['token'], 'basic', 99000, $today);
        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan' => 'basic', 'currency' => 'SAR', 'starts_on' => $today,
            ])
            ->assertCreated();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan' => 'basic', 'currency' => 'SAR', 'starts_on' => $today,
            ])
            ->assertStatus(422);
    }

    /** @test */
    public function subscription_events_are_immutable_after_creation(): void
    {
        $tenant = $this->registerTenant('immutable-events', 'owner@immutable-events.test');
        $platform = $this->platformAdministrator();
        $today = now()->toDateString();
        $this->createPrice($platform['token'], 'basic', 99000, $today);

        $subscriptionId = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/subscriptions", [
                'plan' => 'basic', 'currency' => 'SAR', 'starts_on' => $today,
            ])
            ->assertCreated()
            ->json('data.id');

        $event = \App\Models\PlatformSubscriptionEvent::query()
            ->where('platform_subscription_id', $subscriptionId)
            ->firstOrFail();

        $this->expectException(\LogicException::class);
        $event->update(['reason' => 'محاولة تعديل مرفوضة']);
    }

    /** @test */
    public function contract_management_rejects_read_only_platform_tokens_and_tenant_tokens(): void
    {
        $tenant = $this->registerTenant('isolated-contracts', 'owner@isolated-contracts.test');
        $readOnly = $this->platformAdministrator(['platform:read']);

        $this->withToken($readOnly['token'])
            ->postJson('/api/platform/prices', [
                'plan' => 'basic', 'currency' => 'SAR', 'monthly_amount' => 99000, 'effective_on' => now()->toDateString(),
            ])
            ->assertForbidden();

        $this->withToken($tenant['token'])
            ->postJson('/api/platform/prices', [
                'plan' => 'basic', 'currency' => 'SAR', 'monthly_amount' => 99000, 'effective_on' => now()->toDateString(),
            ])
            ->assertForbidden();
    }
}
