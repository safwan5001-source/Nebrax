<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * أنواع التسوية: إعداد مالي مشترك للمؤسسة، لا مستند مالي ولا مصدر قيد.
     *
     * تُعرّف قبل بناء تسويات عهد الموظف الفعلية. الاسم فريد لكل مستأجر،
     * والتعطيل يحفظ النوع لاستخدام السجلات التاريخية بدلاً من فرض حذفه.
     */
    public function up(): void
    {
        Schema::create('settlement_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('description', 1000)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'name']);
            $table->index(['tenant_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settlement_types');
    }
};
