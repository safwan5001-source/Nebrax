<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // مواعيد العملاء — مستند تنظيمي غير محاسبي (لا يولّد قيوداً).
        Schema::create('appointments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->nullOnDelete();
            $table->string('title');
            $table->dateTime('appointment_at');
            $table->unsignedSmallInteger('duration_minutes')->nullable();
            $table->enum('status', ['scheduled', 'done', 'cancelled'])->default('scheduled');
            $table->string('location')->nullable();
            $table->string('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'appointment_at']);
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appointments');
    }
};
