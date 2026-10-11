<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\PosSession;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\PosReturnService;
use App\Services\Accounting\ReturnService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-02 — إرجاع POS الحقيقي ضد الإشعار الدائن ومرتجع API (PostgreSQL)
 * ═══════════════════════════════════════════════════════════════
 *  القرار المعتمد: لا يجوز تجاوز سقف عكس الضريبة/المبلغ الأصلي حتى عند تزامن
 *  POS مع الإشعار الدائن. عمليات نظام حقيقية منفصلة (`pcntl_fork`) تستدعي
 *  `PosReturnService::create` الفعلية (قفل الفرع + idempotency) مقابل
 *  `CreditNoteService::post` و`ReturnService::post`.
 *
 *  قبل `SourceInvoiceLock`: POS يأخذ صف الفرع فقط ولا يقفل الفاتورة، فيقرأ
 *  إرجاعُه المتبقي نفسه الذي يقرؤه الإشعار ويُرحَّلان معاً. وبعده: الترتيب واحد
 *  (فاتورة ← فرع) في المسارات كلها فلا ازدواج ولا انسداد — واختبار الإجهاد
 *  أدناه يكرّر خلط المسارات الأربعة ويشترط خلوّها من أي Deadlock.
 *
 *  **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي.**
 *
 *  تشغيل: php artisan test --filter=CreditNotePosLockOrderPostgresTest
 */
class CreditNotePosLockOrderPostgresTest extends TestCase
{
    use InteractsWithApi;

    private array $auth;
    private string $sessionId;
    private string $customerId;
    private string $branchId;
    private User $actor;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً على قفل الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $slug = 'pos-lock-'.substr(uniqid(), -8);
        $this->auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $t = $this->auth['token'];

        $warehouse = $this->withToken($t)->postJson('/api/warehouses', [
            'name' => 'مخزن قفل', 'code' => 'LK-W', 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $device = $this->withToken($t)->postJson('/api/pos-devices', [
            'name' => 'كاشير قفل', 'code' => 'LK-D', 'warehouse_id' => $warehouse, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $this->sessionId = $this->withToken($t)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device,
        ])->assertCreated()['data']['id'];
        $this->customerId = $this->withToken($t)->postJson('/api/partners', [
            'name' => 'عميل قفل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->actor = User::where('tenant_id', $this->auth['tenant_id'])->firstOrFail();
        $this->branchId = (string) PosSession::findOrFail($this->sessionId)->branch_id;
    }

    protected function tearDown(): void
    {
        if (isset($this->auth) && DB::connection()->getDriverName() === 'pgsql') {
            $this->purgeTenant($this->auth['tenant_id']);
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
        $barrier = tempnam(sys_get_temp_dir(), 'cn_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'cn_result_');
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

    // ── أدوات ────────────────────────────────────────────────────

    /** فاتورة POS خدمية شاملة للضريبة بسطر واحد. */
    private function posInvoice(int $qty, int $unitPrice): Invoice
    {
        $product = Product::create(['name' => 'خدمة قفل', 'sale_price' => $unitPrice, 'track_inventory' => false]);

        $id = $this->withToken($this->auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $this->customerId,
            'pos_session_id' => $this->sessionId,
            'tax_inclusive' => true,
            'items' => [['product_id' => $product->id, 'quantity' => $qty, 'unit_price' => $unitPrice, 'tax_rate' => 15, 'discount' => 0]],
            'tenders' => ['cash' => $qty * $unitPrice],
        ])->assertCreated()['data']['id'];

        app(TenantContext::class)->set($this->auth['tenant_id']);

        return Invoice::with('lines')->findOrFail($id);
    }

    private function draftNote(Invoice $invoice, int $qty): CreditNote
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return app(CreditNoteService::class)->create(
            ['partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id],
            [['source_line_id' => $invoice->lines->first()->id, 'quantity' => $qty]]
        );
    }

    private function draftApiReturn(Invoice $invoice, int $qty): ReturnDocument
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $line = $invoice->lines->first();

        return app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => $qty, 'unit_price' => (int) $line->unit_price,
        ]]);
    }

    /** مهمة إرجاع POS الحقيقية (قفل الفرع + idempotency) كما يستدعيها `PosController`. */
    private function posReturnJob(Invoice $invoice, int $qty): callable
    {
        $ctx = [$this->auth['tenant_id'], $this->branchId, $this->actor->id, $this->sessionId];
        $invoiceId = $invoice->id;
        $lineId = $invoice->lines->first()->id;

        return function () use ($ctx, $invoiceId, $lineId, $qty) {
            [$tenantId, $branchId, $actorId, $sessionId] = $ctx;
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->set($branchId);
            $actor = User::findOrFail($actorId);

            $posted = app(PosReturnService::class)->create([
                'idempotency_key' => (string) Str::uuid(),
                'pos_session_id' => $sessionId,
                'original_invoice_id' => $invoiceId,
                'payment_type' => 'credit',
                'items' => [['source_line_id' => $lineId, 'quantity' => $qty]],
            ], $actor);

            return [(int) $posted->subtotal, (int) $posted->tax_amount, (int) $posted->total];
        };
    }

    private function noteJob(CreditNote $draft): callable
    {
        $tenantId = $this->auth['tenant_id'];
        $id = $draft->id;

        return function () use ($tenantId, $id) {
            app(TenantContext::class)->set($tenantId);
            $posted = app(CreditNoteService::class)->post(CreditNote::findOrFail($id));

            return [(int) $posted->subtotal, (int) $posted->tax_amount, (int) $posted->total];
        };
    }

    private function apiReturnJob(ReturnDocument $draft): callable
    {
        $tenantId = $this->auth['tenant_id'];
        $id = $draft->id;

        return function () use ($tenantId, $id) {
            app(TenantContext::class)->set($tenantId);
            $posted = app(ReturnService::class)->post(ReturnDocument::findOrFail($id));

            return [(int) $posted->subtotal, (int) $posted->tax_amount, (int) $posted->total];
        };
    }

    /** @return array{net:int, tax:int, total:int, notes:int, returns:int} */
    private function consumed(): array
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $notes = CreditNote::where('status', 'posted')->get();
        $returns = ReturnDocument::where('status', 'posted')->get();

        return [
            'net' => (int) $notes->sum('subtotal') + (int) $returns->sum('subtotal'),
            'tax' => (int) $notes->sum('tax_amount') + (int) $returns->sum('tax_amount'),
            'total' => (int) $notes->sum('total') + (int) $returns->sum('total'),
            'notes' => $notes->count(),
            'returns' => $returns->count(),
        ];
    }

