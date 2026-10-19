<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->string('media_archive_original_filename', 255)->nullable()->after('content_sha256');
            $table->string('media_archive_mime_type', 191)->nullable()->after('media_archive_original_filename');
            $table->unsignedBigInteger('media_archive_byte_size')->nullable()->after('media_archive_mime_type');
            $table->string('media_archive_storage_path', 512)->nullable()->after('media_archive_byte_size');
            $table->char('media_archive_content_sha256', 64)->nullable()->after('media_archive_storage_path');
        });
    }

    public function down(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->dropColumn([
                'media_archive_original_filename',
                'media_archive_mime_type',
                'media_archive_byte_size',
                'media_archive_storage_path',
                'media_archive_content_sha256',
            ]);
        });
    }
};
