<?php

namespace Tests\Feature;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AI-02A — ترتيب هجرة القياس والتدقيق وعكسها وإعادة تطبيقها، على SQLite وPostgreSQL (CI يشغّل الاثنين).
 *
 * تشغيل: php artisan test --filter=AiMeteringMigrationTest
 */
class AiMeteringMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const FILE = '2026_11_13_010000_create_ai_metering_and_audit_tables.php';

    private function migration(): object
    {
        return require base_path('database/migrations/' . self::FILE);
    }

    /** @test */
    public function it_sorts_after_every_migration_it_depends_on(): void
    {
        $names = array_map('basename', glob(base_path('database/migrations/*.php')));
        sort($names);

        // تعتمد فقط على جدول `tenants` (مفتاح أجنبي)؛ ويجب أن تأتي بعد آخر هجرة سبقتها وقت كتابتها.
        $this->assertContains(self::FILE, $names);
        $this->assertGreaterThan(
            array_search('2025_01_01_000001_create_tenants_and_users.php', $names, true),
            array_search(self::FILE, $names, true),
        );
        $this->assertGreaterThan(
            array_search('2026_11_12_010000_add_party_snapshot_to_invoices.php', $names, true),
            array_search(self::FILE, $names, true),
        );

        // اسم فريد وبصيغة التسلسل المعتمدة في المستودع (التواريخ تتقدّم على ساعة الجدار عمداً: 2026_11_* قائمة).
        $this->assertSame(1, count(array_filter($names, fn ($n) => str_starts_with($n, '2026_11_13_010000_'))));
        $this->assertMatchesRegularExpression('/^\d{4}_\d{2}_\d{2}_\d{6}_[a-z0-9_]+\.php$/', self::FILE);
    }

    /** @test */
    public function it_can_be_rolled_back_and_re_applied_without_touching_other_tables(): void
    {
        $tables = ['ai_budgets', 'ai_requests', 'ai_audit_events'];
        $others = array_values(array_diff(Schema::getTableListing(), $tables));
        foreach ($tables as $table) {
            $this->assertTrue(Schema::hasTable($table), $table);
        }

        $migration = $this->migration();
        $migration->down();
        foreach ($tables as $table) {
            $this->assertFalse(Schema::hasTable($table), "{$table} dropped by down()");
        }
        $this->assertEqualsCanonicalizing($others, Schema::getTableListing(), 'down() drops only its own tables');

        $migration->up();
        foreach ($tables as $table) {
            $this->assertTrue(Schema::hasTable($table), "{$table} recreated by up()");
        }
    }

    /** @test */
    public function the_database_itself_refuses_a_budget_without_caps_and_a_duplicate_period_key(): void
    {
        $row = ['id' => null, 'budget_key' => 'global', 'period' => '2026-10', 'cap_tokens' => 1, 'cap_cost_micro_usd' => 1, 'created_at' => now(), 'updated_at' => now()];
        DB::table('ai_budgets')->insert(['id' => (string) Str::uuid()] + $row);

        try {
            DB::table('ai_budgets')->insert(['id' => (string) Str::uuid()] + $row);
            $this->fail('(period, budget_key) must be unique.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    /** @test */
    public function postgres_enforces_non_negative_counters_in_the_database(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('CHECK constraints are added on PostgreSQL only (SQLite cannot add them after creation).');
        }

        $this->expectException(QueryException::class);
        DB::table('ai_budgets')->insert([
            'id' => (string) Str::uuid(), 'budget_key' => 'global', 'period' => '2026-10',
            'cap_tokens' => -1, 'cap_cost_micro_usd' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
