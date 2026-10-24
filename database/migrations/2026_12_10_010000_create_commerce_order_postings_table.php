<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-H4-03 — مِرساة ترحيل طلب المتجر المدفوع (D-13 `ON_PAYMENT_CONFIRMED`، إضافي فقط).
 *
 * صف واحد لكل طلب رُحِّل: الفاتورة + سند القبض (A1) + محاولة الدفع الملتقطة. القيود الفريدة هي شبكة الأمان الأخيرة ضد الترحيل المكرر
 * (طلب ↔ فاتورة ↔ محاولة، كلٌّ فريد) فوق قفل الصفوف في الخدمة. FK بلا CASCADE على الفاتورة/السند (مستند محاسبي لا يُحذف تبعاً).
 * لا Backfill ولا تعديل لأي صف قائم. `down()` يرفض متى وُجد صف (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_order_postings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders');
            $table->foreignUuid('invoice_id')->constrained('invoices');
            $table->foreignUuid('payment_id')->constrained('payments');
            $table->foreignUuid('payment_attempt_id')->constrained('payment_attempts');
            $table->date('accounting_date');
            $table->bigInteger('amount_minor');
            $table->timestamp('created_at')->useCurrent();

            $table->unique('commerce_order_id', 'commerce_order_postings_order_unique');
            $table->unique('invoice_id', 'commerce_order_postings_invoice_unique');
            $table->unique('payment_attempt_id', 'commerce_order_postings_attempt_unique');
            $table->unique('payment_id', 'commerce_order_postings_payment_unique');
        });

        // PostgreSQL فقط: قيد CHECK في القاعدة. SQLite (اختبار) بلا مُشغّل — اختبارات سلامة هجرات أخرى تحصي مُشغّلات SQLite الكاملة؛ يحرس النموذج
        // (`CommerceOrderPosting::creating`) المبلغ الموجب في كل المحرّكين.
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE commerce_order_postings ADD CONSTRAINT commerce_order_postings_amount_chk CHECK (amount_minor > 0)');
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('commerce_order_postings') && DB::table('commerce_order_postings')->exists()) {
            throw new RuntimeException('Rollback refused: commerce_order_postings contains rows (financial references). Fix forward instead.');
        }
        Schema::dropIfExists('commerce_order_postings');
    }
};
