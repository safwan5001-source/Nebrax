<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الأطراف (Partners) — عملاء وموردون
        // ═══════════════════════════════════════════════════════
        Schema::create('partners', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code')->nullable();                    // كود الطرف (اختياري)
            $table->enum('type', ['customer', 'supplier', 'both'])->default('customer');
            $table->string('name');                                // الاسم
            $table->string('name_en')->nullable();
            $table->string('vat_number', 15)->nullable();          // الرقم الضريبي
            $table->string('cr_number')->nullable();               // السجل التجاري
            $table->string('email')->nullable();
            $table->string('phone')->nullable();
            $table->string('address')->nullable();
            $table->string('city')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'type']);
        });

        // ═══════════════════════════════════════════════════════
        // المنتجات والخدمات (Products)
        // الأسعار بالـ minor units (هللات) كـ bigint
        // ═══════════════════════════════════════════════════════
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('sku')->nullable();                     // رمز المنتج
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->enum('type', ['good', 'service'])->default('good');
            $table->string('unit')->default('piece');              // وحدة القياس
            $table->bigInteger('sale_price')->default(0);          // سعر البيع (هللات)
            $table->bigInteger('purchase_price')->default(0);      // سعر الشراء (هللات)
            $table->unsignedSmallInteger('tax_rate')->default(15); // نسبة الضريبة %
            $table->boolean('track_inventory')->default(false);    // يُتابَع مخزونياً؟
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'sku']);
            $table->index(['tenant_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
        Schema::dropIfExists('partners');
    }
};
