<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('financial_control_alerts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->index();
            $table->uuid('branch_id')->nullable()->index();
            $table->string('fingerprint');
            $table->string('rule');
            $table->string('severity');
            $table->string('status')->default('active');
            $table->string('title');
            $table->text('description');
            $table->string('source_type')->nullable();
            $table->uuid('source_id')->nullable();
            $table->json('details')->nullable();
            $table->timestamp('first_detected_at');
            $table->timestamp('last_detected_at');
            $table->timestamp('resolved_at')->nullable();
            $table->foreignUuid('acknowledged_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('acknowledged_at')->nullable();
            $table->text('acknowledgement_note')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'fingerprint']);
            $table->index(['tenant_id', 'status', 'severity']);
            $table->index(['tenant_id', 'rule']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('financial_control_alerts');
    }
};
