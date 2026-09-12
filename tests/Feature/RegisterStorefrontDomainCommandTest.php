<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * COM-7-PREVIEW-FIX-1 §C — `storefront:register-domain` operator command.
 *
 * تشغيل: php artisan test --filter=RegisterStorefrontDomainCommandTest
 */
class RegisterStorefrontDomainCommandTest extends TestCase
{
    use RefreshDatabase;

    private function makeTenantWithWebChannel(string $slug = 'demo-tenant'): array
    {
        $tenant = Tenant::create([
            'name' => 'متجر تجريبي', 'slug' => $slug,
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    /** @test */
    public function registers_a_new_hostname_for_a_tenant_with_one_active_web_channel(): void
    {
        ['tenant' => $tenant] = $this->makeTenantWithWebChannel();

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenant->slug,
            'hostname' => 'storefront-one-xi.vercel.app',
            '--yes' => true,
        ])->assertSuccessful();

        $domain = StorefrontDomain::where('hostname', 'storefront-one-xi.vercel.app')->first();
        $this->assertNotNull($domain);
        $this->assertTrue($domain->is_active);
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $domain->verification_status);
        $this->assertSame($tenant->id, $domain->tenant_id);
    }

    /** @test */
    public function is_idempotent_when_run_twice_with_the_same_inputs(): void
    {
        ['tenant' => $tenant] = $this->makeTenantWithWebChannel();

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenant->slug,
            'hostname' => 'storefront-one-xi.vercel.app',
            '--yes' => true,
        ])->assertSuccessful();

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenant->slug,
            'hostname' => 'storefront-one-xi.vercel.app',
            '--yes' => true,
        ])->assertSuccessful();

        $this->assertSame(
            1,
            StorefrontDomain::where('hostname', 'storefront-one-xi.vercel.app')->count(),
        );
    }

    /** @test */
    public function refuses_to_move_a_hostname_already_owned_by_another_tenant(): void
    {
        ['tenant' => $tenantA] = $this->makeTenantWithWebChannel('tenant-a');
        ['tenant' => $tenantB] = $this->makeTenantWithWebChannel('tenant-b');

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenantA->slug,
            'hostname' => 'shared-host.example.com',
            '--yes' => true,
        ])->assertSuccessful();

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenantB->slug,
            'hostname' => 'shared-host.example.com',
            '--yes' => true,
        ])->assertFailed();

        $domain = StorefrontDomain::where('hostname', 'shared-host.example.com')->first();
        $this->assertSame($tenantA->id, $domain->tenant_id);
    }

    /** @test */
    public function fails_clearly_when_the_tenant_has_no_active_web_sales_channel(): void
    {
        $tenant = Tenant::create([
            'name' => 'بلا قناة', 'slug' => 'no-channel-tenant',
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenant->slug,
            'hostname' => 'no-channel.example.com',
            '--yes' => true,
        ])->assertFailed();

        $this->assertNull(StorefrontDomain::where('hostname', 'no-channel.example.com')->first());
    }

    /** @test */
    public function fails_clearly_for_an_unknown_tenant_instead_of_guessing(): void
    {
        $this->artisan('storefront:register-domain', [
            'tenant' => 'does-not-exist',
            'hostname' => 'anything.example.com',
            '--yes' => true,
        ])->assertFailed();

        $this->assertNull(StorefrontDomain::where('hostname', 'anything.example.com')->first());
    }

    /** @test */
    public function requires_disambiguation_when_multiple_active_web_channels_exist(): void
    {
        ['tenant' => $tenant, 'channel' => $channelA] = $this->makeTenantWithWebChannel();
        app(TenantContext::class)->set($tenant->id);
        $channelB = SalesChannel::create([
            'slug' => 'web-2', 'name' => 'قناة ثانية', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenant->slug,
            'hostname' => 'ambiguous.example.com',
            '--yes' => true,
        ])->assertFailed();

        $this->artisan('storefront:register-domain', [
            'tenant' => $tenant->slug,
            'hostname' => 'ambiguous.example.com',
            '--channel' => $channelB->slug,
            '--yes' => true,
        ])->assertSuccessful();

        $domain = StorefrontDomain::where('hostname', 'ambiguous.example.com')->first();
        $storefront = Storefront::find($domain->storefront_id);
        $this->assertSame($channelB->id, $storefront->sales_channel_id);
    }
}
