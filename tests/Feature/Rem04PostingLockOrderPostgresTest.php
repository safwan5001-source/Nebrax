<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-04 / SEC-02 — جمود (deadlock) ترحيل الفاتورة مقابل إنشاء سند/مسودة لنفس العميل
 * ═══════════════════════════════════════════════════════════════
 *  الدورة المؤكَّدة (PostgreSQL):
 *    A (ترحيل فاتورة آجلة):  صف العميل `FOR UPDATE` (حدّ الائتمان)  ⇒ ثم قفل مِرساة المستأجر (LedgerService/الترقيم).
 *    B (إنشاء سند/مسودة):    قفل مِرساة المستأجر (الترقيم)           ⇒ ثم INSERT بمفتاح أجنبي partner_id
 *                            ⇒ PostgreSQL يأخذ `FOR KEY SHARE` على صف العميل ⇒ يتعارض مع `FOR UPDATE`.
 *  A ينتظر B على المِرساة، وB ينتظر A على صف العميل ⇒ SQLSTATE 40P01.
 *
 *  هذا الاختبار **حتمي**: لا سباق احتمالي. عمليتان حقيقيتان (`pcntl_fork`، لكلٍّ اتصالها)،
 *  وخطّافٌ في A بعد أخذ قفل العميل مباشرةً يوقفها حتى يُظهر `pg_stat_activity` أن B
 *  محجوبة على قفل (أو أنها أنهت عملها دون حجب — أي لا تعارض). عندها فقط تتابع A.
 *    - الترتيب القديم: B تُحجب ⇒ A تتابع ⇒ دورة ⇒ 40P01 مؤكَّد.
 *    - الترتيب المصحَّح: B لا تُحجب أصلاً ⇒ كلتاهما تنجحان.
 *
 *  **لا يعمل إلا على PostgreSQL حقيقي** (ويُتجاهل على SQLite لأن SQLite لا يملك أقفال صفوف).
 *
 *  تشغيل: php artisan test --filter=Rem04PostingLockOrderPostgresTest
 */
class Rem04PostingLockOrderPostgresTest extends TestCase
{
    use InteractsWithApi;

    private Tenant $tenant;
    private Partner $customer;
    private Product $service;
    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->dir = sys_get_temp_dir().'/rem04_'.uniqid();
        mkdir($this->dir);

