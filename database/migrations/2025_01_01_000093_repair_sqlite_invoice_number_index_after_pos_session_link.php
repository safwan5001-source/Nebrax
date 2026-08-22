<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * SQLite يعيد بناء جدول invoices عند إضافة pos_session_id ويستحضر أحياناً
     * القيد القديم `(tenant_id, number)`. هذا القيد يرفض تسلسلات صحيحة في
     * فرعين مختلفين؛ نعيد فهارس الترقيم المتوافقة بعد آخر تعديل بنيوي للجدول.
     * PostgreSQL لا يحتاج المسار.
     */
    public function up(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            return;
        }

        $indexes = $this->indexes();
        $legacy = $this->uniqueIndexName($indexes, ['tenant_id', 'number'], false);
        if ($legacy !== null) {
            DB::statement('DROP INDEX "' . str_replace('"', '""', $legacy) . '"');
            $indexes = $this->indexes();
        }

        if ($this->uniqueIndexName($indexes, ['tenant_id', 'branch_id', 'number'], false) === null) {
            Schema::table('invoices', fn (Blueprint $table) => $table->unique(['tenant_id', 'branch_id', 'number']));
            $indexes = $this->indexes();
        }

        $branchless = 'invoices_tenant_id_number_branchless_unique';
        if (! in_array($branchless, array_column($indexes, 'name'), true)) {
            DB::statement("CREATE UNIQUE INDEX {$branchless} ON invoices (tenant_id, number) WHERE branch_id IS NULL");
        }
    }

    public function down(): void
    {
        // تصحيح بنيوي: لا نعيد قيداً أضيق يرفض أرقام الفروع الصحيحة.
    }

    /** @return array<int, array{name:string,columns:array<int,string>,partial:bool}> */
    private function indexes(): array
    {
        return array_map(function (object $index): array {
            $name = (string) $index->name;
            $columns = array_map(
                fn (object $column) => (string) $column->name,
                DB::select("PRAGMA index_info('{$name}')")
            );

            return ['name' => $name, 'columns' => $columns, 'partial' => (bool) $index->partial];
        }, DB::select("PRAGMA index_list('invoices')"));
    }

    /** @param array<int, array{name:string,columns:array<int,string>,partial:bool}> $indexes */
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
