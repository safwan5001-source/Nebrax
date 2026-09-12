<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * COM-7-OPS-1 — `sales-channel:ensure-web` operator command.
 *
 * تشغيل: php artisan test --filter=EnsureWebSalesChannelCommandTest
 */
class EnsureWebSalesChannelCommandTest extends TestCase
{
    use RefreshDatabase;

    private function makeTenant(string $slug = 'demo-tenant', bool $active = true): Tenant
    {
        return Tenant::create([
            'name' => 'متجر تجريبي',
            'slug' => $slug,
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
            'is_active' => $active,
        ]);
    }

    private function createChannel(Tenant $tenant, array $overrides = []): SalesChannel
    {
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create(array_merge([
            'slug' => 'web',
            'name' => 'المتجر الإلكتروني',
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ], $overrides));

        app(TenantContext::class)->forget();

        return $channel;
    }

    private function tenantChannelCount(Tenant $tenant): int
    {
        app(TenantContext::class)->set($tenant->id);
        $count = SalesChannel::query()->count();
        app(TenantContext::class)->forget();

        return $count;
    }

    private function snapshot(SalesChannel $channel): array
    {
        $channel->refresh();

        return [
            'id' => $channel->id,
            'tenant_id' => $channel->tenant_id,
            'slug' => $channel->slug,
            'name' => $channel->name,
            'type' => $channel->type,
            'is_active' => $channel->is_active,
            'updated_at' => optional($channel->updated_at)->toJSON(),
        ];
    }

    /** @test */
    public function creates_one_active_web_sales_channel_when_none_exists(): void
    {
        $tenant = $this->makeTenant('dominah');

        $this->artisan('sales-channel:ensure-web', [
            'tenant' => $tenant->slug,
        ])->assertSuccessful();

        app(TenantContext::class)->set($tenant->id);
        $channels = SalesChannel::query()->get();
        app(TenantContext::class)->forget();

        $this->assertCount(1, $channels);
        $channel = $channels->first();
        $this->assertSame($tenant->id, $channel->tenant_id);
        $this->assertSame('web', $channel->slug);
        $this->assertSame('المتجر الإلكتروني', $channel->name);
        $this->assertSame(SalesChannel::TYPE_WEB, $channel->type);
        $this->assertTrue($channel->is_active);
    }

    /** @test */
    public function re_running_the_command_is_idempotent_and_does_not_duplicate(): void
    {
        $tenant = $this->makeTenant();

        $this->artisan('sales-channel:ensure-web', ['tenant' => $tenant->slug])->assertSuccessful();
        $this->artisan('sales-channel:ensure-web', ['tenant' => $tenant->slug])->assertSuccessful();

        $this->assertSame(1, $this->tenantChannelCount($tenant));
    }

    /** @test */
    public function reuses_an_existing_correct_active_web_channel_without_mutation(): void
    {
        $tenant = $this->makeTenant();
        $channel = $this->createChannel($tenant, [
            'slug' => 'storefront-web',
            'name' => 'قناة قائمة',
        ]);
        $before = $this->snapshot($channel);

        $this->artisan('sales-channel:ensure-web', ['tenant' => $tenant->slug])->assertSuccessful();

        $this->assertSame(1, $this->tenantChannelCount($tenant));
        $this->assertSame($before, $this->snapshot($channel));
    }

    /** @test */
    public function fails_for_a_missing_tenant_without_creating_anything(): void
    {
        $before = SalesChannel::query()->count();

        $this->artisan('sales-channel:ensure-web', [
            'tenant' => 'does-not-exist',
        ])->assertFailed();

        $this->assertSame($before, SalesChannel::query()->count());
    }

    /** @test */
    public function never_reuses_or_mutates_another_tenant_web_channel(): void
    {
        $tenantA = $this->makeTenant('tenant-a');
        $tenantB = $this->makeTenant('tenant-b');
        $channelA = $this->createChannel($tenantA);
        $beforeA = $this->snapshot($channelA);

        $this->artisan('sales-channel:ensure-web', [
            'tenant' => $tenantB->slug,
        ])->assertSuccessful();

        $this->assertSame($beforeA, $this->snapshot($channelA));
        $this->assertSame(1, $this->tenantChannelCount($tenantA));
        $this->assertSame(1, $this->tenantChannelCount($tenantB));

        app(TenantContext::class)->set($tenantB->id);
        $channelB = SalesChannel::query()->first();
        app(TenantContext::class)->forget();

        $this->assertNotNull($channelB);
        $this->assertSame($tenantB->id, $channelB->tenant_id);
        $this->assertNotSame($channelA->id, $channelB->id);
        $this->assertSame('web', $channelB->slug);
        $this->assertSame(SalesChannel::TYPE_WEB, $channelB->type);
        $this->assertTrue($channelB->is_active);
    }

    /** @test */
    public function fails_closed_when_multiple_active_web_channels_exist_without_mutation(): void
    {
        $tenant = $this->makeTenant();
        $channelA = $this->createChannel($tenant, ['slug' => 'web']);
        $channelB = $this->createChannel($tenant, ['slug' => 'web-2', 'name' => 'قناة ثانية']);
        $beforeA = $this->snapshot($channelA);
        $beforeB = $this->snapshot($channelB);

        $this->artisan('sales-channel:ensure-web', ['tenant' => $tenant->slug])->assertFailed();

        $this->assertSame(2, $this->tenantChannelCount($tenant));
        $this->assertSame($beforeA, $this->snapshot($channelA));
        $this->assertSame($beforeB, $this->snapshot($channelB));
    }

    /** @test */
    public function does_not_silently_activate_an_existing_inactive_web_channel(): void
    {
        $tenant = $this->makeTenant();
        $channel = $this->createChannel($tenant, ['is_active' => false]);
        $before = $this->snapshot($channel);

        $this->artisan('sales-channel:ensure-web', ['tenant' => $tenant->slug])->assertFailed();

        $this->assertSame(1, $this->tenantChannelCount($tenant));
        $this->assertSame($before, $this->snapshot($channel));
        $this->assertFalse($channel->fresh()->is_active);
    }

    /** @test */
    public function does_not_overwrite_an_incompatible_channel_occupying_slug_web(): void
    {
        $tenant = $this->makeTenant();
        $channel = $this->createChannel($tenant, [
            'type' => SalesChannel::TYPE_POS,
            'name' => 'نقطة البيع',
        ]);
        $before = $this->snapshot($channel);

        $this->artisan('sales-channel:ensure-web', ['tenant' => $tenant->slug])->assertFailed();

        $this->assertSame(1, $this->tenantChannelCount($tenant));
        $this->assertSame($before, $this->snapshot($channel));
        $this->assertSame(SalesChannel::TYPE_POS, $channel->fresh()->type);
    }

    /** @test */
    public function fails_closed_for_an_inactive_tenant_without_creating_a_channel(): void
    {
        $tenant = $this->makeTenant('paused-tenant', active: false);

        $this->artisan('sales-channel:ensure-web', [
            'tenant' => $tenant->slug,
        ])->assertFailed();

        $this->assertSame(0, $this->tenantChannelCount($tenant));
    }

    /** @test */
    public function accepts_an_explicit_tenant_uuid_as_well_as_slug(): void
    {
        $tenant = $this->makeTenant('uuid-tenant');

        $this->artisan('sales-channel:ensure-web', [
            'tenant' => $tenant->id,
        ])->assertSuccessful();

        $this->assertSame(1, $this->tenantChannelCount($tenant));
    }
}
