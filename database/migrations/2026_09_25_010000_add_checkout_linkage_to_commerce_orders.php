<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-CHECKOUT-1B — توسيع additive بحت لـ `commerce_orders` (PR-COM-5A) لتصبح
 * الوجهة الموحَّدة لطلبَي التجارة الإلكترونية والمسار التجاري القديم معاً
 * (AWJ_COMMERCE_ORDER_IDENTITY_DECISION_REPORT.md — القرار C: Unify/Migrate).
 * **لا rename** للجدول أو للنموذج، **لا** عمود جديد `NOT NULL`، و**لا** تغيير
 * على enum `status` (يبقى `draft`/`confirmed` بمعناهما الحاليين حرفياً — طلب
 * Checkout يُنشأ داخل معاملةٍ واحدة مباشرةً بحالة `confirmed` النهائية، فلا
 * حاجة لقيمةٍ جديدة، ولا إعادة تفسير للقديمة: `confirmed` ما زال يعني
 * «التزامٌ تجاريٌّ نهائي، بلا أثرٍ محاسبي بعد» لكلا المصدرين).
 *
 * **`storefront_id`** — nullable، `restrictOnDelete()` كـ`sales_channel_id`
 * المجاور: الطلبات القديمة (staff/trusted) لا مصدر متجرٍ لها إطلاقاً، فتبقى
 * `null` للأبد. طلب Checkout يملأه دائماً (المتجر الذي أُنشئ منه).
 *
 * **`commerce_checkout_id`** — nullable **وفريد**: الضمان النصفي الثاني
 * لـ"exactly one order per checkout" (النصف الأول تطبيقي عبر Idempotency-Key
 * على `commerce_checkouts`، راجع migration التالية) — قيدٌ على مستوى القاعدة
 * لا يعتمد على انضباط التطبيق وحده. `null` متعدّد مسموحٌ بنيوياً في كلا
 * محركي القاعدة (SQLite/PostgreSQL: `NULL ≠ NULL` في الفهارس الفريدة)، فلا
 * يتعارض تعدد الطلبات القديمة بلا checkout مع بعضها. `restrictOnDelete()`:
 * `CommerceOrder` سجلٌّ تاريخي — حذف Checkout مرتبط بطلبٍ مؤكَّد يُرفض صراحةً،
 * لا يُيتَّم الطلب صامتاً.
 *
 * **`delivery_method`** — nullable، نسخة من `commerce_checkouts.delivery_method`
 * وقت الإتمام — لا محرك شحن هنا (المبلغ يبقى صفراً دائماً، `total` القائم لا
 * عمود مبلغ توصيل مستقل — نفس حدود CHECKOUT-1A تماماً).
 *
 * **بلا `currency`**: `Tenant.currency` يبقى المصدر الوحيد كما وثّقت
 * migration الجدول الأصلية — لا عمود جديد (قرار C صريح في تقرير الهوية).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->foreignUuid('storefront_id')->nullable()->after('sales_channel_id')
                ->constrained('storefronts')->restrictOnDelete();
            $table->foreignUuid('commerce_checkout_id')->nullable()->after('storefront_id')
                ->constrained('commerce_checkouts')->restrictOnDelete();
            $table->string('delivery_method')->nullable()->after('total');

            $table->unique('commerce_checkout_id', 'commerce_orders_checkout_id_unique');
            $table->index(['tenant_id', 'storefront_id'], 'commerce_orders_tenant_storefront_index');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->dropUnique('commerce_orders_checkout_id_unique');
            $table->dropIndex('commerce_orders_tenant_storefront_index');
            $table->dropConstrainedForeignId('commerce_checkout_id');
            $table->dropConstrainedForeignId('storefront_id');
            $table->dropColumn('delivery_method');
        });
    }
};
