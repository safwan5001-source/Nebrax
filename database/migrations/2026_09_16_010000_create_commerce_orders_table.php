<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-5A — سجلّ الالتزام التجاري (ADR-01): `CommerceOrder` منفصلٌ تماماً
 * عن `Quote`/`Invoice`/`DeliveryNote`، بلا أثر محاسبي أو مخزني عند التأكيد
 * (ADR-01 §2/§6). جدولان إضافيان بحتان — لا جدول قائم يتغيّر.
 *
 * **الحقول المتعمَّد غيابها الآن (موثَّقة لا منسيّة)**:
 * - لا `branch_id`/`warehouse_id`: القناة تحدّد مصدر البيع لا الفرع
 *   (ADR-03 §1)، والتنفيذ مسؤولية `FulfillmentPolicy` عبر PR-COM-5B، لا هذا
 *   الجدول.
 * - لا `currency`: لا سابقة لهذا العمود في أي مستند AWJ (Invoice/Quote/
 *   Purchase) — نظامٌ أحادي العملة لكل مستأجر، `Tenant.currency` وحده
 *   مصدر الحقيقة.
 * - لا `tax_amount`/`discount`/`shipping`: لا محرّك ضريبة ولا خصم ولا شحن في
 *   COM-5A (Master Plan §20/§21/§22) — `CommercePriceResolver` نفسه لا يحسم
 *   ضريبة إطلاقاً (COM-4A). إضافتها الآن قبل وجود سلطة تحسمها تخمينٌ مالي
 *   ممنوع صراحةً.
 * - لا حقل عنوان/جهة اتصال على الرأس: Master Plan يخصّص «immutable order
 *   address snapshot» صراحةً لـ PR-COM-6C، لا لهذه المرحلة.
 *
 * `number`: كل مستند تجاري في AWJ مرقَّمٌ (`GeneratesDocumentNumbers`)؛
 * `CommerceOrder` يتبع نفس القاعدة ببادئة مستقلة `CORD` — لا يستهلك سلسلة
 * الفاتورة `INV` ولا عدّاد ZATCA `zatca_icv` إطلاقاً (Master Plan §24).
 *
 * الحذف: `sales_channel_id`/`partner_id` كلاهما `restrictOnDelete()` — على
 * عكس `commerce_listings`/`fulfillment_policies` (تهيئة حالية، cascade)،
 * هذا الجدول **سجلٌّ تاريخي** كـ`inventory_reservations` تماماً؛ حذفٌ صلبٌ
 * للمرجع يمحو أثراً يجب أن يبقى قابلاً للتفسير. `partner_id` نفسه اختياري
 * (Master Plan §12 — Customer Account لم يُبنَ بعد، ولا Partner يُنشأ تلقائياً).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->restrictOnDelete();

            $table->string('number');
            $table->enum('status', ['draft', 'confirmed'])->default('draft');

            // مشتقّ من مجموع line_total لكل سطر — لا مُدخَل مباشرة أبداً.
            $table->bigInteger('total')->default(0);

            $table->timestamp('confirmed_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'sales_channel_id']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('commerce_order_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained()->cascadeOnDelete();
            // nullOnDelete كبقية سطور المستندات التجارية/التاريخية
            // (InvoiceLine/PurchaseLine/ReturnLine/QuoteLine) — الحماية الحقيقية
            // ضد حذف منتجٍ مُشار إليه تاريخياً تعيش في ProductReferenceRegistry
            // (BUSINESS_HISTORICAL) لا في قيد قاعدة البيانات وحده.
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();

            // لقطة اسم المنتج وقت الاتفاق — لا تُعاد قراءتها من Product لاحقاً.
            $table->string('product_name_snapshot');

            $table->unsignedInteger('quantity');
            // لقطة وحدة العرض: null = وحدة الأساس (نفس اصطلاح UnitConversion::resolve()).
            $table->string('unit_name')->nullable();
            $table->unsignedInteger('unit_factor')->default(1);

            // لقطة السعر التجاري المحسوم لحظة الاتفاق (هللات) — لا يُعاد حسمه لاحقاً.
            $table->bigInteger('unit_price');
            // مشتقّ: quantity × unit_price. لا ضريبة ولا خصم هنا (انظر توثيق الرأس).
            $table->bigInteger('line_total');

            $table->timestamps();

            $table->index(['tenant_id', 'commerce_order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_order_lines');
        Schema::dropIfExists('commerce_orders');
    }
};
