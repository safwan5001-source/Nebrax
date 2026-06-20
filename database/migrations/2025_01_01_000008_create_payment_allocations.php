<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // تخصيص سند واحد على مستند أو أكثر (مجموع التخصيصات = مبلغ السند).
        // المستند polymorphic: فاتورة مبيعات (Invoice) أو فاتورة مشتريات (Purchase).
        Schema::create('payment_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_id')->constrained('payments')->cascadeOnDelete();
            $table->uuidMorphs('allocatable');                    // allocatable_type + allocatable_id
            $table->bigInteger('amount');                         // المبلغ المخصَّص (هللات)
            $table->timestamps();

            $table->index(['tenant_id', 'payment_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_allocations');
    }
};
