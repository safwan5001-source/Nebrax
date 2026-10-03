<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H1 — ملف نشاط المتجر (1:1 مع `storefronts`).
 *
 * جدول جانبي إضافي بحت: لا عمود على `storefronts` (نواته مقيَّدة بقرار
 * AWJ_COM_7_P2 §2). **غياب الصفّ = `general`** — فلا backfill ولا تغيير
 * لأي متجر قائم، ولا يُنشأ صفٌّ إلا بقرار صريح من التاجر.
 *
 * لا يخزّن هذا الجدول أي إعداد قدرة: المفاتيح الموصى بها تأتي من كود المنصة
 * (`BusinessVertical`)، وكل قدرة تحفظ إعدادها في شريحتها. يعمل على SQLite
 * وPostgreSQL بقيود فريدة كاملة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_business_profiles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->cascadeOnDelete();
            $table->string('vertical', 32);
            $table->timestamps();

            $table->unique('storefront_id');
            $table->unique(['tenant_id', 'storefront_id']);
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_business_profiles');
    }
};
