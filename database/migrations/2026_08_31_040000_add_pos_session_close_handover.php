<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->string('handover_status', 20)->nullable()->after('status');
            // False on historical rows so rollout never rewrites or rejects
            // pre-existing parallel sessions. The service sets true on every
            // session opened after this migration.
            $table->boolean('single_cashier_guard')->default(false)->after('handover_status');
            $table->text('handover_note')->nullable()->after('notes');
            $table->timestamp('handover_submitted_at')->nullable()->after('closed_at');
            $table->foreignUuid('handover_confirmed_by')->nullable()->after('closed_by')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('handover_confirmed_at')->nullable()->after('handover_confirmed_by');
            $table->text('handover_confirmation_note')->nullable()->after('handover_confirmed_at');
            $table->index(['tenant_id', 'branch_id', 'handover_status'], 'pos_sessions_handover_status_index');
        });

        // Adding a foreign key rebuilds this table on SQLite. Restore every raw
        // partial index after that rebuild so its WHERE predicate cannot be lost.
        $this->rebuildOpenSessionIndexes(includeCashier: true);

        Schema::create('pos_session_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->cascadeOnDelete();
            $table->string('reconciliation_key', 100);
            $table->foreignUuid('payment_method_id')->nullable()->constrained('payment_methods')->restrictOnDelete();
            $table->string('payment_method_name');
            $table->string('settlement_type', 20);
            $table->bigInteger('expected_amount');
            $table->bigInteger('counted_amount');
            $table->bigInteger('difference');
            $table->string('count_source', 20)->default('operator');
            $table->timestamp('created_at');

            $table->unique(['pos_session_id', 'reconciliation_key'], 'pos_session_reconciliation_key_unique');
            $table->index(['tenant_id', 'branch_id', 'pos_session_id'], 'pos_session_reconciliations_scope_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_session_reconciliations');

        $this->dropOpenSessionIndexes(includeCashier: true);

        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropIndex('pos_sessions_handover_status_index');
            $table->dropForeign(['handover_confirmed_by']);
            $table->dropColumn([
                'handover_status', 'single_cashier_guard', 'handover_note', 'handover_submitted_at',
                'handover_confirmed_by', 'handover_confirmed_at', 'handover_confirmation_note',
            ]);
        });

        $this->rebuildOpenSessionIndexes(includeCashier: false);
    }

    private function rebuildOpenSessionIndexes(bool $includeCashier): void
    {
        $this->dropOpenSessionIndexes(includeCashier: true);

        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_per_device ON pos_sessions (tenant_id, pos_device_id) WHERE status = 'open' AND pos_device_id IS NOT NULL");
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_legacy ON pos_sessions (tenant_id) WHERE status = 'open' AND pos_device_id IS NULL");
        if ($includeCashier) {
            DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_per_cashier ON pos_sessions (tenant_id, opened_by) WHERE status = 'open' AND opened_by IS NOT NULL AND single_cashier_guard = true");
        }
    }

    private function dropOpenSessionIndexes(bool $includeCashier): void
    {
        if ($includeCashier) {
            DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_per_cashier');
        }
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_legacy');
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_per_device');
    }
};
