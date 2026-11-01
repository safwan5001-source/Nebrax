<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\User;
use App\Services\FuelShiftService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FS-33 (PR-13): وردية وقود مفتوحة واحدة لكل محطة يفرضها فهرس فريد جزئي، والهجرة تفشل بوضوح وبلا لمس البيانات عند التعارض.
 */
class FuelOpenShiftUniqueIndexTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const INDEX = 'fuel_shifts_one_open_per_station';

    /** @test */
    public function the_partial_unique_index_exists_on_the_open_status_only(): void
    {
        $this->assertTrue($this->indexExists());
        $definition = $this->indexDefinition();
        $this->assertStringContainsString("status", strtolower($definition));
        $this->assertStringContainsString("'open'", strtolower($definition));
    }

    /** @test */
    public function a_second_open_shift_for_the_same_station_is_rejected_by_the_database_even_with_raw_sql(): void
    {
        $f = $this->fixture();
        $this->insertShift($f, 'FSH-RAW-1', 'open');

        $this->expectException(QueryException::class);
        $this->insertShift($f, 'FSH-RAW-2', 'open');
    }

    /** @test */
    public function closed_and_approved_shifts_and_other_stations_are_not_constrained(): void
    {
        $f = $this->fixture();
        $this->insertShift($f, 'FSH-C-1', 'closed');
        $this->insertShift($f, 'FSH-C-2', 'closed');
        $this->insertShift($f, 'FSH-A-1', 'approved');
        $this->insertShift($f, 'FSH-O-1', 'open');
        $other = FuelStation::create(['branch_id' => $f['branch']->id, 'code' => 'FS-OTHER', 'name' => 'محطة أخرى']);
        $this->insertShift(array_merge($f, ['station' => $other]), 'FSH-O-OTHER', 'open');

        $this->assertSame(2, FuelShift::query()->withoutGlobalScopes()->where('status', 'open')->count());
    }

    /** @test */
    public function a_new_open_shift_is_allowed_once_the_previous_one_is_closed(): void
    {
        $f = $this->fixture();
        $this->insertShift($f, 'FSH-1', 'open');
        DB::table('fuel_shifts')->where('number', 'FSH-1')->update(['status' => 'closed']);

        $this->insertShift($f, 'FSH-2', 'open');
        $this->assertSame(1, DB::table('fuel_shifts')->where('status', 'open')->count());
    }

    /** @test */
    public function the_service_still_reports_the_clear_message_for_a_second_open_shift(): void
    {
        $f = $this->fixture();
        $service = app(FuelShiftService::class);
        $service->open(['fuel_station_id' => $f['station']->id, 'idempotency_key' => 'open-a', 'opening_float_minor' => 0], $f['actor']);

        try {
            $service->open(['fuel_station_id' => $f['station']->id, 'idempotency_key' => 'open-b', 'opening_float_minor' => 0], $f['actor']);
            $this->fail('الوردية المفتوحة الثانية يجب أن تُرفض.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('وردية', $e->getMessage());
        }
        $this->assertSame(1, DB::table('fuel_shifts')->where('status', 'open')->count());
    }

    /** @test */
    public function the_migration_fails_safely_and_lists_conflicts_without_touching_any_row_then_succeeds_after_manual_cleanup(): void
    {
        $f = $this->fixture();
        $migration = require base_path('database/migrations/2026_12_27_010000_add_fuel_open_shift_unique_index.php');

        // حالة سابقة للفهرس: أسقطه وأدخل وردتين مفتوحتين لنفس المحطة.
        $migration->down();
        $this->assertFalse($this->indexExists());
        $this->insertShift($f, 'FSH-DUP-1', 'open');
        $this->insertShift($f, 'FSH-DUP-2', 'open');
        $before = DB::table('fuel_shifts')->orderBy('number')->get(['id', 'number', 'status', 'updated_at'])->toArray();

        $message = null;
        try {
            $migration->up();
        } catch (RuntimeException $e) {
            $message = $e->getMessage();
        }

        $this->assertNotNull($message, 'الهجرة يجب أن تفشل عند وجود ورديات مفتوحة متعارضة.');
        $this->assertStringContainsString('FS-33', $message);
        $this->assertStringContainsString($f['station']->code, $message);
        $this->assertStringContainsString('FSH-DUP-1', $message);
        $this->assertStringContainsString('FSH-DUP-2', $message);
        $this->assertFalse($this->indexExists(), 'لا يُنشأ الفهرس عند التعارض.');
        $this->assertEquals($before, DB::table('fuel_shifts')->orderBy('number')->get(['id', 'number', 'status', 'updated_at'])->toArray(), 'لا تعديل ولا حذف ولا إغلاق تلقائي.');

        // معالجة يدوية ثم نجاح الهجرة.
        DB::table('fuel_shifts')->where('number', 'FSH-DUP-2')->update(['status' => 'closed']);
        $migration->up();
        $this->assertTrue($this->indexExists());
        $migration->up(); // idempotent
        $this->assertTrue($this->indexExists());
    }

    /** @test */
    public function down_drops_only_the_index(): void
    {
        $f = $this->fixture();
        $this->insertShift($f, 'FSH-D-1', 'open');
        $migration = require base_path('database/migrations/2026_12_27_010000_add_fuel_open_shift_unique_index.php');

        $migration->down();

        $this->assertFalse($this->indexExists());
        $this->assertSame(1, DB::table('fuel_shifts')->count());
        $migration->up();
    }

    private function indexExists(): bool
    {
        return $this->indexDefinition() !== '';
    }

    private function indexDefinition(): string
    {
        return match (DB::connection()->getDriverName()) {
            'pgsql' => (string) (DB::selectOne('select indexdef from pg_indexes where indexname = ?', [self::INDEX])->indexdef ?? ''),
            default => (string) (DB::selectOne("select sql from sqlite_master where type = 'index' and name = ?", [self::INDEX])->sql ?? ''),
        };
    }

    /** @param array<string,mixed> $f */
    private function insertShift(array $f, string $number, string $status): void
    {
        DB::table('fuel_shifts')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $f['tenant_id'], 'branch_id' => $f['branch']->id, 'fuel_station_id' => $f['station']->id,
            'number' => $number, 'status' => $status, 'opening_float_minor' => 0, 'opened_at' => now(),
            'idempotency_key' => 'k-'.$number, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-open-shift', 'owner@fuel-open-shift.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $station = FuelStation::create(['branch_id' => $branch->id, 'code' => 'FS-OPEN', 'name' => 'محطة الوردية']);

        return ['tenant_id' => $auth['tenant_id'], 'branch' => $branch, 'actor' => $actor, 'station' => $station];
    }
}
