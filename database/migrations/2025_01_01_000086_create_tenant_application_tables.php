<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // قرار كل مستأجر بتفعيل قدرة من ApplicationCatalog. لا صفّ للقدرات
        // الإلزامية — تُحسب "مفعّلة" منطقياً بلا حاجة لتخزين أو Backfill.
        Schema::create('tenant_application_states', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('application_key');
            $table->boolean('requested_enabled')->default(false);
            // enabled|disabled فقط اليوم؛ عمود مستقل عن requested_enabled لأن P2
            // سيضيف قيماً وسيطة (needs_configuration, suspended_readonly) بلا هجرة جديدة.
            $table->string('status', 32)->default('disabled');
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'application_key']);
            $table->index(['tenant_id', 'status']);
        });

        // سجل تدقيق ثابت لتفعيل/إيقاف التطبيقات. لا يُحدَّث ولا يُحذف بعد الإنشاء؛
        // القرارات المرفوضة لا تُغيّر حالة فلا تُسجَّل هنا.
        Schema::create('tenant_application_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('application_key');
            $table->string('action'); // enabled | disabled
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'application_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_application_events');
        Schema::dropIfExists('tenant_application_states');
    }
};
