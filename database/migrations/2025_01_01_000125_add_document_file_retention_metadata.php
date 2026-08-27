<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_files', function (Blueprint $table) {
            $table->string('purge_reason_code', 64)->nullable()->after('purged_at');
            $table->foreignUuid('document_retention_policy_id')->nullable()->after('purge_reason_code')
                ->constrained('document_retention_policies')->nullOnDelete();
            $table->index(['document_retention_policy_id', 'purged_at'], 'document_file_retention_policy_lookup');
        });
    }

    public function down(): void
    {
        Schema::table('document_files', function (Blueprint $table) {
            $table->dropIndex('document_file_retention_policy_lookup');
            $table->dropConstrainedForeignId('document_retention_policy_id');
            $table->dropColumn('purge_reason_code');
        });
    }
};
