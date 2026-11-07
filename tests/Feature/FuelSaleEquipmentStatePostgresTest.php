<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Services\FuelSaleService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDO;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-P1-1 على PostgreSQL حقيقي: إنهاء البيع يأخذ قفلاً مشتركاً على المضخة والخزان، فتعديل حالتهما الجاري (FOR UPDATE في معاملة أخرى،
 * كما يفعل `FuelStationMasterDataService::updatePump/updateTank`) ينتظر ولا يُمرَّر البيع على حالة قديمة؛ وبعد الإفراج ينجح الإنهاء.
 * مهلة القفل القصيرة تحوّل الانتظار إلى خطأ 55P03 قابل للقياس بدل تعليق الاختبار. يُتخطّى على SQLite.
 */
class FuelSaleEquipmentStatePostgresTest extends TestCase
{
    use InteractsWithApi;
    use CapturesThrowable;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelEquipmentFixture;

    /** @var list<string> */
    private array $tenants = [];

    private ?PDO $other = null;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر أقفال الصفوف.');
        }
    }

    protected function tearDown(): void
    {
        $this->other?->exec('ROLLBACK');
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('SET lock_timeout = 0');
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    private function otherConnection(): PDO
    {
        $c = config('database.connections.pgsql');
        $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $c['host'], $c['port'], DB::connection()->getDatabaseName());
        $pdo = new PDO($dsn, $c['username'], $c['password'] ?: null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

        return $this->other = $pdo;
    }

    #[Test]
    public function finalization_waits_for_an_in_flight_pump_or_tank_state_change_then_succeeds_after_it_ends(): void
    {
        $f = $this->equipmentFixture('pg');
        $this->tenants[] = $f['tenant_id'];
        $sales = app(FuelSaleService::class);
        $other = $this->otherConnection();

        foreach (['fuel_pumps' => $f['a']['pump']->id, 'fuel_tanks' => $f['a']['tank']->id] as $table => $id) {
            $draft = $sales->createDraft([
                'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['a']['nozzle']->id, 'fuel_shift_id' => $f['shift']->id,
                'partner_id' => $f['customer']->id, 'quantity_milliliters' => 5000, 'idempotency_key' => "lock-{$table}",
            ], $f['actor']);

            $other->exec('BEGIN');
            $other->exec("SELECT 1 FROM {$table} WHERE id = '{$id}' FOR UPDATE"); // تعديل حالة جارٍ لم يلتزم بعد
            DB::statement("SET lock_timeout = '400ms'");
            $error = $this->thrown(fn () => $sales->finalize(FuelSale::findOrFail($draft->id), $f['actor']), "{$table}: يجب أن ينتظر الإنهاء قفل الصف.", QueryException::class);
            $this->assertSame('55P03', $error->errorInfo[0] ?? null, "{$table}: مهلة قفل لا خطأ آخر");
            DB::statement('SET lock_timeout = 0');
            $this->assertSame('draft', DB::table('fuel_sales')->where('id', $draft->id)->value('status'), 'المسودة لم تُنهَ');
            $this->assertSame(0, DB::table('invoices')->where('tenant_id', $f['tenant_id'])->where('notes', 'like', "%{$draft->number}%")->count());

            $other->exec('ROLLBACK');
            $done = $sales->finalize(FuelSale::findOrFail($draft->id), $f['actor']);
            $this->assertSame('finalized', $done->status, "{$table}: ينجح بعد الإفراج");
        }
    }
}
