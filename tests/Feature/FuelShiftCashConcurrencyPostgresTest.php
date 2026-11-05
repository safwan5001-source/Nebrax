<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\User;
use App\Services\Accounting\PaymentReversalService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * #2021 (D1/D2/D5) — تزامن حقيقي على PostgreSQL (`pcntl_fork`): سحب متزامن · تحصيل↔إغلاق · عكس↔إغلاق · تكرار نفس المفتاح.
 *
 * الثوابت: لا جمود · لا إيصال نقدي يُختم بوردية أُغلقت · اللقطة المجمّدة تطابق الإيصالات الموجودة وقت الإغلاق تماماً ·
 * عكس بعد الإغلاق ⇒ حدث واحد بالضبط، وقبله ⇒ لا حدث. يُتخطّى على SQLite فقط (لا تنافس أقفال)؛ غياب pcntl على PostgreSQL فشل.
 * بيانات اصطناعية؛ تُحذف مستأجروها في tearDown.
 */
class FuelShiftCashConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelCashFixture;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->dir = sys_get_temp_dir() . '/fuel_cash_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
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

    /** @test */
    public function concurrent_handovers_never_exceed_the_available_cash(): void
    {
        $this->prepare('hand');
        $shift = $this->open('c-hand');
        $f = $this->f;

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f, $shift, $i) {
                $this->enter($f);
                try {
                    app(FuelShiftService::class)->recordCashMovement(FuelShift::findOrFail($shift->id), [
                        'type' => 'cash_out', 'amount_minor' => 8000, 'reason' => 'تسليم', 'idempotency_key' => "c-hand-{$i}",
                        'purpose' => 'treasury_handover', 'received_by_user_id' => $f['supervisor']->id, 'evidence' => ['proof_reference' => "R-{$i}"],
                    ], User::findOrFail($f['actor']->id));

                    return 'ok';
                } catch (RuntimeException) {
                    return 'rejected';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(2, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(16000, (int) FuelShiftCashMovement::where('fuel_shift_id', $shift->id)->sum('amount_minor'));
        $this->assertLessThanOrEqual(self::FLOAT, (int) FuelShiftCashMovement::where('fuel_shift_id', $shift->id)->sum('amount_minor'));
    }

    /** @test */
    public function collection_racing_with_close_is_either_in_the_frozen_snapshot_or_rejected_never_in_between(): void
    {
        $this->prepare('race');
        $f = $this->f;
        $both = $collectedFirst = $closedFirst = 0;

        foreach (range(1, 6) as $round) {
            $shift = $this->open("c-race-{$round}", 0);
            $sale = $this->sale("c-race-sale-{$round}", $shift);
            $total = (int) $sale->invoice->total;

            $results = $this->runConcurrently([
                function () use ($f, $sale, $round, $total) {
                    $this->enter($f);
                    try {
                        app(FuelSaleService::class)->collectPayment(FuelSale::findOrFail($sale->id), [
                            'payment_method_id' => $f['cash']->id, 'amount_minor' => $total, 'idempotency_key' => "c-race-pay-{$round}",
                        ], User::findOrFail($f['actor']->id));

                        return 'collected';
                    } catch (RuntimeException $e) {
                        return str_contains($e->getMessage(), 'FUEL_CASH_RECEIPT_NO_OPEN_SHIFT') ? 'blocked' : 'other:' . $e->getMessage();
                    }
                },
                function () use ($f, $shift) {
                    $this->enter($f);
                    app(FuelShiftService::class)->close(FuelShift::findOrFail($shift->id), 0, null, User::findOrFail($f['actor']->id));

                    return 'closed';
                },
            ]);

            $this->assertAllCompleted($results);
            $this->assertSame('closed', $results[1]['value']);
            $variance = DB::table('fuel_shift_cash_variances')->where('fuel_shift_id', $shift->id)->first();
            $stamped = (int) DB::table('fuel_sale_payment_receipts')->where('fuel_shift_id', $shift->id)->sum('amount_minor');
            $this->assertSame('closed', $this->shiftStatus($shift->id));
            if ($results[0]['value'] === 'collected') {
                $this->assertSame($total, $stamped, 'التحصيل الناجح مختوم بهذه الوردية.');
                $this->assertSame($total, (int) $variance->documented_official_cash_receipts_minor, 'اللقطة تطابق الإيصال بالضبط.');
                $this->assertSame(-$total, (int) $variance->variance_minor);
                $collectedFirst++;
            } else {
                $this->assertSame('blocked', $results[0]['value'], json_encode($results));
                $this->assertSame(0, $stamped);
                $this->assertSame(0, (int) $variance->documented_official_cash_receipts_minor);
                $this->assertSame(0, DB::table('payments')->where('tenant_id', $f['tenant_id'])->where('notes', 'like', '%' . $sale->number . '%')->count(), 'لا سند عند الحجب.');
                $closedFirst++;
            }
            $both++;
        }
        $this->assertSame(6, $both);
        $this->assertSame(6, $collectedFirst + $closedFirst);
    }

    /** @test */
    public function reversal_racing_with_close_leaves_exactly_one_consistent_audit_outcome(): void
    {
        $this->prepare('rev');
        $f = $this->f;

        foreach (range(1, 6) as $round) {
            $shift = $this->open("c-rev-{$round}", 0);
            $sale = $this->sale("c-rev-sale-{$round}", $shift);
            $total = (int) $sale->invoice->total;
            $payment = $this->collect($sale, 'cash', null, "c-rev-pay-{$round}");

            $results = $this->runConcurrently([
                function () use ($f, $shift) {
                    $this->enter($f);
                    app(FuelShiftService::class)->close(FuelShift::findOrFail($shift->id), 0, null, User::findOrFail($f['actor']->id));

                    return 'closed';
                },
                function () use ($f, $payment) {
                    $this->enter($f);
                    app(PaymentReversalService::class)->reverse(\App\Models\Payment::findOrFail($payment->id));

                    return 'reversed';
                },
            ]);

            $this->assertAllCompleted($results);
            $this->assertSame('reversed', DB::table('payments')->where('id', $payment->id)->value('status') === 'reversed' ? 'reversed' : 'no');
            $frozen = (int) DB::table('fuel_shift_cash_variances')->where('fuel_shift_id', $shift->id)->value('documented_official_cash_receipts_minor');
            $events = DB::table('fuel_shift_events')->where('fuel_shift_id', $shift->id)->where('type', 'post_close_cash_adjustment')->count();
            if ($frozen === $total) {
                $this->assertSame(1, $events, 'الإغلاق التقط الإيصال قبل العكس ⇒ أثر لاحق واحد.');
            } else {
                $this->assertSame(0, $frozen);
                $this->assertSame(0, $events, 'العكس سبق الإغلاق ⇒ استُبعد حيّاً ولا أثر لاحق.');
            }
        }
    }

    /** @test */
    public function concurrent_retries_with_the_same_collection_key_create_a_single_receipt(): void
    {
        $this->prepare('same');
        $shift = $this->open('c-same');
        $sale = $this->sale('c-same-sale', $shift);
        $total = (int) $sale->invoice->total;
        $f = $this->f;

        $jobs = [];
        foreach (range(1, 5) as $i) {
            $jobs[] = function () use ($f, $sale, $total) {
                $this->enter($f);

                return app(FuelSaleService::class)->collectPayment(FuelSale::findOrFail($sale->id), [
                    'payment_method_id' => $f['cash']->id, 'amount_minor' => $total, 'idempotency_key' => 'c-same-pay',
                ], User::findOrFail($f['actor']->id))->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertCount(1, array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame(1, DB::table('fuel_sale_payment_receipts')->where('fuel_sale_id', $sale->id)->count());
        $this->assertSame($total, (int) DB::table('fuel_sale_payment_receipts')->where('fuel_sale_id', $sale->id)->value('amount_minor'));
    }

    private function prepare(string $suffix): void
    {
        $this->f = $this->fixture('-pg-' . $suffix . '-' . bin2hex(random_bytes(3)));
        $this->tenants[] = $this->f['tenant_id'];
        $this->tenants[] = $this->f['foreign_tenant_id'];
    }

    private function shiftStatus(string $id): string
    {
        return (string) DB::table('fuel_shifts')->where('id', $id)->value('status');
    }

    /** @param array<string,mixed> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch']->id);
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: " . ($result['error_class'] ?? '') . ' ' . ($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir . '/barrier_' . uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir . '/result_' . uniqid() . "_{$i}";
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
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        DB::purge(config('database.default'));

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