    // ═══════════════════════════════════════════════════════════
    //  لا تجاوز للسقف
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_real_pos_return_and_a_credit_note_of_the_same_units_cannot_both_post(): void
    {
        $invoice = $this->posInvoice(2, 11500);
        $note = $this->draftNote($invoice, 2);

        $results = $this->runConcurrently([$this->posReturnJob($invoice, 2), $this->noteJob($note)]);

        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));
        $failure = array_values(array_filter($results, fn ($r) => ! $r['ok']))[0];
        $this->assertStringContainsString('تتجاوز المتبقي', $failure['message']);

        $c = $this->consumed();
        $this->assertSame(1, $c['notes'] + $c['returns']);
        $this->assertSame([20000, 3000, 23000], [$c['net'], $c['tax'], $c['total']], 'الفاتورة تُعكس مرةً واحدة فقط.');
    }

    /** @test */
    public function a_real_pos_return_and_an_api_return_of_the_same_units_cannot_both_post(): void
    {
        $invoice = $this->posInvoice(2, 11500);
        $api = $this->draftApiReturn($invoice, 2);

        $results = $this->runConcurrently([$this->posReturnJob($invoice, 2), $this->apiReturnJob($api)]);

        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));
        $c = $this->consumed();
        $this->assertSame([20000, 3000, 23000], [$c['net'], $c['tax'], $c['total']]);
    }

    /** @test */
    public function pos_partial_and_note_partial_concurrent_close_the_vat_exactly_without_exceeding(): void
    {
        // 3 × 100.01 شاملة: صافٍ 260.90 وضريبة 39.13 (وحدةٌ لكل مسار).
        $invoice = $this->posInvoice(3, 10001);
        $n1 = $this->draftNote($invoice, 1);
        $n2 = $this->draftNote($invoice, 1);

        $results = $this->runConcurrently([
            $this->posReturnJob($invoice, 1), $this->noteJob($n1), $this->noteJob($n2),
        ]);

        foreach ($results as $r) {
            $this->assertTrue($r['ok'], json_encode($r, JSON_UNESCAPED_UNICODE));
        }
        $c = $this->consumed();
        $this->assertSame(3, $c['notes'] + $c['returns']);
        $this->assertLessThanOrEqual(26090, $c['net']);
        $this->assertLessThanOrEqual(3913, $c['tax']);
        $this->assertSame([26090, 3913, 30003], [$c['net'], $c['tax'], $c['total']], 'الأجزاء الثلاثة المتزامنة = الفاتورة هللةً بهللة.');
    }

    // ═══════════════════════════════════════════════════════════
    //  لا انسداد (Deadlock) بين المسارات الأربعة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function repeated_mixed_pos_note_and_api_postings_never_deadlock_and_never_exceed_the_invoice(): void
    {
        for ($round = 1; $round <= 4; $round++) {
            $invoice = $this->posInvoice(4, 10001);
            $jobs = [
                $this->posReturnJob($invoice, 1),
                $this->noteJob($this->draftNote($invoice, 1)),
                $this->apiReturnJob($this->draftApiReturn($invoice, 1)),
                $this->posReturnJob($invoice, 1),
            ];

            $results = $this->runConcurrently($jobs);

            foreach ($results as $r) {
                $this->assertTrue($r['ok'], "الجولة {$round}: ".json_encode($r, JSON_UNESCAPED_UNICODE));
            }
            foreach ($results as $r) {
                $this->assertStringNotContainsString('deadlock', strtolower((string) ($r['message'] ?? '')));
            }

            // استنفدت الجولة الفاتورة كاملةً: Σ كل ما رُحِّل منها = الفاتورة.
            app(TenantContext::class)->set($this->auth['tenant_id']);
            $notes = CreditNote::where('original_invoice_id', $invoice->id)->where('status', 'posted')->get();
            $returns = ReturnDocument::where('original_id', $invoice->id)->where('status', 'posted')->get();
            $this->assertSame(4, $notes->count() + $returns->count(), "الجولة {$round}");
            $this->assertSame(
                [(int) $invoice->subtotal - (int) $invoice->discount, (int) $invoice->tax_amount, (int) $invoice->total],
                [
                    (int) $notes->sum('subtotal') + (int) $returns->sum('subtotal'),
                    (int) $notes->sum('tax_amount') + (int) $returns->sum('tax_amount'),
                    (int) $notes->sum('total') + (int) $returns->sum('total'),
                ],
                "الجولة {$round}: Σ = الفاتورة بالهللة."
            );
        }
    }
}
