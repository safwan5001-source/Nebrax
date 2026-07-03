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
            $table->string('mobile')->nullable();                  // جوال منفصل عن الهاتف
            $table->string('address')->nullable();
            $table->string('city')->nullable();
            $table->string('building_no')->nullable();             // رقم المبنى (العنوان الوطني — ZATCA)
            $table->string('street')->nullable();                  // الشارع
            $table->string('district')->nullable();                // الحي
            $table->string('postal_code')->nullable();             // الرمز البريدي
            $table->string('country')->nullable();                 // البلد (ISO مثل SA)
            $table->string('classification')->nullable();          // تصنيف الطرف (VIP/جملة/تجزئة…) — للتقارير والتجزئة
            $table->bigInteger('credit_limit')->nullable();        // الحد الائتماني (هللات) — يمنع تجاوز رصيد العميل الآجل
            $table->unsignedSmallInteger('credit_period')->nullable(); // المدة الائتمانية (أيام) — تُشتقّ منها تواريخ الاستحقاق
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
            $table->string('barcode')->nullable();                 // الباركود (مسح ضوئي في POS)
            $table->string('name');
            $table->text('description')->nullable();                // وصف المنتج
            $table->string('category')->nullable();                // التصنيف
            $table->string('brand')->nullable();                   // الماركة
            $table->unsignedInteger('reorder_level')->nullable();  // حد التنبيه عند نقص المخزون
            $table->uuid('supplier_id')->nullable();               // المورّد الافتراضي (مرجعي)
            $table->uuid('sales_account_id')->nullable();          // حساب إيراد المبيعات (تجاوز 4110)
            $table->uuid('cogs_account_id')->nullable();           // حساب تكلفة المبيعات (تجاوز 5110)
            $table->bigInteger('min_sale_price')->nullable();      // أقل سعر بيع (هللات — استرشادي)
            $table->bigInteger('discount')->nullable();            // خصم افتراضي (استرشادي)
            $table->enum('discount_type', ['percent', 'amount'])->nullable(); // نوع الخصم
            $table->unsignedSmallInteger('profit_margin')->nullable(); // هامش الربح % (استرشادي)
            $table->string('tags')->nullable();                    // وسوم (مفصولة بفواصل)
            $table->text('internal_notes')->nullable();            // ملاحظات داخلية
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
