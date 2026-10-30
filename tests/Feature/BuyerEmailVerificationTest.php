<?php

namespace Tests\Feature;

use App\Mail\BuyerVerificationMail;
use App\Models\CustomerEmailVerificationToken;
use App\Models\CustomerIdentity;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch H — تأكيد البريد الإلكتروني لمشتري الجملة
 * ═══════════════════════════════════════════════════════════════
 *  رسالة حقيقية عبر ناقل البريد القائم (Mail facade — Resend في الإنتاج)، رمز مُجزَّأ ومنتهي ووحيد الاستعمال مربوط بالمستأجر
 *  والقناة، ردود محايدة، مضيف الرابط من نطاق المتجر الموثَّق لا من الطلب، ولا دخول لمشترٍ غير موثَّق.
 */
class BuyerEmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'verify-gateway-secret';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private Tenant $tenant;

    private SalesChannel $channel;

    private string $host = 'wholesale.verify.test';

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET,
            'commerce.buyer_verification_resend_gap_seconds' => 60]);
        Mail::fake();
        ['tenant' => $this->tenant, 'channel' => $this->channel] = $this->store($this->host);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function store(string $host, ?Tenant $tenant = null, bool $wholesale = true): array
    {
        $tenant ??= Tenant::create([
            'name' => 'متجر الجملة', 'slug' => 'bv-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web-'.Str::random(5), 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function headers(?string $host = null, string $secret = self::SECRET, array $extra = []): array
    {
        return array_merge(['X-Storefront-Forwarded-Host' => $host ?? $this->host, 'X-Storefront-Gateway-Secret' => $secret], $extra);
    }

    private function register(string $email = 'new@buyer.test', ?string $host = null, array $extra = [], array $headers = [])
    {
        return $this->withHeaders($this->headers($host, self::SECRET, $headers))->postJson(self::BASE.'auth/register', array_merge([
            'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9',
        ], $extra));
    }

    private function resend(string $email, ?string $host = null)
    {
        return $this->withHeaders($this->headers($host))->postJson(self::BASE.'auth/verification/resend', ['email' => $email]);
    }

    private function verifyToken(string $token, ?string $host = null)
    {
        return $this->withHeaders($this->headers($host))->postJson(self::BASE.'auth/verify-email', ['token' => $token]);
    }

    private function login(string $email, ?string $host = null)
    {
        return $this->withHeaders($this->headers($host))->postJson(self::BASE.'auth/login', ['email' => $email, 'password' => 'correct-horse-9']);
    }

    private function identity(string $email): CustomerIdentity
    {
        return CustomerIdentity::withoutGlobalScopes()->where('email_normalized', $email)->firstOrFail();
    }

    /** @return list<BuyerVerificationMail> */
    private function sentMails(?string $to = null): array
    {
        return Mail::sent(BuyerVerificationMail::class, fn ($m) => $to === null || $m->hasTo($to))->values()->all();
    }

    private function tokenFromMail(BuyerVerificationMail $mail): string
    {
        parse_str((string) parse_url($mail->url, PHP_URL_QUERY), $q);

        return (string) $q['token'];
    }

    // ═══════════════════════ التسليم ═══════════════════════

    #[Test]
    public function registering_sends_one_verification_mail_through_the_mail_transport(): void
    {
        $this->register('new@buyer.test')->assertStatus(202)->assertJsonPath('data.verification_required', true);

        $mails = $this->sentMails('new@buyer.test');
        $this->assertCount(1, $mails);
        $this->assertSame('متجر الجملة', $mails[0]->storeName);
        $this->assertSame(1440, $mails[0]->ttlMinutes);
        $this->assertMatchesRegularExpression('#^https://wholesale\.verify\.test/buyer/verify\?token=[A-Za-z0-9]{64}$#', $mails[0]->url);
    }

    #[Test]
    public function the_link_host_is_the_stores_own_domain_never_a_request_header(): void
    {
        $this->register('spoof@buyer.test', null, [], [
            'Origin' => 'https://evil.example', 'Referer' => 'https://evil.example/x', 'X-Forwarded-Host' => 'evil.example',
            'X-Forwarded-For' => '6.6.6.6', 'Host' => 'evil.example',
        ])->assertStatus(202);

        $url = $this->sentMails('spoof@buyer.test')[0]->url;
        $this->assertStringStartsWith('https://wholesale.verify.test/', $url);
        $this->assertStringNotContainsString('evil', $url);
    }

    #[Test]
    public function only_a_strict_locale_prefix_may_shape_the_link_path(): void
    {
        $this->register('loc@buyer.test', null, ['locale_path' => '/sa/ar'])->assertStatus(202);
        $this->assertStringStartsWith('https://wholesale.verify.test/sa/ar/buyer/verify?token=', $this->sentMails('loc@buyer.test')[0]->url);

        foreach (['//evil.example', 'https://evil.example', '/sa/ar/../x', '/SA/AR', '/s/ar'] as $bad) {
            $this->register("bad{$bad}@buyer.test" === '' ? 'x@y.test' : 'bad'.md5($bad).'@buyer.test', null, ['locale_path' => $bad])->assertStatus(422);
        }
    }

    #[Test]
    public function registration_is_neutral_for_new_and_existing_addresses_and_only_a_new_one_gets_mail(): void
    {
        $first = $this->register('dup@buyer.test')->assertStatus(202);
        $second = $this->register('dup@buyer.test')->assertStatus(202);

        $norm = fn ($r) => array_diff_key($r->json(), ['meta' => 1]);
        $this->assertSame($norm($first), $norm($second));
        $this->assertCount(1, $this->sentMails('dup@buyer.test'));
        $this->assertSame(1, CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'dup@buyer.test')->count());
    }

    #[Test]
    public function the_token_is_stored_only_as_a_hash_and_responses_leak_no_identity(): void
    {
        $response = $this->register('hash@buyer.test')->assertStatus(202);
        $plain = $this->tokenFromMail($this->sentMails('hash@buyer.test')[0]);

        $row = DB::table('customer_email_verification_tokens')->first();
        $this->assertSame(hash('sha256', $plain), $row->token_hash);
        $this->assertStringNotContainsString($plain, json_encode((array) $row));
        $this->assertSame($this->channel->id, $row->sales_channel_id);
        $this->assertSame($this->tenant->id, $row->tenant_id);
        $this->assertStringNotContainsString('hash@buyer.test', $response->getContent());
        $this->assertStringNotContainsString($this->identity('hash@buyer.test')->id, $response->getContent());
    }

    // ═══════════════════════ التحقق والدخول ═══════════════════════

    #[Test]
    public function an_unverified_buyer_cannot_log_in_and_a_verified_one_can(): void
    {
        $this->register('login@buyer.test');
        $wrongPassword = $this->withHeaders($this->headers())->postJson(self::BASE.'auth/login', ['email' => 'login@buyer.test', 'password' => 'nope-nope-1']);
        $unverified = $this->login('login@buyer.test')->assertStatus(422);
        $this->assertSame($wrongPassword->json('errors'), $unverified->json('errors'), 'unverified is indistinguishable from a wrong password');
        $this->assertNull($this->identity('login@buyer.test')->email_verified_at);

        $this->verifyToken($this->tokenFromMail($this->sentMails('login@buyer.test')[0]))
            ->assertOk()->assertJsonPath('data.verified', true);

        $this->assertNotNull($this->identity('login@buyer.test')->email_verified_at);
        $this->login('login@buyer.test')->assertOk()->assertJsonStructure(['data' => ['token']]);
    }

    #[Test]
    public function a_token_works_once_and_a_replay_is_a_generic_failure(): void
    {
        $this->register('once@buyer.test');
        $token = $this->tokenFromMail($this->sentMails('once@buyer.test')[0]);

        $this->verifyToken($token)->assertOk();
        $replay = $this->verifyToken($token)->assertStatus(422);
        $unknown = $this->verifyToken(Str::random(64))->assertStatus(422);

        $this->assertSame($replay->json('error'), $unknown->json('error'), 'replay is indistinguishable from an unknown token');
    }

    #[Test]
    public function an_expired_token_fails(): void
    {
        $this->register('exp@buyer.test');
        $token = $this->tokenFromMail($this->sentMails('exp@buyer.test')[0]);

        $this->travel(1441)->minutes();
        $this->verifyToken($token)->assertStatus(422);
        $this->assertNull($this->identity('exp@buyer.test')->email_verified_at);

        $this->travelBack();
        $this->verifyToken($token)->assertOk(); // not consumed by the failed attempt
    }

    #[Test]
    public function a_token_never_verifies_through_another_tenant(): void
    {
        $this->register('tenant@buyer.test');
        $token = $this->tokenFromMail($this->sentMails('tenant@buyer.test')[0]);
        $this->store('other-tenant.verify.test');

        $this->verifyToken($token, 'other-tenant.verify.test')->assertStatus(422);
        $this->assertNull($this->identity('tenant@buyer.test')->email_verified_at);
        $this->verifyToken($token)->assertOk();
    }

    #[Test]
    public function a_token_never_verifies_through_another_host_of_the_same_tenant_and_is_not_consumed_by_trying(): void
    {
        $this->register('host@buyer.test');
        $token = $this->tokenFromMail($this->sentMails('host@buyer.test')[0]);
        $this->store('second.verify.test', $this->tenant);                    // same tenant, different channel/host

        $this->verifyToken($token, 'second.verify.test')->assertStatus(422);
        $this->assertNull($this->identity('host@buyer.test')->email_verified_at);
        $this->assertNull(CustomerEmailVerificationToken::withoutGlobalScopes()->first()->used_at, 'a wrong-host attempt does not burn the token');
        $this->verifyToken($token)->assertOk();
    }

    #[Test]
    public function malformed_and_forged_requests_are_rejected_before_any_lookup(): void
    {
        foreach (['', 'short', str_repeat('!', 64), str_repeat('a', 65)] as $bad) {
            $this->verifyToken($bad)->assertStatus(422);
        }
        $this->withHeaders($this->headers())->postJson(self::BASE.'auth/verify-email', [
            'token' => Str::random(64), 'tenant_id' => $this->tenant->id,
        ])->assertStatus(422);
    }

    // ═══════════════════════ الإعادة ═══════════════════════

    #[Test]
    public function resend_is_neutral_and_only_an_eligible_unverified_active_address_gets_mail(): void
    {
        $this->register('elig@buyer.test');
        $this->register('verified@buyer.test');
        $this->verifyToken($this->tokenFromMail($this->sentMails('verified@buyer.test')[0]))->assertOk();
        $this->register('inactive@buyer.test');
        $this->identity('inactive@buyer.test')->forceFill(['is_active' => false])->save();
        Mail::fake();                                             // forget the registration mails
        $this->travel(2)->minutes();                              // past the resend gap

        $bodies = [];
        foreach (['elig@buyer.test', 'verified@buyer.test', 'inactive@buyer.test', 'ghost@buyer.test'] as $email) {
            $r = $this->resend($email)->assertStatus(202);
            $bodies[$email] = array_diff_key($r->json(), ['meta' => 1]);
        }

        $this->assertCount(1, array_unique(array_map('json_encode', $bodies)), 'identical bodies for every address');
        $this->assertCount(1, $this->sentMails('elig@buyer.test'));
        foreach (['verified@buyer.test', 'inactive@buyer.test', 'ghost@buyer.test'] as $email) {
            $this->assertCount(0, $this->sentMails($email), $email);
        }
    }

    #[Test]
    public function a_new_link_retires_the_old_one_and_a_request_inside_the_gap_sends_nothing(): void
    {
        $this->register('gap@buyer.test');
        $old = $this->tokenFromMail($this->sentMails('gap@buyer.test')[0]);

        $this->resend('gap@buyer.test')->assertStatus(202);
        $this->assertCount(1, $this->sentMails('gap@buyer.test'), 'inside the resend gap: skipped');

        $this->travel(2)->minutes();
        $this->resend('gap@buyer.test')->assertStatus(202);
        $mails = $this->sentMails('gap@buyer.test');
        $this->assertCount(2, $mails);

        $this->verifyToken($old)->assertStatus(422);                       // superseded
        $this->verifyToken($this->tokenFromMail($mails[1]))->assertOk();   // the new one works
    }

    #[Test]
    public function a_mail_transport_failure_is_swallowed_and_keeps_the_previous_link_working(): void
    {
        $this->register('fail@buyer.test');
        $old = $this->tokenFromMail($this->sentMails('fail@buyer.test')[0]);
        $this->travel(2)->minutes();

        // the REAL mail manager with a transport that always fails (and whose error text carries a "secret")
        app()->forgetInstance('mail.manager');
        app()->forgetInstance('mailer');
        Mail::clearResolvedInstances();
        Mail::extend('always-failing', fn () => new class extends \Symfony\Component\Mailer\Transport\AbstractTransport
        {
            protected function doSend(\Symfony\Component\Mailer\SentMessage $message): void
            {
                throw new \RuntimeException('transport down: secret-api-key');
            }

            public function __toString(): string
            {
                return 'always-failing';
            }
        });
        config(['mail.default' => 'always-failing', 'mail.mailers.always-failing' => ['transport' => 'always-failing']]);

        $response = $this->resend('fail@buyer.test')->assertStatus(202);
        $this->assertStringNotContainsString('secret-api-key', $response->getContent());

        $this->assertSame(1, CustomerEmailVerificationToken::withoutGlobalScopes()->whereNull('used_at')->count(), 'candidate retired, previous kept');
        $this->verifyToken($old)->assertOk();
    }

    #[Test]
    public function resend_is_rate_limited_per_address_and_cannot_mail_bomb(): void
    {
        RateLimiter::clear('x');
        $this->register('bomb@buyer.test');
        for ($i = 0; $i < 3; $i++) {
            $this->resend('bomb@buyer.test')->assertStatus(202);
        }
        $this->resend('bomb@buyer.test')->assertStatus(429);
        $this->assertLessThanOrEqual(2, count($this->sentMails('bomb@buyer.test')), 'gap + limiter bound the mail volume');
    }

    // ═══════════════════════ البوابات ═══════════════════════

    #[Test]
    public function both_endpoints_need_the_gateway_secret_and_the_deployment_gate(): void
    {
        // a wrong/absent gateway secret makes the forwarded host untrusted ⇒ the store cannot be resolved ⇒ uniform 404
        foreach ([[self::BASE.'auth/verify-email', ['token' => Str::random(64)]], [self::BASE.'auth/verification/resend', ['email' => 'a@b.test']]] as [$url, $body]) {
            $this->withHeaders($this->headers(null, 'wrong-secret'))->postJson($url, $body)->assertNotFound();
            $this->withHeaders($this->headers(null, ''))->postJson($url, $body)->assertNotFound();
        }

        config(['commerce.wholesale_buyer_enabled' => false]);
        $this->verifyToken(Str::random(64))->assertNotFound();
        $this->resend('a@b.test')->assertNotFound();
        $this->register('closed@buyer.test')->assertNotFound();
        $this->assertCount(0, $this->sentMails());
    }

    #[Test]
    public function a_dtc_host_exposes_none_of_it(): void
    {
        $this->store('retail.verify.test', null, wholesale: false);

        $this->register('dtc@buyer.test', 'retail.verify.test')->assertNotFound();
        $this->resend('dtc@buyer.test', 'retail.verify.test')->assertNotFound();
        $this->verifyToken(Str::random(64), 'retail.verify.test')->assertNotFound();
        $this->assertCount(0, $this->sentMails());
    }
}
