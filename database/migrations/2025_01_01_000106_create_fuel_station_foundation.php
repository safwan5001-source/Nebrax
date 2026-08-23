<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_stations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // المحطة بنية تشغيلية مستقلة، لكن كل عملية مالية/مخزنية لاحقة ترث
            // فرعها المحاسبي من هذا الربط بعد التحقق في طبقة الخدمة.
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('code');
            $table->string('name');
            $table->string('status', 32)->default('active');
            $table->string('timezone', 64)->nullable();
            $table->string('operating_day_starts_at', 5)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'branch_id', 'status']);
        });

        Schema::create('fuel_station_setting_overrides', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            // قيمة فارغة = override على مستوى المحطة؛ قيمة غير فارغة = override
            // محطة/جهاز. لا FK للجهاز قبل إنشاء Device Registry في Cycle 8.
            $table->string('device_key', 128)->default('');
            $table->string('setting_key', 128);
            $table->json('value');
            $table->timestamp('updated_at')->useCurrent();

            $table->unique(['tenant_id', 'fuel_station_id', 'device_key', 'setting_key'], 'fuel_station_setting_override_unique');
            $table->index(['tenant_id', 'fuel_station_id']);
        });

        Schema::create('fuel_station_configuration_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->nullable()->constrained('fuel_stations')->restrictOnDelete();
            $table->string('device_key', 128)->default('');
            $table->string('setting_key', 128);
            $table->json('before')->nullable();
            $table->json('after');
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamp('changed_at')->useCurrent();

            $table->index(['tenant_id', 'fuel_station_id', 'changed_at'], 'fuel_station_configuration_audit_index');
        });

        Schema::create('fuel_station_integration_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->string('source_id', 128);
            $table->string('event_id', 128);
            $table->unsignedBigInteger('sequence')->nullable();
            $table->string('event_type', 128);
            $table->timestamp('occurred_at');
            $table->string('correlation_id', 128)->nullable();
            $table->string('checksum', 128)->nullable();
            $table->json('payload');
            $table->string('status', 32)->default('accepted');
            $table->timestamp('received_at')->useCurrent();
            $table->timestamp('processed_at')->nullable();
            $table->string('failure_reason', 500)->nullable();

            $table->unique(['tenant_id', 'source_id', 'event_id'], 'fuel_station_source_event_unique');
            $table->unique(['tenant_id', 'source_id', 'sequence'], 'fuel_station_source_sequence_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status', 'received_at'], 'fuel_station_event_processing_index');
            $table->index(['tenant_id', 'correlation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_station_integration_events');
        Schema::dropIfExists('fuel_station_configuration_events');
        Schema::dropIfExists('fuel_station_setting_overrides');
        Schema::dropIfExists('fuel_stations');
    }
};
