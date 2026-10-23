<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaRolloutControlService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-18b-3c — إصدار الإشعار الدائن (381) تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  الترتيب الموثَّق: الإشعار ← الفاتورة المصدر ← مِرساة المستأجر (LedgerService) ← قراءة الضابط (بلا قفل) ← رأس السلسلة ← إدراج المدخل ← تحديث الإشعار.
 *  1) إشعارات نقدية وفواتير متزامنة على سلسلة واحدة ⇒ ICV متصل، PIH = هاش السابق، كل إشعار يطابق مدخله، قيد واحد لكل إشعار، بلا جمود.
 *  2) ترحيلات تتسابق مع تفعيل/تعطيل المستأجر ⇒ كل إشعار إما مرحَّل ومُصدَر بمدخل مطابق، أو مرحَّل قديماً بلا قرار ولا مدخل، أو مرفوض
 *     بسياج F2b (مسودة بلا قيد)؛ لا ICV مفقود ولا يتيم، بلا جمود.
 *  3) موت مفاجئ (SIGKILL) بعد إدراج المدخل وقبل التثبيت ⇒ لا مدخل ولا قيد ولا ترحيل ولا تقدّم للرأس، ولا يعلق شيء خلفه.
 *  4) السياسة B (REM-18b-3d) تحت تزامن حقيقي: ترحيلات تتسابق مع تبديل الإيقاف الطارئ ⇒ لا إشعار مرحَّل بلا قرار لمستأجر مفعَّل أبداً؛
 *     إيقاف يُثبَّت بين إدراج المدخل وتحديث الإشعار ⇒ رفض وتراجع كامل (لا ICV مستهلك)؛ وإيقاف يُثبَّت بعد عبارة التحديث وقبل commit ⇒
 *     الإصدار الجاري يكتمل (حدّ READ COMMITTED، D-B3) ثم يُحجب كل ترحيل لاحق.
 *
 *  على PostgreSQL **لا يُتخطّى** هذا الصنف إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط (لا أقفال صفوف).
 *  يعمل على قاعدة العامل بلا معاملة مُغلِّفة (`UsesWorkerDatabaseWithoutTransaction`؛ العمليات الفرعية تحتاج صفوفاً مثبَّتة، وصف المنصة عالميّ فلا يُشارَك مع عمّال آخرين) وينظّف بحذف المستأجر المتسلسل.
 */
class ZatcaCreditNoteIssuancePostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    /** @var list<string> */
    private array $admins = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (REM-18b-3c).');

        $this->dir = sys_get_temp_dir().'/zatca_issue_'.uniqid();
        mkdir($this->dir);
        $this->clearPlatformRows(); // صفوف المنصة لا تُحذف تطبيقياً: لا بقايا من تشغيل سابق منقطع
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
                $this->purgeTenant($id);
            }
            $this->clearPlatformRows();
            foreach ($this->admins as $id) {
                DB::table('platform_administrators')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    /** @test */
    public function concurrent_cash_notes_and_invoices_share_one_contiguous_chain_without_deadlock(): void
    {
        $s = $this->scene(quantity: 8);
        $this->enable($s['tenant']);
        $notes = array_map(fn () => $this->draftNote($s), range(1, 6));
        // فواتير **نقدية** تُرحَّل بالتزامن مع إشعارات نقدية: كانت تتعارض سابقاً بجمود (قفل 1110 في تهيئة الخزينة ↔ `FOR KEY SHARE` لسطر القيد)
        // وعولج ذلك في TREASURY-T1 (`CashBankAccountService::bootstrapDefaults`)؛ يحرسه أيضاً `TreasuryBootstrapDeadlockPostgresTest`.
        $drafts = array_map(fn () => $this->draftInvoice($s), range(1, 6));

        $jobs = [];
        foreach ($notes as $i => $note) {
            $jobs[] = fn () => $this->postInChild($s['tenant'], $note);
            $jobs[] = fn () => $this->postInvoiceInChild($s['tenant'], $drafts[$i]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $entries = DB::table('zatca_chain_entries')->where('tenant_id', $s['tenant'])->orderBy('icv')->get();
        $this->assertSame(range(1, 1 + 12), $entries->pluck('icv')->map(fn ($v) => (int) $v)->all(), 'ICV متصل: فاتورة الإعداد + 12');
        $this->assertSame(1 + 12, (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'));
        $this->assertChainContinuity($entries);
        foreach ($notes as $note) {
            $this->assertIssuedConsistently($note, true);
            $this->assertSame(1, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count(), 'قيد واحد');
        }
    }

    /** @test */
    public function postings_racing_activation_flips_end_issued_legacy_or_refused_never_inconsistent(): void
    {
        $s = $this->scene(quantity: 12);
        $admin = $this->makeAdmin();
        $notes = array_map(fn () => $this->draftNote($s), range(1, 8));

        $jobs = [];
        foreach ($notes as $i => $note) {
            $jobs[] = fn () => $this->postInChild($s['tenant'], $note);
            $jobs[] = fn () => $this->flipInChild($admin, $s['tenant'], $i % 2 === 0, 'تبديل متزامن '.$i);
        }
        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $result) {
            $this->assertFalse($this->isDeadlock($result), "جمود في العملية {$i}");
            $this->assertArrayHasKey('ok', $result);
        }
        foreach ($notes as $note) {
            $row = DB::table('credit_notes')->where('id', $note)->first();
            $entries = DB::table('zatca_chain_entries')->where('credit_note_id', $note)->count();
            $journals = DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count();
            if ($row->status === 'posted' && $row->zatca_status === 'generated') {
                $this->assertIssuedConsistently($note, true);
                $this->assertSame(1, $journals);
            } elseif ($row->status === 'posted') {
                $this->assertNull($row->zatca_status, 'ترحيل قديم بلا قرار');
                $this->assertSame(0, $entries);
                $this->assertSame(1, $journals);
            } else {
                $this->assertSame('draft', $row->status);
                $this->assertNull($row->zatca_status);
                $this->assertSame(0, $entries, 'المرفوض بلا مدخل');
                $this->assertSame(0, $journals, 'المرفوض بلا قيد');
            }
        }
        $entries = DB::table('zatca_chain_entries')->where('tenant_id', $s['tenant'])->orderBy('icv')->get();
        $this->assertSame(range(1, $entries->count()), $entries->pluck('icv')->map(fn ($v) => (int) $v)->all(), 'ICV متصل بلا فجوة أو يتيم');
        $this->assertSame($entries->count(), (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'));
        $this->assertChainContinuity($entries);
    }

    /** @test */
    public function a_process_killed_after_the_chain_entry_leaves_no_entry_no_journal_and_no_head_advance(): void
    {
        $s = $this->scene(quantity: 4);
        $this->enable($s['tenant']);
        $note = $this->draftNote($s);
        $headBefore = (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv');
        $dir = $this->dir;

        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid, 'pcntl_fork');
        if ($pid === 0) {
            DB::purge(config('database.default'));
            Event::listen('eloquent.created: '.\App\Models\ZatcaChainEntry::class, function () use ($dir): void {
                touch($dir.'/entry_inserted');
                sleep(30); // يُقتل قبل تحديث الإشعار والتثبيت
            });
            try {
                $this->postInChild($s['tenant'], $note);
            } catch (\Throwable) {
            }
            exit(0);
        }

        $deadline = microtime(true) + 15.0;
        while (! file_exists($dir.'/entry_inserted') && microtime(true) < $deadline) {
            usleep(1_000);
        }
        posix_kill($pid, SIGKILL);
        pcntl_waitpid($pid, $status);

        $this->assertSame('draft', DB::table('credit_notes')->where('id', $note)->value('status'));
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $note)->count());
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count());
        $this->assertSame($headBefore, (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'));

        // ولا يعلق شيء خلفه: المحاولة التالية تنجح بالـICV التالي.
        $retry = $this->runConcurrently([fn () => $this->postInChild($s['tenant'], $note)]);
        $this->assertAllOk($retry);
        $this->assertIssuedConsistently($note, true);
        $this->assertSame($headBefore + 1, (int) DB::table('credit_notes')->where('id', $note)->value('zatca_icv'));
    }

    /** @test */
    public function postings_racing_stop_toggles_never_leave_an_activated_tenant_with_an_undecided_posted_note(): void
    {
        $s = $this->scene(quantity: 12);
        $plain = $this->scene(quantity: 6);
        $this->enable($s['tenant']);
        $admin = $this->makeAdmin();
        $notes = array_map(fn () => $this->draftNote($s), range(1, 8));
        $plainNotes = array_map(fn () => $this->draftNote($plain), range(1, 4));

        $jobs = [];
        foreach ($notes as $i => $note) {
            $jobs[] = fn () => $this->postInChild($s['tenant'], $note);
            $jobs[] = fn () => $this->flipPlatformInChild($admin, $i % 2 === 1, 'تبديل إيقاف متزامن '.$i);
        }
        foreach ($plainNotes as $note) {
            $jobs[] = fn () => $this->postInChild($plain['tenant'], $note); // مستأجر لم يُفعَّل: ترحيل قديم دائماً
        }
        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $result) {
            $this->assertFalse($this->isDeadlock($result), "جمود في العملية {$i}");
        }
        foreach ($notes as $note) {
            $row = DB::table('credit_notes')->where('id', $note)->first();
            if ($row->status === 'posted') {
                $this->assertIssuedConsistently($note, true); // الترحيل لمفعَّل = صادر كامل دائماً
            } else {
                $this->assertSame('draft', $row->status);
                $this->assertNull($row->zatca_status);
                $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $note)->count(), 'المحجوب بلا مدخل');
                $this->assertSame(0, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count(), 'المحجوب بلا قيد');
            }
        }
        $this->assertSame(0, DB::table('credit_notes')->whereIn('id', $notes)->where('status', 'posted')->whereNull('zatca_status')->count(), 'لا مرحَّل بلا قرار لمستأجر مفعَّل');
        foreach ($plainNotes as $note) {
            $this->assertSame('posted', DB::table('credit_notes')->where('id', $note)->value('status'), 'المستأجر غير المفعَّل لا يتأثر بالإيقاف');
            $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
        }
        $entries = DB::table('zatca_chain_entries')->where('tenant_id', $s['tenant'])->orderBy('icv')->get();
        $this->assertSame(range(1, 1 + $entries->count() - 1), $entries->pluck('icv')->map(fn ($v) => (int) $v)->all(), 'ICV متصل بلا فجوة أو يتيم');
        $this->assertSame($entries->count(), (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'));
        $this->assertChainContinuity($entries);
    }

    /** @test */
    public function a_stop_committed_between_the_chain_entry_and_the_note_update_refuses_and_rolls_everything_back(): void
    {
        $s = $this->scene(quantity: 4);
        $this->enable($s['tenant']);
        $admin = $this->makeAdmin();
        $note = $this->draftNote($s);
        $headBefore = (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv');
        $dir = $this->dir;

        $results = $this->runConcurrently([
            function () use ($s, $note, $dir) {
                Event::listen('eloquent.created: '.\App\Models\ZatcaChainEntry::class, function () use ($dir): void {
                    touch($dir.'/entry_inserted');
                    $this->waitFor($dir.'/stop_done'); // يبقى المدخل غير مثبَّت حتى يُثبَّت الإيقاف
                });

                return $this->postInChild($s['tenant'], $note);
            },
            function () use ($admin, $dir) {
                $this->waitFor($dir.'/entry_inserted');
                $change = $this->flipPlatformInChild($admin, false, 'إيقاف بين المدخل والتحديث');
                touch($dir.'/stop_done');

                return $change;
            },
        ]);

        $this->assertTrue($results[1]['ok'], 'الإيقاف لا يُحجب بالترحيل الجاري (لا قفل مشترك)');
        $this->assertFalse($results[0]['ok'], 'الإيقاف المثبَّت قبل عبارة التحديث يرفض الإشعار');
        $this->assertStringContainsString('blocked while the platform emergency stop', (string) $results[0]['message']);
        $this->assertFalse($this->isDeadlock($results[0]));
        $this->assertSame('draft', DB::table('credit_notes')->where('id', $note)->value('status'));
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $note)->count(), 'المدخل تراجع');
        $this->assertSame($headBefore, (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'), 'لا ICV مستهلك');
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count());
    }

    /** @test */
    public function a_stop_committed_after_the_note_update_but_before_commit_lets_the_running_issuance_finish(): void
    {
        $s = $this->scene(quantity: 4);
        $this->enable($s['tenant']);
        $admin = $this->makeAdmin();
        [$running, $later] = [$this->draftNote($s), $this->draftNote($s)];
        $dir = $this->dir;

        $results = $this->runConcurrently([
            function () use ($s, $running, $dir) {
                Event::listen('eloquent.updated: '.CreditNote::class, function () use ($dir): void {
                    touch($dir.'/note_updated');
                    $this->waitFor($dir.'/stop_done'); // معاملة الإصدار مفتوحة وعبارة التحديث نُفِّذت
                });

                return $this->postInChild($s['tenant'], $running);
            },
            function () use ($admin, $dir) {
                $this->waitFor($dir.'/note_updated');
                $change = $this->flipPlatformInChild($admin, false, 'إيقاف بعد عبارة التحديث');
                touch($dir.'/stop_done');

                return $change;
            },
        ]);

        // D-B3: الإصدار الجاري عبر حدّ الإيقاف يكتمل صادراً كاملاً بمدخله — لا فجوة ولا تناقض.
        $this->assertAllOk($results);
        $this->assertIssuedConsistently($running, true);

        // وكل ترحيل لاحق محجوب بالاستثناء المُعرَّف.
        $blocked = $this->runConcurrently([fn () => $this->postInChild($s['tenant'], $later)]);
        $this->assertFalse($blocked[0]['ok']);
        $this->assertSame(\App\Support\ZatcaCreditNoteEmergencyStopException::class, $blocked[0]['error_class']);
        $this->assertSame('draft', DB::table('credit_notes')->where('id', $later)->value('status'));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{tenant: string, partner: string, product: string, invoice: string, line: string, class: string} */
    private function scene(int $quantity): array
    {
        $slug = 'zatca-issue-pg-'.substr(uniqid(), -8);
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $t = $auth['token'];

        $partner = $this->withToken($t)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $product = $this->withToken($t)->postJson('/api/products', [
            'name' => 'خدمة', 'sku' => 'SVC-'.$slug, 'type' => 'service', 'sale_price' => 50000, 'purchase_price' => 0,
        ])->assertCreated()['data']['id'];
        $s = ['tenant' => $auth['tenant_id'], 'partner' => $partner, 'product' => $product, 'invoice' => '', 'line' => '', 'class' => 'simplified'];
        $s['invoice'] = $this->invoiceInChild($s, $quantity)['invoice'];
        $s['line'] = (string) DB::table('invoice_lines')->where('invoice_id', $s['invoice'])->value('id');

        return $s;
    }

    /** @return array{invoice: string} */
    private function invoiceInChild(array $s, int $quantity = 1): array
    {
        app(TenantContext::class)->set($s['tenant']);
        $invoices = app(InvoiceService::class);
        $invoice = $invoices->post($invoices->create([
            'partner_id' => $s['partner'], 'payment_type' => 'cash', 'tax_inclusive' => false, 'zatca_document_type' => 'simplified',
        ], [['product_id' => $s['product'], 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => 50000, 'tax_rate' => 15]]));

        return ['invoice' => $invoice->id];
    }

    private function draftInvoice(array $s): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(InvoiceService::class)->create([
            'partner_id' => $s['partner'], 'payment_type' => 'cash', 'tax_inclusive' => false, 'zatca_document_type' => 'simplified',
        ], [['product_id' => $s['product'], 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]])->id;
    }

    private function postInvoiceInChild(string $tenant, string $invoice): array
    {
        app(TenantContext::class)->set($tenant);

        return ['status' => app(InvoiceService::class)->post(\App\Models\Invoice::findOrFail($invoice))->status];
    }

    private function draftNote(array $s): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(CreditNoteService::class)->create([
            'partner_id' => $s['partner'], 'original_invoice_id' => $s['invoice'], 'refund_type' => 'cash',
        ], [['source_line_id' => $s['line'], 'quantity' => 1]])->id;
    }

    private function postInChild(string $tenant, string $note): array
    {
        app(TenantContext::class)->set($tenant);
        $posted = app(CreditNoteService::class)->post(CreditNote::findOrFail($note));

        return ['status' => $posted->status];
    }

    private function flipInChild(string $admin, string $tenant, bool $enabled, string $reason): array
    {
        $change = app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($admin), $tenant, $enabled, $reason);

        return ['changed' => $change->changed];
    }

    private function flipPlatformInChild(string $admin, bool $enabled, string $reason): array
    {
        $change = app(ZatcaRolloutControlService::class)->setPlatformState(PlatformAdministrator::findOrFail($admin), $enabled, $reason);

        return ['changed' => $change->changed];
    }

    /** صفوف المنصة لا تُحذف تطبيقياً (حراس C4/E2): تنظيف الاختبار بتعطيل مُشغّلات المستخدم مؤقتاً فقط. */
    private function clearPlatformRows(): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('zatca_rollout_controls')) {
            return;
        }
        try {
            DB::unprepared('ALTER TABLE zatca_rollout_control_events DISABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE zatca_rollout_controls DISABLE TRIGGER USER');
            DB::table('zatca_rollout_control_events')->whereNull('tenant_id')->delete();
            DB::table('zatca_rollout_controls')->whereNull('tenant_id')->delete();
        } finally {
            DB::unprepared('ALTER TABLE zatca_rollout_controls ENABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE zatca_rollout_control_events ENABLE TRIGGER USER');
        }
    }

    private function waitFor(string $file, float $seconds = 10.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($file) && microtime(true) < $deadline) {
            usleep(1_000);
        }
    }

    private function makeAdmin(): string
    {
        $id = PlatformAdministrator::create([
            'name' => 'مدير تزامن', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ])->id;
        $this->admins[] = $id;

        return $id;
    }

    private function enable(string $tenant): void
    {
        app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($this->makeAdmin()), $tenant, true, 'تفعيل تجريبي للاختبار');
    }

    /** إشعار صادر: حالته generated ومدخله 381 يطابق كل أعمدته، وهاشه = هاش XML المخزَّن. */
    private function assertIssuedConsistently(string $note, bool $expected): void
    {
        $row = DB::table('credit_notes')->where('id', $note)->first();
        $this->assertSame('posted', $row->status);
        $this->assertSame('generated', $row->zatca_status);
        $entry = DB::table('zatca_chain_entries')->where('credit_note_id', $note)->sole();
        $this->assertSame('381', $entry->type_code);
        $this->assertSame((int) $entry->icv, (int) $row->zatca_icv);
        $this->assertSame($entry->zatca_uuid, $row->zatca_uuid);
        $this->assertSame($entry->previous_hash, $row->zatca_previous_hash);
        $this->assertSame($entry->hash, $row->zatca_hash);
        $this->assertSame(app(\App\Services\Accounting\ZatcaInvoiceHasher::class)->hash($row->zatca_xml), $row->zatca_hash);
    }

    /** @param \Illuminate\Support\Collection<int, object> $entries */
    private function assertChainContinuity($entries): void
    {
        $previous = \App\Services\Accounting\ZatcaChainAllocator::genesisHash();
        foreach ($entries as $entry) {
            $this->assertSame($previous, $entry->previous_hash, "PIH للمدخل {$entry->icv} = هاش السابق");
            $previous = $entry->hash;
        }
    }

    /** حذف المستأجر المتسلسل يزيل ما يملكه (الحراس تسمح به بعد زوال صفه)؛ يُعاد بعد حذف ما يعترضه من مراجع. */
    private function purgeTenant(string $tenantId): void
    {
        try {
            DB::table('tenants')->where('id', $tenantId)->delete();

            return;
        } catch (QueryException) {
        }

        DB::statement('DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ?)', [$tenantId]);
        $tables = array_map(fn ($row) => $row->table_name, DB::select(
            "SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'tenant_id'"
        ));
        for ($pass = 0; $pass < 8; $pass++) {
            $remaining = 0;
            foreach ($tables as $table) {
                if (in_array($table, ['credit_notes', 'zatca_chain_entries', 'zatca_chains', 'tenants'], true)) {
                    continue;
                }
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

    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $this->assertFalse($this->isDeadlock($result), "جمود في العملية {$i}");
        }
    }

    private function isDeadlock(array $result): bool
    {
        $message = (string) ($result['message'] ?? '');

        return str_contains($message, '40P01') || stripos($message, 'deadlock') !== false;
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
}
