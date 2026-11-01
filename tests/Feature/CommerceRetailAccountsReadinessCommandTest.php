<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * B2C ACTIVATION READINESS — الفحص التشغيلي للقراءة فقط، وضوابط التفعيل الافتراضية.
 */
class CommerceRetailAccountsReadinessCommandTest extends TestCase
{
    use RefreshDatabase;

    private function store(string $host, bool $accounts, bool $domain = true): void
    {
        $tenant = Tenant::create(['name' => $host, 'slug' => 'r-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['customer_accounts_enabled' => $accounts])->save();
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        if ($domain) {
            StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);
        }
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function the_shipped_defaults_keep_every_activation_control_closed(): void
    {
        $this->assertFalse((bool) (require base_path('config/commerce.php'))['retail_accounts_enabled']);
        $this->assertFalse((bool) (require base_path('config/storefront.php'))['client_identity']['enabled']);
        $this->assertFalse((bool) (require base_path('config/commerce.php'))['wholesale_buyer_enabled']);
    }

    #[Test]
    public function a_fresh_channel_has_accounts_off_and_a_closed_deployment_reports_no_blockers(): void
    {
        config(['commerce.retail_accounts_enabled' => false]);
        $this->store('fresh.ready.test', accounts: false);

        $this->artisan('commerce:retail-accounts-readiness')
            ->expectsOutputToContain('COMMERCE_RETAIL_ACCOUNTS_ENABLED: OFF')
            ->expectsOutputToContain('stores with accounts enabled: 0')
            ->assertExitCode(0);
    }

    #[Test]
    public function it_reports_blockers_without_sending_mail_or_printing_secrets(): void
    {
        Mail::fake();
        config([
            'commerce.retail_accounts_enabled' => true,
            'mail.default' => 'log',
            'mail.from.address' => 'hello@example.com',
            'storefront.gateway_secret' => 'super-secret-gateway-value',
            'services.resend.key' => 're_super_secret_key',
        ]);
        $this->store('open.ready.test', accounts: true);
        $this->store('nodomain.ready.test', accounts: true, domain: false);

        $this->artisan('commerce:retail-accounts-readiness')
            ->expectsOutputToContain('e-mail link host: open.ready.test')
            ->expectsOutputToContain('e-mail link host: NONE')
            ->expectsOutputToContain("mail transport 'log' does not deliver")
            ->expectsOutputToContain('no verified active domain')
            ->doesntExpectOutputToContain('super-secret-gateway-value')
            ->doesntExpectOutputToContain('re_super_secret_key')
            ->assertExitCode(1);

        Mail::assertNothingSent();
        Mail::assertNothingQueued();
    }

    #[Test]
    public function a_correctly_configured_open_store_has_no_blockers(): void
    {
        config([
            'commerce.retail_accounts_enabled' => true,
            'mail.default' => 'resend',
            'mail.from.address' => 'no-reply@mail.shop.test',
            'mail.from.name' => 'Shop',
            'services.resend.key' => 're_x',
            'storefront.gateway_secret' => 'gw',
        ]);
        $this->store('ok.ready.test', accounts: true);

        $this->artisan('commerce:retail-accounts-readiness')
            ->expectsOutputToContain('no blockers detected')
            ->assertExitCode(0);
    }
}
