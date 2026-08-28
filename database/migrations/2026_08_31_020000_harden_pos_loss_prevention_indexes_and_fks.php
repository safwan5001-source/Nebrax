<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Production Hardening v1 — فهرس كشف الاستثناءات + تقييد حذف قضية التحقيق.
 *
 * 1) `pos_events_performer_type_timeline_index` يغطي
 *    `PosExceptionDetectionService::aggregate()` (tenant + performed_by + type + created_at).
 * 2) على PostgreSQL فقط: تحويل `case_id` من cascade إلى restrict على جداول أدلة/نشاط
 *    القضية حتى لا يمحو حذف خام للقضية سجل التحقيق. SQLite يُتخطى هنا لأن إعادة بناء
 *    FK عبر dropForeign هشة في بيئة الاختبار، ولا يوجد مسار HTTP حذف أصلاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_session_events', function (Blueprint $table) {
            $table->index(
                ['tenant_id', 'performed_by', 'type', 'created_at'],
                'pos_events_performer_type_timeline_index'
            );
        });

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            $this->rebindPostgresCaseForeignKeys(restrict: true);
        }
    }

    public function down(): void
    {
        Schema::table('pos_session_events', function (Blueprint $table) {
            $table->dropIndex('pos_events_performer_type_timeline_index');
        });

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            $this->rebindPostgresCaseForeignKeys(restrict: false);
        }
    }

    private function rebindPostgresCaseForeignKeys(bool $restrict): void
    {
        $action = $restrict ? 'RESTRICT' : 'CASCADE';
        $tables = [
            'pos_case_evidence_links',
            'pos_case_activities',
            'pos_case_notes',
            'pos_cctv_bookmarks',
        ];

        foreach ($tables as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            $constraint = $this->postgresForeignKeyName($table, 'case_id');
            if ($constraint === null) {
                continue;
            }

            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT {$constraint}");
            DB::statement(
                "ALTER TABLE {$table} ADD CONSTRAINT {$constraint} FOREIGN KEY (case_id) REFERENCES pos_investigation_cases(id) ON DELETE {$action}"
            );
        }
    }

    private function postgresForeignKeyName(string $table, string $column): ?string
    {
        $row = DB::selectOne(
            'SELECT tc.constraint_name AS name
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.key_column_usage AS kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = ?
               AND tc.table_name = ?
               AND kcu.column_name = ?
             LIMIT 1',
            ['FOREIGN KEY', $table, $column]
        );

        return is_object($row) && isset($row->name) ? (string) $row->name : null;
    }
};
