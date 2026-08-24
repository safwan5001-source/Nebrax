<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // حالة التطبيق الرئيسي مستقلة عن حالات قدراته الفرعية. غياب الصف يعني
        // "مفعّل" للحفاظ على السلوك الحالي؛ تعطيل المجموعة لا يغيّر أي اختيار
        // فرعي، لذلك تعود الفروع إلى حالاتها السابقة عند إعادة تفعيل التطبيق.
        Schema::create('tenant_application_group_states', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('group_key', 80);
            $table->boolean('requested_enabled')->default(true);
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'group_key']);
            $table->index(['tenant_id', 'requested_enabled']);
        });

        Schema::create('tenant_application_group_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('group_key', 80);
            $table->string('action', 32); // enabled | disabled
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'group_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_application_group_events');
        Schema::dropIfExists('tenant_application_group_states');
    }
};
