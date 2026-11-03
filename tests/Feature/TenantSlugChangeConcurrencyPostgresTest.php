<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\Commerce\CreateStorefrontForCurrentTenant;
use App\Support\ManagedHostNamespaceLock;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * سباق إصلاح السلاج مع إنشاء متجر إضافي (ملاحظة مراجعة PR #1965): فضاء المضيفات المُدارة مشترك
 * بين `tenants.slug` و`storefront_domains.hostname` بقيدَي تفرّد منفصلَين، فبلا قفل مشترك في إنشاء
 * المتجر الإضافي يمرّ فحصان متزامنان ثم يلتزمان معاً: مستأجر `a-b-c` ومتجر `b-c` للمستأجر `a`
 * بالمضيف نفسه `a-b-c.{base}`.
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=TenantSlugChangeConcurrencyPostgresTest
 */
class TenantSlugChangeConcurrencyPostgresTest extends TestCase
{
    /** @var list<string> */
    private array $tenantIds = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات القفل الاستشاري.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        config(['storefront.managed_base_domain' => 'storefronts.test']);
    }

    protected function tearDown(): void
    {
        foreach ($this->tenantIds as $id) {
            DB::table('storefront_domains')->where('tenant_id', $id)->delete();
            DB::table('storefronts')->where('tenant_id', $id)->delete();
            DB::table('sales_channels')->where('tenant_id', $id)->delete();
            DB::table('tenants')->where('id', $id)->delete();
        }

        parent::tearDown();
    }

    private function tenant(string $slug): Tenant
    {
        $tenant = Tenant::create(['name' => 'T '.$slug, 'slug' => $slug, 'currency' => 'SAR', 'is_active' => true]);
        $this->tenantIds[] = $tenant->id;

        return $tenant;
    }

    /** @test */
    public function an_additional_store_waits_for_a_concurrent_slug_repair_and_never_takes_the_repaired_hostname(): void
    {
        $prefix = Str::lower(Str::random(6));
        $owner = $this->tenant($prefix);                       // مستأجر `{prefix}` ينشئ متجراً إضافياً `b-c`
        $broken = $this->tenant($prefix.'_b_c');               // سيُصلَح إلى `{prefix}-b-c` = مضيف `{prefix}` + `b-c` نفسه
        $target = $prefix.'-b-c';
        $lockReady = $this->signalPath('slug_lock_');
        $callerStarted = $this->signalPath('slug_caller_');
        $resultFile = tempnam(sys_get_temp_dir(), 'slug_result_');

        // Locker: يمسك القفل الحصري كما تفعل الأداة، وينتظر بدء الطالب، ثم يلتزم الإصلاح.
        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($broken, $target, $lockReady, $callerStarted) {
                ManagedHostNamespaceLock::exclusive();
                touch($lockReady);
                $this->waitForSignal($callerStarted);
                usleep(800000); // يكفي ليبلغ الطالب نقطة القفل
                DB::table('tenants')->where('id', $broken->id)->update(['slug' => $target]);
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $locker);
        $this->waitForSignal($lockReady);

        $caller = pcntl_fork();
        if ($caller === 0) {
            DB::purge(config('database.default'));
            app(TenantContext::class)->set($owner->id);
            touch($callerStarted);
            try {
                $store = app(CreateStorefrontForCurrentTenant::class)->create('b-c', 'ar');
                file_put_contents($resultFile, json_encode(['ok' => true, 'preview' => $store['preview_url']]));
            } catch (\Throwable $e) {
                file_put_contents($resultFile, json_encode(['ok' => false, 'message' => $e->getMessage()]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $caller);

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($caller, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        @unlink($lockReady);
        @unlink($callerStarted);
        @unlink($resultFile);

        $this->assertTrue($result['ok'], json_encode($result));
        $this->assertSame($target, DB::table('tenants')->where('id', $broken->id)->value('slug'));
        // الطالب انتظر ثم رأى السلاج الجديد محجوزاً فاختار مضيفاً آخر — لا مضيف مكرر لمستأجر مُصلَح.
        $this->assertSame(0, DB::table('storefront_domains')->where('hostname', $target.'.storefronts.test')->count());
        $this->assertNotSame('https://'.$target.'.storefronts.test/', $result['preview']);
    }

    private function signalPath(string $prefix): string
    {
        $path = tempnam(sys_get_temp_dir(), $prefix);
        unlink($path);

        return $path;
    }

    private function waitForSignal(string $path): void
    {
        $deadline = microtime(true) + 5.0;
        while (! file_exists($path) && microtime(true) < $deadline) {
            usleep(1000);
        }
        if (! file_exists($path)) {
            throw new \RuntimeException("Timed out waiting for {$path}");
        }
    }
}
