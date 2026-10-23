<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Stocktake;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\StocktakeService;
use App\Services\StocktakeCountImportService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H7-S1 — ترحيل جردٍ متزامن مع استيراد ورقة عدّ تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): لا يُكتب عدٌّ على جردٍ رُحِّل، ولا يُرحَّل نصف ورقة.
 * الثابت: جردٌ مرحَّل ⇒ كل سطر معدود بفرقٍ غير صفري له تكلفة وقيمة فرق (أي أن العدّ كان مكتوباً **قبل** الترحيل)؛ وإلا فالاستيراد فشل والورقة بلا عدّ.
 * **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL.
 */
class StocktakeCountImportConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/stocktake_import_race_'.uniqid();
        mkdir($this->dir);
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
                DB::table('tenants')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    /** @return array{0: string, 1: Stocktake, 2: string} [tenant, stocktake, csv] */
    private function sheet(int $products): array
    {
        $auth = $this->registerTenant('stk-'.substr(md5((string) microtime(true)), 0, 8), 'stk'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $warehouse = Warehouse::create(['name' => 'رئيسي', 'code' => 'WH-1', 'is_default' => true]);
        $rows = [];
        foreach (range(1, $products) as $n) {
            $product = Product::create(['name' => "صنف {$n}", 'sku' => "SKU-{$n}", 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($product, 100, 1000, ['warehouse_id' => $warehouse->id]);
            $rows[] = ["SKU-{$n}", (string) (90 + ($n % 5))];   // كل سطر بفرق غير صفري
        }
        $stocktake = app(StocktakeService::class)->open(['warehouse_id' => $warehouse->id]);

        return [$auth['tenant_id'], $stocktake, SpreadsheetWriter::csv(['sku', 'counted_quantity'], $rows)];
    }

    /** @test */
    public function posting_racing_an_import_never_posts_a_partial_sheet_or_counts_a_posted_stocktake(): void
    {
        [$tenant, $stocktake, $csv] = $this->sheet(60);
        $path = $this->dir.'/count.csv';
        file_put_contents($path, $csv);

        $jobs = [
            function () use ($tenant, $stocktake, $path) {
                app(TenantContext::class)->set($tenant);

                return app(StocktakeCountImportService::class)->apply(new UploadedFile($path, 'count.csv', 'text/csv', null, true), ['stocktake_id' => $stocktake->id])['written'];
            },
            function () use ($tenant, $stocktake) {
                app(TenantContext::class)->set($tenant);
                usleep(20_000);

                return app(StocktakeService::class)->post(Stocktake::query()->findOrFail($stocktake->id))->status;
            },
        ];
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $fresh = Stocktake::query()->with('lines')->findOrFail($stocktake->id);
        $counted = $fresh->lines->filter(fn ($l) => $l->counted_quantity !== null);
        $detail = json_encode($results, JSON_UNESCAPED_UNICODE);

        if ($fresh->status === 'posted') {
            // كل ما عُدَّ رُحِّل فرقه (تكلفة وقيمة)، ولا سطر معدود بعد الترحيل.
            foreach ($counted as $line) {
                $this->assertNotNull($line->unit_cost, "سطر معدود بلا تكلفة بعد الترحيل — عدٌّ كُتب على جردٍ مرحَّل: {$detail}");
            }
            $this->assertContains($counted->count(), [0, 60], "نصف ورقة رُحِّل: {$detail}");
        } else {
            $this->assertSame('draft', $fresh->status, $detail);
        }
        // الاستيراد إما كتب الورقة كلها أو لم يكتب شيئاً
        $this->assertContains($counted->count(), [0, 60], $detail);
    }

    /**
     * **حتمي:** نمسك قفل صف الجرد من اتصال آخر (كما يفعل `post()` في أول خطوة) ثم نحوّله إلى «مرحَّل» ونحرّر. استيرادٌ يأخذ القفل ينتظر ثم يرى الحالة
     * مرحَّلة فيفشل بلا أي عدّ؛ استيرادٌ بلا قفل (قراءة قديمة للحالة) كان يمضي فوراً ويكتب عدداً على جردٍ مرحَّل. الاختبار يفشل إن أُزيل القفل.
     *
     * @test
     */
    public function the_import_waits_for_the_stocktake_row_lock_and_then_sees_it_posted(): void
    {
        [$tenant, $stocktake, $csv] = $this->sheet(5);
        $path = $this->dir.'/count.csv';
        file_put_contents($path, $csv);
        $locked = $this->dir.'/locked';

        // لا اتصال مشترك عبر الـfork (مقبس SSL واحد يفسده `purge` الطفل): نُغلق اتصال الأب قبل التفرّع، ويفتح كلٌّ اتصاله بعده.
        DB::purge();
        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid);
        if ($pid === 0) {
            DB::purge();
            $deadline = microtime(true) + 10;
            while (! file_exists($locked) && microtime(true) < $deadline) {
                usleep(1000);
            }
            app(TenantContext::class)->set($tenant);
            $started = microtime(true);
            try {
                app(StocktakeCountImportService::class)->apply(new UploadedFile($path, 'count.csv', 'text/csv', null, true), ['stocktake_id' => $stocktake->id]);
                file_put_contents($this->dir.'/child_result', json_encode(['ok' => true, 'waited' => microtime(true) - $started]));
            } catch (\Throwable $e) {
                file_put_contents($this->dir.'/child_result', json_encode(['ok' => false, 'message' => $e->getMessage(), 'waited' => microtime(true) - $started]));
            }
            exit(0);
        }

        $holder = DB::connection();
        $holder->beginTransaction();
        $holder->select('select id from stocktakes where id = ? for update', [$stocktake->id]);
        touch($locked);
        usleep(1_200_000);   // الطفل يجب أن يكون عالقاً على القفل الآن
        $this->assertFileDoesNotExist($this->dir.'/child_result', 'الاستيراد مضى دون انتظار قفل صف الجرد: '.(is_file($this->dir.'/child_result') ? file_get_contents($this->dir.'/child_result') : ''));

        $holder->update("update stocktakes set status = 'posted' where id = ?", [$stocktake->id]);
        $holder->commit();
        pcntl_waitpid($pid, $status);

        $result = json_decode((string) file_get_contents($this->dir.'/child_result'), true);
        $this->assertFalse($result['ok'], json_encode($result, JSON_UNESCAPED_UNICODE));
        $this->assertStringContainsString('مرحَّل', $result['message']);
        $this->assertGreaterThan(1.0, $result['waited']);
        app(TenantContext::class)->set($tenant);
        $this->assertSame(0, \App\Models\StocktakeLine::query()->where('stocktake_id', $stocktake->id)->whereNotNull('counted_quantity')->count());
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
                DB::connection()->getPdo();
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
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
