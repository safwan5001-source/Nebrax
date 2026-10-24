<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Services\Accounting\PurchaseService;
use App\Services\PurchaseImportService;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetWriter;
use Illuminate\Http\UploadedFile;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Support\DuplicateDocumentException;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H5-S3b — عدة عمليات استيراد لملف فاتورة المورّد نفسه (ومعها إنشاء مباشر تحت block) تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`):
 * مسودة واحدة بسطورها كلها ومحجوز واحد، والخاسرون يفشلون فشل وحدةٍ مسمّاة لا استثناءً مجهولاً. **لا يُتخطّى** إن غاب `pcntl`.
 */
class PurchaseImportConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/purchase_import_race_'.uniqid();
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

    /** @return array{0: string, 1: string, 2: string, 3: string} [tenant, supplier id, sku, csv content] */
    private function tenantWithFile(string $ref = 'RACE-1'): array
    {
        $auth = $this->registerTenant('imp-'.substr(md5((string) microtime(true)), 0, 8), 'imp'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $supplier = Partner::create(['name' => 'مورّد السباق', 'type' => 'supplier', 'code' => 'S-R'])->id;
        $a = Product::create(['name' => 'صنف أ', 'sku' => 'RA', 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true]);
        Product::create(['name' => 'صنف ب', 'sku' => 'RB', 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true]);

        $csv = SpreadsheetWriter::csv(
            ['supplier_code', 'supplier_invoice_ref', 'purchase_date', 'sku', 'quantity', 'unit_price'],
            [['S-R', $ref, '2026-10-01', 'RA', '2', '10.00'], ['S-R', $ref, '', 'RB', '3', '20.00']],
        );

        return [$auth['tenant_id'], $supplier, $a->id, $csv];
    }

    /** @test */
    public function concurrent_imports_of_the_same_file_yield_exactly_one_draft_with_all_its_lines(): void
    {
        [$tenant, , , $csv] = $this->tenantWithFile();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($tenant, $csv) {
                app(TenantContext::class)->set($tenant);

                return app(PurchaseImportService::class)->apply(UploadedFile::fake()->createWithContent('p.csv', $csv), [])['created'];
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Purchase::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(2, Purchase::query()->firstOrFail()->lines()->count());
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertCount(1, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(ImportUnitFailureException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @test */
    public function imports_racing_direct_creations_under_block_yield_one_purchase_in_either_order(): void
    {
        [$tenant, $supplier, $sku, $csv] = $this->tenantWithFile('MIX-1');
        Settings::put('purchases', ['duplicate_reference_policy' => 'block']);

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = function () use ($tenant, $csv, $supplier, $sku, $i) {
                app(TenantContext::class)->set($tenant);
                if ($i % 2 === 0) {
                    return app(PurchaseImportService::class)->apply(UploadedFile::fake()->createWithContent('p.csv', $csv), [])['created'];
                }

                return app(PurchaseService::class)->create(
                    ['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => $i % 3 === 0 ? 'mix 1' : 'MIX-1', 'number' => "BILL-X-{$i}"],
                    [['product_id' => $sku, 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]],
                )->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Purchase::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertContains($r['error_class'] ?? null, [ImportUnitFailureException::class, DuplicateDocumentException::class], json_encode($r, JSON_UNESCAPED_UNICODE));
            }
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
