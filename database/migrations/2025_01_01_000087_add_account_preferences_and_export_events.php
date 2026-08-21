<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // تفضيلات عرض شخصية؛ لا تخص المؤسسة ولا تغيّر سياسة مالية أو تشغيلية.
            $table->json('preferences')->nullable()->after('permissions');
        });

        Schema::create('account_export_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('file_name');
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 1000)->nullable();
            $table->timestamp('generated_at');

            $table->index(['tenant_id', 'generated_at']);
            $table->index(['user_id', 'generated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_export_events');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('preferences');
        });
    }
};
