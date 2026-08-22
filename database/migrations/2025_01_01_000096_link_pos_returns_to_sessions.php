<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // مرجع تشغيلي اختياري: لا يغير قيود المرتجعات ولا يصف مرتجعاً تاريخياً
        // لم يُنشأ من نقطة البيع. الحذف مقيّد لحفظ أثر الجلسة والمرتجع معاً.
        Schema::table('return_documents', function (Blueprint $table) {
            $table->foreignUuid('pos_session_id')
                ->nullable()
                ->constrained('pos_sessions')
                ->restrictOnDelete();
            $table->index(['tenant_id', 'pos_session_id', 'status'], 'returns_pos_session_status_index');
        });
    }

    public function down(): void
    {
        Schema::table('return_documents', function (Blueprint $table) {
            $table->dropIndex('returns_pos_session_status_index');
            $table->dropConstrainedForeignId('pos_session_id');
        });
    }
};
