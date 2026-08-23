<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_station_maintenance_schedules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->string('asset_type', 160);
            $table->uuid('asset_id');
            $table->string('name', 160);
            $table->string('schedule_type', 32); // calendar | runtime | meter
            $table->unsignedInteger('interval_days')->nullable();
            $table->unsignedBigInteger('interval_milliliters')->nullable();
            $table->string('manufacturer_interval', 160)->nullable();
            $table->string('status', 32)->default('active');
            $table->timestamp('last_completed_at')->nullable();
            $table->timestamp('next_due_at')->nullable();
            $table->text('instructions')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_station_id', 'asset_type', 'asset_id', 'name'], 'fuel_maintenance_schedule_asset_name_unique');
            $table->index(['tenant_id', 'branch_id', 'status', 'next_due_at'], 'fuel_maintenance_schedule_due_index');
        });

        Schema::create('fuel_station_work_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_station_maintenance_schedule_id')->nullable()->constrained('fuel_station_maintenance_schedules')->nullOnDelete();
            $table->string('number', 64);
            $table->string('work_type', 32); // preventive | corrective
            $table->string('status', 32)->default('reported');
            $table->string('priority', 32)->default('medium');
            $table->string('severity', 32)->default('medium');
            $table->string('asset_type', 160);
            $table->uuid('asset_id');
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->text('root_cause')->nullable();
            $table->text('resolution')->nullable();
            $table->string('vendor_name', 160)->nullable();
            $table->foreignUuid('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('cost_minor')->default(0);
            $table->unsignedBigInteger('downtime_minutes')->default(0);
            $table->string('evidence_reference', 500)->nullable();
            $table->timestamp('opened_at');
            $table->timestamp('scheduled_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->foreignUuid('reported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number'], 'fuel_work_order_branch_number_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status', 'priority'], 'fuel_work_order_station_status_index');
            $table->index(['tenant_id', 'asset_type', 'asset_id', 'status'], 'fuel_work_order_asset_status_index');
        });

        Schema::create('fuel_station_safety_inspections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->string('number', 64);
            $table->string('inspection_type', 80);
            $table->string('status', 32)->default('scheduled');
            $table->timestamp('scheduled_at')->nullable();
            $table->timestamp('performed_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->foreignUuid('inspector_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->string('evidence_reference', 500)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number'], 'fuel_safety_inspection_branch_number_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status', 'scheduled_at'], 'fuel_safety_inspection_status_index');
        });

        Schema::create('fuel_station_safety_findings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_safety_inspection_id')->constrained('fuel_station_safety_inspections')->restrictOnDelete();
            $table->string('checklist_key', 120);
            $table->string('result', 16); // pass | fail | not_applicable
            $table->string('severity', 32)->nullable();
            $table->string('title', 200);
            $table->text('details')->nullable();
            $table->string('asset_type', 160)->nullable();
            $table->uuid('asset_id')->nullable();
            $table->timestamps();

            $table->unique(['fuel_station_safety_inspection_id', 'checklist_key'], 'fuel_safety_finding_checklist_unique');
            $table->index(['tenant_id', 'branch_id', 'result', 'severity'], 'fuel_safety_finding_status_index');
        });

        Schema::create('fuel_station_safety_corrective_actions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_safety_finding_id')->constrained('fuel_station_safety_findings')->restrictOnDelete();
            $table->string('status', 32)->default('open');
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->foreignUuid('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->date('due_date')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->foreignUuid('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'status', 'due_date'], 'fuel_safety_action_due_index');
        });

        Schema::create('fuel_station_safety_permits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->string('permit_type', 100);
            $table->string('reference', 160);
            $table->string('status', 32)->default('active');
            $table->date('issued_on')->nullable();
            $table->date('expires_on')->nullable();
            $table->string('asset_type', 160)->nullable();
            $table->uuid('asset_id')->nullable();
            $table->string('evidence_reference', 500)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'permit_type', 'reference'], 'fuel_safety_permit_reference_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status', 'expires_on'], 'fuel_safety_permit_expiry_index');
        });

        Schema::create('fuel_station_readiness_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->nullable()->constrained('fuel_stations')->nullOnDelete();
            $table->string('subject_type', 160);
            $table->uuid('subject_id');
            $table->string('event_type', 80);
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->string('reason', 500)->nullable();
            $table->foreignUuid('performed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('occurred_at')->useCurrent();

            $table->index(['tenant_id', 'branch_id', 'subject_type', 'subject_id', 'occurred_at'], 'fuel_readiness_event_subject_index');
        });

        Schema::table('financial_control_alerts', function (Blueprint $table) {
            $table->foreignUuid('assigned_to')->nullable()->after('acknowledged_by')->constrained('users')->nullOnDelete();
            $table->string('assignment_reason', 500)->nullable()->after('assigned_to');
            $table->index(['tenant_id', 'assigned_to', 'status'], 'financial_control_alert_assignment_index');
        });
    }

    public function down(): void
    {
        Schema::table('financial_control_alerts', function (Blueprint $table) {
            $table->dropIndex('financial_control_alert_assignment_index');
            $table->dropConstrainedForeignId('assigned_to');
            $table->dropColumn('assignment_reason');
        });
        Schema::dropIfExists('fuel_station_readiness_events');
        Schema::dropIfExists('fuel_station_safety_permits');
        Schema::dropIfExists('fuel_station_safety_corrective_actions');
        Schema::dropIfExists('fuel_station_safety_findings');
        Schema::dropIfExists('fuel_station_safety_inspections');
        Schema::dropIfExists('fuel_station_work_orders');
        Schema::dropIfExists('fuel_station_maintenance_schedules');
    }
};
