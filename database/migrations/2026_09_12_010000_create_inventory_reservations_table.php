<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-1B — أول primitive حجز مخزوني حقيقي في Commerce (ADR-02).
 *
 * الحجز **وعدٌ تشغيلي لا حركة مخزون**: لا يُغيّر `products.quantity_on_hand`
 * ولا `product_warehouse_stock.quantity` ولا يولّد `stock_movements` ولا قيداً
 * محاسبياً. `AvailableToSellService` يجمع `base_quantity` لكل صفٍّ حالته
 * `active` ليخصم من On Hand — هذا الجدول هو مصدر الحقيقة الوحيد لـ«المحجوز
 * النشط»؛ لا عدّاد مجمَّع مستقل يوازيه.
 *
 * **بوابة التزامن على مستوى الترحيل** = القيد الفريد
 * `(tenant_id, idempotency_key)`: طلبا حجزٍ متزامنان بالمفتاح نفسه يتسابقان
 * على الإدراج، فيفوز واحد ويصطدم الآخر بالقيد — بنفس نمط
 * `pos_checkout_attempts`/`public_api_idempotency_keys`. أما منع البيع
 * الزائد (oversell) تحت التزامن فمسؤولية قفلٍ صريح في الخدمة
 * (`product_warehouse_stock` عبر `lockForUpdate()`)، لا مسؤولية هذا الجدول.
 *
 * `source_type`/`source_id` بنفس شكل `journal_entries`/`stock_movements` —
 * مرجعٌ مخزَّنٌ عام يسمح بربط `CommerceOrder` لاحقاً حين يُبنى، بلا FK مبكر
 * إليه ولا اعتماد دائرة على وحدة لم تُنشأ بعد.
 *
 * الحذف يبقى مقيّداً (`restrictOnDelete`) على المنتج/المخزن — الحجز سجلٌّ
 * تدقيقي (ADR-02 §3)، فحذفٌ صلبٌ للمرجع كان سيمحو أثراً يجب أن يبقى قابلاً
 * للتفسير حتى بعد الاستهلاك/الإفراج/الانتهاء.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_reservations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->restrictOnDelete();

            // كمية أساس دائماً (كـ product_warehouse_stock.quantity) — لا وحدة تجارية هنا.
            $table->unsignedInteger('base_quantity');
            $table->enum('status', ['active', 'consumed', 'released', 'expired'])->default('active');

            // مرجع عام لمصدر الحجز (لاحقاً CommerceOrder) — بلا FK مبكر.
            $table->string('source_type')->nullable();
            $table->uuid('source_id')->nullable();

            // بوابة idempotency: مفتاح المستدعي + بصمة الحمولة المادية (sha256).
            $table->string('idempotency_key', 128);
            $table->string('request_checksum', 64);

            $table->timestamp('expires_at')->nullable();
            $table->timestamp('released_at')->nullable();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('expired_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key'], 'inventory_reservations_idempotency_unique');
            // مسار القراءة الساخن: مجموع base_quantity لصفوف active لمنتج× مخزن معيّن.
            $table->index(['tenant_id', 'product_id', 'warehouse_id', 'status'], 'inventory_reservations_ats_idx');
            $table->index(['source_type', 'source_id'], 'inventory_reservations_source_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_reservations');
    }
};
