<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ACC-6: نطاق تاريخ محاسبي مقفل على مستوى المؤسسة (CompanyWide). لا
        // `branch_id` في V1 عمداً: القيد الواحد قد يحمل سطوراً بفروع مختلفة
        // (أو بلا فرع)، فقفلٌ بالفرع كان سيجعل قيداً متوازناً «مقفولاً جزئياً».
        //
        // النطاق **مغلق الطرفين وشامل لهما** (start_date و end_date داخل القفل)،
        // ولا يوجد نطاق مفتوح النهاية في V1.
        Schema::create('accounting_period_locks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->date('start_date');
            $table->date('end_date');
            // active | released — لا حذف فعلي: النطاق المحرَّر يبقى صفّاً
            // تاريخياً يشهد أن الفترة كانت مقفلة ومَن حرّرها ولماذا.
            $table->string('status')->default('active');
            $table->text('reason');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('released_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('released_at')->nullable();
            $table->text('release_reason')->nullable();
            $table->timestamps();

            // مسار الحارس الساخن: أنشط قفلٍ يشمل تاريخاً بعينه لمستأجر بعينه.
            $table->index(['tenant_id', 'status', 'start_date', 'end_date']);
        });

        // سجل تدقيق ثابت: لا يُحدَّث ولا يُحذف بعد الإنشاء. تواريخ النطاق مخزَّنة
        // لقطةً (لا FK على القفل) كي يبقى السجل مقروءاً حتى لو حُذف المستأجر
        // مستقبلاً بأثرٍ تتالٍ على جدول الأقفال — نفس نمط ACC-2.
        Schema::create('accounting_period_lock_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('accounting_period_lock_id');
            $table->string('action'); // lock_created | lock_released
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->date('start_date');
            $table->date('end_date');
            $table->text('reason');
            $table->timestamps();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'accounting_period_lock_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('accounting_period_lock_events');
        Schema::dropIfExists('accounting_period_locks');
    }
};
