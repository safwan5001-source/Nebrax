<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حالة تنبيه المخزون (PR-NOTIF-3) — دورة حياة منفصلة عن الإشعار
 * ═══════════════════════════════════════════════════════════════
 *  صفٌّ واحد لكل منتج يمثّل آخر حالة معروفة (نشطة أو محلولة). **لا** يُدمج في
 *  `financial_control_alerts` عمداً — نطاقاه مختلفان (مخزون لا رقابة مالية)،
 *  ودورة حياة الرقابة المالية (active/acknowledged/resolved) لا تحتاجها هذه
 *  الحالة الأبسط (active/resolved فقط، بلا إقرار). إضافية بحتة؛ لا تمسّ
 *  المخزون ولا التقييم ولا أي جدول محاسبي.
 *  انظر docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md §5.3.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_stock_alerts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // وسم فقط (BelongsToBranch) من فرع المنتج وقت الاكتشاف — لا عزل تلقائي؛
            // العتبة كمّية إجمالية على المنتج لا فرعية.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();

            $table->string('status', 20)->default('active'); // active | resolved
            $table->string('type', 20); // low_stock | out_of_stock — آخر نوع معروف
            // يزداد فقط عند إعادة التنشيط من resolved/غياب — لا عند تبدّل النوع
            // ضمن نفس الدورة النشطة (Low → Out تبقى نفس الدورة، إشعاراً جديداً بمفتاح مختلف).
            $table->unsignedInteger('cycle')->default(1);

            // لقطة كمّية فقط للتشخيص/محتوى الإشعار — لا تكلفة ولا تقييم مالي هنا إطلاقاً.
            $table->integer('quantity_on_hand');
            $table->integer('reorder_level');

            $table->timestamp('first_detected_at');
            $table->timestamp('last_detected_at');
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            // صفّ واحد لكل منتج: يُحدَّث في مكانه بدل تراكم صفوف تاريخية لكل تبديل حالة.
            $table->unique(['tenant_id', 'product_id'], 'inventory_stock_alerts_product_unique');
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_stock_alerts');
    }
};
