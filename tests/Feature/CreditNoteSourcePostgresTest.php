<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ReturnService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-02 — الإشعار الدائن على PostgreSQL: التزامن وتقييد الحذف
 * ═══════════════════════════════════════════════════════════════
 *  عمليات نظام حقيقية منفصلة عبر `pcntl_fork()` (أسلوب REM-01 حرفياً): كل طفلٍ
 *  يفتح اتصال PostgreSQL خاصاً به فيتنافس فعلياً على قفل صفّ الفاتورة المصدر في
 *  `CreditNoteService::post()` و`ReturnService::post()`.
 *
 *  بلا القفل: معاملتان (READ COMMITTED) تريان المتبقي نفسه فيُرحَّل إشعاران كلٌّ
 *  منهما يخصم الكمية كلها، أو يتسابق إشعارٌ ومرتجعٌ على الكمية نفسها. ومع القفل:
 *  واحدٌ ينجح والآخر يُرفض بعد أن يرى ما رحّله الأول، ومجموع الأجزاء المتزامنة
 *  يساوي المحصَّل هللةً بهللة.
 *
 *  وهنا أيضاً: قاعدة حذف المفتاح الأجنبي `original_invoice_id` (RESTRICT) فعلياً
 *  في المحرك، وتراجع الهجرة/إعادتها.
 *
 *  **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي.**
 *
 *  تشغيل: php artisan test --filter=CreditNoteSourcePostgresTest
 */
class CreditNoteSourcePostgresTest extends TestCase
{
    private Tenant $tenant;
    private Partner $customer;
    private Product $service;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً على قفل الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'نبراس تزامن الإشعارات', 'slug' => 'cn-concurrency-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->service  = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant) && DB::connection()->getDriverName() === 'pgsql') {
            $this->purgeTenant($this->tenant->id);
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

