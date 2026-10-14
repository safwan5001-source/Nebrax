<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-04 / SEC-02 — انسداد PostgreSQL عند ترحيل الفواتير المتزامن
 * ═══════════════════════════════════════════════════════════════
 *  العيب: `InvoiceService::post()` كان يقفل **صف العميل** (`FOR UPDATE` داخل
 *  فحص الحد الائتماني) ثم **مِرساة المستأجر** (`LedgerService` ← `AccountingDateGuard`).
 *  أيّ معاملة تقفل المِرساة أولاً ثم تُدرج صفاً بمفتاح أجنبي إلى العميل (PostgreSQL
 *  يأخذ `FOR KEY SHARE` على صف العميل، وهو يتعارض مع `FOR UPDATE`) تُكوِّن دورة:
 *      A: عميل ← تنتظر مِرساة      B: مِرساة ← تنتظر عميل      ⇒ 40P01
 *  الإصلاح: مِرساة المستأجر **قبل** صف العميل في المسار نفسه (انظر `SourceInvoiceLock`).
 *
 *  ═══ التزامن الحتمي (بلا `sleep` اعتماداً) ═══
 *  عملياتان حقيقيتان عبر `pcntl_fork()`، ولكلٍّ اتصال PostgreSQL خاص. اتصال **ثالث** خام
 *  (`blocker`) يمسك الصفّ المتنازَع عليه عمداً، فتصطفّ المعاملتان خلفه بترتيب معلوم:
 *    1) يُطلَق A فيتوقف عند القفل (يُتحقَّق من `pg_stat_activity.wait_event_type = 'Lock'`)؛
 *    2) يُطلَق B ويُنتظر حتى يتوقف هو الآخر؛
 *    3) عندها فقط يُحرَّر الـblocker. ما يحدث بعدها هو ترتيب الأقفال الفعلي للشيفرة.
 *  قبل الإصلاح: A يأخذ العميل ثم يطلب المِرساة التي يمسكها B الذي ينتظر العميل ⇒ `40P01`
 *  حتمياً. بعده: A يأخذ المِرساة أولاً فلا تتكوّن دورة.
 *
 *  **لا يعمل إلا على PostgreSQL حقيقي.** SQLite لا يُثبت شيئاً عن هذا التنافس.
 *
 *  تشغيل: php artisan test --filter=Rem04InvoicePostConcurrencyPostgresTest
 */
class Rem04InvoicePostConcurrencyPostgresTest extends TestCase
{
    private const WAIT_SECONDS = 15;

    private Tenant $tenant;

    private Partner $customer;

    private Product $service;

