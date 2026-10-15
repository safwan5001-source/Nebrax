<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-13a / ADR-0001 — تزامن التقاط `issued_at` (PostgreSQL حقيقي، عمليات `pcntl_fork` حقيقية)
 * ═══════════════════════════════════════════════════════════════
 *  1) ترحيلان متزامنان للمسودة نفسها ⇒ ينجح واحد فقط، ولحظة واحدة تُكتب مرة واحدة.
 *  2) عدة ترحيلات متزامنة لمسودات مختلفة ⇒ لحظة الإصدار غير متناقصة مع تسلسل ICV (تُلتقط بعد قفل المِرساة
 *     وقبل توليد ICV داخل القسم المقفول نفسه)، وسلسلة PIH سليمة، ولا جمود (40P01) ولا ICV مكرر.
 *
 *  لا يعمل إلا على PostgreSQL (يُتجاهل على SQLite). النمط نفسه كـ Rem04PostingLockOrderPostgresTest.
 *
 *  تشغيل: php artisan test --filter=InvoiceIssuedAtPostgresTest
 */
class InvoiceIssuedAtPostgresTest extends TestCase
{
    private Tenant $tenant;
    private Partner $customer;
    private Product $service;
    private string $dir;

    /** @var list<string> */
    private array $tenantsToPurge = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->dir = sys_get_temp_dir().'/issued_at_'.uniqid();
        mkdir($this->dir);

        $this->tenant = Tenant::create([
            'name' => 'نبراس issued-at', 'slug' => 'issued-at-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        $this->tenantsToPurge[] = $this->tenant->id;
        app(TenantContext::class)->set($this->tenant->id);
        app(BranchContext::class)->forget();
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->service = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
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
            foreach ($this->tenantsToPurge as $id) {
                $this->purgeTenant($id);
            }
        }

        parent::tearDown();
    }

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
        $barrier = $this->dir.'/barrier';
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir."/result_{$i}";
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

    private function draft(int $price = 10000): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        );
    }

    private function poster(string $invoiceId): callable
    {
        $tenantId = $this->tenant->id;

        return function () use ($tenantId, $invoiceId) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            $posted = app(InvoiceService::class)->post(Invoice::findOrFail($invoiceId));

            return ['status' => $posted->status, 'icv' => (int) $posted->zatca_icv];
        };
    }

    private function isDeadlock(array $result): bool
    {
        return ! ($result['ok'] ?? false)
            && (str_contains((string) ($result['message'] ?? ''), '40P01')
                || stripos((string) ($result['message'] ?? ''), 'deadlock detected') !== false);
    }

    /** @test */
    public function concurrent_posts_of_the_same_draft_record_the_instant_exactly_once(): void
    {
        $draft = $this->draft();

        $results = $this->runConcurrently([$this->poster($draft->id), $this->poster($draft->id)]);

        foreach ($results as $r) {
            $this->assertFalse($this->isDeadlock($r), json_encode($r));
        }
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results));
        $loser = array_values(array_filter($results, fn ($r) => ! $r['ok']))[0];
        $this->assertStringContainsString('مسوّدة', $loser['message']);

        $row = DB::table('invoices')->where('id', $draft->id)->first();
        $this->assertSame('posted', $row->status);
        $this->assertNotNull($row->issued_at, 'لحظة الإصدار مكتوبة مرة واحدة من الفائز');
        $this->assertSame(1, (int) $row->zatca_icv);
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $draft->id)->count());
    }

    /** @test */
    public function concurrent_posts_of_different_drafts_order_the_instants_with_the_icv_sequence(): void
    {
        $drafts = [$this->draft(10000), $this->draft(20000), $this->draft(30000), $this->draft(40000)];

        $results = $this->runConcurrently(array_map(fn (Invoice $d) => $this->poster($d->id), $drafts));

        foreach ($results as $r) {
            $this->assertFalse($this->isDeadlock($r), json_encode($r));
            $this->assertTrue($r['ok'], json_encode($r));
        }

        $rows = DB::table('invoices')->whereIn('id', array_map(fn ($d) => $d->id, $drafts))
            ->orderBy('zatca_icv')->get(['issued_at', 'zatca_icv', 'zatca_xml', 'zatca_hash', 'zatca_previous_hash']);

        // ICV متصل بلا تكرار أو فجوات.
        $this->assertSame([1, 2, 3, 4], $rows->pluck('zatca_icv')->map(fn ($v) => (int) $v)->all());
        // لحظة الإصدار غير متناقصة مع ICV (تُلتقط داخل القسم المقفول نفسه الذي يُولَّد فيه ICV).
        $instants = $rows->pluck('issued_at')->all();
        $this->assertNotContains(null, $instants);
        $sorted = $instants;
        sort($sorted);
        $this->assertSame($sorted, $instants, 'issued_at يجب أن تكون غير متناقصة مع ICV');
        // سلسلة PIH سليمة: كل فاتورة تشير إلى هاش XML السابق المحفوظ.
        $hasher = app(ZatcaInvoiceHasher::class);
        for ($i = 1; $i < $rows->count(); $i++) {
            $this->assertSame($hasher->hash($rows[$i - 1]->zatca_xml), $rows[$i]->zatca_previous_hash);
        }
    }
}
