<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Final Closure — `GET store/v1/storefront` يعلن `capabilities.wholesale_buyer` (قراءة فقط، منطقي فقط)
 *  حتى تردّ واجهة المتجر بـ404 حقيقي لصفحات المشتري على مضيف لا تُفتح فيه الجملة.
 * ═══════════════════════════════════════════════════════════════
 */
class StorefrontWholesaleCapabilityTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'cap-secret';

    private const URL = 'http://laravel-internal.test/store/v1/storefront';

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.gateway_secret' => self::SECRET, 'commerce.wholesale_buyer_enabled' => true]);
    }

    private function host(string $host, bool $wholesale, ?Tenant $tenant = null): Tenant
    {
        $tenant ??= Tenant::create(['name' => 'متجر '.$host, 'slug' => 'cp-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'c-'.Str::random(5), 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);
        app(TenantContext::class)->forget();

        return $tenant;
    }

    private function config(string $host, ?string $secret = self::SECRET)
    {
        $this->flushHeaders();
        $headers = ['X-Storefront-Forwarded-Host' => $host];
        if ($secret !== null) {
            $headers['X-Storefront-Gateway-Secret'] = $secret;
        }

        return $this->withHeaders($headers)->getJson(self::URL);
    }

    #[Test]
    public function a_wholesale_host_with_the_deployment_flag_on_declares_the_capability(): void
    {
        $this->host('a.cap.test', true);

        $this->config('a.cap.test')->assertOk()->assertJsonPath('data.capabilities.wholesale_buyer', true);
    }

    #[Test]
    public function the_deployment_flag_off_closes_it_even_for_a_wholesale_channel(): void
    {
        $this->host('b.cap.test', true);
        config(['commerce.wholesale_buyer_enabled' => false]);

        $this->config('b.cap.test')->assertOk()->assertJsonPath('data.capabilities.wholesale_buyer', false);
    }

    #[Test]
    public function an_ordinary_retail_host_never_declares_it(): void
    {
        $this->host('c.cap.test', false);

        $this->config('c.cap.test')->assertOk()->assertJsonPath('data.capabilities.wholesale_buyer', false);
    }

    #[Test]
    public function a_wholesale_channel_of_another_tenant_does_not_open_a_retail_host(): void
    {
        $this->host('d1.cap.test', true);
        $this->host('d2.cap.test', false);

        $this->config('d2.cap.test')->assertOk()->assertJsonPath('data.capabilities.wholesale_buyer', false);
        $this->config('d1.cap.test')->assertOk()->assertJsonPath('data.capabilities.wholesale_buyer', true);
    }

    #[Test]
    public function an_unknown_host_or_a_missing_secret_resolves_no_store_and_declares_nothing(): void
    {
        $this->host('e.cap.test', true);

        $this->config('nobody.cap.test')->assertNotFound()->assertJsonPath('error.code', 'not_found')->assertJsonMissingPath('data');
        $this->config('e.cap.test', null)->assertNotFound()->assertJsonMissingPath('data');
        $this->config('e.cap.test', 'wrong')->assertNotFound()->assertJsonMissingPath('data');
    }

    #[Test]
    public function the_payload_carries_only_a_boolean_for_the_capability(): void
    {
        $this->host('f.cap.test', true);

        $capabilities = $this->config('f.cap.test')->assertOk()->json('data.capabilities');

        // additive booleans only (B2C-ACCOUNTS adds `customer_accounts`, closed here: this host has no retail accounts)
        $this->assertSame(['wholesale_buyer' => true, 'customer_accounts' => false], $capabilities);
    }
}
