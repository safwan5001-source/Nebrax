<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_categories', function (Blueprint $table): void {
            $table->text('description')->nullable()->after('name');
            $table->string('image_path')->nullable()->after('description');
            $table->string('image_original_name')->nullable()->after('image_path');
            $table->string('image_mime_type', 100)->nullable()->after('image_original_name');
            $table->unsignedBigInteger('image_size')->nullable()->after('image_mime_type');
        });
    }

    public function down(): void
    {
        Schema::table('product_categories', function (Blueprint $table): void {
            $table->dropColumn([
                'description',
                'image_path',
                'image_original_name',
                'image_mime_type',
                'image_size',
            ]);
        });
    }
};
