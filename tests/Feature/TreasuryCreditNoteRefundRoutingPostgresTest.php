<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY-T5 — توجيه الاسترداد النقدي تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) إشعارات نقدية موجَّهة (مشتقّة من بيع على 1111) ↔ فواتير نقدية موجَّهة على الدرج نفسه ⇒ بلا جمود، وكل إشعار Cr 1111 فقط.
 *  2) تعطيل الخزينة المشتقّة أثناء ترحيل الإشعارات ⇒ كل إشعار إما مرحَّل بقيد واحد Cr 1111 وإما مرفوض مسوّدةً بلا أي أثر؛
 *     لا قيد جزئي ولا Cr 1110 ولا جمود.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. يعمل على قاعدة العامل بلا معاملة مُغلِّفة.
 */
class TreasuryCreditNoteRefundRoutingPostgresTest extends TestCase
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
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (TREASURY-T5).');

        $this->dir = sys_get_temp_dir().'/treasury_t5_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        config(['treasury.cash_sale_routing_enabled' => false]);
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
    public function routed_cash_notes_and_routed_cash_sales_race_on_one_drawer_without_deadlock_and_never_touch_1110(): void
    {
        $s = $this->scene(quantity: 12);
        $notes = array_map(fn () => $this->draftNote($s), range(1, 8));
        $invoices = array_map(fn () => $this->draftInvoice($s), range(1, 8));

        $jobs = [];
        foreach ($notes as $i => $note) {
            $jobs[] = fn () => $this->postNoteInChild($s, $note);
            $jobs[] = fn () => $this->postInvoiceInChild($s, $invoices[$i]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        foreach ($notes as $note) {
            $this->assertSame(['1111'], $this->creditedTreasuryCodes($note), 'كل إشعار Cr 1111 فقط');
            $this->assertSame(1, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count());
        }
        $this->assertSame(8, DB::table('invoices')->whereIn('id', $invoices)->where('status', 'posted')->count());
        $this->assertSame(0, DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->where('e.tenant_id', $s['tenant'])->where('a.code', '1110')->where('e.source_type', CreditNote::class)->count(), 'لا قيد إشعار على 1110');
    }

    /** @test */
    public function deactivating_the_source_treasury_while_notes_post_leaves_each_note_either_fully_posted_to_1111_or_untouched(): void
    {
        $s = $this->scene(quantity: 12, moveMainBack: true);
        $notes = array_map(fn () => $this->draftNote($s), range(1, 6));

        $jobs = [function () use ($s) {
            usleep(40_000);
            app(TenantContext::class)->set($s['tenant']);
            app(CashBankAccountService::class)->deactivate(CashBankAccount::findOrFail($s['t1111']));

            return ['deactivated' => true];
        }];
        foreach ($notes as $note) {
            $jobs[] = fn () => $this->postNoteInChild($s, $note);
        }
        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $r) {
            $this->assertFalse($this->isDeadlock($r), "جمود في العملية {$i}");
        }
        $this->assertTrue($results[0]['ok'] ?? false, 'التعطيل نجح: '.($results[0]['message'] ?? ''));
        foreach ($notes as $k => $note) {
            $status = DB::table('credit_notes')->where('id', $note)->value('status');
            $entries = DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $note)->count();
            if ($status === 'posted') {
                $this->assertSame(1, $entries);
                $this->assertSame(['1111'], $this->creditedTreasuryCodes($note));
            } else {
                $this->assertSame('draft', $status);
                $this->assertSame(0, $entries, 'المرفوض بلا أي قيد');
                $this->assertFalse($results[$k + 1]['ok'] ?? true, 'المرفوض أبلغ فشله');
            }
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{tenant:string, partner:string, product:string, invoice:string, line:string, owner:string, t1111:string} */
    private function scene(int $quantity, bool $moveMainBack = false): array
    {
        $slug = 'refund-pg-'.substr(uniqid(), -8);
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('email', "owner@{$slug}.test")->sole();
        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer'])->id;
        $product = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false])->id;

        $cash = app(CashBankAccountService::class);
        $cash->bootstrapDefaults();
        $t1111 = $cash->create(['type' => 'cash', 'name' => 'خزينة 1111', 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'], $owner);
        $cash->makeMain(CashBankAccount::findOrFail($t1111->id));
        config(['treasury.cash_sale_routing_enabled' => true]);
        Settings::put('sales', ['cash_sale_treasury_policy' => 'main']);

        $s = ['tenant' => $auth['tenant_id'], 'partner' => $partner, 'product' => $product, 'invoice' => '', 'line' => '', 'owner' => $owner->id, 't1111' => $t1111->id];
        $svc = app(InvoiceService::class);
        $sale = $svc->post($svc->create(
            ['partner_id' => $partner, 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'],
            [['product_id' => $product, 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => 50000, 'tax_rate' => 15]]
        ), null, $owner);
        $s['invoice'] = $sale->id;
        $s['line'] = (string) DB::table('invoice_lines')->where('invoice_id', $sale->id)->value('id');

        if ($moveMainBack) {
            $cash->makeMain(CashBankAccount::whereHas('account', fn ($q) => $q->where('code', '1110'))->firstOrFail());
        }

        return $s;
    }

    private function draftNote(array $s): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(CreditNoteService::class)->create([
            'partner_id' => $s['partner'], 'original_invoice_id' => $s['invoice'], 'refund_type' => 'cash',
        ], [['source_line_id' => $s['line'], 'quantity' => 1]])->id;
    }

    private function draftInvoice(array $s): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(InvoiceService::class)->create(
            ['partner_id' => $s['partner'], 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'],
            [['product_id' => $s['product'], 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]]
        )->id;
    }

    private function postNoteInChild(array $s, string $note): array
    {
        app(TenantContext::class)->set($s['tenant']);
        $owner = User::findOrFail($s['owner']);

        return ['status' => app(CreditNoteService::class)->post(CreditNote::findOrFail($note), $owner)->status];
    }

    private function postInvoiceInChild(array $s, string $invoice): array
    {
        app(TenantContext::class)->set($s['tenant']);
        $owner = User::findOrFail($s['owner']);

        return ['status' => app(InvoiceService::class)->post(Invoice::findOrFail($invoice), null, $owner)->status];
    }

    /** @return list<string> أكواد الحسابات الدائنة بخزائن (111x) في قيد الإشعار */
    private function creditedTreasuryCodes(string $note): array
    {
        return DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.source_type', CreditNote::class)->where('e.source_id', $note)->where('l.credit', '>', 0)
            ->where('a.code', 'like', '111%')
            ->pluck('a.code')->unique()->values()->all();
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
