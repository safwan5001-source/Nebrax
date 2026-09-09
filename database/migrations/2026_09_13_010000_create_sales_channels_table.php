<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-2A — قناة بيع Commerce (ADR-03): مصدر البيع التجاري، لا الفرع
 * التشغيلي ولا مخزن التنفيذ. جدولٌ إضافي بحت — لا عمود ولا جدول قائم يتغيّر.
 *
 * لا تُزرع قنوات جاهزة هنا (لا "متجرنا"، لا POS، لا Web Store): لا مستهلك
 * فعلي يقرأها بعد في هذه المرحلة (لا CommerceOrder ولا API)، فزرعها الآن
 * بيانات تخمينية بلا استعمال — يُنشئها المستدعي صراحةً حين يوجد سبب حقيقي.
 *
 * `slug` هويةٌ مستقرة قابلة للقراءة آلياً، بنفس نمط `roles.slug`
 * (`unique(['tenant_id','slug'])`) — لا سلسلة ترقيم (`GeneratesDocumentNumbers`)
 * لأن القناة ليست مستنداً معدوداً. لا `branch_id` ولا `warehouse_id` على هذا
 * الجدول: القناة تُجيب «من أي قناة تجارية جاء البيع؟» فقط، لا «من أي مخزن
 * سيُنفَّذ؟» — تلك مسؤولية Fulfillment Policy في PR-COM-2B، لا هذا الجدول.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_channels', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('slug');
            $table->string('name');
            // أصغر مفردات مدافَع عنها: أمثلة ADR-03 §1 حرفياً — لا تصنيف Commerce
            // شامل مُعتمد (القرار خارج نطاق ADR-03 §17 صراحةً)، قابلة للتوسعة
            // بترحيل عادي لاحقاً كما تُوسَّع أي عمود enum آخر في هذا المستودع.
            $table->enum('type', ['web', 'mobile', 'pos', 'external']);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'slug']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_channels');
    }
};
