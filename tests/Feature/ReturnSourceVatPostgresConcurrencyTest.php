<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-01 — تزامن ترحيل المرتجعات على المستند المصدر نفسه
 * ═══════════════════════════════════════════════════════════════
 *  عمليتا نظام حقيقيتان منفصلتان عبر `pcntl_fork()` (أسلوب
 *  `InventoryStatePostgresConcurrencyTest` حرفياً): كل طفلٍ يفتح اتصال
 *  PostgreSQL خاصاً به، فيتنافسان فعلياً على قفل صفّ المصدر في
 *  `ReturnService::post()`.
 *
 *  بلا القفل: معاملتان (READ COMMITTED) تريان المتبقي نفسه فتُرحَّل مسوّدتان
 *  كلٌّ منهما تردّ كامل الكمية ⇒ ردّ مزدوج للأساس والضريبة. ومع القفل: واحدة
 *  تنجح والأخرى تُرفض بعد أن ترى ما رحّلته الأولى، ومجموع الأجزاء المتزامنة
 *  يساوي المحصَّل هللةً بهللة.
 *
 *  **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي.**
 *
 *  تشغيل: php artisan test --filter=ReturnSourceVatPostgresConcurrencyTest
 */
class ReturnSourceVatPostgresConcurrencyTest extends TestCase
{
    private Tenant $tenant;
    private Partner $customer;
    private Partner $supplier;
    private Product $service;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً على قفل الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'نبراس تزامن المرتجعات', 'slug' => 'ret-concurrency-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->service  = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant) && DB::connection()->getDriverName() === 'pgsql') {
            $this->purgeTenant($this->tenant->id);
        }

        parent::tearDown();
    }

    /**
     * يحذف كل ما كتبته الاختبارات (تُرحَّل فعلاً بلا تراجع لأن الأبناء يرونها).
     * الجداول تُكتشف من الفهرس لا من قائمة يدوية قد تُنسى؛ ومرّات متعددة لأن
     * المفاتيح الأجنبية تفرض ترتيباً — الفاشل منها يُعاد بعد أن يُحذف مرجعُه.
     */
    private function purgeTenant(string $tenantId): void
    {
        DB::statement(
            'DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ?)',
            [$tenantId]
        );

        $tables = array_map(
            fn ($row) => $row->table_name,
            DB::select(
                "SELECT table_name FROM information_schema.columns
                  WHERE table_schema = current_schema() AND column_name = 'tenant_id'"
            )
        );

        for ($pass = 0; $pass < 8; $pass++) {
            $remaining = 0;
            foreach ($tables as $table) {
                try {
                    DB::table($table)->where('tenant_id', $tenantId)->delete();
                } catch (QueryException) {
                    $remaining++;
                }
            }
            if ($remaining === 0) {
                break;
            }
        }

        DB::table('tenants')->where('id', $tenantId)->delete();
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string, value?: mixed}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'ret_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'ret_result_');
            $resultFiles[$i] = $resultFile;

            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork — لا يمكن إثبات تزامن حقيقي بدونه.');
            }

            if ($pid === 0) {
                DB::purge(config('database.default'));

                $deadline = microtime(true) + 5.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }

                try {
                    $value = $job();
                    file_put_contents($resultFile, json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFile, json_encode([
                        'ok' => false,
                        'error_class' => get_class($e),
                        'message' => $e->getMessage(),
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
        @unlink($barrier);

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = file_get_contents($file);
            @unlink($file);
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }

    private function sale(int $qty, int $unitPrice, array $head = []): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(
            array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], $head),
            [['product_id' => $this->service->id, 'quantity' => $qty, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return $svc->post($invoice);
    }

    private function draft(Invoice|Purchase $doc, string $lineId, int $qty, string $type): ReturnDocument
    {
        return app(ReturnService::class)->create([
            'type' => $type, 'partner_id' => $doc->partner_id, 'payment_type' => 'credit',
            'original_id' => $doc->id,
        ], [[
            'product_id' => $this->service->id, 'source_line_id' => $lineId,
            'quantity' => $qty, 'unit_price' => (int) $doc->lines->first()->unit_price,
        ]]);
    }

    /** @return list<array{ok: bool, message?: string, value?: mixed}> */
    private function postConcurrently(array $drafts): array
    {
        $tenantId = $this->tenant->id;

        return $this->runConcurrently(array_map(
            fn (ReturnDocument $d) => function () use ($tenantId, $d) {
                app(TenantContext::class)->set($tenantId);
                $posted = app(ReturnService::class)->post(ReturnDocument::findOrFail($d->id));

                return [(int) $posted->subtotal, (int) $posted->tax_amount, (int) $posted->total];
            },
            $drafts
        ));
    }

    /** @test */
    public function two_concurrent_posts_of_full_quantity_drafts_return_the_invoice_exactly_once(): void
    {
        $invoice = $this->sale(2, 11500, ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $drafts = [
            $this->draft($invoice, $line->id, 2, 'sales'),
            $this->draft($invoice, $line->id, 2, 'sales'),
        ];

        $results = $this->postConcurrently($drafts);

        $succeeded = array_values(array_filter($results, fn ($r) => $r['ok']));
        $failed    = array_values(array_filter($results, fn ($r) => ! $r['ok']));
        $this->assertCount(1, $succeeded, 'واحدٌ فقط ينجح: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, $failed);
        $this->assertStringContainsString('تتجاوز المتبقي', $failed[0]['message']);
        $this->assertSame([20000, 3000, 23000], $succeeded[0]['value']);

        app(TenantContext::class)->set($this->tenant->id);
        $posted = ReturnDocument::where('status', 'posted')->get();
        $this->assertCount(1, $posted);
        $this->assertSame(23000, (int) $posted->sum('total'), 'لا ردّ مزدوج لأساس أو ضريبة.');
    }

    /** @test */
    public function three_concurrent_single_unit_returns_sum_to_the_charged_vat_to_the_penny(): void
    {
        // 3 × 100.01 متضمّن: صافٍ 260.90 وضريبة 39.13. المسوّدات الثلاث حُسبت
        // معاً كلٌّ على حدة؛ الاشتقاق تحت قفل المصدر يجعل مجموعها دقيقاً.
        $invoice = $this->sale(3, 10001, ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $drafts = [
            $this->draft($invoice, $line->id, 1, 'sales'),
            $this->draft($invoice, $line->id, 1, 'sales'),
            $this->draft($invoice, $line->id, 1, 'sales'),
        ];

        $results = $this->postConcurrently($drafts);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], 'الأجزاء الثلاثة ضمن المباع فتنجح كلها: '.json_encode($result, JSON_UNESCAPED_UNICODE));
        }

        app(TenantContext::class)->set($this->tenant->id);
        $posted = ReturnDocument::where('status', 'posted')->get();
        $this->assertCount(3, $posted);
        $this->assertSame(26090, (int) $posted->sum('subtotal'));
        $this->assertSame(3913, (int) $posted->sum('tax_amount'));
        $this->assertSame(30003, (int) $posted->sum('total'));
    }

    /** @test */
    public function concurrent_purchase_returns_against_one_purchase_cannot_exceed_it(): void
    {
        $svc = app(PurchaseService::class);
        $purchase = $svc->post($svc->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'tax_inclusive' => true],
            [['product_id' => $this->service->id, 'quantity' => 2, 'unit_price' => 5750, 'tax_rate' => 15]]
        ));
        $line = $purchase->lines->first();

        $drafts = [
            $this->draft($purchase, $line->id, 2, 'purchase'),
            $this->draft($purchase, $line->id, 2, 'purchase'),
        ];

        $results = $this->postConcurrently($drafts);

        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));

        app(TenantContext::class)->set($this->tenant->id);
        $posted = ReturnDocument::where('status', 'posted')->get();
        $this->assertCount(1, $posted);
        $this->assertSame([10000, 1500, 11500], [(int) $posted->sum('subtotal'), (int) $posted->sum('tax_amount'), (int) $posted->sum('total')]);
    }
}
