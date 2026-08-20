<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // سجل تدقيق ثابت لإجراءات مدير المنصة على مستأجر (تغيير خطة/تجربة/حالة).
        // لا يُحدَّث ولا يُحذف بعد الإنشاء؛ الأثر الرجعي وحده سبب وجوده.
        Schema::create('platform_administrator_actions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('platform_administrator_id')->constrained('platform_administrators')->cascadeOnDelete();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('action');
            $table->string('from_value')->nullable();
            $table->string('to_value')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_administrator_actions');
    }
};
