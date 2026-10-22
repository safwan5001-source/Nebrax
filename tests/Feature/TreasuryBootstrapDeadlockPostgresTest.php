<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\CreditNote;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY-T1 — جمود تهيئة الخزينة الافتراضية تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  الجذر: `CashBankAccountService::bootstrapDefaults()` كان يأخذ `FOR UPDATE` على حسابَي 1110/1120 **قبل** مِرساة المستأجر،
 *  بينما يأخذ الإشعار الدائن النقدي المِرساة ثم يحتاج `FOR KEY SHARE` على 1110 (مفتاح أجنبي)، وتأخذ الفاتورة الآجلة المدفوعة المِرساة
 *  ثم تهيّئ (ترتيب معكوس). العلاج: مسار سريع بلا أقفال للمستأجر المهيَّأ + المِرساة أولاً و`FOR NO KEY UPDATE` للمسار البطيء.
 *
 *  1) فاتورة نقدية ↔ إشعار دائن نقدي (حتمي ثم عشوائي) ⇒ بلا جمود.
 *  2) فاتورة نقدية ↔ فاتورة آجلة مدفوعة ⇒ بلا جمود.
 *  3) تهيئة تحمل المِرساة أولاً ↔ فاتورة نقدية (حتمي) ⇒ بلا جمود.
 *  4) تهيئة أولى متزامنة لمستأجرين غير مهيَّأين ⇒ كيانان ورئيسيان وأربع طرق دفع بالضبط، ولا أثر عابر للمستأجرين.
 *  5) مستأجر ناقص التهيئة (بنك مفقود / طرق مفقودة / حسابات نظامية غائبة) ⇒ يكتمل مرة واحدة بلا تكرار ولا خطأ.
 *  6) المسار السريع لا يُصدر أي قفل صفوف؛ والبطيء يقفل المِرساة قبل الحسابين ويستعمل `FOR NO KEY UPDATE`.
 *
 *  على PostgreSQL **لا يُتخطّى** هذا الصنف إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط.
 *  يعمل على قاعدة العامل بلا معاملة مُغلِّفة (`UsesWorkerDatabaseWithoutTransaction`) وينظّف بحذف المستأجر المتسلسل.
 */
