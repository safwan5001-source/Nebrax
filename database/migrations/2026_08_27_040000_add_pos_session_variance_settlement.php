<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * تسوية فرق صندوق جلسة نقاط البيع في دفتر الأستاذ.
 *
 *  • `pos_sessions.cash_account_id` — حساب الخزينة (الأستاذ) المثبّت للجلسة وقت
 *    فتحها من مسار نقد نقاط البيع نفسه (خزينة وسيلة الدفع النقدية)، فلا ينجرف
 *    لاحقاً إن غُيّرت الخزينة الرئيسية أو خزينة الطريقة. تُسوّى الفروق عليه لا
 *    على «الخزينة الرئيسية» العامة. nullable للجلسات القديمة السابقة للهجرة —
 *    وتُمنع تسويتها بلا خزينة مثبتة (لا نلفّق خزينة تاريخية).
 *  • `pos_sessions.variance_journal_entry_id` — رابط اللقطة المحاسبية للفرق
 *    المسوّى؛ وجوده يعني «مُسوّى» ويضمن قيداً واحداً لكل جلسة (idempotency).
 *
 * لا يُضاف حساب فروق جديد للدليل: يُرحّل الفرق على حساب الفروق والتسويات القائم
 * (5170) الذي يزرعه دليل الحسابات لكل مستأجر أصلاً، فلا حاجة لتعبئة رجعية.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->uuid('cash_account_id')->nullable()->after('warehouse_id');
            $table->uuid('variance_journal_entry_id')->nullable()->after('difference_acknowledgement_note');
            $table->index('cash_account_id');
            $table->index('variance_journal_entry_id');
        });
    }

    public function down(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropIndex(['cash_account_id']);
            $table->dropIndex(['variance_journal_entry_id']);
            $table->dropColumn('cash_account_id');
            $table->dropColumn('variance_journal_entry_id');
        });
    }
};
