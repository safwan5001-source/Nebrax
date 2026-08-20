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
        $branchless = "{$table}_tenant_id_number_branchless_unique";
        $indexes = $this->sqliteIndexes($table);

        // SQLite يسمّي قيد UNIQUE الداخلي sqlite_autoindex_* بعد إعادة البناء؛
        // لذلك لا يصح الاعتماد على الاسم السابق. نبحث عن القيد الكامل نفسه
        // بحسب الأعمدة، مع استثناء الفهرس الجزئي الخاص بالصفوف بلا فرع.
        $legacy = $this->uniqueIndexName($indexes, ['tenant_id', 'number'], false);
        if ($legacy !== null) {
            // لا يعتمد SQLite اسم Laravel المتوقع للقيد بعد إعادة البناء؛ نُسقط
            // الفهرس بالاسم الذي يعيده PRAGMA بالفعل (ومن ذلك branchless الخاطئ).
            DB::statement('DROP INDEX "' . str_replace('"', '""', $legacy) . '"');
            $indexes = $this->sqliteIndexes($table);
        }

        if (! $this->hasUniqueIndex($indexes, ['tenant_id', 'branch_id', 'number'], false)) {
            Schema::table($table, fn (Blueprint $blueprint) => $blueprint->unique(['tenant_id', 'branch_id', 'number']));
            $indexes = $this->sqliteIndexes($table);
        }

        // NULL لا يساوي NULL في المفاتيح الفريدة المركبة، لذلك يلزم فهرس جزئي
        // لصفوف بيانات ما قبل الفروع أو عمليات الخلفية بلا BranchContext.
        if (! in_array($branchless, array_column($indexes, 'name'), true)) {
            DB::statement("CREATE UNIQUE INDEX {$branchless} ON {$table} (tenant_id, number) WHERE branch_id IS NULL");
        }
    }

    /** @return array<int, array{name:string, columns:array<int,string>, partial:bool}> */
    private function sqliteIndexes(string $table): array
    {
        return array_map(function (object $index) use ($table): array {
            $name = (string) $index->name;
            $columns = array_map(
                fn (object $column) => (string) $column->name,
                DB::select("PRAGMA index_info('{$name}')")
            );

            return ['name' => $name, 'columns' => $columns, 'partial' => (bool) $index->partial];
        }, DB::select("PRAGMA index_list('{$table}')"));
    }

    /** @param array<int, array{name:string, columns:array<int,string>, partial:bool}> $indexes */
    private function hasUniqueIndex(array $indexes, array $columns, bool $partial): bool
    {
        return $this->uniqueIndexName($indexes, $columns, $partial) !== null;
    }

    /** @param array<int, array{name:string, columns:array<int,string>, partial:bool}> $indexes */
    private function uniqueIndexName(array $indexes, array $columns, bool $partial): ?string
    {
        foreach ($indexes as $index) {
            if ($index['columns'] === $columns && $index['partial'] === $partial) {
                return $index['name'];
            }
        }

        return null;
    }
};
