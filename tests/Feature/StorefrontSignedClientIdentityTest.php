<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\StorefrontClientIdentity;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  B2C ACTIVATION READINESS — هوية الزائر الموقَّعة لمحدِّدات مصادقة المتجر
 * ═══════════════════════════════════════════════════════════════
 *  الفرضية الدفاعية: كل ما يرسله المتصفح غير موثوق؛ الموثوق فقط ما يوقّعه خادم المتجر بسرّ البوابة، وبعد أن يُعلن المشغّل مصدراً
 *  موثوقاً للعنوان. هنا نثبّت: (1) فصل الزوار المستقلين، (2) بقاء حارس القوة الغاشمة لكل بريد وسقف المتجر، (3) سقوط كل طلب مزوَّر/
 *  منتهٍ/خارج النطاق إلى السلة القديمة المشتركة (لا يمنحه التزوير حدّاً أعلى)، (4) عدم إضعاف الجملة، (5) إغلاق افتراضي.
 */
class StorefrontSignedClientIdentityTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'signed-ip-secret';

    private const LOGIN = 'http://laravel-internal.test/store/v1/auth/login';

    private const RETAIL = 'shop.signed.test';

    private const RETAIL_B = 'shop-b.signed.test';

    private const WHOLESALE = 'b2b.signed.test';

    private const BOTH = 'both.signed.test';

    /** The one address every request really comes from: the storefront server. */
    private const GATEWAY_ADDR = '203.0.113.9';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'commerce.retail_accounts_enabled' => true,
            'commerce.wholesale_buyer_enabled' => true,
            'storefront.gateway_secret' => self::SECRET,
            'storefront.client_identity.enabled' => true,
            'storefront.client_identity.backstop_multiplier' => 10,
        ]);

        // host => [retail, wholesale]
        foreach ([
            self::RETAIL => [true, false],
            self::RETAIL_B => [true, false],
            self::WHOLESALE => [false, true],
            self::BOTH => [true, true],
        ] as $host => [$retail, $wholesale]) {
            $tenant = Tenant::create(['name' => $host, 'slug' => 't-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
            app(TenantContext::class)->set($tenant->id);
            $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
            $channel->forceFill(['customer_accounts_enabled' => $retail, 'wholesale_membership_enabled' => $wholesale])->save();
            $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
            StorefrontDomain::create([
                'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
            app(TenantContext::class)->forget();
        }
    }

    /** A public, distinct visitor address. */
    private function visitor(int $n): string
    {
        return '34.120.'.intdiv($n, 250).'.'.(($n % 250) + 1);
    }

    /** Headers exactly as the storefront server would send them. */
    private function signed(string $host, string $ip, ?int $ts = null, string $secret = self::SECRET, ?string $signHost = null): array
    {
        $ts ??= time();

        return [
            'X-Storefront-Forwarded-Host' => $host,
            'X-Storefront-Gateway-Secret' => self::SECRET,
            StorefrontClientIdentity::HEADER_IP => $ip,
            StorefrontClientIdentity::HEADER_TIMESTAMP => (string) $ts,
            StorefrontClientIdentity::HEADER_SIGNATURE => StorefrontClientIdentity::signature($secret, $signHost ?? $host, $ip, $ts),
        ];
    }

    /** One failing login (422 when allowed, 429 when throttled); a unique e-mail keeps the per-address brake out of the way. */
    private function login(array $headers, ?string $email = null)
    {
        $this->flushHeaders();

        return $this->withServerVariables(['REMOTE_ADDR' => self::GATEWAY_ADDR])
            ->withHeaders($headers)
            ->postJson(self::LOGIN, ['email' => $email ?? Str::random(10).'@x.test', 'password' => 'wrong-password-1']);
    }

    private function legacyHeaders(string $host): array
    {
        return ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
    }

    #[Test]
    public function signature_encoding_is_pinned_to_the_storefront_signer_vector(): void
    {
        // The same vector is asserted in storefront/src/lib/commerce/__tests__/client-attestation.test.ts — the two encodings
        // must never drift apart (a drift silently disables the feature, which is safe but invisible).
        $this->assertSame(
            '44c4ddacb69135606fbde789b667b99de9da54ccae492a1438fac51614a3779f',
            StorefrontClientIdentity::signature('vector-secret', 'shop.example.com', '203.0.113.7', 1700000000),
        );
    }

    #[Test]
    public function independent_signed_visitors_do_not_share_one_login_bucket(): void
    {
        // Legacy behaviour: the 21st request in a minute from the gateway address is throttled for EVERYONE.
        for ($i = 0; $i < 60; $i++) {
            $this->login($this->signed(self::RETAIL, $this->visitor($i)))->assertStatus(422);
        }
    }

    #[Test]
    public function one_abusive_visitor_is_throttled_without_affecting_others(): void
    {
        $abuser = $this->visitor(1);
        for ($i = 0; $i < 20; $i++) {
            $this->login($this->signed(self::RETAIL, $abuser))->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, $abuser))->assertStatus(429);

        // An honest shopper behind the very same gateway address is untouched.
        $this->login($this->signed(self::RETAIL, $this->visitor(2)))->assertStatus(422);
    }

    #[Test]
    public function the_per_address_brute_force_brake_still_bites_across_many_visitors(): void
    {
        // Same victim address from many different "visitors": 5/min per account regardless of the network dimension.
        for ($i = 0; $i < 5; $i++) {
            $this->login($this->signed(self::RETAIL, $this->visitor($i)), 'victim@x.test')->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, $this->visitor(99)), 'victim@x.test')->assertStatus(429);
    }

    #[Test]
    public function the_store_wide_backstop_still_stops_distributed_credential_spraying(): void
    {
        config(['storefront.client_identity.backstop_multiplier' => 2]); // 20 * 2 = 40 / minute for the whole store

        for ($i = 0; $i < 40; $i++) {
            $this->login($this->signed(self::RETAIL, $this->visitor($i)))->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, $this->visitor(500)))->assertStatus(429);

        // The backstop is per store: another store of the platform is unaffected.
        $this->login($this->signed(self::RETAIL_B, $this->visitor(500)))->assertStatus(422);
    }

    /** @return array<string, array{0: string}> */
    public static function forgeries(): array
    {
        $cases = ['wrong secret', 'tampered address', 'expired timestamp', 'future timestamp', 'signed for another host',
            'private address', 'loopback address', 'garbage signature', 'missing signature'];

        return array_combine($cases, array_map(fn (string $c): array => [$c], $cases));
    }

    #[Test]
    #[DataProvider('forgeries')]
    public function a_forged_or_invalid_identity_falls_back_to_the_shared_legacy_bucket(string $case): void
    {
        $build = function (int $n) use ($case): array {
            $ip = $this->visitor($n);
            $h = $this->signed(self::RETAIL, $ip);

            return match ($case) {
                'wrong secret' => $this->signed(self::RETAIL, $ip, null, 'not-the-gateway-secret'),
                'tampered address' => array_merge($h, [StorefrontClientIdentity::HEADER_IP => $this->visitor($n + 1000)]),
                'expired timestamp' => $this->signed(self::RETAIL, $ip, time() - 3600),
                'future timestamp' => $this->signed(self::RETAIL, $ip, time() + 3600),
                'signed for another host' => $this->signed(self::RETAIL, $ip, null, self::SECRET, self::RETAIL_B),
                'private address' => $this->signed(self::RETAIL, '10.1.2.'.(($n % 250) + 1)),
                'loopback address' => $this->signed(self::RETAIL, '127.0.0.'.(($n % 250) + 1)),
                'garbage signature' => array_merge($h, [StorefrontClientIdentity::HEADER_SIGNATURE => str_repeat('a', 64)]),
                'missing signature' => array_diff_key($h, [StorefrontClientIdentity::HEADER_SIGNATURE => 1]),
            };
        };

        // Each attempt claims a different visitor. If any were honoured, each would get a fresh bucket and the 21st would pass.
        for ($i = 0; $i < 20; $i++) {
            $this->login($build($i))->assertStatus(422);
        }
        $this->login($build(21))->assertStatus(429);
    }

    #[Test]
    public function plain_forwarding_headers_stay_inert_even_with_the_feature_on(): void
    {
        $spoof = fn (int $n): array => $this->legacyHeaders(self::RETAIL) + [
            'X-Forwarded-For' => $this->visitor($n), 'X-Real-IP' => $this->visitor($n), 'Forwarded' => 'for='.$this->visitor($n),
            'CF-Connecting-IP' => $this->visitor($n), 'True-Client-IP' => $this->visitor($n),
            StorefrontClientIdentity::HEADER_IP => $this->visitor($n), // unsigned
        ];

        for ($i = 0; $i < 20; $i++) {
            $this->login($spoof($i))->assertStatus(422);
        }
        $this->login($spoof(21))->assertStatus(429);
    }

    #[Test]
    public function a_direct_request_without_the_gateway_secret_can_never_use_a_signed_identity(): void
    {
        // The signature is valid, but the caller never proved it is the storefront server (no secret ⇒ no forwarded host either).
        // It is treated as a direct request on the API's own host, which resolves to no store.
        $headers = $this->signed(self::RETAIL, $this->visitor(1));
        unset($headers['X-Storefront-Gateway-Secret']);

        $this->login($headers)->assertStatus(404);
    }

    #[Test]
    public function the_feature_is_off_by_default_and_a_valid_signature_is_then_ignored(): void
    {
        config(['storefront.client_identity.enabled' => false]);

        for ($i = 0; $i < 20; $i++) {
            $this->login($this->signed(self::RETAIL, $this->visitor($i)))->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, $this->visitor(50)))->assertStatus(429);
    }

    #[Test]
    public function the_shipped_default_is_closed(): void
    {
        $this->assertFalse((bool) (require base_path('config/storefront.php'))['client_identity']['enabled']);
    }

    #[Test]
    public function wholesale_hosts_keep_the_original_shared_limit(): void
    {
        foreach ([self::WHOLESALE, self::BOTH] as $host) {
            for ($i = 0; $i < 20; $i++) {
                $this->login($this->signed($host, $this->visitor($i + 300)))->assertStatus(422);
            }
            $this->login($this->signed($host, $this->visitor(777)))->assertStatus(429);
        }
    }

    #[Test]
    public function ipv6_addresses_in_one_slash_64_share_a_bucket(): void
    {
        for ($i = 1; $i <= 20; $i++) {
            $this->login($this->signed(self::RETAIL, '2a00:1450:4001:810:'.dechex($i).':0:0:1'))->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, '2a00:1450:4001:810:ffff::9'))->assertStatus(429);
        // A different /64 is a different visitor.
        $this->login($this->signed(self::RETAIL, '2a00:1450:4001:811::1'))->assertStatus(422);
    }

    #[Test]
    public function an_ipv4_mapped_address_is_the_same_visitor_as_its_ipv4_form_and_private_mapped_ones_are_refused(): void
    {
        // Public mapped form is accepted (not silently dropped to the shared bucket) and shares the plain IPv4 bucket.
        for ($i = 0; $i < 10; $i++) {
            $this->login($this->signed(self::RETAIL, '::ffff:34.120.5.5'))->assertStatus(422);
        }
        for ($i = 0; $i < 10; $i++) {
            $this->login($this->signed(self::RETAIL, '34.120.5.5'))->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, '::ffff:34.120.5.5'))->assertStatus(429); // 21st for ONE visitor
        $this->login($this->signed(self::RETAIL, $this->visitor(9)))->assertStatus(422);     // another visitor is free

        // A mapped PRIVATE address is a misconfigured source: legacy shared bucket, never a visitor bucket.
        $this->assertNull($this->bucketFor('::ffff:10.0.0.1'));
        $this->assertNull($this->bucketFor('::ffff:127.0.0.1'));
        $this->assertSame($this->bucketFor('34.120.5.5'), $this->bucketFor('::ffff:34.120.5.5'));
        $this->assertNotNull($this->bucketFor('34.120.5.5'));
    }

    private function bucketFor(string $ip): ?string
    {
        $request = \Illuminate\Http\Request::create('/store/v1/auth/login', 'POST', [], [], [], $this->transformHeadersToServerVars($this->signed(self::RETAIL, $ip)));
        $request->attributes->set(\App\Http\Middleware\ResolveStorefrontDomain::GATEWAY_VERIFIED_ATTRIBUTE, true);

        return StorefrontClientIdentity::bucket($request);
    }

    #[Test]
    public function the_same_visitor_gets_separate_buckets_on_different_stores(): void
    {
        $visitor = $this->visitor(5);
        for ($i = 0; $i < 20; $i++) {
            $this->login($this->signed(self::RETAIL, $visitor))->assertStatus(422);
        }
        $this->login($this->signed(self::RETAIL, $visitor))->assertStatus(429);
        $this->login($this->signed(self::RETAIL_B, $visitor))->assertStatus(422);
    }

    #[Test]
    public function the_register_and_reset_brakes_use_the_same_visitor_dimension(): void
    {
        $post = fn (string $path, int $n) => $this->withServerVariables(['REMOTE_ADDR' => self::GATEWAY_ADDR])
            ->withHeaders($this->signed(self::RETAIL, $this->visitor($n)))
            ->postJson('http://laravel-internal.test/store/v1/'.$path, ['email' => Str::random(8).'@x.test']);

        // register: 10/min per visitor. 12 DIFFERENT visitors never trip the shared bucket.
        for ($i = 0; $i < 12; $i++) {
            $this->assertNotSame(429, $post('auth/register', $i)->status());
        }
        // password/forgot: 20/min per visitor. 25 different visitors never trip it.
        for ($i = 0; $i < 25; $i++) {
            $this->assertNotSame(429, $post('auth/password/forgot', $i)->status());
        }
    }
}
