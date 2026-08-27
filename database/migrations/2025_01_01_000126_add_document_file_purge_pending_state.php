<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_files', function (Blueprint $table): void {
            $table->timestampTz('purge_pending_at')->nullable()->after('purged_at');
            $table->index(['tenant_id', 'branch_id', 'purge_pending_at'], 'document_file_purge_pending_lookup');
        });
    }

    public function down(): void
    {
        Schema::table('document_files', function (Blueprint $table): void {
            $table->dropIndex('document_file_purge_pending_lookup');
            $table->dropColumn('purge_pending_at');
        });
    }
};
