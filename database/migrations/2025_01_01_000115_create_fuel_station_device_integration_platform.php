<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_station_devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            // معرف مصدر مستقر غير سري؛ يدخل في idempotency ولا يمثل بيانات اعتماد.
            $table->string('device_key', 128);
            $table->string('name', 160);
            $table->string('device_type', 48);
            $table->string('status', 32)->default('active');
            $table->string('adapter_key', 64);
            $table->string('manufacturer', 120)->nullable();
            $table->string('model', 120)->nullable();
            $table->string('serial_number', 160)->nullable();
            $table->string('firmware_version', 120)->nullable();
            $table->string('protocol', 64)->nullable();
            $table->string('external_identifier', 160)->nullable();
            $table->json('endpoint_metadata')->nullable();
            // مرجع vault أو اسم logical فقط؛ لا يحتفظ النظام بسر أو token أو مفتاح.
            $table->string('credential_reference', 160)->nullable();
            $table->string('health', 32)->default('unknown');
            $table->string('sync_status', 32)->default('idle');
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('last_event_at')->nullable();
            $table->timestamp('last_failure_at')->nullable();
            $table->string('last_failure_reason', 500)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'device_key'], 'fuel_station_device_key_unique');
            $table->unique(['tenant_id', 'fuel_station_id', 'name'], 'fuel_station_device_station_name_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status', 'health'], 'fuel_station_device_health_index');
            $table->index(['tenant_id', 'adapter_key', 'device_type'], 'fuel_station_device_adapter_index');
        });

        Schema::table('fuel_station_integration_events', function (Blueprint $table) {
            $table->foreignUuid('fuel_station_device_id')
                ->nullable()
                ->after('fuel_station_id')
                ->constrained('fuel_station_devices')
                ->restrictOnDelete();
            $table->unsignedInteger('retry_count')->default(0)->after('status');
            $table->index(['tenant_id', 'fuel_station_device_id', 'status', 'received_at'], 'fuel_station_device_event_processing_index');
        });

        Schema::create('fuel_station_integration_event_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_integration_event_id')->constrained('fuel_station_integration_events')->restrictOnDelete();
            $table->foreignUuid('fuel_station_device_id')->nullable()->constrained('fuel_station_devices')->nullOnDelete();
            $table->string('action', 32);
            $table->string('status', 32);
            $table->unsignedInteger('attempt_number');
            $table->string('reason', 500)->nullable();
            $table->foreignUuid('performed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('attempted_at')->useCurrent();

            $table->unique(['fuel_station_integration_event_id', 'attempt_number'], 'fuel_station_event_attempt_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_station_device_id', 'attempted_at'], 'fuel_station_event_attempt_device_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_station_integration_event_attempts');
        Schema::table('fuel_station_integration_events', function (Blueprint $table) {
            $table->dropIndex('fuel_station_device_event_processing_index');
            $table->dropConstrainedForeignId('fuel_station_device_id');
            $table->dropColumn('retry_count');
        });
        Schema::dropIfExists('fuel_station_devices');
    }
};
