<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->string('number');
            $table->string('external_reference', 120)->nullable();
            $table->foreignUuid('customer_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->date('delivery_date');
            $table->enum('status', ['draft', 'confirmed', 'cancelled'])->default('draft');
            $table->text('notes')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancellation_reason', 500)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->index(['tenant_id', 'branch_id', 'status', 'delivery_date']);
            $table->index(['tenant_id', 'branch_id', 'customer_id', 'delivery_date']);
            $table->index(['tenant_id', 'branch_id', 'external_reference']);
        });

        Schema::create('delivery_note_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('delivery_note_id')->constrained('delivery_notes')->cascadeOnDelete();
            $table->unsignedInteger('line_number');
            $table->foreignUuid('product_id')->constrained('products')->restrictOnDelete();
            $table->string('product_name_snapshot');
            $table->string('product_sku_snapshot')->nullable();
            $table->string('product_barcode_snapshot')->nullable();
            $table->string('unit_name');
            $table->unsignedInteger('unit_factor');
            // الكمية العادية الصحيحة؛ وعند السطر النسبي تبقى 1 للتوافق ويصبح المقدار
            // الحقيقي في البسط/المقام. لا float ولا decimal مخفيان في دليل التسليم.
            $table->unsignedInteger('quantity');
            $table->unsignedInteger('quantity_numerator')->nullable();
            $table->unsignedInteger('quantity_denominator')->nullable();
            $table->string('description', 1000)->nullable();
            $table->timestamps();

            $table->unique(['delivery_note_id', 'line_number']);
            $table->index(['tenant_id', 'branch_id', 'delivery_note_id']);
            $table->index(['tenant_id', 'branch_id', 'product_id']);
        });

        Schema::create('delivery_note_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('delivery_note_id')->constrained('delivery_notes')->cascadeOnDelete();
            $table->string('event');
            $table->string('from_status')->nullable();
            $table->string('to_status')->nullable();
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('occurred_at');

            $table->index(['tenant_id', 'branch_id', 'delivery_note_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_note_events');
        Schema::dropIfExists('delivery_note_lines');
        Schema::dropIfExists('delivery_notes');
    }
};
