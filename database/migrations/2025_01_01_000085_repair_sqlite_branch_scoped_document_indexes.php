<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * يعالج SQLite فقط: إضافة مفتاح أجنبي عبر Schema::table قد تعيد بناء الجدول
 * وتسترجع القيد القديم (tenant_id, number)، رغم أن هجرة 053 وسّعته مسبقاً إلى
 * (tenant_id, branch_id, number). PostgreSQL لا يعيد بناء الجدول بهذا الشكل.
 */
return new class extends Migration
{
    private const TABLES = ['invoices', 'purchases', 'payments'];

    public function up(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            return;
        }

        foreach (self::TABLES as $table) {
            $this->restoreBranchScopedNumberIndex($table);
        }
    }

    public function down(): void
    {
        // تصحيح بنيوي لا يُعكس إلى قيد أضيق يرفض أرقام فروع صحيحة.
    }

    private function restoreBranchScopedNumberIndex(string $table): void
    {
        $legacy = "{$table}_tenant_id_number_unique";
        $scoped = "{$table}_tenant_id_branch_id_number_unique";
        $branchless = "{$table}_tenant_id_number_branchless_unique";
        $indexes = $this->sqliteIndexes($table);

        // لا نلمس الجدول إن كانت إعادة البناء قد حفظت الفهرس الصحيح.
        if (in_array($legacy, $indexes, true)) {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->dropUnique($legacy));
            $indexes = $this->sqliteIndexes($table);
        }

        if (! in_array($scoped, $indexes, true)) {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->unique(['tenant_id', 'branch_id', 'number']));
            $indexes = $this->sqliteIndexes($table);
        }

        // NULL لا يساوي NULL في المفاتيح الفريدة المركبة، لذلك يلزم فهرس جزئي
        // لصفوف بيانات ما قبل الفروع أو عمليات الخلفية بلا BranchContext.
        if (! in_array($branchless, $indexes, true)) {
            DB::statement("CREATE UNIQUE INDEX {$branchless} ON {$table} (tenant_id, number) WHERE branch_id IS NULL");
        }
    }

    /** @return array<int, string> */
    private function sqliteIndexes(string $table): array
    {
        return array_map(
            fn (object $index) => (string) $index->name,
            DB::select("PRAGMA index_list('{$table}')")
        );
    }
};
