<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // الجلسة مرجع تشغيلي محفوظ على مستندات POS المرحّلة؛ لا تغيّر القيود ولا
        // تكون بديلاً عن الفاتورة أو سند القبض. الحذف مقيّد كي تبقى المستندات
        // التاريخية قابلة للتدقيق، والفهرس يجعل تقرير الوردية لا يعتمد على الوقت.
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignUuid('pos_session_id')
                ->nullable()
                ->constrained('pos_sessions')
                ->restrictOnDelete();
            $table->index(['tenant_id', 'pos_session_id']);
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->foreignUuid('pos_session_id')
                ->nullable()
                ->constrained('pos_sessions')
                ->restrictOnDelete();
            $table->index(['tenant_id', 'pos_session_id', 'status', 'direction', 'method']);
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'pos_session_id', 'status', 'direction', 'method']);
            $table->dropConstrainedForeignId('pos_session_id');
        });

        Schema::table('invoices', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'pos_session_id']);
            $table->dropConstrainedForeignId('pos_session_id');
        });
    }
};
