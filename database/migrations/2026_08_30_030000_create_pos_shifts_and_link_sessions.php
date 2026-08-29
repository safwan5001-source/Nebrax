<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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
    }

    public function down(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropForeign(['pos_shift_id']);
            $table->dropIndex(['tenant_id', 'branch_id', 'pos_shift_id']);
            $table->dropColumn('pos_shift_id');
        });

        Schema::dropIfExists('pos_shifts');
    }
};
