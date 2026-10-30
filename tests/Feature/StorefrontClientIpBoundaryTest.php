<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch H (P0a) — حدّ هوية الزائر عبر بوابة المتجر: ما يُثبَت اليوم، وما لا يجوز تفعيله قبل التحقق
 * ═══════════════════════════════════════════════════════════════
 *  لم يُثبَت مسار الوكيل الفعلي بين الزائر وخادم Next.js وLaravel في أي بيئة (راجع تقرير الدفعة H §P0a)، فلا يُنفَّذ إصلاحٌ تخمينيّ.
 *  هذه الاختبارات تثبّت **السلامة الحالية** (لا ترويسة يرسلها المتصفح تغيّر هوية التحديد، حتى مع سرّ البوابة الصحيح) وتوثّق
 *  **السلوك المعروف** (سلة IP مشتركة لكل مشترٍ عبر البوابة) كي لا يتغيّر أيٌّ منهما صدفة — أي تغيير مستقبلي يحتاج قراراً صريحاً.
 */
class StorefrontClientIpBoundaryTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'client-ip-secret';

    private const URL = 'http://laravel-internal.test/store/v1/auth/login';

    private const HOST = 'ip.wholesale.test';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);

        $this->tenant = Tenant::create([
            'name' => 'ip', 'slug' => 'ip-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => self::HOST, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();
    }

    /** One failing login attempt (wrong credentials ⇒ 422, but it still consumes limiter budget). */
    private function attempt(string $email, array $spoof = [], string $remote = '203.0.113.9')
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $remote])
            ->withHeaders(array_merge([
                'X-Storefront-Forwarded-Host' => self::HOST, 'X-Storefront-Gateway-Secret' => self::SECRET,
            ], $spoof))
            ->postJson(self::URL, ['email' => $email, 'password' => 'wrong-password-1']);
    }

    /** Every header a browser or intermediary could use to claim an identity. */
    private function spoofSet(string $ip): array
    {
        return [
            'X-Forwarded-For' => $ip, 'X-Real-IP' => $ip, 'Forwarded' => "for={$ip}", 'CF-Connecting-IP' => $ip,
            'True-Client-IP' => $ip, 'X-Client-IP' => $ip, 'X-Storefront-Client-Ip' => $ip, 'X-Originating-IP' => $ip,
        ];
    }

    #[Test]
    public function no_forwarding_header_changes_the_limiter_identity_even_with_the_correct_gateway_secret(): void
    {
        RateLimiter::clear('x');

        // 20 attempts, each claiming a different client IP through every common header. If any header were trusted,
        // each would land in a fresh bucket and the 21st would still pass.
        for ($i = 1; $i <= 20; $i++) {
            $this->attempt("user{$i}@ip.test", $this->spoofSet("198.51.100.{$i}"))->assertStatus(422);
        }

        $this->attempt('user21@ip.test', $this->spoofSet('198.51.100.99'))->assertStatus(429);
    }

    #[Test]
    public function the_identity_is_the_connection_address_not_a_header(): void
    {
        for ($i = 1; $i <= 20; $i++) {
            $this->attempt("a{$i}@ip.test", $this->spoofSet('8.8.8.8'), remote: '203.0.113.50')->assertStatus(422);
        }

        // a different connection address has its own fresh bucket regardless of what its headers claim
        $this->attempt('fresh@ip.test', $this->spoofSet('203.0.113.50'), remote: '203.0.113.51')->assertStatus(422);
        // while the exhausted address stays exhausted whatever it claims
        $this->attempt('late@ip.test', $this->spoofSet('1.1.1.1'), remote: '203.0.113.50')->assertStatus(429);
    }

    #[Test]
    public function the_per_address_limit_survives_rotating_claimed_ips(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $this->attempt('victim@ip.test', $this->spoofSet("192.0.2.{$i}"))->assertStatus(422);
        }

        $this->attempt('victim@ip.test', $this->spoofSet('192.0.2.200'))->assertStatus(429);
    }

    #[Test]
    public function characterization_all_buyers_behind_the_gateway_share_one_ip_bucket(): void
    {
        // KNOWN, DOCUMENTED LIMITATION (Batch G finding / Batch H §P0a): the gateway reaches Laravel from one address, so
        // 20 attempts by ANY mix of buyers exhaust the per-tenant IP bucket for everyone for the rest of the minute.
        // Fixing it needs a verified client-IP strategy that this batch could not establish; this test pins today's
        // behaviour so that changing it is a deliberate, reviewed decision — not an accident.
        for ($i = 1; $i <= 20; $i++) {
            $this->attempt("buyer{$i}@ip.test")->assertStatus(422);
        }

        $this->attempt('innocent-buyer@ip.test')->assertStatus(429);
    }

    #[Test]
    public function other_tenants_buckets_are_independent(): void
    {
        for ($i = 1; $i <= 20; $i++) {
            $this->attempt("t{$i}@ip.test")->assertStatus(422);
        }
        $this->attempt('x@ip.test')->assertStatus(429);

        $other = Tenant::create(['name' => 'ip2', 'slug' => 'ip2-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($other->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'ip2.wholesale.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
            ->withHeaders(['X-Storefront-Forwarded-Host' => 'ip2.wholesale.test', 'X-Storefront-Gateway-Secret' => self::SECRET])
            ->postJson(self::URL, ['email' => 'y@ip.test', 'password' => 'wrong-password-1'])->assertStatus(422);
    }
}
