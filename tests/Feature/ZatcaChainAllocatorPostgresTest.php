<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-18b-2 — مخصِّص سلسلة ZATCA تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) ترحيلات متزامنة لمستأجر واحد ⇒ ICV متصل بلا تكرار، سلسلة PIH سليمة، لا جمود (40P01).
 *  2) أول ترحيلين متزامنين لمستأجر بلا رأس ⇒ رأس واحد وICV 1 و2.
 *  3) مستأجران متزامنان ⇒ سلسلتان مستقلّتان.
 *  4) فشلٌ بعد إدراج المدخل وموتٌ مفاجئ للعملية (SIGKILL) أثناء المعاملة ⇒ لا ICV مستهلك ولا فجوة.
 *  5) «كاتب قديم» (max+1 بلا مدخل، تحت قفل المِرساة كالكود السابق) يتسابق مع المخصِّص ⇒ يُرفض دائماً، ولا تكرار.
 *
 *  على PostgreSQL **لا يُتخطّى** هذا الصنف إن غاب `pcntl`: يفشل، كي لا يمرّ CI بلا اختبار تزامن. يُتخطّى على SQLite فقط
 *  (لا أقفال صفوف). النمط نفسه كـ InvoiceIssuedAtPostgresTest.
 */
class ZatcaChainAllocatorPostgresTest extends TestCase
{
    private Tenant $tenant;

    private Partner $customer;

    private string $dir;

    /** @var list<string> */
    private array $tenantsToPurge = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (REM-18b-2).');

        $this->dir = sys_get_temp_dir().'/zatca_chain_'.uniqid();
        mkdir($this->dir);
        [$this->tenant, $this->customer] = $this->makeTenant('chain-pg');
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