    /** @var list<string> مستأجرون إضافيون أنشأتهم الاختبارات لفحص العزل */
    private array $extraTenantIds = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً على قفل الصفوف.');
        }
        if (! function_exists('pcntl_fork') || ! function_exists('posix_kill')) {
            $this->markTestSkipped('امتدادا pcntl وposix مطلوبان لتزامن حقيقي.');
        }

        $this->tenant = Tenant::create([
            'name' => 'نبراس انسداد الترحيل', 'slug' => 'rem04-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->service  = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant) && DB::connection()->getDriverName() === 'pgsql') {
            foreach ([...$this->extraTenantIds, $this->tenant->id] as $tenantId) {
                $this->purgeTenant($tenantId);
            }
        }

        parent::tearDown();
    }

    /** يحذف كل ما كتبته الاختبارات (تُرحَّل فعلاً بلا تراجع لأن الأبناء يرونها). */
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

    // ───────────────────────── محرّك التزامن ─────────────────────────

    /** اتصال خام مستقل يمسك صفاً بـ`FOR UPDATE` حتى `release()`. */
    private function blocker(string $table, string $id): \Closure
    {
        $cfg = config('database.connections.'.config('database.default'));
        $pdo = new PDO(
            sprintf('pgsql:host=%s;port=%s;dbname=%s', $cfg['host'], $cfg['port'], $cfg['database']),
            $cfg['username'],
            $cfg['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $pdo->exec('BEGIN');
        $stmt = $pdo->prepare("SELECT id FROM {$table} WHERE id = ? FOR UPDATE");
        $stmt->execute([$id]);
        $this->assertNotFalse($stmt->fetchColumn(), 'الصفّ المتنازَع عليه يجب أن يوجد');

        return function () use ($pdo): void {
            $pdo->exec('COMMIT');
        };
    }

    /**
     * @return array{pid: int, pidFile: string, resultFile: string, backend: int}
     */
    private function spawn(callable $job): array
    {
        $pidFile = tempnam(sys_get_temp_dir(), 'rem04_pid_');
        $resultFile = tempnam(sys_get_temp_dir(), 'rem04_res_');
        unlink($pidFile);

        // الأب يُسقط اتصاله **قبل كل تفرّع**: اتصال حيّ موروث يشاركه الابن المقبس نفسه فتنهار الجلسات.
        DB::purge(config('database.default'));

        $pid = pcntl_fork();
        if ($pid === -1) {
            $this->fail('فشل pcntl_fork — لا يمكن إثبات تزامن حقيقي بدونه.');
        }

        if ($pid === 0) {
            try {
                // اتصال الابن جديد (الأب فصل اتصاله قبل التفرّع). رقم الخلفية يُعلَن أولاً ليراقبه الأب.
                $backend = (int) DB::selectOne('select pg_backend_pid() as p')->p;
                file_put_contents($pidFile, (string) $backend);
                $value = $job();
                file_put_contents($resultFile, json_encode(['ok' => true, 'value' => $value]));
            } catch (\Throwable $e) {
                file_put_contents($resultFile, json_encode([
                    'ok' => false,
                    'class' => get_class($e),
                    'sqlstate' => $e instanceof QueryException ? ($e->errorInfo[0] ?? null) : ($e->errorInfo[0] ?? null),
                    'message' => $e->getMessage(),
                ]));
            }
            // بلا مدمّرات: إغلاق نظيف لاتصال موروث كان سيُنهي جلسة الأب/الـblocker عبر المقبس المشترك.
            posix_kill(posix_getpid(), SIGKILL);
            exit(0);
        }

        $deadline = microtime(true) + self::WAIT_SECONDS;
        while (! file_exists($pidFile) && microtime(true) < $deadline) {
            usleep(2000);
        }
        $this->assertFileExists($pidFile, 'لم يعلن الابن رقم خلفيته');

        return ['pid' => $pid, 'pidFile' => $pidFile, 'resultFile' => $resultFile, 'backend' => (int) file_get_contents($pidFile)];
    }

    /** ينتظر حتى ينتظر الخلفية قفلٌ فعلي، أو ينتهي الابن. */
    private function awaitLockWaitOrExit(array $child): string
    {
        $deadline = microtime(true) + self::WAIT_SECONDS;
        while (microtime(true) < $deadline) {
            $row = DB::selectOne('select wait_event_type from pg_stat_activity where pid = ?', [$child['backend']]);
            if ($row !== null && $row->wait_event_type === 'Lock') {
                return 'waiting';
            }
            if (pcntl_waitpid($child['pid'], $status, WNOHANG) === $child['pid']) {
                return 'exited';
            }
            usleep(2000);
        }

        $this->fail('لم يبلغ الابن حالة انتظار قفل ولا انتهى — الترتيب المتوقع لم يتحقق.');
    }

    /**
     * يطلق A ثم B خلف قفل الـblocker، ويحرّره بعد أن يصطفّا.
     *
     * @return array{0: array, 1: array, 2: array{a: string, b: string}} نتيجتا A وB وحالتا الاصطفاف
     */
    private function interleave(string $blockTable, string $blockId, callable $a, callable $b): array
    {
        $release = $this->blocker($blockTable, $blockId);

        $childA = $this->spawn($a);
        $stateA = $this->awaitLockWaitOrExit($childA);
        $childB = $this->spawn($b);
        $stateB = $this->awaitLockWaitOrExit($childB);

        $release();

        foreach ([$childA, $childB] as $child) {
            // المفوَّض قد يكون استُهلك في awaitLockWaitOrExit إن انتهى؛ المحاولة الثانية بلا ضرر.
            @pcntl_waitpid($child['pid'], $status);
        }

        $out = [];
        foreach ([$childA, $childB] as $child) {
            $raw = @file_get_contents($child['resultFile']);
            @unlink($child['resultFile']);
            @unlink($child['pidFile']);
            $out[] = json_decode($raw !== false && $raw !== '' ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return [$out[0], $out[1], ['a' => $stateA, 'b' => $stateB]];
    }

    // ───────────────────────── بيانات ─────────────────────────

    private function draft(array $head = [], int $unitPrice = 10000): Invoice
    {
        return app(InvoiceService::class)->create(
            array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], $head),
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );
    }

    private function receipt(int $amount = 1000): array
    {
        return [
            'partner_id' => $this->customer->id, 'amount' => $amount,
            'direction' => 'received', 'method' => 'cash',
        ];
    }

    private function isDeadlock(array $result): bool
    {
        return ($result['ok'] ?? true) === false
            && (($result['sqlstate'] ?? null) === '40P01' || str_contains((string) ($result['message'] ?? ''), 'deadlock detected'));
    }

    // ───────────────────────── فحوص المحاسبة ─────────────────────────

    private function assertLedgerSound(): void
    {
        $tenantId = $this->tenant->id;

        $unbalanced = DB::select(
            'SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
              WHERE e.tenant_id = ? GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)',
            [$tenantId]
        );
        $this->assertCount(0, $unbalanced, 'كل قيد متوازن');

        $drift = DB::select(
            "SELECT b.account_id FROM account_balances b
               LEFT JOIN (
                    SELECT jl.account_id, SUM(jl.debit) d, SUM(jl.credit) c
                      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
                     WHERE je.tenant_id = ? AND je.status IN ('posted','reversed') GROUP BY jl.account_id
               ) s ON s.account_id = b.account_id
              WHERE b.tenant_id = ? AND (b.total_debit <> COALESCE(s.d,0) OR b.total_credit <> COALESCE(s.c,0))",
            [$tenantId, $tenantId]
        );
        $this->assertCount(0, $drift, 'لقطات الأرصدة = مجاميع السطور');

        $icvs = DB::table('invoices')->where('tenant_id', $tenantId)->whereNotNull('zatca_icv')->pluck('zatca_icv')->map(fn ($v) => (int) $v)->all();
        $this->assertSame(count($icvs), count(array_unique($icvs)), 'لا ICV مكرّر');
        if ($icvs !== []) {
            $this->assertSame(count($icvs), max($icvs) - min($icvs) + 1, 'سلسلة ICV متصلة');
        }
    }

    private function assertPostedExactlyOnce(Invoice $invoice): void
    {
        $fresh = Invoice::query()->whereKey($invoice->id)->firstOrFail();
        $this->assertSame('posted', $fresh->status);
        $this->assertSame(
            1,
            DB::table('journal_entries')->where('source_type', Invoice::class)->where('source_id', $invoice->id)->count(),
            'قيد واحد بالضبط لهذه الفاتورة'
        );
        $this->assertSame($fresh->journal_entry_id, DB::table('journal_entries')
            ->where('source_type', Invoice::class)->where('source_id', $invoice->id)->value('id'));
        // المدين = إجمالي الفاتورة على الذمم، والضريبة 15% محتسبة كما هي.
        $this->assertSame((int) $fresh->total, (int) DB::table('journal_lines')
            ->where('journal_entry_id', $fresh->journal_entry_id)->sum('debit'));
        $this->assertSame(intdiv((int) $fresh->subtotal * 15 + 50, 100), (int) $fresh->tax_amount); // بالأعداد الصحيحة كما في الخدمة
    }

    // ═══════════════ A/B — ترحيل فاتورة آجلة × إنشاء سند (مِرساة المستأجر) ═══════════════

    /**
     * السيناريو الموثَّق في التدقيق (SEC-02): ترحيل فاتورة آجلة مقابل إنشاء سند قبض للعميل
     * نفسه بلا فرع نشط ⇒ ترقيم السند يقفل صف المستأجر ثم يُدرج صفاً بمفتاح أجنبي إلى العميل.
     *
     * @test
     */
    public function posting_a_credit_invoice_never_deadlocks_with_a_tenant_anchored_payment_create(): void
    {
        $draft = $this->draft();

        [$a, $b, $states] = $this->interleave(
            'partners',
            $this->customer->id,
            fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($draft->id))->id,
            fn () => app(PaymentService::class)->create($this->receipt())->id,
        );

        $this->assertFalse($this->isDeadlock($a), 'A (ترحيل الفاتورة): '.json_encode($a, JSON_UNESCAPED_UNICODE));
        $this->assertFalse($this->isDeadlock($b), 'B (إنشاء السند): '.json_encode($b, JSON_UNESCAPED_UNICODE));
        $this->assertTrue($a['ok'], 'A: '.json_encode($a, JSON_UNESCAPED_UNICODE));
        $this->assertTrue($b['ok'], 'B: '.json_encode($b, JSON_UNESCAPED_UNICODE));
        $this->assertSame(['a' => 'waiting', 'b' => 'waiting'], $states, 'كلاهما اصطفّ خلف القفل قبل التحرير');

        $this->assertPostedExactlyOnce($draft);
        $this->assertSame(1, Payment::query()->count(), 'سند واحد بالضبط');
        $this->assertLedgerSound();
    }

    // ═══════════════ C — فاتورة آجلة × فاتورة آجلة مسدَّدة فوراً (الانسداد بين فاتورتين) ═══════════════

    /**
     * نفس الدورة بلا أي سند منفصل: فاتورة آجلة *مسدَّدة* تأخذ المِرساة في القيد ثم `settle()` يُدرج سنداً
     * بمفتاح أجنبي إلى العميل، بينما فاتورة آجلة غير مسدَّدة تأخذ العميل أولاً.
     *
     * @test
     */
    public function posting_a_credit_invoice_never_deadlocks_with_a_paid_credit_invoice_post(): void
    {
        $unpaid = $this->draft();
        $paid = $this->draft(['is_paid' => true, 'payment_method' => 'cash']);

        [$a, $b, $states] = $this->interleave(
            'partners',
            $this->customer->id,
            fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($unpaid->id))->id,
            fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($paid->id))->id,
        );

        $this->assertFalse($this->isDeadlock($a), 'A: '.json_encode($a, JSON_UNESCAPED_UNICODE));
        $this->assertFalse($this->isDeadlock($b), 'B: '.json_encode($b, JSON_UNESCAPED_UNICODE));
        $this->assertTrue($a['ok'], 'A: '.json_encode($a, JSON_UNESCAPED_UNICODE));
        $this->assertTrue($b['ok'], 'B: '.json_encode($b, JSON_UNESCAPED_UNICODE));
        $this->assertSame(['a' => 'waiting', 'b' => 'waiting'], $states);

        $this->assertPostedExactlyOnce($unpaid);
        $this->assertPostedExactlyOnce($paid);
        $this->assertSame(1, Payment::query()->where('status', 'posted')->count(), 'سند التسوية الفوري مرة واحدة');
        $this->assertSame('paid', Invoice::query()->findOrFail($paid->id)->payment_status);
        $this->assertLedgerSound();
    }

    // ═══════════════ D — تكرار محدود ═══════════════

    /** @test */
    public function repeated_interleavings_never_deadlock(): void
    {
        $iterations = (int) (getenv('REM04_ITERATIONS') ?: 8);
        $posted = [];

        for ($i = 0; $i < $iterations; $i++) {
            $draft = $this->draft();
            $posted[] = $draft;

            [$a, $b] = $this->interleave(
                'partners',
                $this->customer->id,
                fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($draft->id))->id,
                fn () => app(PaymentService::class)->create($this->receipt(1000 + $i))->id,
            );

            $this->assertFalse($this->isDeadlock($a) || $this->isDeadlock($b), "التكرار {$i}: ".json_encode([$a, $b], JSON_UNESCAPED_UNICODE));
            $this->assertTrue($a['ok'] && $b['ok'], "التكرار {$i}: ".json_encode([$a, $b], JSON_UNESCAPED_UNICODE));
        }

        foreach ($posted as $draft) {
            $this->assertPostedExactlyOnce($draft);
        }
        $this->assertSame($iterations, Payment::query()->count());
        $this->assertLedgerSound();
    }

    // ═══════════════ F — ترتيب الأقفال الفعلي (سجل الاستعلامات) ═══════════════

    /**
     * الترتيب المعلن: الفاتورة ← المِرساة ← العميل. يُستخرج من عبارات `FOR UPDATE` الفعلية التي يرسلها
     * `InvoiceService::post()` لفاتورة آجلة غير مسدَّدة (دون تفرّع). المِرساة يطلبها `LedgerService` بعدها
     * ثانيةً (إعادة-دخولية) فلا تغيّر الترتيب الأول.
     *
     * @test
     */
    public function the_declared_lock_order_is_invoice_then_tenant_then_partner(): void
    {
        $draft = $this->draft();
        $locks = [];
        DB::listen(function ($query) use (&$locks) {
            if (str_contains(strtolower($query->sql), 'for update')
                && preg_match('/from "([a-z_]+)"/i', $query->sql, $m)) {
                $locks[] = $m[1];
            }
        });

        app(InvoiceService::class)->post(Invoice::query()->findOrFail($draft->id));

        $firstSeen = array_values(array_unique($locks));
        $this->assertSame(['invoices', 'tenants', 'partners'], array_slice($firstSeen, 0, 3), 'أول ظهور لكل قفل: '.implode(' → ', $firstSeen));
    }

    // ═══════════════ G — عزل المستأجرين ═══════════════

    /**
     * مِرساة مستأجرٍ آخر ممسوكة لا تحجب ترحيل مستأجرنا: القفل مقيَّد بمعرّف مستأجر الفاتورة نفسه.
     *
     * @test
     */
    public function another_tenants_anchor_lock_never_blocks_this_tenants_post(): void
    {
        $other = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'rem04-other-'.uniqid(),
            'vat_number' => '300000000000011', 'currency' => 'SAR',
        ]);
        $this->extraTenantIds[] = $other->id;
        $draft = $this->draft();

        $release = $this->blocker('tenants', $other->id);
        $child = $this->spawn(fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($draft->id))->id);
        $state = $this->awaitLockWaitOrExit($child);
        $release();
        @pcntl_waitpid($child['pid'], $status);
        $result = json_decode((string) @file_get_contents($child['resultFile']), true);
        @unlink($child['resultFile']);
        @unlink($child['pidFile']);

        $this->assertSame('exited', $state, 'الترحيل أنهى عمله دون انتظار قفل مستأجرٍ آخر');
        $this->assertTrue($result['ok'], json_encode($result, JSON_UNESCAPED_UNICODE));
        $this->assertPostedExactlyOnce($draft);
    }

    // ═══════════════ E — الحد الائتماني: القرار يطابق الترتيب التسلسلي على المِرساة ═══════════════

    /**
     * عميل قرب حدّه (حد 1000.00، رصيد 690.00). فاتورة آجلة جديدة بـ690.00 تُرفض ما لم يُرحَّل قبلها سند
     * يُنقص الرصيد. الاختبار يضبط من يفوز بمِرساة المستأجر أولاً (blocker على صف المستأجر):
     *   سند أولاً ⇒ الفاتورة تُقبل · فاتورة أولاً ⇒ تُرفض. القرار = تنفيذ تسلسلي بنفس الترتيب،
     * والقاعدة والصيغة والحد لم تتغيّر — فقط لحظة قراءة الرصيد صارت تحت المِرساة.
     *
     * @return array{0: Invoice, 1: Invoice, 2: Payment}
     */
    private function nearLimitWorld(): array
    {
        $this->customer->update(['credit_limit' => 100000]);

        $first = app(InvoiceService::class)->post($this->draft([], 60000)); // 690.00 على الذمم
        $second = $this->draft([], 60000);                                  // 690.00 أخرى
        $payment = app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'amount' => 40000, 'direction' => 'received', 'method' => 'cash',
        ], [['invoice_id' => $first->id, 'amount' => 40000]]);

        return [$first, $second, $payment];
    }

    /** @test */
    public function credit_limit_decision_follows_the_order_in_which_the_tenant_anchor_is_won_payment_first(): void
    {
        [, $second, $payment] = $this->nearLimitWorld();

        [$pay, $inv, $states] = $this->interleave(
            'tenants',
            $this->tenant->id,
            fn () => app(PaymentService::class)->post(Payment::query()->findOrFail($payment->id))->id,
            fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($second->id))->id,
        );

        $this->assertSame(['a' => 'waiting', 'b' => 'waiting'], $states);
        $this->assertTrue($pay['ok'], json_encode($pay, JSON_UNESCAPED_UNICODE));
        $this->assertTrue($inv['ok'], 'السند فاز بالمِرساة أولاً ⇒ الرصيد 290.00 + 690.00 ≤ 1000.00 ⇒ تُقبل: '.json_encode($inv, JSON_UNESCAPED_UNICODE));
        $this->assertPostedExactlyOnce($second);
        $this->assertLedgerSound();
    }

    /** @test */
    public function credit_limit_decision_follows_the_order_in_which_the_tenant_anchor_is_won_invoice_first(): void
    {
        [, $second, $payment] = $this->nearLimitWorld();

        [$inv, $pay, $states] = $this->interleave(
            'tenants',
            $this->tenant->id,
            fn () => app(InvoiceService::class)->post(Invoice::query()->findOrFail($second->id))->id,
            fn () => app(PaymentService::class)->post(Payment::query()->findOrFail($payment->id))->id,
        );

        $this->assertSame(['a' => 'waiting', 'b' => 'waiting'], $states);
        $this->assertFalse($inv['ok'], 'الفاتورة فازت أولاً ⇒ الرصيد 690.00 + 690.00 > 1000.00 ⇒ تُرفض');
        $this->assertStringContainsString('الحد الائتماني', (string) $inv['message']);
        $this->assertTrue($pay['ok'], json_encode($pay, JSON_UNESCAPED_UNICODE));

        $this->assertSame('draft', Invoice::query()->findOrFail($second->id)->status, 'لا أثر جزئي للفاتورة المرفوضة');
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', Invoice::class)->where('source_id', $second->id)->count());
        $this->assertLedgerSound();
    }
}