    private function sale(int $qty, int $unitPrice, array $head = []): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(
            array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], $head),
            [['product_id' => $this->service->id, 'quantity' => $qty, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return $svc->post($invoice);
    }

    private function draftNote(Invoice $invoice, int $qty): CreditNote
    {
        return app(CreditNoteService::class)->create(
            ['partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id],
            [['source_line_id' => $invoice->lines->first()->id, 'quantity' => $qty]]
        );
    }

    private function draftReturn(Invoice $invoice, int $qty): ReturnDocument
    {
        $line = $invoice->lines->first();

        return app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => $qty, 'unit_price' => (int) $line->unit_price,
        ]]);
    }

    /**
     * @param  list<CreditNote|ReturnDocument>  $drafts
     * @return list<array{ok: bool, message?: string, value?: mixed}>
     */
    private function postConcurrently(array $drafts): array
    {
        $tenantId = $this->tenant->id;

        return $this->runConcurrently(array_map(
            fn ($d) => function () use ($tenantId, $d) {
                app(TenantContext::class)->set($tenantId);
                $posted = $d instanceof CreditNote
                    ? app(CreditNoteService::class)->post(CreditNote::findOrFail($d->id))
                    : app(ReturnService::class)->post(ReturnDocument::findOrFail($d->id));

                return [(int) $posted->subtotal, (int) $posted->tax_amount, (int) $posted->total];
            },
            $drafts
        ));
    }

    private function deleteRule(?string $connection = null): ?string
    {
        $row = DB::connection($connection)->selectOne(
            "SELECT rc.delete_rule AS rule
               FROM information_schema.referential_constraints rc
               JOIN information_schema.key_column_usage kcu
                 ON rc.constraint_name = kcu.constraint_name AND rc.constraint_schema = kcu.constraint_schema
              WHERE kcu.table_schema = current_schema()
                AND kcu.table_name = 'credit_notes' AND kcu.column_name = 'original_invoice_id'
              LIMIT 1"
        );

        return $row?->rule;
    }

    // ═══════════════════════════════════════════════════════════
    //  تقييد حذف الفاتورة المصدر (ACC-06)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_engine_refuses_to_delete_an_invoice_that_a_note_references(): void
    {
        $this->assertSame('RESTRICT', $this->deleteRule());

        $invoice = $this->sale(1, 11500, ['tax_inclusive' => true]);
        $note = app(CreditNoteService::class)->post($this->draftNote($invoice, 1));

        try {
            DB::table('invoices')->where('id', $invoice->id)->delete();
            $this->fail('PostgreSQL يجب أن يرفض حذف فاتورة يشير إليها إشعار.');
        } catch (QueryException $e) {
            $this->assertSame('23503', $e->errorInfo[0] ?? null, 'foreign_key_violation');
            $this->assertStringContainsString('credit_notes_original_invoice_id_foreign', $e->getMessage(), 'القيد المانع هو قيد الإشعار تحديداً.');
        }

        $this->assertNotNull(DB::table('invoices')->where('id', $invoice->id)->first());
        $this->assertSame($invoice->id, DB::table('credit_notes')->where('id', $note->id)->value('original_invoice_id'));
    }

    /**
     * التراجع والإعادة بأمرَي المشغّل الحقيقيين (`migrate:rollback --path` ثم `migrate --path`)
     * على قاعدة خاصة مُهاجَرة بالسلسلة كاملة — لا على القاعدة المشتركة.
     *
     * AWJ-BACKEND-CI-01: صفوف هذا الصنف تُرحَّل فعلاً (الأبناء المتشعّبون يجب أن يروها) فلا
     * يستعمل RefreshDatabase، ولذلك لا يحوّله ParaTest إلى قاعدة العامل `nibras_test_N`: كل
     * العمّال يتشاركون القاعدة الأساسية. وتعديل القيد يأخذ AccessExclusiveLock على
     * credit_notes ثم invoices، بينما `DELETE FROM tenants` في تنظيف عاملٍ آخر يأخذ
     * RowExclusiveLock على الجدولين بالترتيب المعاكس عبر قيود tenant_id المتتالية — دورة
     * أقفال يكسرها PostgreSQL بـ 40P01 (رُصدت في CI على #1433 و#1441). قاعدةٌ لا يتصل بها
     * غير هذا الاختبار تزيل الدورة من أصلها بلا إعادة محاولة ولا استثناء من التشغيل المتوازي.
     *
     * @test
     */
    public function the_restrict_rule_rolls_back_to_set_null_and_forward_again(): void
    {
        $path = base_path('database/migrations/2026_11_04_020000_restrict_credit_note_original_invoice_delete.php');
        $name = '2026_11_04_020000_restrict_credit_note_original_invoice_delete';

        $this->onPrivateMigratedDatabase(function (string $connection) use ($path, $name) {
            $applied = fn () => DB::connection($connection)->table('migrations')->where('migration', $name)->value('batch');

            $this->assertSame('RESTRICT', $this->deleteRule($connection), 'السلسلة الكاملة تنتهي بالتقييد.');
            $this->assertNotNull($applied());

            $this->artisan('migrate:rollback', ['--database' => $connection, '--path' => $path, '--realpath' => true, '--force' => true])
                ->assertExitCode(0)
                ->run();
            $this->assertSame('SET NULL', $this->deleteRule($connection));
            $this->assertNull($applied(), 'التراجع أزال سجلّ هذه الهجرة وحدها.');

            $this->artisan('migrate', ['--database' => $connection, '--path' => $path, '--realpath' => true, '--force' => true])
                ->assertExitCode(0)
                ->run();
            $this->assertSame('RESTRICT', $this->deleteRule($connection));
            $this->assertNotNull($applied(), 'الإعادة سجّلت الهجرة من جديد.');
        });

        $this->assertSame('RESTRICT', $this->deleteRule(), 'القاعدة المشتركة لم تُمسّ.');
    }

    /**
     * ينشئ قاعدة PostgreSQL مؤقتة باسمٍ فريد، يهاجرها بالسلسلة الحقيقية كاملة، يمرّر اسم
     * اتصالها، ثم يسقطها مهما كانت النتيجة.
     *
     * @param  callable(string): void  $test
     */
    private function onPrivateMigratedDatabase(callable $test): void
    {
        $base = config('database.default');
        $connection = 'rem02_private_ddl';
        // اللاحقة تُحفظ كاملة (حدّ PostgreSQL للمعرّف 63 بايتاً): يُقتطع من اسم القاعدة الأساسية لا منها.
        $suffix = '_ddl_'.getmypid().'_'.bin2hex(random_bytes(4));
        $database = substr((string) config("database.connections.{$base}.database"), 0, 63 - strlen($suffix)).$suffix;

        config(["database.connections.{$connection}" => array_merge(config("database.connections.{$base}"), ['database' => $database])]);
        DB::statement("CREATE DATABASE \"{$database}\"");

        try {
            $exit = Artisan::call('migrate', ['--database' => $connection, '--force' => true]);
            $this->assertSame(0, $exit, Artisan::output());

            $test($connection);
        } finally {
            DB::purge($connection);
            DB::statement("DROP DATABASE IF EXISTS \"{$database}\" WITH (FORCE)");
            config(["database.connections.{$connection}" => null]);
        }
    }

    /** @test */
    public function the_new_columns_exist_with_their_index_on_postgresql(): void
    {
        $this->assertTrue(Schema::hasColumn('credit_note_lines', 'source_line_id'));
        $this->assertTrue(Schema::hasColumn('credit_note_lines', 'line_discount'));
        $this->assertNotEmpty(DB::select(
            "SELECT 1 FROM pg_indexes WHERE tablename = 'credit_note_lines' AND indexname = 'credit_note_lines_tenant_source_line_index'"
        ));
    }

    // ═══════════════════════════════════════════════════════════
    //  التزامن
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function two_concurrent_posts_of_full_quantity_notes_credit_the_invoice_exactly_once(): void
    {
        $invoice = $this->sale(2, 11500, ['tax_inclusive' => true]);

        $results = $this->postConcurrently([$this->draftNote($invoice, 2), $this->draftNote($invoice, 2)]);

        $succeeded = array_values(array_filter($results, fn ($r) => $r['ok']));
        $failed    = array_values(array_filter($results, fn ($r) => ! $r['ok']));
        $this->assertCount(1, $succeeded, 'واحدٌ فقط ينجح: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, $failed);
        $this->assertStringContainsString('تتجاوز المتبقي', $failed[0]['message']);
        $this->assertSame([20000, 3000, 23000], $succeeded[0]['value']);

        app(TenantContext::class)->set($this->tenant->id);
        $posted = CreditNote::where('status', 'posted')->get();
        $this->assertCount(1, $posted);
        $this->assertSame(23000, (int) $posted->sum('total'), 'لا خصم مزدوج لأساس أو ضريبة.');
    }

    /** @test */
    public function three_concurrent_single_unit_notes_sum_to_the_charged_vat_to_the_penny(): void
    {
        // 3 × 100.01 شاملة: صافٍ 260.90 وضريبة 39.13 — المسوّدات الثلاث حُسبت معاً كلٌّ لوحدها.
        $invoice = $this->sale(3, 10001, ['tax_inclusive' => true]);

        $results = $this->postConcurrently([
            $this->draftNote($invoice, 1), $this->draftNote($invoice, 1), $this->draftNote($invoice, 1),
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], json_encode($result, JSON_UNESCAPED_UNICODE));
        }

        app(TenantContext::class)->set($this->tenant->id);
        $posted = CreditNote::where('status', 'posted')->get();
        $this->assertCount(3, $posted);
        $this->assertSame(26090, (int) $posted->sum('subtotal'));
        $this->assertSame(3913, (int) $posted->sum('tax_amount'));
        $this->assertSame(30003, (int) $posted->sum('total'));
    }

    /** @test */
    public function a_concurrent_note_and_return_of_the_same_units_cannot_both_post(): void
    {
        $invoice = $this->sale(2, 11500, ['tax_inclusive' => true]);

        $results = $this->postConcurrently([$this->draftNote($invoice, 2), $this->draftReturn($invoice, 2)]);

        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));

        app(TenantContext::class)->set($this->tenant->id);
        $notes = CreditNote::where('status', 'posted')->get();
        $returns = ReturnDocument::where('status', 'posted')->get();
        $this->assertSame(1, $notes->count() + $returns->count());
        $this->assertSame(
            [20000, 3000, 23000],
            [
                (int) $notes->sum('subtotal') + (int) $returns->sum('subtotal'),
                (int) $notes->sum('tax_amount') + (int) $returns->sum('tax_amount'),
                (int) $notes->sum('total') + (int) $returns->sum('total'),
            ],
            'الفاتورة تُخصم مرةً واحدة فقط: بإشعار أو بمرتجع.'
        );
    }

    /** @test */
    public function concurrent_notes_and_returns_mixed_close_the_invoice_exactly(): void
    {
        $invoice = $this->sale(4, 10001, ['tax_inclusive' => true]);

        $results = $this->postConcurrently([
            $this->draftNote($invoice, 1), $this->draftReturn($invoice, 1),
            $this->draftNote($invoice, 1), $this->draftReturn($invoice, 1),
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], json_encode($result, JSON_UNESCAPED_UNICODE));
        }

        app(TenantContext::class)->set($this->tenant->id);
        $notes = CreditNote::where('status', 'posted')->get();
        $returns = ReturnDocument::where('status', 'posted')->get();
        $this->assertSame(2, $notes->count());
        $this->assertSame(2, $returns->count());
        $this->assertSame(
            [(int) $invoice->subtotal - (int) $invoice->discount, (int) $invoice->tax_amount, (int) $invoice->total],
            [
                (int) $notes->sum('subtotal') + (int) $returns->sum('subtotal'),
                (int) $notes->sum('tax_amount') + (int) $returns->sum('tax_amount'),
                (int) $notes->sum('total') + (int) $returns->sum('total'),
            ],
            'Σ الإشعارات + المرتجعات = الفاتورة هللةً بهللة مهما كان ترتيب الفائز.'
        );
    }
}
