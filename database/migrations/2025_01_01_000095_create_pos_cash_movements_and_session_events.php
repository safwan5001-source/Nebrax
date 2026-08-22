<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_sessions', function (Blueprint $table) {
            // NULL للجلسات التاريخية: لا نعيد وصف حالة اعتماد لم تُسجّل وقت الإقفال.
            $table->string('difference_status', 20)->nullable()->after('difference');
            $table->foreignUuid('difference_acknowledged_by')->nullable()->after('difference_status')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('difference_acknowledged_at')->nullable()->after('difference_acknowledged_by');
            $table->text('difference_acknowledgement_note')->nullable()->after('difference_acknowledged_at');
            $table->index(['tenant_id', 'branch_id', 'difference_status'], 'pos_sessions_difference_status_index');
        });

        // SQLite يعيد بناء الجدول عند إضافة قيود أجنبية ويُسقط شرط WHERE من
        // الفهارس الجزئية الخام السابقة. نعيدها صراحةً على القاعدتين كي يبقى
        // المنع "وردية مفتوحة لكل جهاز" لا "وردية مفتوحة لكل مستأجر".
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_legacy');
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_per_device');
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_per_device ON pos_sessions (tenant_id, pos_device_id) WHERE status = 'open' AND pos_device_id IS NOT NULL");
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_legacy ON pos_sessions (tenant_id) WHERE status = 'open' AND pos_device_id IS NULL");

        // حركة درج محلية: تثبت انتقال النقد بين الدرج ونقطة الحفظ داخل المنشأة.
        // ليست سند قبض أو صرف ولا تنشئ قيداً؛ العمليات الخارجية تمر عبر وحدتها المالية.
        Schema::create('pos_cash_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_session_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20); // cash_in | cash_out
            $table->bigInteger('amount'); // هللات موجبة دائماً
            $table->string('reason', 1000);
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'branch_id', 'pos_session_id'], 'pos_cash_movements_session_index');
            $table->index(['pos_session_id', 'type'], 'pos_cash_movements_type_index');
        });

        // سجل تدقيق موحّد لجلسة POS: لا يغير أرصدة ولا يسمح بتحرير أو حذف الأحداث.
        Schema::create('pos_session_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_session_id')->constrained()->cascadeOnDelete();
            $table->string('type', 60);
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('payload')->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'branch_id', 'pos_session_id'], 'pos_session_events_session_index');
            $table->index(['pos_session_id', 'created_at'], 'pos_session_events_timeline_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_session_events');
        Schema::dropIfExists('pos_cash_movements');

        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropIndex('pos_sessions_difference_status_index');
            $table->dropForeign(['difference_acknowledged_by']);
            $table->dropColumn([
                'difference_status', 'difference_acknowledged_by',
                'difference_acknowledged_at', 'difference_acknowledgement_note',
            ]);
        });

        // يدعم rollback المعاد بناء الجدول في SQLite من دون تحويل فهارس P1
        // الجزئية إلى قيود عامة على المستأجر كله.
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_legacy');
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_per_device');
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_per_device ON pos_sessions (tenant_id, pos_device_id) WHERE status = 'open' AND pos_device_id IS NOT NULL");
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_legacy ON pos_sessions (tenant_id) WHERE status = 'open' AND pos_device_id IS NULL");
    }
};
