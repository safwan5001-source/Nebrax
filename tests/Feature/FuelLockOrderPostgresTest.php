<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\PaymentMethod;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\FuelReconciliationService;
use App\Services\FuelSaleService;
use App\Services\FuelStationSettingsService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-LOCK-ORDER — لا جمود بين مسارات المبيعات وقراءة الخزان وتسوية الوردية، على PostgreSQL حقيقي.
 *
 * الترتيب الموحَّد: [المحطة NO KEY UPDATE] ← الوردية ← البيع ← الفاتورة ← السند ← مِرساة المستأجر.
 * ثلاث طبقات لا تكفي إحداها وحدها:
 *  1) سيناريوهات حتمية: عملية `psql` منفصلة تقفل صفوفاً بترتيب المسار المعاكس ثم تنام (`pg_sleep`) فيتقاطع الطرفان عمداً.
 *  2) تزاحم فعلي بالكود الحقيقي من الطرفين (`pcntl_fork`): تسجيل قراءات خزان مقابل مسودات/إنهاء/تحصيل بيع.
 *  3) حارس ترتيب: لقطة عبارات القفل داخل `collectPayment` (الوردية FOR SHARE قبل البيع FOR UPDATE).
 * يُتخطّى على SQLite؛ على PostgreSQL غياب `pcntl` أو `psql` فشل لا تخطٍّ.
 */
class FuelLockOrderPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelEquipmentFixture;

    /** @var list<string> */
    private array $tenants = [];

    private string $dir = '';

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_lock_order_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if ($this->dir !== '') {
            foreach (glob($this->dir . '/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    /** @return array<string,mixed> */
    private function world(): array
    {
        $f = $this->equipmentFixture('lo');
        $this->tenants[] = $f['tenant_id'];

        return $f;
    }

    /** @return array<string,mixed> */
    private function draftPayload(array $f, string $key): array
    {
        return [
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['a']['nozzle']->id, 'fuel_shift_id' => $f['shift']->id,
            'partner_id' => $f['customer']->id, 'quantity_milliliters' => 5000, 'idempotency_key' => $key,
        ];
    }

    /** يبدأ عملية psql تنفّذ $sql ثم يُنتظر انتهاؤها؛ يعيد [stderr, exit]. */
    private function startHolder(string $sql): array
    {
        $c = config('database.connections.pgsql');
        $proc = proc_open(
            ['psql', '-h', $c['host'], '-p', (string) $c['port'], '-U', $c['username'], '-d', DB::connection()->getDatabaseName(), '-v', 'ON_ERROR_STOP=1', '-c', $sql],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, ['PGPASSWORD' => (string) $c['password']] + getenv(),
        );
        $this->assertIsResource($proc, 'تعذر تشغيل psql');

        return [$proc, $pipes];
    }

    /** @return array{0:string,1:int} */
    private function finishHolder(array $holder): array
    {
        [$proc, $pipes] = $holder;
        $stderr = (string) stream_get_contents($pipes[2]);

        return [trim($stderr), proc_close($proc)];
    }

    private function assertNoDeadlock(string $stderr, int $exit, string $label): void
    {
        $this->assertStringNotContainsString('deadlock', $stderr, "{$label}: {$stderr}");
        $this->assertSame(0, $exit, "{$label}: عملية الطرف الآخر اكتملت — {$stderr}");
    }

    // ───── 1) سيناريوهات حتمية: قراءة الخزان (خزان ← محطة) مقابل مسارات المحطة ─────

    private function readerSql(array $f): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM fuel_tanks WHERE id='%s' FOR UPDATE; SELECT pg_sleep(1.5); SELECT 1 FROM fuel_stations WHERE id='%s' FOR KEY SHARE; COMMIT;",
            $f['a']['tank']->id, $f['station']->id,
        );
    }

    #[Test]
    public function creating_a_draft_never_deadlocks_with_a_tank_reading_transaction(): void
    {
        $f = $this->world();
        $holder = $this->startHolder($this->readerSql($f));
        usleep(500000);
        $draft = app(FuelSaleService::class)->createDraft($this->draftPayload($f, 'lo-draft'), $f['actor']);
        [$err, $exit] = $this->finishHolder($holder);

        $this->assertSame('draft', $draft->status);
        $this->assertNoDeadlock($err, $exit, 'createDraft ↔ قراءة خزان');
    }

    #[Test]
    public function finalizing_a_sale_never_deadlocks_with_a_tank_reading_transaction(): void
    {
        $f = $this->world();
        $sales = app(FuelSaleService::class);
        $draft = $sales->createDraft($this->draftPayload($f, 'lo-final'), $f['actor']);
        $holder = $this->startHolder($this->readerSql($f));
        usleep(500000);
        $sale = $sales->finalize(FuelSale::findOrFail($draft->id), $f['actor']);
        [$err, $exit] = $this->finishHolder($holder);

        $this->assertSame('finalized', $sale->status);
        $this->assertNoDeadlock($err, $exit, 'finalize ↔ قراءة خزان');
    }

    // ───── 2) سيناريوهات حتمية: الإغلاق/التسوية (وردية ← بيع) مقابل collectPayment ─────

    /** يهيّئ بيعاً منتهياً وطرق دفع نقد/بنك لاختبار التحصيل. @return array{0:array<string,mixed>,1:FuelSale,2:PaymentMethod} */
    private function finalizedSaleWithCashMethod(bool $receiptsBasis): array
    {
        $f = $this->world();
        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = PaymentMethod::where('settlement_type', 'cash')->where('is_active', true)->firstOrFail();
        $bank = PaymentMethod::where('settlement_type', 'bank')->where('is_active', true)->orderBy('name')->firstOrFail();
        $values = ['fuel_sales_allowed_payment_method_ids' => [$cash->id, $bank->id], 'fuel_sales_allow_deferred_payment' => true, 'fuel_price_tax_mode' => 'tax_inclusive'];
        if ($receiptsBasis) {
            config(['fuel_stations.shift_cash_receipts_enabled' => true]);
            $values['shift_expected_cash_basis'] = 'receiving_shift_receipts';
        }
        app(FuelStationSettingsService::class)->putStationValues($f['station'], $values, $f['actor'], 'تهيئة اختبار الأقفال');
        $sales = app(FuelSaleService::class);
        $sale = $sales->finalize($sales->createDraft($this->draftPayload($f, 'lo-pay-' . ($receiptsBasis ? 'r' : 'm')), $f['actor']), $f['actor']);

        return [$f, $sale, $cash];
    }

    /** @param array<string,mixed> $f */
    private function closeLikeSql(array $f, FuelSale $sale): string
    {
        // ترتيب الإغلاق/التسوية: الوردية FOR UPDATE ثم البيع FOR UPDATE (لتسديد فاتورة قائمة).
        return sprintf(
            "BEGIN; SELECT 1 FROM fuel_shifts WHERE id='%s' FOR UPDATE; SELECT pg_sleep(1.5); SELECT 1 FROM fuel_sales WHERE id='%s' FOR UPDATE; COMMIT;",
            $f['shift']->id, $sale->id,
        );
    }

    #[Test]
    public function collecting_a_payment_never_deadlocks_with_a_close_like_transaction_under_the_receipts_basis(): void
    {
        [$f, $sale, $cash] = $this->finalizedSaleWithCashMethod(true);
        $holder = $this->startHolder($this->closeLikeSql($f, $sale));
        usleep(500000);
        $payment = app(FuelSaleService::class)->collectPayment($sale->fresh(), ['payment_method_id' => $cash->id, 'amount_minor' => 1000, 'idempotency_key' => 'lo-pay-1'], $f['actor']);
        [$err, $exit] = $this->finishHolder($holder);

        $this->assertSame(1000, (int) $payment->amount);
        $this->assertNoDeadlock($err, $exit, 'collectPayment (أساس الإيصالات) ↔ إغلاق');
        $this->assertSame($f['shift']->id, DB::table('fuel_sale_payment_receipts')->where('payment_id', $payment->id)->value('fuel_shift_id'), 'الإيصال مختوم بالوردية المفتوحة');
    }

    #[Test]
    public function collecting_a_payment_never_deadlocks_with_a_close_like_transaction_under_the_default_basis(): void
    {
        [$f, $sale, $cash] = $this->finalizedSaleWithCashMethod(false);
        $holder = $this->startHolder($this->closeLikeSql($f, $sale));
        usleep(500000);
        $payment = app(FuelSaleService::class)->collectPayment($sale->fresh(), ['payment_method_id' => $cash->id, 'amount_minor' => 1000, 'idempotency_key' => 'lo-pay-2'], $f['actor']);
        [$err, $exit] = $this->finishHolder($holder);

        $this->assertSame(1000, (int) $payment->amount);
        $this->assertNoDeadlock($err, $exit, 'collectPayment (الأساس الافتراضي) ↔ إغلاق');
    }

    // ───── 3) حارس الترتيب داخل collectPayment ─────

    #[Test]
    public function collect_payment_locks_the_shift_before_the_sale_and_the_invoice(): void
    {
        [$f, $sale, $cash] = $this->finalizedSaleWithCashMethod(true);
        $locking = [];
        DB::listen(function ($q) use (&$locking) {
            if (preg_match('/from "(fuel_shifts|fuel_sales|invoices)".*\b(for (share|update|no key update))\b/i', $q->sql, $m) === 1) {
                $locking[] = $m[1] . ':' . strtolower($m[3]);
            }
        });
        app(FuelSaleService::class)->collectPayment($sale->fresh(), ['payment_method_id' => $cash->id, 'amount_minor' => 500, 'idempotency_key' => 'lo-order'], $f['actor']);

        $this->assertSame(['fuel_shifts:share', 'fuel_sales:update', 'invoices:update'], array_slice($locking, 0, 3), 'الترتيب الموحَّد: وردية ← بيع ← فاتورة. الفعلي: ' . implode(' → ', $locking));
    }

    #[Test]
    public function the_station_lock_in_the_sale_and_opening_paths_is_no_key_update(): void
    {
        $f = $this->world();
        $locking = [];
        DB::listen(function ($q) use (&$locking) {
            if (preg_match('/from "fuel_stations".*\b(for (update|no key update))\b/i', $q->sql, $m) === 1) {
                $locking[] = strtolower($m[2]);
            }
        });
        $sales = app(FuelSaleService::class);
        $sales->finalize($sales->createDraft($this->draftPayload($f, 'lo-nku'), $f['actor']), $f['actor']);

        $this->assertNotEmpty($locking, 'قُفلت المحطة');
        $this->assertSame(array_fill(0, count($locking), 'no key update'), $locking, 'مسارات البيع لا تقفل المحطة FOR UPDATE: ' . implode(',', $locking));
    }

    // ───── 4) تزاحم فعلي بالكود الحقيقي من الطرفين ─────

    #[Test]
    public function real_tank_readings_and_real_sales_collections_run_together_without_a_deadlock(): void
    {
        [$f, $sale0, $cash] = $this->finalizedSaleWithCashMethod(true);
        $ctx = ['tenant_id' => $f['tenant_id'], 'branch_id' => $f['actor']->branch_id ?? app(BranchContext::class)->id(), 'actor_id' => $f['actor']->id, 'station' => $f['station']->id, 'tank' => $f['a']['tank']->id,
            'nozzle' => $f['a']['nozzle']->id, 'pump' => $f['a']['pump']->id, 'shift' => $f['shift']->id, 'customer' => $f['customer']->id, 'cash' => $cash->id, 'sale0' => $sale0->id];

        $enter = function () use ($ctx) {
            app(TenantContext::class)->set($ctx['tenant_id']);
            if ($ctx['branch_id'] !== null) {
                app(BranchContext::class)->set($ctx['branch_id']);
            }

            return User::findOrFail($ctx['actor_id']);
        };
        $jobs = [
            // طرف القراءات: خزان FOR UPDATE ثم FK إلى المحطة.
            function () use ($ctx, $enter) {
                $enter();
                for ($i = 0; $i < 25; $i++) {
                    app(FuelReconciliationService::class)->recordReading([
                        'fuel_station_id' => $ctx['station'], 'fuel_tank_id' => $ctx['tank'], 'reading_type' => 'physical',
                        'quantity_liters' => (string) (90 + $i) . '.000', 'evidence_key' => "lo-stress-r{$i}", 'recorded_by' => $ctx['actor_id'],
                    ]);
                }

                return 25;
            },
            // طرف المبيعات: مسودة ← إنهاء ← تحصيل (وردية ← بيع ← فاتورة).
            function () use ($ctx, $enter) {
                $actor = $enter();
                $sales = app(FuelSaleService::class);
                for ($i = 0; $i < 12; $i++) {
                    $d = $sales->createDraft(['fuel_station_id' => $ctx['station'], 'fuel_nozzle_id' => $ctx['nozzle'], 'fuel_shift_id' => $ctx['shift'], 'partner_id' => $ctx['customer'], 'quantity_milliliters' => 1000, 'idempotency_key' => "lo-stress-s{$i}"], $actor);
                    $sales->finalize($d, $actor);
                    $sales->collectPayment(FuelSale::findOrFail($d->id), ['payment_method_id' => $ctx['cash'], 'amount_minor' => 100, 'idempotency_key' => "lo-stress-p{$i}"], $actor);
                }

                return 12;
            },
            // طرف تعديل بيانات أساسية بالكود الحقيقي: خزان FOR UPDATE ثم مضخة FOR UPDATE (تغيير الاسم فقط فلا تتأثر صلاحية البيع).
            function () use ($ctx, $enter) {
                $actor = $enter();
                $master = app(\App\Services\FuelStationMasterDataService::class);
                for ($i = 0; $i < 15; $i++) {
                    $master->updateTank(\App\Models\FuelTank::findOrFail($ctx['tank']), ['name' => "E2E_TEST خزان {$i}"], $actor);
                    $master->updatePump(\App\Models\FuelPump::findOrFail($ctx['pump']), ['name' => "E2E_TEST مضخة {$i}"], $actor);
                }

                return 15;
            },
            // طرف حركات نقد الوردية (الوردية FOR UPDATE ثم إدراج بمفاتيح أجنبية) بالكود الحقيقي.
            function () use ($ctx, $enter) {
                $actor = $enter();
                $shifts = app(\App\Services\FuelShiftService::class);
                for ($i = 0; $i < 15; $i++) {
                    $shifts->recordCashMovement(\App\Models\FuelShift::findOrFail($ctx['shift']), ['type' => 'cash_in', 'amount_minor' => 100, 'reason' => 'E2E_TEST', 'idempotency_key' => "lo-stress-cm{$i}"], $actor);
                }

                return 15;
            },
            // طرف رابع يحاكي الإغلاق/التسوية (وردية ← بيع) بتكرار، فيغطي تقاطع collectPayment مع قفل الوردية.
            function () use ($ctx, $enter) {
                $enter();
                for ($i = 0; $i < 12; $i++) {
                    DB::transaction(function () use ($ctx) {
                        DB::selectOne('select id from fuel_shifts where id = ? for update', [$ctx['shift']]);
                        usleep(20000);
                        DB::selectOne('select id from fuel_sales where id = ? for update', [$ctx['sale0']]);
                    });
                }

                return 12;
            },
        ];
        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $r) {
            $message = (string) ($r['message'] ?? '');
            $this->assertTrue($r['ok'] ?? false, "الطرف {$i}: " . ($r['error_class'] ?? '') . ' ' . $message);
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في الطرف {$i}");
        }
        $this->assertSame(15, (int) DB::table('fuel_shift_cash_movements')->where('fuel_shift_id', $f['shift']->id)->count(), 'كل حركات النقد سُجّلت');
        $this->assertSame(25, (int) DB::table('fuel_tank_readings')->where('tenant_id', $f['tenant_id'])->count(), 'كل القراءات سُجّلت');
        $this->assertSame(12 + 1, (int) DB::table('fuel_sales')->where('tenant_id', $f['tenant_id'])->where('status', 'finalized')->count(), 'كل المبيعات أُنهيت (12 + الأولى)');
    }

    /** @param list<callable> $jobs @return list<array<string,mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir . '/barrier_' . uniqid();
        $files = [];
        $pids = [];
        foreach ($jobs as $i => $job) {
            $files[$i] = $this->dir . '/result_' . uniqid() . "_{$i}";
            $pid = pcntl_fork();
            $this->assertNotSame(-1, $pid, 'فشل pcntl_fork');
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($files[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($files[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }
        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $out = [];
        foreach ($files as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $out[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $out;
    }
}
