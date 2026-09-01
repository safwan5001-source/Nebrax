<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * عملاء الـ Public API (تكاملات M2M) — مملوكون لمستأجر واحد.
 *
 * لا جدول مفاتيح جديد: المفاتيح توكنات Sanctum على `personal_access_tokens`
 * (tokenable = ApiClient)، فيُعاد استخدام تخزين Sanctum وتجزئته وصلاحياته
 * (abilities = scopes) وانتهاء صلاحيته وآخر استخدامه. هذا الجدول للعميل فقط.
 *
 * متوافق مع SQLite وPostgreSQL (UUID + FK قياسيان، بلا سلوك خاص بقاعدة).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_clients', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('api_clients');
    }
};
