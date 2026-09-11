<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // SQLite stores Laravel enum columns as varchar, so no enum DDL is needed there.
        // PostgreSQL represents the existing enum as a CHECK constraint; replace only
        // that constraint and preserve the existing draft/posted/cancelled contract.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check');
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed'))");
        }

        Schema::table('payments', function (Blueprint $table) {
            $table->foreignUuid('reversal_entry_id')
                ->nullable()
                ->after('journal_entry_id')
                ->constrained('journal_entries')
                ->restrictOnDelete();
            $table->timestamp('reversed_at')->nullable()->after('reversal_entry_id');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('reversal_entry_id');
            $table->dropColumn('reversed_at');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check');
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('draft', 'posted', 'cancelled'))");
        }
    }
};
