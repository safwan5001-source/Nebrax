<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-FOUNDATION-1 — ملف تعريف منصة التوصيل فوق `SalesChannel(type=external)`.
 * جدولٌ إضافي بحت: لا عمود ولا جدول قائم يتغيّر، ولا بيانات تاريخية تُفسَّر.
 *
 * الصف يحمل **الهوية** فقط (منصة + قناة) وحالة التفعيل المرآة لآخر نسخة. كل
 * إعداد دلالي يعيش في `delivery_platform_profile_versions` (إلحاقي لا يُعدَّل).
 * `unique(tenant_id, platform_key)` و`unique(tenant_id, sales_channel_id)`:
 * منصة واحدة لكل مستأجر، وقناة واحدة لملف واحد.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_platform_profiles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->string('platform_key', 40);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'platform_key']);
            $table->unique(['tenant_id', 'sales_channel_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_platform_profiles');
    }
};
