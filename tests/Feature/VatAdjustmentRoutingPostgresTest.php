<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ReturnService;
use App\Services\Reporting\ReportService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * REM-06 / ACC-02 — تزامن إعادة تعيين `tax_output` مع ترحيل مرتجع مبيعات على PostgreSQL.
 *
 * عمليتان حقيقيتان (`pcntl_fork`): الأولى تُرحِّل مرتجعاً، والثانية تُعيد تعيين الدور. المعاملتان تقفلان صفّ
 * المستأجر نفسه فتتسلسلان: يُحلّ الدور إما قبل إعادة التعيين (2120) أو بعدها (2125) — لا جمود (40P01)، ولا قيد
 * مكرر أو ناقص، ولا قيد غير متوازن، وتقرير REM-05 يبقى كاملاً وموثَّقاً أياً كان الترتيب.
 *
 * لا يعمل إلا على PostgreSQL حقيقي. تشغيل: php artisan test --filter=VatAdjustmentRoutingPostgresTest
 */
class VatAdjustmentRoutingPostgresTest extends TestCase
{
    private Tenant $tenant;
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

        $this->dir = sys_get_temp_dir().'/rem06_'.uniqid();
        mkdir($this->dir);
        $this->tenant = $this->makeTenant('rem06-a-');
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

    private function makeTenant(string $prefix): Tenant
    {
        $tenant = Tenant::create([
            'name' => 'نبراس '.$prefix, 'slug' => $prefix.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        $this->tenantsToPurge[] = $tenant->id;
        app(TenantContext::class)->set($tenant->id);
        app(BranchContext::class)->forget();
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        return $tenant;
    }

    private function purgeTenant(string $tenantId): void
    {
        DB::statement(
            'DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ?)',
            [$tenantId]
        );
        $tables = array_map(
            fn ($row) => $row->table_name,
            DB::select("SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'tenant_id'")
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
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
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

    /** @test */
    public function a_remap_racing_a_sales_return_post_never_deadlocks_duplicates_or_unbalances(): void
    {
        $custom = Account::create([
            'tenant_id' => $this->tenant->id, 'code' => '2125', 'name' => 'ضريبة مخرجات', 'type' => 'liability',
            'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true,
        ]);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $product = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
        $routing = app(AccountRoutingService::class);
        $tenantId = $this->tenant->id;
        $rounds = 5;
        $sawDefault = $sawCustom = 0;

        for ($i = 0; $i < $rounds; $i++) {
            $routing->reset('tax_output', null);
            $invoices = app(InvoiceService::class);
            $invoice = $invoices->post($invoices->create(
                ['partner_id' => $customer->id, 'payment_type' => 'credit', 'invoice_date' => '2026-01-10'],
                [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            ));
            $line = $invoice->lines->first();
            $draft = app(ReturnService::class)->create([
                'type' => 'sales', 'partner_id' => $customer->id, 'payment_type' => 'credit',
                'original_id' => $invoice->id, 'return_date' => '2026-02-15',
            ], [[
                'product_id' => $line->product_id, 'source_line_id' => $line->id,
                'quantity' => 1, 'unit_price' => (int) $line->unit_price, 'tax_rate' => 15,
            ]]);
            $draftId = $draft->id;
            $customId = $custom->id;

            $results = $this->runConcurrently([
                function () use ($tenantId, $draftId) {
                    app(TenantContext::class)->set($tenantId);
                    app(BranchContext::class)->forget();
                    $posted = app(ReturnService::class)->post(ReturnDocument::findOrFail($draftId));

                    return $posted->status;
                },
                function () use ($tenantId, $customId) {
                    app(TenantContext::class)->set($tenantId);
                    app(BranchContext::class)->forget();
                    app(AccountRoutingService::class)->setMapping('tax_output', $customId, null);

                    return 'mapped';
                },
            ]);

            foreach ($results as $r) {
                $this->assertTrue($r['ok'], 'فشلت عملية متزامنة: '.json_encode($r, JSON_UNESCAPED_UNICODE));
                $this->assertStringNotContainsString('40P01', (string) ($r['message'] ?? ''));
            }

            // قيد واحد متوازن للمرتجع، وساق الضريبة على أحد الحسابين الصالحين فقط.
            $entry = JournalEntry::with('lines.account')
                ->where('source_type', ReturnDocument::class)->where('source_id', $draftId)->sole();
            $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
            $vat = $entry->lines->first(fn ($l) => (int) $l->debit === 15000);
            $this->assertContains($vat->account->code, ['2120', '2125']);
            $vat->account->code === '2120' ? $sawDefault++ : $sawCustom++;
        }

        // 5 فواتير − 5 مرتجعات على مجموعة الدور = صفر، موثَّق أياً كان ترتيب كل جولة.
        $report = app(ReportService::class)->taxReport();
        $this->assertSame(0, $report['output_vat']);
        $this->assertSame('verified', $report['verification']['status']);
        $this->assertSame($rounds, $sawDefault + $sawCustom);
        $this->assertSame($rounds, ReturnDocument::count());
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'));
    }
}
