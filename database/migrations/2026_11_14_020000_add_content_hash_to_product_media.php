<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_media', function (Blueprint $table) {
            $table->string('content_sha256', 64)->nullable()->after('size');
            $table->unique(['tenant_id', 'product_id', 'content_sha256'], 'product_media_content_unique');
        });
    }

    public function down(): void
    {
        Schema::table('product_media', function (Blueprint $table) {
            $table->dropUnique('product_media_content_unique');
            $table->dropColumn('content_sha256');
        });
    }
};
