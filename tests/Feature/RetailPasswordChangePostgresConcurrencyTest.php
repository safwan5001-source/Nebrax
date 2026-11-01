<?php

namespace Tests\Feature;

use App\Models\CustomerIdentity;
use App\Models\CustomerPasswordResetToken;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  B2C-ACCOUNTS — تزامن حقيقي (PostgreSQL): تغيير كلمة المرور مقابل تغيير آخر ومقابل إعادة تعيين بالبريد
 * ═══════════════════════════════════════════════════════════════
 *  الثابت: `PUT account/password` يتحقّق من كلمة المرور الحالية على صفّ الهوية **المقفول** الطازج داخل المعاملة نفسها، فلا يستطيع
 *  طلبٌ مصادَق بكلمة المرور القديمة (جلسته أُنهيت لتوّها بإعادة تعيين) أن يكتب فوق كلمة مرور أُعيد تعيينها، ولا يستطيع تغييران
 *  متداخلان بالكلمة القديمة نفسها أن ينجحا معاً. يفشل (لا يتخطّى) على PostgreSQL إن غاب pcntl؛ يُتخطّى على SQLite فقط.
 */
class RetailPasswordChangePostgresConcurrencyTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private const SECRET = 'pw-race-secret';

    private const HOST = 'pw-race.retail.test';

    private const OLD = 'old-password-1';

    private string $dir;

    private string $tenantId;

    private string $channelId;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');
        config([
            'commerce.retail_accounts_enabled' => true,
            'storefront.gateway_secret' => self::SECRET,
            'commerce.buyer_password_reset_resend_gap_seconds' => 0,
        ]);

        $this->dir = sys_get_temp_dir().'/retail_pw_pg_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'كلمات مرور متزامنة', 'slug' => 'pw-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['customer_accounts_enabled' => true])->save();
        $this->channelId = $channel->id;
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => self::HOST, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('personal_access_tokens')->whereIn('tokenable_id', DB::table('customer_identities')->where('tenant_id', $id)->pluck('id'))->delete();
                DB::table('customer_password_reset_tokens')->where('tenant_id', $id)->delete();
                DB::table('customer_identities')->where('tenant_id', $id)->delete();
                DB::table('tenants')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    /** One identity with two live sessions (bound to this channel) and an unused reset link. @return array{0:CustomerIdentity,1:string,2:string,3:string} */
    private function fixture(string $label): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $identity = CustomerIdentity::create([
            'tenant_id' => $this->tenantId, 'display_name' => $label, 'email' => $label.'-'.Str::random(5).'@pg.test',
            'password' => self::OLD, 'email_verified_at' => now(), 'is_active' => true,
        ]);
        $ability = 'store-channel:'.$this->channelId;
        $t1 = $identity->createToken('customer', ['customer:access', $ability], now()->addDay())->plainTextToken;
        $t2 = $identity->createToken('customer', ['customer:access', $ability], now()->addDay())->plainTextToken;
        $plain = Str::random(64);
        CustomerPasswordResetToken::query()->create([
            'tenant_id' => $this->tenantId, 'customer_identity_id' => $identity->id, 'sales_channel_id' => $this->channelId,
            'token_hash' => hash('sha256', $plain), 'expires_at' => now()->addHour(),
        ]);

        return [$identity, $t1, $t2, $plain];
    }

    /** One real HTTP-kernel request, exactly as the storefront server sends it (gateway secret + forwarded host + customer token). */
    private function http(string $method, string $path, array $body, ?string $token = null): int
    {
        $headers = array_filter([
            'X-Storefront-Forwarded-Host' => self::HOST, 'X-Storefront-Gateway-Secret' => self::SECRET, 'X-Customer-Token' => $token,
        ]);

        return $this->withHeaders($headers)->json($method, 'http://laravel-internal.test/store/v1/'.$path, $body)->getStatusCode();
    }

    #[Test]
    public function a_stale_password_change_never_overwrites_a_concurrent_reset_and_two_changes_never_both_win(): void
    {
        for ($round = 0; $round < 5; $round++) {
            [$identity, $t1, $t2, $plain] = $this->fixture("race-{$round}");
            $reset = 'reset-password-'.$round;
            $pwA = 'change-a-password-'.$round;
            $pwB = 'change-b-password-'.$round;

            $jobs = [
                // overlapping change #1 and #2: both authenticated, both quoting the SAME old password
                fn (): array => ['status' => $this->http('PUT', 'account/password', ['current_password' => self::OLD, 'password' => $pwA], $t1)],
                fn (): array => ['status' => $this->http('PUT', 'account/password', ['current_password' => self::OLD, 'password' => $pwB], $t2)],
                // the e-mailed reset (single-use link) racing both
                fn (): array => ['status' => $this->http('POST', 'auth/password/reset', ['token' => $plain, 'password' => $reset])],
            ];

            $results = $this->runConcurrently($jobs);
            $this->assertAllOk($results);
            [$a, $b, $r] = array_map(fn ($x) => $x['value']['status'], $results);

            $fresh = CustomerIdentity::query()->withoutGlobalScopes()->findOrFail($identity->id);
            $matches = fn (string $pw): bool => Hash::check($pw, (string) $fresh->password);
            $live = PersonalAccessToken::query()->where('tokenable_id', $identity->id)->count();

            // 1. never two winning changes with the same "current" password (the second must see the first's write)
            $this->assertLessThanOrEqual(1, count(array_filter([$a, $b], fn ($s) => $s === 200)), "round {$round}: both changes succeeded: ".json_encode([$a, $b, $r]));

            // 2. the final password is exactly the LAST successful writer; the old password never survives a success
            $winners = array_filter(['a' => $a === 200 ? $pwA : null, 'b' => $b === 200 ? $pwB : null, 'r' => $r === 200 ? $reset : null]);
            $this->assertNotEmpty($winners, "round {$round}: at least one writer must win: ".json_encode([$a, $b, $r]));
            $this->assertFalse($matches(self::OLD), "round {$round}: the old password must not survive a successful write");
            $this->assertCount(1, array_filter($winners, fn (string $pw) => $matches($pw)), "round {$round}: the final password must be the last successful writer's, not a stale overwrite: ".json_encode([$a, $b, $r]));

            // 3. the stale-session case itself: if the reset succeeded, a change that succeeded must have committed BEFORE it
            //    (so the reset password is the final one) — a change can never land after the reset revoked its session.
            if ($r === 200) {
                $this->assertTrue($matches($reset), "round {$round}: a stale change overwrote the reset password: ".json_encode([$a, $b, $r]));
                $this->assertSame(0, $live, "round {$round}: the reset ends every session");
            } else {
                $this->assertSame(422, $r, "round {$round}: a reset that lost must be the generic 422");
            }

            // 4. a refused change is a clean 4xx (never a 500 / deadlock)
            foreach ([$a, $b] as $status) {
                $this->assertContains($status, [200, 401, 422], "round {$round}: unexpected status {$status}");
            }
        }
    }

    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $r) {
            $this->assertTrue($r['ok'] ?? false, "العملية {$i} فشلت: ".json_encode($r));
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    $value = $job();
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode([
                        'ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage(),
                    ]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
