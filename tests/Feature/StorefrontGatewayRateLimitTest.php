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
 *  H6 Batch M (P0) — حدّ معدّل `store/v1` خلف بوابة المتجر المشتركة: ميزانية لكل متجر بدل IP الاتصال
 * ═══════════════════════════════════════════════════════════════
 *  الجذر (Batch L، متصفح حقيقي): كل زوار كل المتاجر يصلون من عنوان خادم Next.js، فكانت سلة `unauth` (30/دقيقة لكل IP) واحدة للمنصة
 *  كلها؛ الصفحة الرابعة في الدقيقة تفشل للجميع. لا يمكن إثبات هوية الزائر الحقيقية (لا `trustProxies`، لا ترويسة IP موثوقة)، فالإصلاح
 *  لا يثق بأي ترويسة: يقيس ما هو مُثبَت فقط — أن المُرسِل هو خادم المتجر (سرّ البوابة) وأي متجر هو (النطاق الموثَّق).
 *  هذه الاختبارات عدائية: ترويسات مزوّرة، آلاف الزوار خلف بوابة واحدة، حجم عالٍ خبيث، طلبات مباشرة، وسرّ خاطئ.
 */
class StorefrontGatewayRateLimitTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'gw-limit-secret';

    private const API = 'http://laravel-internal.test/store/v1/';

    private const HOST_A = 'a.limit.test';

    private const HOST_B = 'b.limit.test';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'commerce.wholesale_buyer_enabled' => true,
            'storefront.gateway_secret' => self::SECRET,
            'storefront.gateway_limits.read_per_minute' => 600,
            'storefront.gateway_limits.write_per_minute' => 120,
        ]);

        foreach ([self::HOST_A, self::HOST_B] as $host) {
            $tenant = Tenant::create(['name' => $host, 'slug' => 't-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
            app(TenantContext::class)->set($tenant->id);
            $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
            $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
            StorefrontDomain::create([
                'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
            app(TenantContext::class)->forget();
        }
    }

    /** A read exactly as the storefront server sends it (forwarded host + gateway secret), from the one gateway address. */
    private function gatewayRead(string $host = self::HOST_A, array $extra = [], string $remote = '203.0.113.9')
    {
        $this->flushHeaders();

        return $this->withServerVariables(['REMOTE_ADDR' => $remote])
            ->withHeaders(array_merge(['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET], $extra))
            ->getJson(self::API.'categories');
    }

    /** A request that talks to Laravel directly on a storefront hostname (no gateway headers). */
    private function directRead(string $host, array $extra = [], string $remote = '198.51.100.5')
    {
        $this->flushHeaders();

        return $this->withServerVariables(['REMOTE_ADDR' => $remote])
            ->withHeaders($extra)
            ->getJson("http://{$host}/store/v1/categories");
    }

    private function spoof(string $ip): array
    {
        return [
            'X-Forwarded-For' => $ip, 'X-Real-IP' => $ip, 'Forwarded' => "for={$ip}", 'CF-Connecting-IP' => $ip,
            'True-Client-IP' => $ip, 'X-Client-IP' => $ip, 'X-Storefront-Client-Ip' => $ip, 'X-Originating-IP' => $ip,
        ];
    }

    #[Test]
    public function many_visitors_behind_one_gateway_are_no_longer_throttled_at_thirty_requests(): void
    {
        // Batch L reproduction: the 31st read from the shared gateway address used to answer 429 for everyone.
        for ($i = 1; $i <= 120; $i++) {
            $this->gatewayRead(self::HOST_A, $this->spoof('192.0.2.'.($i % 250 + 1)))->assertOk();
        }
    }

    #[Test]
    public function a_forged_forwarding_header_neither_grants_a_bucket_nor_raises_the_cap(): void
    {
        config(['storefront.gateway_limits.read_per_minute' => 10]);

        for ($i = 1; $i <= 10; $i++) {
            $this->gatewayRead(self::HOST_A, $this->spoof("192.0.2.{$i}"))->assertOk();
        }

        // an eleventh "visitor" claiming a brand-new address, and one claiming to be a loopback/private address: same bucket
        $this->gatewayRead(self::HOST_A, $this->spoof('192.0.2.250'))->assertStatus(429);
        $this->gatewayRead(self::HOST_A, $this->spoof('10.0.0.1'))->assertStatus(429);
        $this->gatewayRead(self::HOST_A, $this->spoof('127.0.0.1'), '198.51.100.77')->assertStatus(429);
    }

    #[Test]
    public function a_malicious_high_volume_client_is_still_stopped_at_the_store_budget(): void
    {
        config(['storefront.gateway_limits.read_per_minute' => 50]);

        $ok = 0;
        $limited = 0;
        for ($i = 1; $i <= 80; $i++) {
            $r = $this->gatewayRead(self::HOST_A, $this->spoof("203.0.113.{$i}"));
            $r->getStatusCode() === 200 ? $ok++ : $limited++;
            if ($r->getStatusCode() === 429) {
                $this->assertNotNull($r->headers->get('Retry-After'));
                $this->assertSame('0', $r->headers->get('X-RateLimit-Remaining'));
                $this->assertSame('50', $r->headers->get('X-RateLimit-Limit'));
            }
        }

        $this->assertSame(50, $ok);
        $this->assertSame(30, $limited);
    }

    #[Test]
    public function one_stores_traffic_cannot_exhaust_another_stores_budget(): void
    {
        config(['storefront.gateway_limits.read_per_minute' => 5]);

        for ($i = 1; $i <= 5; $i++) {
            $this->gatewayRead(self::HOST_A)->assertOk();
        }
        $this->gatewayRead(self::HOST_A)->assertStatus(429);

        // store B (another tenant) is untouched by A's abuse
        for ($i = 1; $i <= 5; $i++) {
            $this->gatewayRead(self::HOST_B)->assertOk();
        }
        $this->gatewayRead(self::HOST_B)->assertStatus(429);
    }

    #[Test]
    public function direct_requests_without_the_gateway_secret_keep_the_strict_per_ip_limit(): void
    {
        // Laravel reached directly on a real storefront hostname: no secret ⇒ no gateway budget ⇒ the original 30/min per IP.
        for ($i = 1; $i <= 30; $i++) {
            $this->directRead(self::HOST_A)->assertOk();
        }
        $this->directRead(self::HOST_A)->assertStatus(429);

        // forged headers do not buy a fresh bucket, and another address has its own
        $this->directRead(self::HOST_A, $this->spoof('192.0.2.99'))->assertStatus(429);
        $this->directRead(self::HOST_A, [], '198.51.100.6')->assertOk();
    }

    #[Test]
    public function an_invalid_gateway_secret_is_treated_as_direct_and_never_reaches_the_gateway_budget(): void
    {
        $headers = ['X-Storefront-Forwarded-Host' => self::HOST_A, 'X-Storefront-Gateway-Secret' => 'not-the-secret'];

        // (a) wrong secret on a non-storefront host: forwarded host ignored ⇒ unresolved ⇒ uniform 404, no bucket consumed
        for ($i = 1; $i <= 40; $i++) {
            $this->flushHeaders();
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])->withHeaders($headers)->getJson(self::API.'categories')->assertStatus(404);
        }

        // (b) wrong secret on the storefront's own hostname: direct path ⇒ strict 30/min, not the 600 budget
        $ok = 0;
        for ($i = 1; $i <= 40; $i++) {
            $r = $this->directRead(self::HOST_A, ['X-Storefront-Gateway-Secret' => 'not-the-secret', 'X-Storefront-Forwarded-Host' => self::HOST_B]);
            $r->getStatusCode() === 200 && $ok++;
        }
        $this->assertSame(30, $ok);

        // and the legitimate gateway budget is intact
        $this->gatewayRead(self::HOST_A)->assertOk();
    }

    #[Test]
    public function direct_abuse_cannot_consume_the_gateway_budget_and_vice_versa(): void
    {
        for ($i = 1; $i <= 31; $i++) {
            $this->directRead(self::HOST_A);
        }
        $this->directRead(self::HOST_A)->assertStatus(429);
        $this->gatewayRead(self::HOST_A, [], '198.51.100.5')->assertOk(); // same connection address, different budget

        config(['storefront.gateway_limits.read_per_minute' => 3]);
        for ($i = 1; $i <= 4; $i++) {
            $this->gatewayRead(self::HOST_B);
        }
        $this->gatewayRead(self::HOST_B)->assertStatus(429);
        $this->directRead(self::HOST_B, [], '203.0.113.9')->assertOk(); // direct bucket for that address untouched
    }

    #[Test]
    public function reads_and_writes_have_separate_store_budgets(): void
    {
        config(['storefront.gateway_limits.write_per_minute' => 3]);

        for ($i = 1; $i <= 3; $i++) {
            $this->flushHeaders();
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
                ->withHeaders(['X-Storefront-Forwarded-Host' => self::HOST_A, 'X-Storefront-Gateway-Secret' => self::SECRET])
                ->postJson(self::API.'auth/login', ['email' => "w{$i}@limit.test", 'password' => 'wrong-password-1'])->assertStatus(422);
        }
        $this->flushHeaders();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
            ->withHeaders(['X-Storefront-Forwarded-Host' => self::HOST_A, 'X-Storefront-Gateway-Secret' => self::SECRET])
            ->postJson(self::API.'auth/login', ['email' => 'w4@limit.test', 'password' => 'wrong-password-1'])->assertStatus(429);

        $this->gatewayRead(self::HOST_A)->assertOk(); // the read budget is a different bucket
    }

    #[Test]
    public function the_kill_switch_restores_the_legacy_shared_ip_bucket_exactly(): void
    {
        config(['storefront.gateway_limits.read_per_minute' => 0]);

        for ($i = 1; $i <= 30; $i++) {
            $this->gatewayRead(self::HOST_A, $this->spoof("192.0.2.{$i}"))->assertOk();
        }
        $this->gatewayRead(self::HOST_B)->assertStatus(429); // one bucket for every store behind the gateway, as before
    }

    #[Test]
    public function credential_throttles_are_not_loosened_by_the_gateway_budget(): void
    {
        // the per-account brake still bites long before the store budget (600/120) is anywhere near exhausted
        $attempt = function (string $email) {
            $this->flushHeaders();

            return $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
                ->withHeaders(['X-Storefront-Forwarded-Host' => self::HOST_A, 'X-Storefront-Gateway-Secret' => self::SECRET] + $this->spoof('192.0.2.'.random_int(1, 200)))
                ->postJson(self::API.'auth/login', ['email' => $email, 'password' => 'wrong-password-1']);
        };

        for ($i = 1; $i <= 5; $i++) {
            $attempt('victim@limit.test')->assertStatus(422);
        }
        $attempt('victim@limit.test')->assertStatus(429);

        // and the per-tenant brake (password spraying across many accounts) still caps at 20
        for ($i = 1; $i <= 14; $i++) {
            $attempt("spray{$i}@limit.test")->assertStatus(422);
        }
        $attempt('spray15@limit.test')->assertStatus(429);
    }

    #[Test]
    public function the_response_advertises_the_effective_store_limit_not_a_client_value(): void
    {
        $r = $this->gatewayRead(self::HOST_A, ['X-RateLimit-Limit' => '999999']);
        $r->assertOk();
        $this->assertSame('600', $r->headers->get('X-RateLimit-Limit'));
        $this->assertSame('599', $r->headers->get('X-RateLimit-Remaining'));
    }
}
