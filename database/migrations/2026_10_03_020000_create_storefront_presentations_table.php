<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * STORE-BACKEND-1 — رأس المظهر الحالي لمتجر واحد (1:1).
 *
 * مسودة JSON + لقطة منشورة JSON + أرقام مراجعة صحيحة. ليست سجلاً تاريخياً —
 * سجل الإصدارات مؤجَّل. لا أعمدة مظهر على `storefronts` أو `sales_channels`
 * أو `tenants.settings` (AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md §2).
 *
 * يعمل على SQLite وPostgreSQL: قيود فريدة كاملة بلا فهارس جزئية.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_presentations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->cascadeOnDelete();
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->json('draft_config');
            $table->unsignedInteger('draft_revision')->default(0);
            $table->json('published_config')->nullable();
            $table->unsignedInteger('published_revision')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique('storefront_id');
            $table->unique(['tenant_id', 'storefront_id']);
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_presentations');
    }
};
