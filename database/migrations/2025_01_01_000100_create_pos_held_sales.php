<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_held_sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('resumed_pos_session_id')->nullable()->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->nullable()->constrained('warehouses')->restrictOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('held_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 20)->default('held');
            $table->json('payload');
            $table->timestamp('resumed_at')->nullable();
            $table->timestamp('discarded_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'held_by', 'status'], 'pos_held_sales_owner_status_index');
            $table->index(['tenant_id', 'pos_session_id', 'status'], 'pos_held_sales_session_status_index');
            $table->index(['tenant_id', 'warehouse_id', 'status'], 'pos_held_sales_warehouse_status_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_held_sales');
    }
};
