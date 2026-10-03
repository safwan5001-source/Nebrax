<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-ACCOUNTING-1 — سياق منصة توصيل مثبّت على فاتورة، منفصل تماماً عن DG-2
 * (الفاتورة تبقى بطرفها الافتراضي/الزائر — لا توسيع لـ`invoices`).
 *
 * صفٌّ **إلحاقي ثابت**: لا تحديث ولا حذف (`DeliveryInvoiceContext`). يثبّت
 * سلسلة القناة/الملف/النسخة وقت التسجيل فلا يتأثر بتعديلات لاحقة على الإعداد
 * (DLV-FOUNDATION-1 الإلحاقي). `unique(invoice_id)`: سياق واحد للفاتورة —
 * المرساة التي تمنع تكرار التسجيل عند إعادة محاولة.
 *
 * `external_order_reference` **لا** فهرس فريد عليه — مرجع خارجي معلوماتي لا
 * سلطة هوية (التوثيق الأعلى يمنع اعتباره معرِّفاً).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_invoice_contexts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->foreignUuid('delivery_platform_profile_id')->constrained('delivery_platform_profiles')->restrictOnDelete();
            $table->foreignUuid('delivery_platform_profile_version_id')->constrained('delivery_platform_profile_versions')->restrictOnDelete();
            $table->string('collection_mode', 32);
            $table->string('external_order_reference')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique('invoice_id');
            $table->index(['tenant_id', 'delivery_platform_profile_id']);
            $table->index(['tenant_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_invoice_contexts');
    }
};