    /** @test */
    public function concurrent_postings_of_one_tenant_produce_a_contiguous_valid_chain(): void
    {
        $drafts = [];
        foreach (['standard', 'simplified', 'standard', 'simplified', 'standard', 'simplified'] as $i => $type) {
            $drafts[] = $this->draft($this->tenant, $this->customer, 10000 * ($i + 1), $type);
        }

        $results = $this->runConcurrently(array_map(fn (Invoice $d) => $this->poster($this->tenant->id, $d->id), $drafts));

        $this->assertAllOk($results);
        $this->assertSame([1, 2, 3, 4, 5, 6], $this->icvs($this->tenant));
        $this->assertChainWalks($this->tenant, 0);
        $this->assertSame(6, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
    }

    /** @test */
    public function the_first_two_concurrent_postings_seed_one_head(): void
    {
        $a = $this->draft($this->tenant, $this->customer, 10000);
        $b = $this->draft($this->tenant, $this->customer, 20000);

        $results = $this->runConcurrently([$this->poster($this->tenant->id, $a->id), $this->poster($this->tenant->id, $b->id)]);

        $this->assertAllOk($results);
        $this->assertSame(1, DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->count());
        $this->assertSame([1, 2], $this->icvs($this->tenant));
        $this->assertChainWalks($this->tenant, 0);
    }

    /** @test */
    public function two_tenants_posting_concurrently_keep_independent_chains(): void
    {
        [$other, $otherCustomer] = $this->makeTenant('chain-pg-other');
        $jobs = [];
        foreach ([1, 2, 3] as $n) {
            $jobs[] = $this->poster($this->tenant->id, $this->draft($this->tenant, $this->customer, 1000 * $n)->id);
            $jobs[] = $this->poster($other->id, $this->draft($other, $otherCustomer, 2000 * $n)->id);
        }

        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame([1, 2, 3], $this->icvs($this->tenant));
        $this->assertSame([1, 2, 3], $this->icvs($other));
        $this->assertChainWalks($this->tenant, 0);
        $this->assertChainWalks($other, 0);
    }

    /** @test */
    public function a_failure_after_the_entry_and_a_killed_process_consume_no_icv(): void
    {
        $this->issueDraft($this->draft($this->tenant, $this->customer, 5000)); // ICV 1
        $failing = $this->draft($this->tenant, $this->customer, 6000);
        $killed = $this->draft($this->tenant, $this->customer, 7000);
        $tenantId = $this->tenant->id;

        $results = $this->runConcurrently([
            // settle() يفشل بعد إدراج المدخل وتحديث الفاتورة: المعاملة كلها تتراجع.
            function () use ($tenantId, $failing) {
                app(TenantContext::class)->set($tenantId);
                app(BranchContext::class)->forget();
                app()->bind(InvoiceService::class, fn ($app) => $app->build(Rem04FlakyInvoiceService::class));
                Rem04FlakyInvoiceService::reset(1, 'HY000');
                app(InvoiceService::class)->post(Invoice::findOrFail($failing->id));

                return 'unexpected';
            },
            // العملية تموت داخل معاملة مفتوحة بعد الترحيل كاملاً وقبل الالتزام.
            function () use ($tenantId, $killed) {
                app(TenantContext::class)->set($tenantId);
                app(BranchContext::class)->forget();
                DB::beginTransaction();
                app(InvoiceService::class)->post(Invoice::findOrFail($killed->id));
                posix_kill(getmypid(), SIGKILL);

                return 'unreachable';
            },
        ]);

        $this->assertFalse($results[0]['ok'], json_encode($results[0]));
        $this->assertFalse($results[1]['ok'] ?? false, 'العملية المقتولة لا تكتب نتيجة');
        $this->assertSame([1], $this->icvs($this->tenant));
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
        $this->assertSame('draft', DB::table('invoices')->where('id', $failing->id)->value('status'));
        $this->assertSame('draft', DB::table('invoices')->where('id', $killed->id)->value('status'));

        // الخانة نفسها تصدر للترحيل التالي: لا فجوة ولا ICV مستهلك.
        $this->assertSame(2, (int) $this->issueDraft(Invoice::findOrFail($killed->id))->zatca_icv);
        $this->assertChainWalks($this->tenant, 0);
    }

    /** @test */
    public function an_old_writer_racing_the_allocator_is_always_fenced(): void
    {
        $this->issueDraft($this->draft($this->tenant, $this->customer, 5000)); // يفتح السلسلة (ICV 1)
        $tenantId = $this->tenant->id;
        $jobs = [];
        foreach ([1, 2, 3] as $n) {
            $new = $this->draft($this->tenant, $this->customer, 1000 * $n);
            $old = $this->draft($this->tenant, $this->customer, 3000 * $n);
            $jobs[] = $this->poster($tenantId, $new->id);
            // ما يفعله ZatcaService قبل REM-18b-2: قفل المِرساة، max+1، هاش XML صاحب الأقصى، كتابة مباشرة على invoices.
            $jobs[] = function () use ($tenantId, $old) {
                return DB::transaction(function () use ($tenantId, $old) {
                    DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first();
                    $max = (int) DB::table('invoices')->where('tenant_id', $tenantId)->max('zatca_icv');
                    $prevXml = (string) DB::table('invoices')->where('tenant_id', $tenantId)->where('zatca_icv', $max)->value('zatca_xml');
                    DB::table('invoices')->where('id', $old->id)->update([
                        'status' => 'posted', 'zatca_icv' => $max + 1, 'zatca_uuid' => (string) Str::uuid(),
                        'zatca_previous_hash' => app(ZatcaInvoiceHasher::class)->hash($prevXml),
                        'zatca_hash' => 'old-writer', 'zatca_xml' => '<old/>',
                    ]);

                    return 'old-writer-succeeded';
                });
            };
        }

        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $r) {
            $this->assertFalse($this->isDeadlock($r), json_encode($r));
            if ($i % 2 === 0) {
                $this->assertTrue($r['ok'], json_encode($r));
            } else {
                $this->assertFalse($r['ok'], 'كاتب قديم يجب أن يُرفض: '.json_encode($r));
                $this->assertStringContainsString('shared-chain entry', (string) ($r['message'] ?? ''));
            }
        }
        $this->assertSame([1, 2, 3, 4], $this->icvs($this->tenant));
        $this->assertSame(0, DB::table('invoices')->where('tenant_id', $tenantId)->where('zatca_hash', 'old-writer')->count());
        $this->assertChainWalks($this->tenant, 0);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{0: Tenant, 1: Partner} */
    private function makeTenant(string $label): array
    {
        $tenant = Tenant::create([
            'name' => 'نبراس '.$label, 'slug' => $label.'-'.uniqid(), 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        $this->tenantsToPurge[] = $tenant->id;
        app(TenantContext::class)->set($tenant->id);
        app(BranchContext::class)->forget();
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        app(TenantContext::class)->set(($this->tenant ?? $tenant)->id);

        return [$tenant, $customer];
    }

    private function draft(Tenant $tenant, Partner $customer, int $price, string $type = 'standard'): Invoice
    {
        $previous = app(TenantContext::class)->id();
        app(TenantContext::class)->set($tenant->id);
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit', 'zatca_document_type' => $type],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        );
        app(TenantContext::class)->set((string) $previous);

        return $draft;
    }

    private function issueDraft(Invoice $draft): Invoice
    {
        app(TenantContext::class)->set($draft->tenant_id);

        return app(InvoiceService::class)->post($draft);
    }

    private function poster(string $tenantId, string $invoiceId): callable
    {
        return function () use ($tenantId, $invoiceId) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            $posted = app(InvoiceService::class)->post(Invoice::findOrFail($invoiceId));

            return ['icv' => (int) $posted->zatca_icv];
        };
    }

    /** @return list<int> */
    private function icvs(Tenant $tenant): array
    {
        return DB::table('invoices')->where('tenant_id', $tenant->id)->whereNotNull('zatca_icv')
            ->orderBy('zatca_icv')->pluck('zatca_icv')->map(fn ($v) => (int) $v)->all();
    }

    private function assertChainWalks(Tenant $tenant, int $seed): void
    {
        $hasher = app(ZatcaInvoiceHasher::class);
        $entries = DB::table('zatca_chain_entries')->where('tenant_id', $tenant->id)->orderBy('icv')->get();
        $this->assertSame(range($seed + 1, $seed + $entries->count()), $entries->pluck('icv')->map(fn ($v) => (int) $v)->all());
        foreach ($entries as $i => $entry) {
            $invoice = DB::table('invoices')->where('id', $entry->invoice_id)->first();
            $this->assertSame((int) $entry->icv, (int) $invoice->zatca_icv);
            $this->assertSame($entry->hash, $invoice->zatca_hash);
            $this->assertSame($entry->hash, $hasher->hash((string) $invoice->zatca_xml));
            if ($i > 0) {
                $this->assertSame($entries[$i - 1]->hash, $entry->previous_hash);
            }
        }
    }

    /** @param list<array<string, mixed>> $results */
    private function assertAllOk(array $results): void
    {
        foreach ($results as $r) {
            $this->assertFalse($this->isDeadlock($r), json_encode($r));
            $this->assertTrue($r['ok'] ?? false, json_encode($r));
        }
    }

    private function isDeadlock(array $result): bool
    {
        return ! ($result['ok'] ?? false)
            && (str_contains((string) ($result['message'] ?? ''), '40P01')
                || stripos((string) ($result['message'] ?? ''), 'deadlock detected') !== false);
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array<string, mixed>>
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
        // مداخل السلسلة لا تُحذف إلا مع المستأجر (T2/T7): الحذف المتسلسل يزيلها.
        DB::table('tenants')->where('id', $tenantId)->delete();
    }
}
