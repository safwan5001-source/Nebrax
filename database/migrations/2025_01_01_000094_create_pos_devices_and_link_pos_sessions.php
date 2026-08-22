<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // جهاز البيع كيان تشغيلي معزول بالفرع. يثبّت مخزن الخروج قبل فتح الجلسة،
        // فلا يستطيع الكاشير أن يبدّل مخزن الفاتورة من شاشة البيع بعد بدء الورديّة.
        Schema::create('pos_devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('name', 120);
            $table->string('code', 64)->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'name']);
            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'branch_id', 'is_active']);
            $table->index(['tenant_id', 'warehouse_id']);
        });

        Schema::table('pos_sessions', function (Blueprint $table) {
            // الحقول nullable لحفظ الجلسات المقفلة التاريخية كما هي. خدمة فتح
            // الجلسة تفرض الجهاز النشط للورديات الجديدة؛ القديمة تبقى حجة قابلة
            // للتقرير والإقفال بلا إعادة تفسير لبياناتها.
            $table->foreignUuid('pos_device_id')->nullable()->constrained('pos_devices')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('shift_id')->nullable()->constrained('shifts')->restrictOnDelete();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->index(['tenant_id', 'pos_device_id', 'status']);
            $table->index(['tenant_id', 'warehouse_id', 'status']);
        });

        // لا تُفتح ورديتان على الجهاز نفسه. تسمح الفهارس الجزئية بوردية مغلقة
        // بعد كل إغلاق وبورديات متوازية على أجهزة مختلفة، وتحمي سباق فتح الجلسة
        // حيث لا يكفي فحص exists وحده عندما لا يوجد صف مفتوح لقفله.
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_per_device ON pos_sessions (tenant_id, pos_device_id) WHERE status = 'open' AND pos_device_id IS NOT NULL");
        DB::statement("CREATE UNIQUE INDEX pos_sessions_one_open_legacy ON pos_sessions (tenant_id) WHERE status = 'open' AND pos_device_id IS NULL");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_legacy');
        DB::statement('DROP INDEX IF EXISTS pos_sessions_one_open_per_device');

        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'warehouse_id', 'status']);
            $table->dropIndex(['tenant_id', 'pos_device_id', 'status']);
            $table->dropConstrainedForeignId('closed_by');
            $table->dropConstrainedForeignId('shift_id');
            $table->dropConstrainedForeignId('warehouse_id');
            $table->dropConstrainedForeignId('pos_device_id');
        });

        Schema::dropIfExists('pos_devices');
    }
};
