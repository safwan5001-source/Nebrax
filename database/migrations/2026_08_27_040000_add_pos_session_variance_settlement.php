<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * تسوية فرق صندوق جلسة نقاط البيع في دفتر الأستاذ.
 *
 * `pos_sessions.variance_journal_entry_id` — رابط اللقطة المحاسبية للفرق المسوّى؛
 * وجوده يعني «مُسوّى» ويضمن قيداً واحداً لكل جلسة (idempotency).
 *
 * لا يُضاف حساب جديد للدليل: يُرحّل الفرق على حساب الفروق والتسويات القائم (5170)
 * الذي يزرعه دليل الحسابات لكل مستأجر أصلاً، فلا حاجة لتعبئة رجعية.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->uuid('variance_journal_entry_id')->nullable()->after('difference_acknowledgement_note');
            $table->index('variance_journal_entry_id');
        });
    }

    public function down(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropIndex(['variance_journal_entry_id']);
            $table->dropColumn('variance_journal_entry_id');
        });
    }
};
