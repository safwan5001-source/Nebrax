<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Services\Accounting\PurchaseService;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Support\DuplicateDocumentException;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H5-S3a — استيراد ضد إنشاء مباشر (سياسة block) ضد حذف/تعديل لفاتورة المورّد نفسها تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`):
 * فاتورة واحدة فقط لكل (مورّد، رقم) مهما كان الترتيب، والخاسرون يتلقّون `DuplicateDocumentException`، ولا حجز يتيم. **لا يُتخطّى** إن غاب `pcntl`.
 */
class PurchaseDuplicateReservationConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/purchase_dup_race_'.uniqid();
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

    /** @return array{0: string, 1: string, 2: array<int, array<string, mixed>>} [tenant, supplier, items] */
    private function tenantWithSupplier(): array
    {
        $auth = $this->registerTenant('pur-'.substr(md5((string) microtime(true)), 0, 8), 'pur'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $supplier = Partner::create(['name' => 'مورّد السباق', 'type' => 'supplier'])->id;
        $product = Product::create(['name' => 'صنف', 'sku' => 'R-'.uniqid(), 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true])->id;

        return [$auth['tenant_id'], $supplier, [['product_id' => $product, 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]]];
    }

    /** @test */
    public function imports_and_direct_creations_of_the_same_supplier_invoice_yield_exactly_one_purchase(): void
    {
        [$tenant, $supplier, $items] = $this->tenantWithSupplier();
        Settings::put('purchases', ['duplicate_reference_policy' => 'block']);

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = function () use ($tenant, $supplier, $items, $i) {
                app(TenantContext::class)->set($tenant);
                $data = ['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => $i % 3 === 0 ? 'inv 1' : 'INV-1', 'number' => "BILL-R-{$i}"];   // أرقام صريحة: لا قفل مِرساة يسلسل المتسابقين، فيحكم الفهرس الفريد وحده

                // نصف المتسابقين مستوردون والنصف الآخر إنشاء مباشر تحت block، بكتابتين مختلفتين للرقم نفسه
                return app(PurchaseService::class)->create($data, $items, $i % 2 === 0 ? ['source' => Dup::SOURCE_STANDARD] : null)->id;
            };
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Purchase::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertCount(1, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(DuplicateDocumentException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @test */
    public function two_imports_of_the_same_invoice_under_allow_yield_one_purchase(): void
    {
        [$tenant, $supplier, $items] = $this->tenantWithSupplier();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($tenant, $supplier, $items, $i) {
                app(TenantContext::class)->set($tenant);

                return app(PurchaseService::class)->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => 'ALW-1', 'number' => "BILL-A-{$i}"], $items, ['source' => Dup::SOURCE_STANDARD])->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Purchase::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(DuplicateDocumentException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @test */
    public function importers_and_direct_creators_over_overlapping_invoices_end_with_one_purchase_per_identity_and_no_unexpected_error(): void
    {
        [$tenant, $supplier, $items] = $this->tenantWithSupplier();
        Settings::put('purchases', ['duplicate_reference_policy' => 'block']);

        $jobs = [];
        // مستوردان يكتبان الفواتير نفسها في معاملة واحدة بترتيبين متعاكسين + منشئان مباشران لفواتير متقاطعة؛ الرقم يُولَّد (قفل المِرساة) كما في الإنتاج.
        // ملاحظة صدق: استيرادان يتقاطعان في معاملتين متعاكسَي الترتيب قد يتبادلان الانتظار (40P01) بحكم أي فهرس فريد — يفشل الخاسر مغلقاً
        // (IMP-LOCK-XBRANCH-01)؛ هذا الاختبار لا يدّعي غيره، بل أن يكون ما يبقى بلا تكرار وبلا حجز يتيم.
        foreach ([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]] as $order) {
            $jobs[] = function () use ($tenant, $supplier, $items, $order) {
                app(TenantContext::class)->set($tenant);

                return DB::transaction(function () use ($supplier, $items, $order) {
                    foreach ($order as $n) {
                        app(PurchaseService::class)->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => "M-{$n}"], $items, ['source' => Dup::SOURCE_STANDARD]);
                        usleep(20_000);
                    }

                    return 'ok';
                });
            };
        }
        foreach ([3, 5] as $n) {
            $jobs[] = function () use ($tenant, $supplier, $items, $n) {
                app(TenantContext::class)->set($tenant);

                return app(PurchaseService::class)->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => "M-{$n}"], $items)->id;
            };
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertContains($r['error_class'] ?? null, [DuplicateDocumentException::class, \Illuminate\Database\QueryException::class], 'فشلٌ غير متوقع: '.json_encode($r, JSON_UNESCAPED_UNICODE));
                if (($r['error_class'] ?? null) === \Illuminate\Database\QueryException::class) {
                    $this->assertStringContainsString('40P01', (string) $r['message'], 'خطأ قاعدة غير الجمود: '.json_encode($r, JSON_UNESCAPED_UNICODE));
                }
            }
        }
        // لا هوية مكرّرة مهما كان الفائز
        $this->assertSame(Purchase::query()->count(), Purchase::query()->distinct()->count('supplier_invoice_no'));
        $this->assertSame(Purchase::query()->count(), ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function a_delete_racing_a_reimport_leaves_no_orphan_reservation(): void
    {
        [$tenant, $supplier, $items] = $this->tenantWithSupplier();
        $first = app(PurchaseService::class)->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => 'D-1', 'number' => 'BILL-D-0'], $items, ['source' => Dup::SOURCE_STANDARD]);

        $jobs = [
            function () use ($tenant, $first) {
                app(TenantContext::class)->set($tenant);
                app(PurchaseService::class)->deleteDraft(Purchase::query()->findOrFail($first->id));

                return 'deleted';
            },
            function () use ($tenant, $supplier, $items) {
                app(TenantContext::class)->set($tenant);

                return app(PurchaseService::class)->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => 'D-1', 'number' => 'BILL-D-1'], $items, ['source' => Dup::SOURCE_STANDARD])->id;
            },
        ];
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        // كل حجز قائم يقابله مشترى موجود، وكل مشترى مستورد محجوز: لا يتيم في أي ترتيب.
        $ids = Purchase::query()->pluck('id')->all();
        foreach (ImportDocumentReservation::query()->get() as $r) {
            $this->assertContains($r->document_id, $ids, 'حجز يتيم: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        }
        $this->assertSame(count($ids), ImportDocumentReservation::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
    }

    /** @test */
    public function two_edits_racing_into_the_same_identity_leave_one_holder(): void
    {
        [$tenant, $supplier, $items] = $this->tenantWithSupplier();
        $svc = app(PurchaseService::class);
        $a = $svc->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => 'E-A', 'number' => 'BILL-E-A'], $items, ['source' => Dup::SOURCE_STANDARD]);
        $b = $svc->create(['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => 'E-B', 'number' => 'BILL-E-B'], $items, ['source' => Dup::SOURCE_STANDARD]);

        $jobs = [];
        foreach ([$a, $b] as $p) {
            $jobs[] = function () use ($tenant, $supplier, $items, $p) {
                app(TenantContext::class)->set($tenant);

                return app(PurchaseService::class)->update(Purchase::query()->findOrFail($p->id), ['partner_id' => $supplier, 'supplier_invoice_no' => 'E-TARGET'], $items)->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Purchase::query()->where('supplier_invoice_no', 'E-TARGET')->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(2, ImportDocumentReservation::query()->count());
        $this->assertSame(2, ImportDocumentReservation::query()->distinct()->count('dedupe_key'));
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(DuplicateDocumentException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
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
