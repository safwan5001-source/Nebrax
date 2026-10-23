<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PosReturnService;
use App\Services\Accounting\ReturnService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  TREASURY-T6 — توجيه ردّ المرتجعات/POS تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) مرتجعات عامة موجَّهة ↔ فواتير نقدية موجَّهة على درج واحد ⇒ بلا جمود، وكل مرتجع Cr 1111 فقط.
 *  2) تعطيل خزينة بين حلّ المحلِّل وكتابة القيد (مرتجع عام): لا يلتزم ترحيل بعد تثبيت تعطيل خزينته، ولا جمود.
 *  3) مرتجعات POS متزامنة في جلسة واحدة ⇒ بلا جمود، وكلها Cr خزينة الجلسة.
 *  4) تعطيل خزينة الجلسة بين الحلّ والكتابة (مرتجع POS): النافذة نفسها مُغلقة.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. يعمل على قاعدة العامل بلا معاملة مُغلِّفة.
 */
class TreasuryReturnRefundRoutingPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (TREASURY-T6).');

        $this->dir = sys_get_temp_dir().'/treasury_t6_'.uniqid();
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
    public function routed_general_returns_and_routed_cash_sales_race_on_one_drawer_without_deadlock_and_never_touch_1110(): void
    {
        $s = $this->generalScene(quantity: 12, saleOn1110: false);
        $returns = array_map(fn () => $this->draftReturn($s), range(1, 8));
        $invoices = array_map(fn () => $this->draftInvoice($s), range(1, 8));

        $jobs = [];
        foreach ($returns as $i => $return) {
            $jobs[] = fn () => $this->postReturnInChild($s, $return);
            $jobs[] = fn () => $this->postInvoiceInChild($s, $invoices[$i]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        foreach ($returns as $return) {
            $this->assertSame(['1111'], $this->creditedTreasuryCodes($return), 'كل مرتجع Cr 1111 فقط');
        }
        $this->assertSame(0, DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->where('e.tenant_id', $s['tenant'])->where('a.code', '1110')->where('e.source_type', ReturnDocument::class)->count(), 'لا قيد مرتجع على 1110');
    }

    /**
     * النافذة: الخزينة (1110 نظامية) تُقرأ نشطةً ثم يتأخر الترحيل قبل المِرساة فيُثبَّت تعطيلها. القفل `FOR KEY SHARE` على حسابها يجعل التعطيل
     * ينتظر التزام الترحيل أو يسبقه فيُرفض الترحيل؛ لا يلتزم ترحيل بعد تثبيت تعطيل خزينته (وهو ما كان يحدث بلا القفل).
     *
     * @test
     */
    public function a_deactivation_cannot_commit_between_the_resolution_and_the_ledger_write_of_a_routed_general_return(): void
    {
        $s = $this->generalScene(quantity: 12, saleOn1110: true);
        $return = $this->draftReturn($s);
        $e1110 = CashBankAccount::whereHas('account', fn ($q) => $q->where('code', '1110'))->firstOrFail();
        $this->assertTrue((bool) $e1110->account->is_system);

        $results = $this->runConcurrently([
            fn () => $this->postWithPauseAfterResolution($s, $e1110->id, fn (User $owner) => app(ReturnService::class)->post(ReturnDocument::findOrFail($return), $owner)->status),
            fn () => $this->deactivateAfterSignal($s, $e1110->id),
        ]);

        $this->assertRaceInvariant($results, $e1110->id, fn () => DB::table('return_documents')->where('id', $return)->value('status'),
            fn () => DB::table('journal_entries')->where('source_id', $return)->count());
    }

    /** @test */
    public function concurrent_pos_cash_returns_in_one_session_credit_only_the_session_treasury_without_deadlock(): void
    {
        $p = $this->posScene(invoices: 6);
        $jobs = array_map(fn ($inv) => fn () => $this->posReturnInChild($p, $inv), $p['invoices']);
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        foreach ($p['invoices'] as $inv) {
            $this->assertSame(1, DB::table('return_documents')->where('original_id', $inv)->where('status', 'posted')->count());
        }
        $this->assertSame(6, DB::table('return_documents')->where('tenant_id', $p['tenant'])->where('status', 'posted')->count());
        $this->assertSame(0, DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->where('e.tenant_id', $p['tenant'])->where('a.code', '1110')->where('e.source_type', ReturnDocument::class)->count(), 'لا قيد مرتجع POS على 1110');
    }

    /** @test */
    public function a_deactivation_cannot_commit_between_the_resolution_and_the_ledger_write_of_a_routed_pos_return(): void
    {
        // الجلسة على 1110 (حساب نظامي): تعطيل كيانه لا يمسّ حسابه الدفتري فلا يردّه المحرك — الحالة التي يحميها القفل وحده.
        $p = $this->posScene(invoices: 1, onSystemTreasury: true);
        $inv = $p['invoices'][0];
        $e1110 = CashBankAccount::whereHas('account', fn ($q) => $q->where('code', '1110'))->firstOrFail();
        $this->assertTrue((bool) $e1110->account->is_system);
        $this->assertSame($e1110->account_id, DB::table('pos_sessions')->where('id', $p['session'])->value('cash_account_id'));

        $results = $this->runConcurrently([
            fn () => $this->postWithPauseAfterResolution($p, $e1110->id, fn (User $owner) => $this->posReturnInChild($p, $inv)['status']),
            fn () => $this->deactivateAfterSignal($p, $e1110->id),
        ]);

        $this->assertRaceInvariant($results, $e1110->id, fn () => DB::table('return_documents')->where('original_id', $inv)->where('status', 'posted')->exists() ? 'posted' : 'draft',
            fn () => DB::table('journal_entries as e')->join('return_documents as r', 'r.id', '=', 'e.source_id')->where('r.original_id', $inv)->count());
    }

    // ───────────────────────── مساعدات الثابتة ─────────────────────────

    /** يجري `$post` ويوقف الحلقة بعد آخر استعلام للحلّ (فحص العملة) حتى يُثبَّت التعطيل أو ينقضي ثانية. */
    private function postWithPauseAfterResolution(array $s, string $entityId, callable $post): array
    {
        app(TenantContext::class)->set($s['tenant']);
        $owner = User::findOrFail($s['owner']);
        $seen = ['entity_active_at_write' => null];
        $hooked = false;
        DB::listen(function ($q) use (&$hooked, &$seen, $entityId) {
            if ($hooked || ! str_contains($q->sql, 'select "currency" from "tenants"')) {
                return;
            }
            $hooked = true;
            touch($this->dir.'/resolved');
            $this->waitFor($this->dir.'/deactivated', 1.0);
            $seen['entity_active_at_write'] = (bool) DB::selectOne('select is_active from cash_bank_accounts where id = ?', [$entityId])->is_active;
        });
        try {
            $status = $post($owner);
        } catch (\Throwable $e) {
            return $seen + ['status' => 'rejected', 'why' => $e->getMessage()];
        }

        return $seen + ['status' => $status];
    }

    private function deactivateAfterSignal(array $s, string $entityId): array
    {
        $this->waitFor($this->dir.'/resolved', 5.0);
        app(TenantContext::class)->set($s['tenant']);
        $t = microtime(true);
        app(CashBankAccountService::class)->deactivate(CashBankAccount::findOrFail($entityId));
        touch($this->dir.'/deactivated');

        return ['deactivated' => true, 'waited' => microtime(true) - $t];
    }

    private function assertRaceInvariant(array $results, string $entityId, callable $status, callable $entries): void
    {
        foreach ($results as $i => $r) {
            $this->assertFalse($this->isDeadlock($r), "جمود في العملية {$i}");
        }
        $this->assertTrue($results[1]['ok'] ?? false, 'التعطيل نجح: '.($results[1]['message'] ?? ''));
        $p = $results[0]['value'] ?? [];
        if (($p['status'] ?? null) === 'posted') {
            $this->assertTrue($p['entity_active_at_write'], 'ترحيل التزم بعد تثبيت تعطيل خزينته (نافذة سباق)');
            $this->assertGreaterThan(0.3, $results[1]['value']['waited'], 'التعطيل انتظر التزام الترحيل الجاري');
            $this->assertGreaterThanOrEqual(1, $entries());
        } else {
            $this->assertSame('draft', $status());
            $this->assertSame(0, $entries(), 'المرفوض بلا أي قيد');
        }
        $this->assertFalse((bool) DB::table('cash_bank_accounts')->where('id', $entityId)->value('is_active'), 'التعطيل ثبت في النهاية');
    }

    // ───────────────────────── المشاهد ─────────────────────────

    /** @return array{tenant:string, partner:string, product:string, owner:string, invoice:string, line:string, t1111:string} */
    private function generalScene(int $quantity, bool $saleOn1110): array
    {
        $slug = 't6-pg-'.substr(uniqid(), -8);
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('email', "owner@{$slug}.test")->sole();
        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer'])->id;
        $product = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false])->id;

        $cash = app(CashBankAccountService::class);
        $cash->bootstrapDefaults();
        $t1111 = $cash->create(['type' => 'cash', 'name' => 'خزينة 1111', 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'], $owner);
        if (! $saleOn1110) {
            $cash->makeMain(CashBankAccount::findOrFail($t1111->id));
        }
        config(['treasury.cash_sale_routing_enabled' => true]);
        Settings::put('sales', ['cash_sale_treasury_policy' => 'main']);

        $svc = app(InvoiceService::class);
        $sale = $svc->post($svc->create(
            ['partner_id' => $partner, 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'],
            [['product_id' => $product, 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => 50000, 'tax_rate' => 15]]
        ), null, $owner);

        return [
            'tenant' => $auth['tenant_id'], 'partner' => $partner, 'product' => $product, 'owner' => $owner->id,
            'invoice' => $sale->id, 'line' => (string) DB::table('invoice_lines')->where('invoice_id', $sale->id)->value('id'), 't1111' => $t1111->id,
        ];
    }

    private function draftReturn(array $s): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $s['partner'], 'payment_type' => 'cash', 'original_type' => Invoice::class, 'original_id' => $s['invoice'],
        ], [['source_line_id' => $s['line'], 'product_id' => $s['product'], 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]])->id;
    }

    private function draftInvoice(array $s): string
    {
        app(TenantContext::class)->set($s['tenant']);

        return app(InvoiceService::class)->create(
            ['partner_id' => $s['partner'], 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'],
            [['product_id' => $s['product'], 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]]
        )->id;
    }

    private function postReturnInChild(array $s, string $return): array
    {
        app(TenantContext::class)->set($s['tenant']);
        $owner = User::findOrFail($s['owner']);

        return ['status' => app(ReturnService::class)->post(ReturnDocument::findOrFail($return), $owner)->status];
    }

    private function postInvoiceInChild(array $s, string $invoice): array
    {
        app(TenantContext::class)->set($s['tenant']);
        $owner = User::findOrFail($s['owner']);

        return ['status' => app(InvoiceService::class)->post(Invoice::findOrFail($invoice), null, $owner)->status];
    }

    /** @return array{tenant:string, owner:string, session:string, t1111:string, invoices:list<string>} */
    private function posScene(int $invoices, bool $onSystemTreasury = false): array
    {
        $slug = 't6-pos-'.substr(uniqid(), -8);
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('email', "owner@{$slug}.test")->sole();
        $token = $auth['token'];

        $cash = app(CashBankAccountService::class);
        $cash->bootstrapDefaults();
        $t1111 = $cash->create(['type' => 'cash', 'name' => 'خزينة 1111', 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'], $owner);
        if (! $onSystemTreasury) {
            PaymentMethod::where('settlement_type', 'cash')->orderByDesc('is_default')->firstOrFail()->update(['cash_bank_account_id' => $t1111->id]);
        }

        $n = ++$this->seq;
        $wh = $this->withToken($token)->postJson('/api/warehouses', ['name' => "مخزن {$n}", 'code' => "T6PG-W-{$n}", 'is_active' => true])->assertCreated()['data']['id'];
        $dev = $this->withToken($token)->postJson('/api/pos-devices', ['name' => "كاشير {$n}", 'code' => "T6PG-D-{$n}", 'warehouse_id' => $wh, 'is_active' => true])->assertCreated()['data']['id'];
        $session = $this->withToken($token)->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $dev])->assertCreated()['data']['id'];
        $partner = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل pos', 'type' => 'customer'])->assertCreated()['data']['id'];

        $ids = [];
        for ($i = 0; $i < $invoices; $i++) {
            $product = Product::create(['name' => 'صنف '.(++$this->seq), 'sale_price' => 10000, 'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0])->id;
            $r = $this->withToken($token)->postJson('/api/pos/checkout', [
                'idempotency_key' => (string) Str::uuid(), 'partner_id' => $partner, 'pos_session_id' => $session,
                'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15, 'discount' => 0]],
                'tenders' => ['cash' => 11500],
            ])->assertCreated();
            $ids[] = $r['data']['id'];
        }
        app(TenantContext::class)->set($auth['tenant_id']);
        config(['treasury.cash_sale_routing_enabled' => true]);
        Settings::put('sales', ['cash_sale_treasury_policy' => 'main']);

        return ['tenant' => $auth['tenant_id'], 'owner' => $owner->id, 'session' => $session, 't1111' => $t1111->id, 'invoices' => $ids];
    }

    private function posReturnInChild(array $p, string $invoiceId): array
    {
        app(TenantContext::class)->set($p['tenant']);
        $owner = User::findOrFail($p['owner']);
        $invoice = Invoice::with('lines')->findOrFail($invoiceId);

        $return = app(PosReturnService::class)->create([
            'pos_session_id' => $p['session'], 'original_invoice_id' => $invoiceId, 'payment_type' => 'cash',
            'items' => [['source_line_id' => $invoice->lines->firstOrFail()->id, 'quantity' => 1]],
        ], $owner);

        return ['status' => $return->status];
    }

    /** @return list<string> أكواد الحسابات الدائنة بخزائن (111x) في قيد المرتجع */
    private function creditedTreasuryCodes(string $return): array
    {
        return DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.source_type', ReturnDocument::class)->where('e.source_id', $return)->where('l.credit', '>', 0)
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
