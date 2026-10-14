<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\FlatHostBackfillException;
use App\Services\Commerce\FlatHostBackfillService;
use App\Services\Commerce\ManagedHostnameAvailability;
use App\Support\ManagedHostNamespaceLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * سباق «تسجيل مستأجر جديد» مقابل «Backfill مضيف» — إثبات بلا Schema (PostgreSQL فقط).
 *
 * يحاكي كل اختبار طرفاً حقيقياً داخل عملية متفرّعة ويُبقي طرفه عالقاً داخل معاملته (مثل الإنتاج)،
 * ثم يثبت أن الطرف الثاني **ينتظر فعلاً** (زمن) ويرى ما التزمه الأول فيرفض — لا مستأجر وصفّ نطاق
 * بنفس الشريحة. التسجيل يستدعي نفس الحارس الذي في AuthController (shared + assertTenantSlugFree).
 *
 * تشغيل: DB_CONNECTION=pgsql php artisan test --filter=ManagedHostNamespaceLockPostgresTest
 */
class ManagedHostNamespaceLockPostgresTest extends TestCase
{
    private const BASE = 'store.nsq.test';

    /** @var list<string> */
    private array $tenantIds = [];

    private string $slug;

    private string $legacyHost;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً (أقفال advisory).');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح.');
        }
        config(['storefront.managed_base_domain' => self::BASE]);

        // مستأجر قائم + متجر `h` قديم غير نشط (شكل الإنتاج) — كلها ملتزَمة فعلاً.
        $this->slug = 'ns'.Str::lower(Str::random(8));
        $tenant = $this->makeTenant($this->slug);
        $channel = SalesChannel::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'slug' => 'c-h', 'name' => 'h', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $sf = Storefront::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'sales_channel_id' => $channel->id, 'slug' => 'h', 'name' => 'h', 'is_active' => false,
        ]);
        $this->legacyHost = "h.{$this->slug}.".self::BASE;
        StorefrontDomain::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'storefront_id' => $sf->id, 'hostname' => $this->legacyHost,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN, 'is_primary' => true, 'is_active' => false,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
    }

    protected function tearDown(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql' && $this->tenantIds !== []) {
            // الحذف يشمل ما أنشأته العمليات المتفرّعة (تُعثر عليها بالسلاج)
            $ids = DB::table('tenants')->where('slug', 'like', $this->slug.'%')->pluck('id')->all();
            DB::table('storefront_domains')->whereIn('tenant_id', $ids)->delete();
            DB::table('storefronts')->whereIn('tenant_id', $ids)->delete();
            DB::table('sales_channels')->whereIn('tenant_id', $ids)->delete();
            DB::table('tenants')->whereIn('id', $ids)->delete();
        }
        parent::tearDown();
    }

    private function makeTenant(string $slug): Tenant
    {
        $t = Tenant::create([
            'name' => $slug, 'slug' => $slug, 'currency' => 'SAR', 'is_active' => true,
            'vat_number' => '300000000000003',
        ]);
        $this->tenantIds[] = $t->id;

        return $t;
    }

    // ── أ) تسجيل جارٍ ⇒ الـBackfill ينتظر ثم يرى المستأجر فيرفض ─────────────────

    /** @test */
    public function a_registration_in_flight_makes_the_backfill_wait_then_abort_on_the_committed_tenant(): void
    {
        $newSlug = $this->slug.'-h'; // يطابق هدف الـBackfill dominah-h
        $ready = $this->signal();

        $registrant = pcntl_fork();
        if ($registrant === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($newSlug, $ready) {
                ManagedHostNamespaceLock::shared();
                app(ManagedHostnameAvailability::class)->assertTenantSlugFree($newSlug); // حرّ الآن
                Tenant::create(['name' => $newSlug, 'slug' => $newSlug, 'currency' => 'SAR', 'is_active' => true, 'vat_number' => '300000000000003']);
                touch($ready);
                usleep(1_300_000); // لا يزال داخل المعاملة (غير ملتزم)
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $registrant);
        $this->waitFor($ready);

        $start = microtime(true);
        try {
            app(FlatHostBackfillService::class)->run([$this->legacyHost], true);
            $this->fail('backfill should have aborted on the committed tenant');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('target_is_tenant_slug', $e->reason);
        }
        $elapsed = microtime(true) - $start;
        pcntl_waitpid($registrant, $status);
        @unlink($ready);

        $this->assertGreaterThan(0.8, $elapsed, 'backfill must have waited for the in-flight registration');
        $this->assertSame(0, DB::table('storefront_domains')->where('hostname', "{$this->slug}-h.".self::BASE)->count());
        $this->assertSame(1, DB::table('tenants')->where('slug', $newSlug)->count());
    }

    // ── ب) Backfill جارٍ ⇒ التسجيل ينتظر ثم يرى النطاق فيُرفض ─────────────────

    /** @test */
    public function a_backfill_in_flight_makes_a_registration_wait_then_reject_on_the_committed_domain(): void
    {
        $newSlug = $this->slug.'-h';
        $inserted = $this->signal();

        $backfill = pcntl_fork();
        if ($backfill === 0) {
            DB::purge(config('database.default'));
            DB::listen(function ($q) use ($inserted) {
                if (stripos($q->sql, 'insert into "storefront_domains"') === 0) {
                    touch($inserted);
                    usleep(1_300_000); // لا يزال داخل معاملة الـBackfill
                }
            });
            app(FlatHostBackfillService::class)->run([$this->legacyHost], true);
            exit(0);
        }
        $this->assertGreaterThan(0, $backfill);
        $this->waitFor($inserted);

        $start = microtime(true);
        $rejected = false;
        try {
            DB::transaction(function () use ($newSlug) {
                ManagedHostNamespaceLock::shared();
                app(ManagedHostnameAvailability::class)->assertTenantSlugFree($newSlug);
                $this->makeTenant($newSlug); // لا يجب الوصول إليه
            });
        } catch (ValidationException $e) {
            $rejected = isset($e->errors()['slug']);
        }
        $elapsed = microtime(true) - $start;
        pcntl_waitpid($backfill, $status);
        @unlink($inserted);

        $this->assertTrue($rejected, 'registration must be rejected once the backfilled domain is committed');
        $this->assertGreaterThan(0.8, $elapsed, 'registration must have waited for the in-flight backfill');
        $this->assertSame(0, DB::table('tenants')->where('slug', $newSlug)->count());
        $this->assertSame(1, DB::table('storefront_domains')->where('hostname', "{$this->slug}-h.".self::BASE)->count());
    }

    // ── ج) التسجيلات لا تحجب بعضها (قفل مشترك) ───────────────────────────────

    /** @test */
    public function registrations_do_not_block_each_other(): void
    {
        $ready = $this->signal();
        $holder = pcntl_fork();
        if ($holder === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($ready) {
                ManagedHostNamespaceLock::shared();
                touch($ready);
                usleep(1_500_000);
            });
            exit(0);
        }
        $this->waitFor($ready);

        $start = microtime(true);
        DB::transaction(fn () => ManagedHostNamespaceLock::shared());
        $elapsed = microtime(true) - $start;
        pcntl_waitpid($holder, $status);
        @unlink($ready);

        $this->assertLessThan(0.5, $elapsed, 'a shared lock must not wait for another shared holder');
    }

    /** @test */
    public function the_lock_refuses_to_run_outside_a_transaction(): void
    {
        $this->expectException(\LogicException::class);
        ManagedHostNamespaceLock::exclusive();
    }

    private function signal(): string
    {
        $p = tempnam(sys_get_temp_dir(), 'nsq_');
        unlink($p);

        return $p;
    }

    private function waitFor(string $path): void
    {
        $deadline = microtime(true) + 8.0;
        while (! file_exists($path) && microtime(true) < $deadline) {
            usleep(1000);
        }
        if (! file_exists($path)) {
            throw new \RuntimeException("Timed out waiting for {$path}");
        }
    }
}
