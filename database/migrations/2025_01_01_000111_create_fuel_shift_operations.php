<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_shifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->cascadeOnDelete();
            $table->string('number');
            $table->string('status')->default('open'); // open → closed → approved (locked)
            $table->bigInteger('opening_float_minor')->default(0);
            $table->bigInteger('counted_cash_minor')->nullable();
            $table->bigInteger('expected_operational_cash_minor')->nullable();
            $table->bigInteger('cash_variance_minor')->nullable();
            $table->bigInteger('operational_meter_milliliters')->default(0);
            $table->bigInteger('operational_delivery_milliliters')->default(0);
            $table->bigInteger('operational_tank_variance_milliliters')->nullable();
            $table->json('active_terminal_keys')->nullable();
            $table->text('opening_note')->nullable();
            $table->text('closing_note')->nullable();
            $table->foreignUuid('opened_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('locked_at')->nullable();
            $table->string('idempotency_key');
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'fuel_station_id', 'status']);
            $table->index(['tenant_id', 'branch_id', 'opened_at']);
        });

        Schema::create('fuel_shift_staff_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role')->default('attendant');
            $table->foreignUuid('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('assigned_at');
            $table->timestamps();

            $table->unique(['fuel_shift_id', 'user_id']);
            $table->index(['tenant_id', 'branch_id', 'user_id']);
        });

        Schema::create('fuel_shift_meter_readings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles')->cascadeOnDelete();
            $table->string('reading_stage'); // opening | closing
            $table->bigInteger('meter_milliliters');
            $table->string('evidence_key');
            $table->json('evidence')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('measured_at');
            $table->timestamps();

            $table->unique(['fuel_shift_id', 'fuel_nozzle_id', 'reading_stage']);
            $table->unique(['tenant_id', 'evidence_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_shift_id']);
        });

        Schema::create('fuel_shift_tank_readings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            $table->string('reading_stage'); // opening | closing
            $table->string('reading_type')->default('physical'); // physical | atg
            $table->bigInteger('quantity_milliliters');
            $table->string('evidence_key');
            $table->json('evidence')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('measured_at');
            $table->timestamps();

            $table->unique(['fuel_shift_id', 'fuel_tank_id', 'reading_stage']);
            $table->unique(['tenant_id', 'evidence_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_shift_id']);
        });

        Schema::create('fuel_shift_cash_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->string('type'); // cash_in | cash_out | expense
            $table->bigInteger('amount_minor');
            $table->text('reason');
            $table->json('evidence')->nullable();
            $table->string('idempotency_key');
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('recorded_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'branch_id', 'fuel_shift_id', 'type']);
        });

        Schema::create('fuel_shift_cash_variances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->bigInteger('opening_float_minor');
            $table->bigInteger('documented_cash_in_minor')->default(0);
            $table->bigInteger('documented_cash_out_minor')->default(0);
            $table->bigInteger('documented_expenses_minor')->default(0);
            $table->bigInteger('expected_operational_cash_minor');
            $table->bigInteger('counted_cash_minor');
            $table->bigInteger('variance_minor');
            $table->string('variance_direction'); // none | overage | shortage
            $table->string('status'); // not_required | pending_review
            $table->text('note')->nullable();
            $table->foreignUuid('counted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('counted_at');
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->unique('fuel_shift_id');
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'status']);
        });

        Schema::create('fuel_shift_corrections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->string('target_type'); // meter_reading | tank_reading | cash_count
            $table->uuid('target_id')->nullable();
            $table->json('before');
            $table->json('proposed');
            $table->string('status')->default('requested'); // requested | approved | rejected
            $table->text('reason');
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('requested_at');
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'fuel_shift_id', 'status']);
        });

        Schema::create('fuel_shift_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->string('type');
            $table->json('payload');
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'fuel_shift_id', 'type']);
        });

        // توافق رجعي صريح ومؤرخ: الأدوار الموجودة قبل Cycle 4 التي منحت view/manage
        // للمحطات تتلقى صلاحيات الشفت المكافئة. الأدوار الجديدة تختار fuel.shift.*
        // من كتالوج RBAC صراحةً، ولا تعتمد على fuel_stations.* كإذن ضمني.
        Schema::create('fuel_shift_role_permission_backfills', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('role_id')->constrained('roles')->cascadeOnDelete();
            $table->json('before_permissions');
            $table->json('after_permissions');
            $table->timestamps();
            $table->unique('role_id');
        });
        $shiftManage = ['fuel.shift.open', 'fuel.shift.close', 'fuel.shift.approve', 'fuel.shift.correct', 'fuel.shift.cash_count', 'fuel.shift.cash_variance_review'];
        foreach (DB::table('roles')->whereNull('deleted_at')->select('id', 'permissions')->cursor() as $role) {
            $before = json_decode($role->permissions, true) ?: [];
            if (in_array('*', $before, true)) {
                continue;
            }
            $after = $before;
            if (in_array('fuel_stations.view', $before, true)) {
                $after[] = 'fuel.shift.view';
            }
            if (in_array('fuel_stations.manage', $before, true)) {
                $after = array_merge($after, $shiftManage, ['fuel.shift.view']);
            }
            $after = array_values(array_unique($after));
            if ($after === $before) {
                continue;
            }
            DB::table('fuel_shift_role_permission_backfills')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'role_id' => $role->id,
                'before_permissions' => json_encode($before),
                'after_permissions' => json_encode($after),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('roles')->where('id', $role->id)->update(['permissions' => json_encode($after), 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        // نرفض rollback إذا عدّل المستأجر دوراً بعد backfill: استعادة لقطة JSON
        // قد تمحو منحه اللاحق. عند عدم وجود تعديل نستعيد اللقطة الأصلية بدقة.
        if (Schema::hasTable('fuel_shift_role_permission_backfills')) {
            $backfills = DB::table('fuel_shift_role_permission_backfills')->get();
            foreach ($backfills as $backfill) {
                $role = DB::table('roles')->where('id', $backfill->role_id)->first();
                if ($role !== null && json_decode($role->permissions, true) !== json_decode($backfill->after_permissions, true)) {
                    throw new \RuntimeException('لا يمكن rollback لصلاحيات Cycle 4 بأمان بعد تعديل دور مستأجر؛ راجع الدور صراحةً أولاً.');
                }
            }
            foreach ($backfills as $backfill) {
                if (DB::table('roles')->where('id', $backfill->role_id)->exists()) {
                    DB::table('roles')->where('id', $backfill->role_id)->update([
                        'permissions' => $backfill->before_permissions,
                        'updated_at' => now(),
                    ]);
                }
            }
            Schema::dropIfExists('fuel_shift_role_permission_backfills');
        }
        Schema::dropIfExists('fuel_shift_events');
        Schema::dropIfExists('fuel_shift_corrections');
        Schema::dropIfExists('fuel_shift_cash_variances');
        Schema::dropIfExists('fuel_shift_cash_movements');
        Schema::dropIfExists('fuel_shift_tank_readings');
        Schema::dropIfExists('fuel_shift_meter_readings');
        Schema::dropIfExists('fuel_shift_staff_assignments');
        Schema::dropIfExists('fuel_shifts');
    }
};
