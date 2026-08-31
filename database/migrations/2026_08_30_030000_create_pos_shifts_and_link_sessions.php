<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_shifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('branch_id')->nullable();
            $table->string('name');
            $table->string('code', 64)->nullable();
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'is_active']);
            $table->index(['tenant_id', 'name']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });

        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->uuid('pos_shift_id')->nullable()->after('shift_id');
            $table->foreign('pos_shift_id')->references('id')->on('pos_shifts')->restrictOnDelete();
            $table->index(['tenant_id', 'branch_id', 'pos_shift_id']);
        });

        // SQLite rebuilds pos_sessions while adding the foreign key and can
        // restore the raw partial indexes without their WHERE predicates. The
        // legacy index then becomes UNIQUE (tenant_id), which incorrectly
        // prevents a tenant from opening sessions on different POS devices.
        // Recreate both indexes explicitly after the structural change; doing
        // the same on PostgreSQL keeps the migration semantics identical.
        $this->rebuildOpenSessionIndexes();
    }

    public function down(): void
    {
        $this->dropOpenSessionIndexes();

        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropForeign(['pos_shift_id']);
            $table->dropIndex(['tenant_id', 'branch_id', 'pos_shift_id']);
            $table->dropColumn('pos_shift_id');
        });

        $this->rebuildOpenSessionIndexes();

        Schema::dropIfExists('pos_shifts');
    }

    private function rebuildOpenSessionIndexes(): void
    {
        $this->dropOpenSessionIndexes();

        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_per_device ON pos_sessions (tenant_id, pos_device_id) WHERE status = 'open' AND pos_device_id IS NOT NULL");
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_legacy ON pos_sessions (tenant_id) WHERE status = 'open' AND pos_device_id IS NULL");
    }

    private function dropOpenSessionIndexes(): void
    {
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_legacy');
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_per_device');
    }
};
