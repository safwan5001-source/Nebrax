<?php

namespace Tests\Feature;

use App\Models\CustomerIdentity;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Monolog\Handler\TestHandler;
use PHPUnit\Framework\Attributes\Test;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\TestCase;

/**
 * B2C ACTIVATION READINESS — when the mail transport fails (provider down, bad key, unverified sender domain) the shopper still gets
 * the neutral 202, the failure is LOGGED so an operator can see it, and the log carries no token, address, password or provider text.
 */
class BuyerMailFailureLoggingTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'mail-log-secret';

    private const HOST = 'shop.maillog.test';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private function headers(): array
    {
        return ['X-Storefront-Forwarded-Host' => self::HOST, 'X-Storefront-Gateway-Secret' => self::SECRET];
    }

    #[Test]
    public function transport_failures_are_logged_without_secrets_and_the_response_stays_neutral(): void
    {
        config(['commerce.retail_accounts_enabled' => true, 'storefront.gateway_secret' => self::SECRET,
            'commerce.buyer_verification_resend_gap_seconds' => 0, 'commerce.buyer_password_reset_resend_gap_seconds' => 0]);

        $tenant = Tenant::create(['name' => 'متجر', 'slug' => 'ml-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['customer_accounts_enabled' => true])->save();
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => self::HOST, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);
        CustomerIdentity::create(['tenant_id' => $tenant->id, 'display_name' => 'Shopper', 'email' => 'victim.address@shopper.test', 'password' => 'correct-horse-9', 'email_verified_at' => now(), 'is_active' => true]);
        CustomerIdentity::create(['tenant_id' => $tenant->id, 'display_name' => 'New', 'email' => 'unverified.address@shopper.test', 'password' => 'correct-horse-9', 'email_verified_at' => null, 'is_active' => true]);
        app(TenantContext::class)->forget();

        // The REAL mail manager with a transport whose error text carries a provider secret.
        app()->forgetInstance('mail.manager');
        app()->forgetInstance('mailer');
        Mail::clearResolvedInstances();
        Mail::extend('always-failing', fn () => new class extends AbstractTransport
        {
            protected function doSend(SentMessage $message): void
            {
                throw new \RuntimeException('401 invalid api key re_live_SECRETKEY123 for victim.address@shopper.test');
            }

            public function __toString(): string
            {
                return 'always-failing';
            }
        });
        config(['mail.default' => 'always-failing', 'mail.mailers.always-failing' => ['transport' => 'always-failing']]);

        $handler = new TestHandler;
        Log::getLogger()->pushHandler($handler);

        $forgot = $this->withHeaders($this->headers())->postJson(self::BASE.'auth/password/forgot', ['email' => 'victim.address@shopper.test']);
        $resend = $this->withHeaders($this->headers())->postJson(self::BASE.'auth/verification/resend', ['email' => 'unverified.address@shopper.test']);

        // neutral to the shopper, whatever happened to the mail
        $forgot->assertStatus(202);
        $resend->assertStatus(202);

        $failures = array_values(array_filter($handler->getRecords(), fn ($r) => str_contains((string) ($r['message'] ?? $r->message ?? ''), 'mail failed')));
        $messages = array_map(fn ($r) => (string) ($r['message'] ?? $r->message), $failures);
        $this->assertContains('buyer password reset mail failed', $messages);
        $this->assertContains('buyer verification mail failed', $messages);

        // an operator can see which tenant/identity and what kind of failure — and nothing else
        $dump = json_encode(array_map(fn ($r) => [(string) ($r['message'] ?? $r->message), (array) ($r['context'] ?? $r->context)], $failures), JSON_UNESCAPED_UNICODE);
        foreach ($failures as $record) {
            $context = (array) ($record['context'] ?? $record->context);
            $this->assertEqualsCanonicalizing(['tenant_id', 'identity_id', 'exception'], array_keys($context));
            $this->assertSame(\RuntimeException::class, $context['exception']);
        }
        $this->assertStringNotContainsString('victim.address@shopper.test', $dump);
        $this->assertStringNotContainsString('unverified.address@shopper.test', $dump);
        $this->assertStringNotContainsString('re_live_SECRETKEY123', $dump);
        $this->assertStringNotContainsString('correct-horse-9', $dump);
        $this->assertDoesNotMatchRegularExpression('/[A-Za-z0-9]{64}/', $dump, 'no verification/reset token in the log');
        $this->assertStringNotContainsString('token=', $dump);
        $this->assertStringNotContainsString('re_live_SECRETKEY123', json_encode($forgot->json()).json_encode($resend->json()));
    }
}
