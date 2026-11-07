<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelDelivery;
use App\Models\FuelOpeningBalance;
use App\Models\Partner;
use App\Services\FuelOpeningBalanceBlockedException;
use App\Services\FuelOpeningBalanceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-TANKS-V2 / PR-1 — ترحيل الرصيد الافتتاحي للوقود تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`).
 *
 *  1) ترحيل المستند نفسه من عدة عمليات ⇒ أثر واحد (قيد واحد، 3 حركات، 3 صفوف دفتر) والباقي يعيده (replayed).
 *  2) مستندان مختلفان للمجمّعات نفسها ⇒ يُرحَّل أحدهما فقط والآخر محجوب ولا يترك أثراً.
 *  3) مسودات متزامنة بمفتاح واحد ⇒ مستند واحد.
 *  4) ترحيل افتتاحي ضد اعتماد استلام على المجمّع نفسه ⇒ لا جمود ولا رصيد مكرر: إما افتتاحي ثم استلام، أو استلام ثم حجب الافتتاحي.
 * يُتخطّى على SQLite فقط؛ على PostgreSQL غياب `pcntl` فشل. لا جمود (40P01) مقبول في أي حالة.
 */
class FuelOpeningBalanceConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelOpeningWorld;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_open_conc_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->cleanupOpeningTenants();
        }
        parent::tearDown();
    }

    #[Test]
    public function concurrent_posts_of_the_same_document_produce_exactly_one_effect(): void
    {
        $w = $this->openingWorld();
        $doc = $this->service()->createDraft($this->openingPayload($w), $w['actor'])['document'];
        $before = $this->effects($w);

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->attempt($w, fn () => $this->postOpening($w, $doc->id));
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $outcomes = array_count_values(array_map(fn ($r) => $r['value'], $results));
        $this->assertSame(1, $outcomes['posted'] ?? 0, 'عملية واحدة تُرحِّل فعلاً: ' . json_encode($results));
        $this->assertSame(5, $outcomes['replayed'] ?? 0, json_encode($results));

        $this->assertSame('posted', DB::table('fuel_opening_balances')->where('id', $doc->id)->value('status'));
        $this->assertSame(1, (int) DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->where('source_id', $doc->id)->count());
        $this->assertSame($before['journal_entries'] + 1, $this->effects($w)['journal_entries']);
        $this->assertSame(3, (int) DB::table('stock_movements')->where('source_type', FuelOpeningBalance::class)->where('source_id', $doc->id)->count());
        $this->assertSame(3, (int) DB::table('fuel_operational_ledgers')->where('source_id', $doc->id)->count());
        $this->assertSame(3, (int) DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->count());
        $this->assertSame(76_555_000, (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->sum('quantity'));
        $this->assertSame(self::TOTAL_VALUE, (int) DB::table('fuel_inventory_cost_states')->where('tenant_id', $w['tenant_id'])->sum('cost_pool_minor'));
        $this->assertSame(76_555_000, (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $w['tenant_id'])->sum('quantity_milliliters'));
    }

    #[Test]
    public function two_documents_for_the_same_pools_never_both_post(): void
    {
        $w = $this->openingWorld();
        $a = $this->service()->createDraft($this->openingPayload($w), $w['actor'])['document'];
        $b = $this->service()->createDraft($this->openingPayload($w), $w['actor'])['document'];

        $jobs = [];
        foreach ([$a, $b, $a, $b] as $doc) {
            $jobs[] = fn () => $this->attempt($w, fn () => $this->postOpening($w, $doc->id));
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $posted = DB::table('fuel_opening_balances')->where('tenant_id', $w['tenant_id'])->where('status', 'posted')->pluck('id')->all();
        $this->assertCount(1, $posted, 'يُرحَّل مستند واحد فقط: ' . json_encode($results));
        $loser = $posted[0] === $a->id ? $b->id : $a->id;

        $this->assertSame('draft', DB::table('fuel_opening_balances')->where('id', $loser)->value('status'));
        $this->assertSame(0, (int) DB::table('fuel_operational_ledgers')->where('source_id', $loser)->count());
        $this->assertSame(0, (int) DB::table('stock_movements')->where('source_id', $loser)->count());
        $this->assertSame(0, (int) DB::table('journal_entries')->where('source_id', $loser)->count());
        $this->assertSame(1, (int) DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->count());
        $this->assertSame(76_555_000, (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->sum('quantity'), 'الرصيد لم يتضاعف');
        $this->assertSame(3, (int) DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->count());
        foreach ($results as $i => $r) {
            $this->assertContains($r['value'], ['posted', 'replayed', 'blocked'], "العملية {$i}: " . json_encode($r));
        }
    }

    #[Test]
    public function concurrent_drafts_with_one_idempotency_key_create_a_single_document(): void
    {
        $w = $this->openingWorld();
        $payload = $this->openingPayload($w, ['idempotency_key' => 'conc-key-1']);

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->attempt($w, fn () => app(FuelOpeningBalanceService::class)->createDraft($payload, $w['actor'])['document']->id);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $ids = array_values(array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertCount(1, $ids, json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_opening_balances')->where('tenant_id', $w['tenant_id'])->count());
        $this->assertSame(3, (int) DB::table('fuel_opening_balance_lines')->where('tenant_id', $w['tenant_id'])->count());
        $this->assertSame(0, $this->effects($w)['movements'] + $this->effects($w)['ledger'] + $this->effects($w)['journal_entries'], 'المسودات لا أثر لها');
    }

    #[Test]
    public function an_opening_racing_a_delivery_approval_on_the_same_pool_never_deadlocks_or_double_counts(): void
    {
        $base = $this->openingWorld();
        $this->enter($base);
        $supplier = Partner::create(['branch_id' => $base['branch']->id, 'type' => 'supplier', 'name' => 'مورد سباق', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI سباق', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        app(FuelStationSettingsService::class)->putTenant(['grni_account_id' => $grni->id], $base['actor'], 'GRNI لاختبار السباق');

        $outcomes = ['opening_first' => 0, 'delivery_first' => 0];
        foreach (range(1, 6) as $round) {
            $w = $this->freshPools($base, $round);
            $this->enter($w);
            $delivery = app(FuelSupplyReceivingService::class)->createDelivery([
                'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'fuel_product_id' => $w['fuels']['91']->id,
                'warehouse_id' => $w['warehouse']->id, 'supplier_id' => $supplier->id, 'dispatched_liters' => '10.000', 'received_liters' => '10.000',
                'received_total_cost_minor' => 2345, 'delivery_note_number' => "DN-{$round}-" . $w['slug'], 'idempotency_key' => "race-{$round}-" . $w['slug'],
                'received_at' => '2026-08-23 10:00:00', 'created_by' => $w['actor']->id,
            ]);
            $doc = $this->service()->createDraft($this->openingPayload($w), $w['actor'])['document'];

            // الترتيب المتسابق يتبدّل بين الجولات.
            $jobs = [
                fn () => $this->attempt($w, fn () => $this->postOpening($w, $doc->id)),
                fn () => $this->attempt($w, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id)->status),
            ];
            if ($round % 2 === 0) {
                $jobs = array_reverse($jobs);
            }
            $results = $this->runConcurrently($jobs);
            $this->assertAllCompleted($results);

            $warehouseId = $w['warehouse']->id;
            $openingPosted = DB::table('fuel_opening_balances')->where('id', $doc->id)->value('status') === 'posted';
            $deliveryApproved = DB::table('fuel_deliveries')->where('id', $delivery->id)->value('status') === 'approved';
            $pool91 = (int) DB::table('product_warehouse_stock')->where('warehouse_id', $warehouseId)->where('product_id', $w['fuels']['91']->product_id)->value('quantity');
            $total = (int) DB::table('product_warehouse_stock')->where('warehouse_id', $warehouseId)->sum('quantity');

            $this->assertTrue($deliveryApproved, "جولة {$round}: الاستلام يُعتمد في الحالتين: " . json_encode($results));
            if ($openingPosted) {
                $outcomes['opening_first']++;
                $this->assertSame(30_000_000 + 10_000, $pool91, "جولة {$round}");
                $this->assertSame(76_555_000 + 10_000, $total, "جولة {$round}");
            } else {
                // الاستلام سبق: الافتتاحي محجوب كلياً (ذرّي) والمجمّع يحمل الاستلام وحده.
                $outcomes['delivery_first']++;
                $this->assertSame(10_000, $pool91, "جولة {$round}");
                $this->assertSame(10_000, $total, "جولة {$round}");
                $this->assertSame(0, (int) DB::table('stock_movements')->where('source_id', $doc->id)->count());
                $this->assertSame(0, (int) DB::table('fuel_operational_ledgers')->where('source_id', $doc->id)->count());
                $this->assertSame('draft', DB::table('fuel_opening_balances')->where('id', $doc->id)->value('status'));
            }
            // اتساق ثابت P0: مجموع الدفتر = الرصيد الرسمي = كمية حالة التكلفة، لمخزن الجولة.
            $this->assertSame($total, (int) DB::table('fuel_operational_ledgers')->where('warehouse_id', $warehouseId)->sum('quantity_milliliters'), "جولة {$round}: الدفتر = الرصيد الرسمي");
            $this->assertSame($total, (int) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $warehouseId)->sum('quantity_milliliters'), "جولة {$round}: حالة التكلفة = الرصيد الرسمي");
            $this->assertSame(1, (int) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $warehouseId)->where('fuel_product_id', $w['fuels']['91']->id)->count(), 'حالة تكلفة واحدة للمجمّع');
        }
        $this->assertSame(6, $outcomes['opening_first'] + $outcomes['delivery_first'], json_encode($outcomes));
    }

    /** مخزن ومحطة وخزانات جديدة (مجمّعات جديدة) داخل المستأجر نفسه — بلا تسجيل مستأجر جديد (تفادي حد التسجيل). @param array<string,mixed> $w @return array<string,mixed> */
    private function freshPools(array $w, int $round): array
    {
        $this->enter($w);
        $warehouse = \App\Models\Warehouse::create(['name' => "مخزن سباق {$round}", 'code' => "RACE-{$round}-" . $w['slug'], 'branch_id' => $w['branch']->id]);
        $station = \App\Models\FuelStation::create(['branch_id' => $w['branch']->id, 'warehouse_id' => $warehouse->id, 'code' => "RS-{$round}-" . $w['slug'], 'name' => "محطة سباق {$round}"]);
        $tanks = [];
        foreach ($w['fuels'] as $key => $fuel) {
            $tanks[$key] = \App\Models\FuelTank::create([
                'branch_id' => $w['branch']->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => "RT-{$key}-{$round}-" . $w['slug'], 'name' => "خزان {$key} جولة {$round}", 'capacity_milliliters' => 34_000_000, 'safe_capacity_milliliters' => 33_000_000,
            ]);
        }

        return array_replace($w, ['warehouse' => $warehouse, 'station' => $station, 'tanks' => $tanks]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function service(): FuelOpeningBalanceService
    {
        return app(FuelOpeningBalanceService::class);
    }

    /** @param array<string,mixed> $w */
    private function enter(array $w): void
    {
        app(TenantContext::class)->set($w['tenant_id']);
        app(BranchContext::class)->set($w['branch']->id);
    }

    /** posted | replayed @param array<string,mixed> $w */
    private function postOpening(array $w, string $id): string
    {
        $result = $this->service()->post(FuelOpeningBalance::findOrFail($id), $w['actor']);

        return $result['replayed'] ? 'replayed' : 'posted';
    }

    /**
     * ok ⇒ القيمة | blocked ⇒ مانع عمل متوقَّع (FuelOpeningBalanceBlockedException أو رفض RuntimeException). غيرها (جمود/خطأ قاعدة) يُفشل assertAllCompleted.
     *
     * @param array<string,mixed> $w
     */
    private function attempt(array $w, callable $work): mixed
    {
        $this->enter($w);
        try {
            return $work();
        } catch (FuelOpeningBalanceBlockedException|\RuntimeException $e) {
            if ($e instanceof \PDOException) {
                throw $e;
            }

            return 'blocked';
        }
    }

    /** @param array<string,mixed> $w @return array<string,int> */
    private function effects(array $w): array
    {
        return $this->openingEffects($w);
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

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