        $this->tenant = $this->makeTenant('rem04-a-');
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
            foreach ($this->tenantsToPurge ?? [] as $id) {
                $this->purgeTenant($id);
            }
        }

        parent::tearDown();
    }

    /** @var list<string> */
    private array $tenantsToPurge = [];

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

    // ───────────────────────── أدوات التزامن ─────────────────────────

    /**
     * @param  list<callable(): mixed>  $jobs  تُنفَّذ كلٌّ في عملية مستقلة بعد حاجز بدء مشترك
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

    private function isDeadlock(array $result): bool
    {
        return ! ($result['ok'] ?? false)
            && (str_contains((string) ($result['message'] ?? ''), '40P01')
                || stripos((string) ($result['message'] ?? ''), 'deadlock detected') !== false);
    }

    /** مسودة آجلة جاهزة للترحيل (تُنشأ في العملية الأم). */
    private function creditDraft(?Partner $partner = null, int $price = 10000): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => ($partner ?? $this->customer)->id, 'payment_type' => 'credit'],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        );
    }

    /**
     * يوقف A بعد أخذ قفل العميل مباشرةً حتى تُحجب B على قفل أو تنتهي — فيتحدّد التداخل بالبنية لا بالتوقيت.
     *
     * @param  class-string<InvoiceService>|null  $serviceClass
     */
    private function posterJob(string $invoiceId, string $dir, ?string $serviceClass = null, ?string $tenantId = null): callable
    {
        $tenantId ??= $this->tenant->id;
        $serviceClass ??= Rem04GatedInvoiceService::class;

        return function () use ($tenantId, $invoiceId, $dir, $serviceClass) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            Rem04GatedInvoiceService::$dir = $dir;
            /** @var InvoiceService $svc */
            $svc = app()->build($serviceClass);
            $posted = $svc->post(Invoice::findOrFail($invoiceId));

            return ['status' => $posted->status, 'icv' => (int) $posted->zatca_icv];
        };
    }

    /** B: إنشاء سند قبض مسوّدة للعميل نفسه (مِرساة الترقيم ثم INSERT بمفتاح أجنبي). */
    private function paymentJob(string $dir): callable
    {
        $tenantId = $this->tenant->id;
        $partnerId = $this->customer->id;

        return function () use ($tenantId, $partnerId, $dir) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            $this->awaitFile($dir.'/a_partner_locked');
            file_put_contents($dir.'/b_pid', (string) DB::selectOne('select pg_backend_pid() as p')->p);
            $payment = app(PaymentService::class)->create([
                'partner_id' => $partnerId, 'amount' => 1000, 'direction' => 'received', 'method' => 'cash',
            ]);
            file_put_contents($dir.'/b_done', '1');

            return ['payment_id' => $payment->id];
        };
    }

    /** B′: إنشاء مسودة فاتورة جديدة للعميل نفسه. */
    private function draftJob(string $dir): callable
    {
        $tenantId = $this->tenant->id;
        $partnerId = $this->customer->id;
        $productId = $this->service->id;

        return function () use ($tenantId, $partnerId, $productId, $dir) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();
            $this->awaitFile($dir.'/a_partner_locked');
            file_put_contents($dir.'/b_pid', (string) DB::selectOne('select pg_backend_pid() as p')->p);
            $invoice = app(InvoiceService::class)->create(
                ['partner_id' => $partnerId, 'payment_type' => 'credit'],
                [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 5000, 'tax_rate' => 15]],
            );
            file_put_contents($dir.'/b_done', '1');

            return ['invoice_id' => $invoice->id];
        };
    }

    private function awaitFile(string $path, float $seconds = 20.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($path)) {
            if (microtime(true) > $deadline) {
                throw new \RuntimeException("timeout waiting for {$path}");
            }
            usleep(2000);
        }
    }

    // ───────────────────────── السيناريوهات الحتمية ─────────────────────────

    /** @test */
    public function posting_a_credit_invoice_never_deadlocks_with_a_concurrent_payment_creation_for_the_same_customer(): void
    {
        $draft = $this->creditDraft();
        $before = $this->ledgerSnapshot();

        [$post, $pay] = $this->runConcurrently([
            $this->posterJob($draft->id, $this->dir),
            $this->paymentJob($this->dir),
        ]);

        $this->assertFalse($this->isDeadlock($post), 'poster: '.json_encode($post));
        $this->assertFalse($this->isDeadlock($pay), 'payment creator: '.json_encode($pay));
        $this->assertTrue($post['ok'], json_encode($post));
        $this->assertTrue($pay['ok'], json_encode($pay));

        $this->assertInvoicePostedExactlyOnce($draft->id, 1);
        $this->assertSame(1, Payment::where('partner_id', $this->customer->id)->count());
        $this->assertLedgerBalanced();
        $this->assertSame($before['entries'] + 1, JournalEntry::count());
    }

    /** @test */
    public function posting_a_credit_invoice_never_deadlocks_with_a_concurrent_draft_invoice_creation_for_the_same_customer(): void
    {
        $draft = $this->creditDraft();

        [$post, $other] = $this->runConcurrently([
            $this->posterJob($draft->id, $this->dir),
            $this->draftJob($this->dir),
        ]);

        $this->assertFalse($this->isDeadlock($post), 'poster: '.json_encode($post));
        $this->assertFalse($this->isDeadlock($other), 'draft creator: '.json_encode($other));
        $this->assertTrue($post['ok'] && $other['ok'], json_encode([$post, $other]));

        $this->assertInvoicePostedExactlyOnce($draft->id, 1);
        $this->assertSame(1, Invoice::where('status', 'draft')->where('partner_id', $this->customer->id)->count());
        $this->assertLedgerBalanced();
    }

    /** @test */
    public function control_the_legacy_for_update_partner_lock_still_deadlocks_and_the_victim_rolls_back_cleanly(): void
    {
        // ضابط سالب: بالقفل القديم يجب أن يرصد الاختبار نفسه الجمود — وإلا فهو لا يثبت شيئاً.
        $draft = $this->creditDraft();

        Rem04GatedInvoiceService::$legacyPartnerLock = true;
        try {
            [$post, $pay] = $this->runConcurrently([
                $this->posterJob($draft->id, $this->dir),
                $this->paymentJob($this->dir),
            ]);
        } finally {
            Rem04GatedInvoiceService::$legacyPartnerLock = false;
        }

        $victims = array_values(array_filter([$post, $pay], fn ($r) => $this->isDeadlock($r)));
        $this->assertCount(1, $victims, 'ضحية واحدة بالضبط يختارها PostgreSQL: '.json_encode([$post, $pay]));

        // سلامة التراجع: أيّاً كانت الضحية، لا أثر جزئي.
        $invoice = Invoice::findOrFail($draft->id);
        if ($this->isDeadlock($post)) {
            $this->assertSame('draft', $invoice->status);
            $this->assertNull($invoice->journal_entry_id);
            $this->assertNull($invoice->zatca_icv, 'لا ICV مستهلك بترحيل تراجع.');
            $this->assertSame(0, JournalEntry::where('source_id', $draft->id)->count());
            $this->assertSame(1, Payment::where('partner_id', $this->customer->id)->count());
        } else {
            $this->assertInvoicePostedExactlyOnce($draft->id, 1);
            $this->assertSame(0, Payment::where('partner_id', $this->customer->id)->count(), 'السند الضحية لم يُحفظ.');
        }
        $this->assertLedgerBalanced();
    }

    /** @test */
    public function the_posting_transaction_takes_invoice_then_customer_with_no_key_update_then_the_tenant_anchor(): void
    {
        $draft = $this->creditDraft();

        $locks = [];
        DB::listen(function ($query) use (&$locks) {
            if (preg_match('/from "(\w+)".*\sfor (no key update|update)\s*$/s', $query->sql, $m)) {
                $locks[] = [$m[1], $m[2]];
            }
        });
        app(InvoiceService::class)->post(Invoice::findOrFail($draft->id));

        $first = function (string $table, string $mode) use ($locks): ?int {
            foreach ($locks as $i => [$t, $m]) {
                if ($t === $table && $m === $mode) {
                    return $i;
                }
            }

            return null;
        };

        $invoiceLock = $first('invoices', 'update');
        $partnerLock = $first('partners', 'no key update');
        $tenantLock = $first('tenants', 'update');

        $this->assertNotNull($invoiceLock, 'invoice row lock');
        $this->assertNotNull($partnerLock, 'customer row lock must be FOR NO KEY UPDATE');
        $this->assertNotNull($tenantLock, 'tenant anchor lock');
        $this->assertLessThan($partnerLock, $invoiceLock);
        $this->assertLessThan($tenantLock, $partnerLock);
        $this->assertNull($first('partners', 'update'), 'FOR UPDATE على صف العميل ممنوع: يتعارض مع فحص المفتاح الأجنبي.');
    }

    /** @test */
    public function concurrent_posters_payment_creators_and_draft_creators_keep_every_financial_invariant(): void
    {
        $target = app(InvoiceService::class)->post($this->creditDraft()); // ICV 1 — هدف تخصيص السندات
        $drafts = array_map(fn () => $this->creditDraft(), range(1, 6));

        $tenantId = $this->tenant->id;
        $partnerId = $this->customer->id;
        $productId = $this->service->id;
        $targetId = $target->id;

        $jobs = [];
        foreach ($drafts as $d) {
            $jobs[] = $this->posterJob($d->id, $this->dir, InvoiceService::class);
        }
        for ($i = 0; $i < 3; $i++) {
            $jobs[] = function () use ($tenantId, $partnerId, $targetId) {
                app(TenantContext::class)->set($tenantId);
                app(BranchContext::class)->forget();
                $p = app(PaymentService::class)->create(
                    ['partner_id' => $partnerId, 'amount' => 500, 'direction' => 'received', 'method' => 'cash'],
                    [['invoice_id' => $targetId, 'amount' => 500]],
                );

                return ['payment_id' => $p->id];
            };
            $jobs[] = function () use ($tenantId, $partnerId, $productId) {
                app(TenantContext::class)->set($tenantId);
                app(BranchContext::class)->forget();
                $inv = app(InvoiceService::class)->create(
                    ['partner_id' => $partnerId, 'payment_type' => 'credit'],
                    [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 7000, 'tax_rate' => 15]],
                );

                return ['invoice_id' => $inv->id];
            };
        }

        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $r) {
            $this->assertFalse($this->isDeadlock($r), "job {$i}: ".json_encode($r));
            $this->assertTrue($r['ok'], "job {$i}: ".json_encode($r));
        }

        // لا ترحيل مزدوج + لا ICV مكرر أو مفقود (1..7 متصلة) + قيد واحد لكل فاتورة.
        $posted = Invoice::where('status', 'posted')->where('partner_id', $partnerId)->orderBy('zatca_icv')->get();
        $this->assertCount(7, $posted);
        $this->assertSame(range(1, 7), $posted->pluck('zatca_icv')->map(fn ($v) => (int) $v)->all());
        foreach ($posted as $inv) {
            $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $inv->id)->count());
        }
        $this->assertSame(7, JournalEntry::where('source_type', Invoice::class)->count());
        $this->assertLedgerBalanced();

        // ذمم العملاء = مجموع إجماليات المرحَّل بالضبط.
        $ar = DB::selectOne(
            "SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l
               JOIN journal_entries e ON e.id = l.journal_entry_id
              WHERE e.tenant_id = ? AND l.partner_id = ?",
            [$tenantId, $partnerId]
        );
        $this->assertSame((int) $posted->sum('total'), (int) $ar->bal);

        // السندات والتخصيصات: سند واحد لكل مهمة، وتخصيص واحد فقط لكل سند (لا تكرار).
        $this->assertSame(3, Payment::where('partner_id', $partnerId)->count());
        $allocs = PaymentAllocation::query()->get();
        $this->assertCount(3, $allocs);
        $this->assertCount(3, $allocs->pluck('payment_id')->unique());
        $this->assertSame(3, Invoice::where('status', 'draft')->where('partner_id', $partnerId)->count());
    }

    /** @test */
    public function two_concurrent_posts_of_the_same_draft_produce_one_entry_and_one_icv(): void
    {
        $draft = $this->creditDraft();

        [$a, $b] = $this->runConcurrently([
            $this->posterJob($draft->id, $this->dir, InvoiceService::class),
            $this->posterJob($draft->id, $this->dir, InvoiceService::class),
        ]);

        $this->assertSame(1, (int) $a['ok'] + (int) $b['ok'], json_encode([$a, $b]));
        $loser = $a['ok'] ? $b : $a;
        $this->assertFalse($this->isDeadlock($loser), json_encode($loser));
        $this->assertStringContainsString('غير مسوّدة', (string) $loser['message']);
        $this->assertInvoicePostedExactlyOnce($draft->id, 1);
        $this->assertLedgerBalanced();
    }

    /** @test */
    public function the_credit_limit_is_still_serialised_per_customer_under_concurrency(): void
    {
        // NO KEY UPDATE يجب أن يسلسل الترحيلات الآجلة للعميل نفسه كما كان FOR UPDATE: واحدة فقط تعبر الحد.
        $this->customer->update(['credit_limit' => 20000]);
        $one = $this->creditDraft();   // إجمالي 11500
        $two = $this->creditDraft();   // إجمالي 11500 ⇒ 23000 > 20000

        $results = $this->runConcurrently([
            $this->posterJob($one->id, $this->dir, InvoiceService::class),
            $this->posterJob($two->id, $this->dir, InvoiceService::class),
        ]);

        $ok = array_values(array_filter($results, fn ($r) => $r['ok']));
        $failed = array_values(array_filter($results, fn ($r) => ! $r['ok']));
        $this->assertCount(1, $ok, json_encode($results));
        $this->assertCount(1, $failed);
        $this->assertStringContainsString('الحد الائتماني', (string) $failed[0]['message']);
        $this->assertSame(1, Invoice::where('status', 'posted')->where('partner_id', $this->customer->id)->count());
        $this->assertLedgerBalanced();
    }

    /** @test */
    public function tenants_posting_concurrently_keep_independent_icv_chains_and_ledgers(): void
    {
        $x = $this->tenant;
        $y = $this->makeTenant('rem04-b-');
        $partnerY = Partner::create(['name' => 'عميل ي', 'type' => 'customer']);
        $serviceY = Product::create(['name' => 'خدمة ي', 'track_inventory' => false]);
        $draftsY = array_map(fn () => app(InvoiceService::class)->create(
            ['partner_id' => $partnerY->id, 'payment_type' => 'credit'],
            [['product_id' => $serviceY->id, 'quantity' => 1, 'unit_price' => 4000, 'tax_rate' => 15]],
        ), range(1, 3));

        app(TenantContext::class)->set($x->id);
        $draftsX = array_map(fn () => $this->creditDraft(), range(1, 3));

        $jobs = [];
        foreach ($draftsX as $d) {
            $jobs[] = $this->posterJob($d->id, $this->dir, InvoiceService::class, $x->id);
        }
        foreach ($draftsY as $d) {
            $jobs[] = $this->posterJob($d->id, $this->dir, InvoiceService::class, $y->id);
        }
        foreach ($this->runConcurrently($jobs) as $i => $r) {
            $this->assertTrue($r['ok'], "job {$i}: ".json_encode($r));
        }

        foreach ([$x->id => 3, $y->id => 3] as $tid => $n) {
            $icvs = DB::table('invoices')->where('tenant_id', $tid)->where('status', 'posted')->orderBy('zatca_icv')->pluck('zatca_icv')->map(fn ($v) => (int) $v)->all();
            $this->assertSame(range(1, $n), $icvs, "tenant {$tid}");
            $this->assertSame($n, DB::table('journal_entries')->where('tenant_id', $tid)->count());
            // لا سطر قيد يشير إلى حساب مستأجر آخر.
            $cross = DB::selectOne(
                'SELECT COUNT(*) AS c FROM journal_lines l
                   JOIN journal_entries e ON e.id = l.journal_entry_id
                   JOIN accounts a ON a.id = l.account_id
                  WHERE e.tenant_id = ? AND a.tenant_id <> e.tenant_id',
                [$tid]
            );
            $this->assertSame(0, (int) $cross->c);
        }
        app(TenantContext::class)->set($x->id);
        $this->assertLedgerBalanced();
    }

    // ───────────────────── إعادة المحاولة واستنفادها ─────────────────────

    /** @test */
    public function a_transient_deadlock_victim_is_rolled_back_completely_and_retried_to_a_single_posting(): void
    {
        $draft = $this->creditDraft();
        Rem04FlakyInvoiceService::reset(2); // المحاولتان 1 و2 تفشلان بعد أن كتبتا القيد وICV والحالة

        $posted = app()->build(Rem04FlakyInvoiceService::class)->post(Invoice::findOrFail($draft->id));

        $this->assertSame(3, Rem04FlakyInvoiceService::$calls);
        $this->assertSame('posted', $posted->status);
        $this->assertInvoicePostedExactlyOnce($draft->id, 1);
        $this->assertSame(1, JournalEntry::count(), 'لا قيود يتيمة من المحاولات الملغاة.');
        $this->assertLedgerBalanced();

        // السلسلة سليمة: التالية تأخذ ICV 2 دون فجوة.
        $next = app(InvoiceService::class)->post($this->creditDraft());
        $this->assertSame(2, (int) $next->zatca_icv);
    }

    /** @test */
    public function when_retries_are_exhausted_nothing_is_persisted_and_the_post_can_be_repeated(): void
    {
        $draft = $this->creditDraft();
        Rem04FlakyInvoiceService::reset(3);

        try {
            app()->build(Rem04FlakyInvoiceService::class)->post(Invoice::findOrFail($draft->id));
            $this->fail('كان يجب أن يصل استثناء الجمود بعد نفاد المحاولات.');
        } catch (QueryException $e) {
            $this->assertSame('40P01', $e->errorInfo[0]);
        }

        $this->assertSame(3, Rem04FlakyInvoiceService::$calls, 'ثلاث محاولات بالضبط.');
        $invoice = Invoice::findOrFail($draft->id);
        $this->assertSame('draft', $invoice->status);
        $this->assertNull($invoice->journal_entry_id);
        $this->assertNull($invoice->zatca_icv);
        $this->assertSame(0, JournalEntry::count());

        Rem04FlakyInvoiceService::reset(0);
        app()->build(Rem04FlakyInvoiceService::class)->post(Invoice::findOrFail($draft->id));
        $this->assertInvoicePostedExactlyOnce($draft->id, 1);
    }

    /** @test */
    public function the_api_answers_409_with_retry_after_when_retries_are_exhausted_never_500_and_recovers(): void
    {
        $auth = $this->registerTenant('rem04-http-'.uniqid(), 'rem04http'.uniqid().'@example.test');
        $this->tenantsToPurge[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $token = $auth['token'];

        $partner = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $partner, 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        app()->bind(InvoiceService::class, fn ($app) => $app->build(Rem04FlakyInvoiceService::class));
        Rem04FlakyInvoiceService::reset(3);

        $response = $this->withToken($token)->postJson("/api/invoices/{$invoice['id']}/post");
        $response->assertStatus(409);
        $this->assertSame('1', $response->headers->get('Retry-After'));
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('40P01', $body);
        $this->assertStringNotContainsString('update "tenants"', $body);
        $this->assertSame('draft', Invoice::findOrFail($invoice['id'])->status);

        // إعادة الطلب نفسه تنجح (لا ترحيل جزئي، لا ICV مستهلك).
        Rem04FlakyInvoiceService::reset(0);
        $this->withToken($token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();
        $this->assertSame(1, (int) Invoice::findOrFail($invoice['id'])->zatca_icv);
    }

    // ───────────────────────── ثوابت مالية ─────────────────────────

    /** @return array{entries: int} */
    private function ledgerSnapshot(): array
    {
        return ['entries' => JournalEntry::count()];
    }

    private function assertInvoicePostedExactlyOnce(string $invoiceId, int $expectedIcv): void
    {
        $invoice = Invoice::findOrFail($invoiceId);
        $this->assertSame('posted', $invoice->status);
        $this->assertSame($expectedIcv, (int) $invoice->zatca_icv);
        $this->assertNotNull($invoice->journal_entry_id);
        $this->assertSame(
            1,
            JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoiceId)->count(),
            'قيد واحد فقط للفاتورة.'
        );
    }

    private function assertLedgerBalanced(): void
    {
        $unbalanced = DB::select(
            'SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
              WHERE e.tenant_id = ? GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)',
            [$this->tenant->id]
        );
        $this->assertSame([], $unbalanced, 'كل قيد متوازن (Σ مدين = Σ دائن).');
    }
}
