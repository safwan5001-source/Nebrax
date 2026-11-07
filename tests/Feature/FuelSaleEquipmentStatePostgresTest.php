<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Services\FuelSaleService;
use Illuminate\Support\Facades\DB;
use PDO;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-P1-1 على PostgreSQL حقيقي — فحص حالة المضخة/الخزان في `finalize` **قراءة بلا قفل صفّ**، فلا يضيف حافة إلى دورات الأقفال:
 *  - لا عبارة `FOR SHARE/FOR UPDATE` على `fuel_pumps`/`fuel_tanks` من الفحص (النسخة ذات القفل المشترك رُفضت: تتعاكس مع `updatePump`/`updateTank`).
 *  - معاملة تحمل `FOR UPDATE` على **المضخة** (تعديل حالة جارٍ) لا تحجب الإنهاء.
 * تنبيه موثَّق: تعارض الإنهاء مع معاملة تقفل **الخزان** (مثل `recordReading`) قائم أصلاً على `main` عبر FK إدراج صف الدفتر التشغيلي (KEY SHARE على الخزان)
 * ويُنتج 40P01 — خارج نطاق هذا الإصلاح ومُبلَّغ عنه كبند منفصل. يُتخطّى على SQLite.
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

    /** @return array{0:array<string,mixed>,1:FuelSale} */
    private function draft(string $key): array
    {
        $f = $this->equipmentFixture('pg');
        $this->tenants[] = $f['tenant_id'];
        $draft = app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['a']['nozzle']->id, 'fuel_shift_id' => $f['shift']->id,
            'partner_id' => $f['customer']->id, 'quantity_milliliters' => 5000, 'idempotency_key' => $key,
        ], $f['actor']);

        return [$f, $draft];
    }

    #[Test]
    public function the_equipment_state_check_takes_no_row_lock_on_pumps_or_tanks(): void
    {
        [$f, $draft] = $this->draft('no-lock');
        $statements = [];
        DB::listen(function ($query) use (&$statements) { $statements[] = $query->sql; });
        app(FuelSaleService::class)->finalize(FuelSale::findOrFail($draft->id), $f['actor']);

        $locking = array_values(array_filter($statements, fn (string $sql) => preg_match('/from "fuel_(pumps|tanks)".*\b(for (share|update|no key update))\b/i', $sql) === 1));
        $this->assertSame([], $locking, 'فحص الحالة قراءة عادية بلا قفل: ' . implode(' | ', $locking));
        $this->assertNotEmpty(array_filter($statements, fn (string $sql) => str_contains($sql, 'from "fuel_pumps"')), 'الفحص جرى فعلاً (المضخة قُرئت)');
    }

    #[Test]
    public function an_in_flight_pump_status_change_does_not_block_finalization(): void
    {
        [$f, $draft] = $this->draft('no-block');
        $c = config('database.connections.pgsql');
        $this->other = new PDO(sprintf('pgsql:host=%s;port=%s;dbname=%s', $c['host'], $c['port'], DB::connection()->getDatabaseName()), $c['username'], $c['password'] ?: null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->other->exec('BEGIN');
        $this->other->exec("SELECT 1 FROM fuel_pumps WHERE id = '{$f['a']['pump']->id}' FOR UPDATE"); // تعديل حالة المضخة جارٍ ولم يلتزم
        DB::statement("SET lock_timeout = '500ms'");

        $sale = app(FuelSaleService::class)->finalize(FuelSale::findOrFail($draft->id), $f['actor']);
        $this->assertSame('finalized', $sale->status, 'الفحص قراءة عادية: لا ينتظر قفل صف المضخة');
    }
}