class TreasuryBootstrapDeadlockPostgresTest extends TestCase
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
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (TREASURY-T1).');

        $this->dir = sys_get_temp_dir().'/treasury_t1_'.uniqid();
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
                $this->purgeTenant($id);
            }
        }

        parent::tearDown();
    }

    /** @test */
    public function a_cash_invoice_and_a_cash_sales_credit_note_never_deadlock_when_the_note_holds_the_anchor_first(): void
    {
        $s = $this->scene(quantity: 4);
        $note = $this->draftNote($s);
        $invoice = $this->draftInvoice($s, 'cash');
        $dir = $this->dir;

        $results = $this->runConcurrently([
            function () use ($s, $note, $dir) {
                app(TenantContext::class)->set($s['tenant']);

                // المِرساة تُؤخذ مبكراً عمداً لتوسيع نافذة التعارض مع تهيئة الفاتورة النقدية.
                return DB::transaction(function () use ($s, $note, $dir) {
                    Tenant::query()->whereKey($s['tenant'])->lockForUpdate()->first();
                    touch($dir.'/anchor_held');
                    usleep(1_500_000);

                    return ['note' => app(CreditNoteService::class)->post(CreditNote::findOrFail($note))->status];
                });
            },
            function () use ($s, $invoice, $dir) {
                $this->waitFor($dir.'/anchor_held');
                usleep(200_000);

                return $this->postInvoiceInChild($s['tenant'], $invoice);
            },
        ]);

        $this->assertAllOk($results);
        $this->assertSame('posted', $results[0]['value']['note']);
        $this->assertSame('posted', $results[1]['value']['status']);
        $this->assertSame(1, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count());
    }

    /** @test */
    public function many_cash_invoices_and_cash_sales_credit_notes_race_without_deadlock(): void
    {
        $s = $this->scene(quantity: 12);
        $notes = array_map(fn () => $this->draftNote($s), range(1, 8));
        $invoices = array_map(fn () => $this->draftInvoice($s, 'cash'), range(1, 8));

        $jobs = [];
        foreach ($notes as $i => $note) {
            $jobs[] = fn () => $this->postInChild($s['tenant'], $note);
            $jobs[] = fn () => $this->postInvoiceInChild($s['tenant'], $invoices[$i]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        foreach ($notes as $note) {
            $this->assertSame(1, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count());
        }
        $this->assertSame(8, DB::table('invoices')->whereIn('id', $invoices)->where('status', 'posted')->count());
    }

    /** @test */
    public function cash_invoices_and_paid_credit_invoices_race_without_deadlock(): void
    {
        $s = $this->scene(quantity: 1);
        $cash = array_map(fn () => $this->draftInvoice($s, 'cash'), range(1, 8));
        $paid = array_map(fn () => $this->draftInvoice($s, 'credit', paid: true), range(1, 8));

        $jobs = [];
        foreach ($cash as $i => $id) {
            $jobs[] = fn () => $this->postInvoiceInChild($s['tenant'], $id);
            $jobs[] = fn () => $this->postInvoiceInChild($s['tenant'], $paid[$i]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame(16, DB::table('invoices')->whereIn('id', array_merge($cash, $paid))->where('status', 'posted')->count());
        // كل فاتورة مدفوعة سُدّدت بسند قبض واحد: لا تكرار.
        $this->assertSame(8, DB::table('payment_allocations')->whereIn('allocatable_id', $paid)->count());
    }

    /** @test */
    public function a_bootstrap_that_holds_the_anchor_first_does_not_deadlock_with_a_cash_invoice(): void
    {
        $s = $this->scene(quantity: 1);
        $invoice = $this->draftInvoice($s, 'cash');
        $dir = $this->dir;

        $results = $this->runConcurrently([
            function () use ($s, $dir) {
                app(TenantContext::class)->set($s['tenant']);

                // ترتيب الفاتورة المدفوعة: المِرساة ثم التهيئة (ما يفعله `settle()` عبر `PaymentService`).
                return DB::transaction(function () use ($s, $dir) {
                    Tenant::query()->whereKey($s['tenant'])->lockForUpdate()->first();
                    touch($dir.'/anchor_held');
                    usleep(1_500_000);
                    app(CashBankAccountService::class)->bootstrapDefaults();

                    return ['bootstrap' => 'ok'];
                });
            },
            function () use ($s, $invoice, $dir) {
                $this->waitFor($dir.'/anchor_held');
                usleep(200_000);

                return $this->postInvoiceInChild($s['tenant'], $invoice);
            },
        ]);

        $this->assertAllOk($results);
        $this->assertSame('posted', $results[1]['value']['status']);
    }

    /** @test */
    public function the_slow_path_of_an_unprovisioned_tenant_does_not_deadlock_with_a_note_holding_the_anchor(): void
    {
        // المسار البطيء نفسه تحت تنافس: الفاتورة النقدية تهيّئ مستأجراً غير مهيَّأ (كان يقفل 1110 ثم ينتظر المِرساة) بينما يحمل الإشعار المِرساة ويحتاج مفتاح 1110.
        $s = $this->scene(quantity: 4);
        $note = $this->draftNote($s);
        $invoice = $this->draftInvoice($s, 'cash');
        $this->unprovision($s['tenant']);
        $dir = $this->dir;

        $results = $this->runConcurrently([
            function () use ($s, $note, $dir) {
                app(TenantContext::class)->set($s['tenant']);

                return DB::transaction(function () use ($s, $note, $dir) {
                    Tenant::query()->whereKey($s['tenant'])->lockForUpdate()->first();
                    touch($dir.'/anchor_held');
                    usleep(1_500_000);

                    return ['note' => app(CreditNoteService::class)->post(CreditNote::findOrFail($note))->status];
                });
            },
            function () use ($s, $invoice, $dir) {
                $this->waitFor($dir.'/anchor_held');
                usleep(200_000);

                return $this->postInvoiceInChild($s['tenant'], $invoice);
            },
        ]);

        $this->assertAllOk($results);
        $this->assertSame('posted', $results[1]['value']['status']);
        $this->assertFullyProvisioned($s['tenant']);
    }

    /** @test */
    public function concurrent_first_time_provisioning_is_idempotent_per_tenant_without_cross_tenant_effects(): void
    {
        $a = $this->scene(quantity: 1);
        $b = $this->scene(quantity: 1);
        $this->unprovision($a['tenant']);
        $bBefore = $this->treasurySnapshot($b['tenant']);

        $jobs = [];
        foreach (range(1, 6) as $_) {
            $jobs[] = fn () => $this->bootstrapInChild($a['tenant']);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertFullyProvisioned($a['tenant']);
        $this->assertSame($bBefore, $this->treasurySnapshot($b['tenant']), 'تهيئة مستأجر لا تمسّ مستأجراً آخر');
    }

    /** @test */
    public function a_partially_provisioned_tenant_completes_once_under_concurrency(): void
    {
        $s = $this->scene(quantity: 1);
        $bankAccount = Account::withoutGlobalScopes()->where('tenant_id', $s['tenant'])->where('code', '1120')->value('id');

        // البنك مفقود فقط: طرق الدفع الأربع قائمة لكنها مربوطة بالكيان، فنفكّ ربطها ثم نحذف الكيان.
        DB::table('payment_methods')->where('tenant_id', $s['tenant'])->update(['cash_bank_account_id' => null]);
        DB::table('cash_bank_accounts')->where('tenant_id', $s['tenant'])->where('account_id', $bankAccount)->delete();
        $methodsBefore = DB::table('payment_methods')->where('tenant_id', $s['tenant'])->count();
        $this->assertSame(4, $methodsBefore);

        $jobs = [];
        foreach (range(1, 6) as $_) {
            $jobs[] = fn () => $this->bootstrapInChild($s['tenant']);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame(1, DB::table('cash_bank_accounts')->where('tenant_id', $s['tenant'])->where('account_id', $bankAccount)->count(), 'كيان بنكي واحد');
        $this->assertSame(1, DB::table('cash_bank_accounts')->where('tenant_id', $s['tenant'])->where('type', 'bank')->where('is_main', true)->count());
        $this->assertSame(2, DB::table('cash_bank_accounts')->where('tenant_id', $s['tenant'])->count());
        $this->assertSame($methodsBefore, DB::table('payment_methods')->where('tenant_id', $s['tenant'])->count(), 'طرق الدفع القائمة لا تُزرع من جديد');
    }

    /** @test */
    public function a_tenant_without_the_legacy_system_accounts_is_a_concurrent_no_op(): void
    {
        $s = $this->scene(quantity: 1);
        $this->unprovision($s['tenant']);
        DB::table('journal_lines')->where('tenant_id', $s['tenant'])->delete();
        DB::table('account_balances')->where('tenant_id', $s['tenant'])->delete();
        DB::table('accounts')->where('tenant_id', $s['tenant'])->whereIn('code', ['1110', '1120'])->delete();

        $jobs = [];
        foreach (range(1, 4) as $_) {
            $jobs[] = fn () => $this->bootstrapInChild($s['tenant']);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $this->assertSame(0, DB::table('cash_bank_accounts')->where('tenant_id', $s['tenant'])->count());
        $this->assertSame(0, DB::table('payment_methods')->where('tenant_id', $s['tenant'])->count());
    }

    /** @test */
    public function the_fast_path_takes_no_row_locks_and_the_slow_path_locks_the_anchor_before_the_accounts(): void
    {
        $s = $this->scene(quantity: 1);
        app(TenantContext::class)->set($s['tenant']);
        $service = app(CashBankAccountService::class);

        $fast = $this->lockStatements(fn () => $service->bootstrapDefaults());
        $this->assertSame([], $fast, 'مستأجر مهيَّأ ⇒ لا قفل صفوف إطلاقاً: '.implode(' | ', $fast));

        $this->unprovision($s['tenant']);
        $slow = $this->lockStatements(fn () => $service->bootstrapDefaults());
        $tenantLock = $this->firstIndexMatching($slow, '/from "tenants"/i');
        $accountLock = $this->firstIndexMatching($slow, '/from "accounts"/i');
        $this->assertNotNull($tenantLock, 'المسار البطيء يقفل المِرساة');
        $this->assertNotNull($accountLock, 'المسار البطيء يقفل الحسابين');
        $this->assertLessThan($accountLock, $tenantLock, 'المِرساة قبل الحسابات');
        foreach ($slow as $sql) {
            if (preg_match('/from "accounts"/i', $sql)) {
                $this->assertMatchesRegularExpression('/for no key update/i', $sql, 'الحساب يُقفل بـFOR NO KEY UPDATE لا FOR UPDATE');
            }
        }
        $this->assertFullyProvisioned($s['tenant']);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function draftInvoice(array $s, string $paymentType, bool $paid = false): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(InvoiceService::class)->create([
            'partner_id' => $s['partner'], 'payment_type' => $paymentType, 'tax_inclusive' => false, 'zatca_document_type' => 'simplified',
            'is_paid' => $paid, 'payment_method' => 'cash',
        ], [['product_id' => $s['product'], 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]])->id;
    }

    private function bootstrapInChild(string $tenant): array
    {
        app(TenantContext::class)->set($tenant);
        app(CashBankAccountService::class)->bootstrapDefaults();

        return ['ok' => true];
    }

    /** يعيد المستأجر إلى حالة «لم تُهيَّأ خزائنه بعد»: طرق الدفع ثم الكيانات (بهذا الترتيب بسبب `restrict`). */
    private function unprovision(string $tenant): void
    {
        DB::table('payment_methods')->where('tenant_id', $tenant)->delete();
        DB::table('cash_bank_accounts')->where('tenant_id', $tenant)->delete();
    }

    private function assertFullyProvisioned(string $tenant): void
    {
        $entities = DB::table('cash_bank_accounts')->where('tenant_id', $tenant)->get();
        $this->assertSame(2, $entities->count(), 'كيانان بالضبط');
        $this->assertSame(['bank', 'cash'], $entities->pluck('type')->sort()->values()->all());
        $this->assertSame(2, $entities->where('is_main', true)->count(), 'رئيسي واحد لكل نوع');
        $this->assertSame(2, $entities->pluck('account_id')->unique()->count());
        $this->assertSame(4, DB::table('payment_methods')->where('tenant_id', $tenant)->count(), 'أربع طرق دفع بالضبط');
        $this->assertSame(4, DB::table('payment_methods')->where('tenant_id', $tenant)->distinct()->count('name'));
    }

    /** @return array<string, mixed> */
    private function treasurySnapshot(string $tenant): array
    {
        return [
            'entities' => DB::table('cash_bank_accounts')->where('tenant_id', $tenant)->orderBy('account_id')->get(['id', 'account_id', 'type', 'is_main', 'updated_at'])->map(fn ($r) => (array) $r)->all(),
            'methods' => DB::table('payment_methods')->where('tenant_id', $tenant)->orderBy('name')->get(['id', 'name', 'cash_bank_account_id', 'updated_at'])->map(fn ($r) => (array) $r)->all(),
        ];
    }

    /** عبارات SQL التي تقفل صفوفاً أثناء تنفيذ العملية. @return list<string> */
    private function lockStatements(callable $operation): array
    {
        $locks = [];
        DB::listen(function ($query) use (&$locks) {
            if (preg_match('/\bfor (no key )?(update|share|key share)\b/i', $query->sql)) {
                $locks[] = $query->sql;
            }
        });
        $operation();

        return $locks;
    }

    private function firstIndexMatching(array $statements, string $pattern): ?int
    {
        foreach ($statements as $i => $sql) {
            if (preg_match($pattern, $sql)) {
                return $i;
            }
        }

        return null;
    }

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

    private function postInvoiceInChild(string $tenant, string $invoice): array
    {
        app(TenantContext::class)->set($tenant);

        return ['status' => app(InvoiceService::class)->post(\App\Models\Invoice::findOrFail($invoice))->status];
    }

    private function waitFor(string $file, float $seconds = 10.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($file) && microtime(true) < $deadline) {
            usleep(1_000);
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
