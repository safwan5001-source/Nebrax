<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenant_application_states', function (Blueprint $table) {
            $table->foreignUuid('changed_by_platform_administrator_id')
                ->nullable()
                ->after('changed_by')
                ->constrained('platform_administrators')
                ->nullOnDelete();
        });

        Schema::table('tenant_application_events', function (Blueprint $table) {
            $table->foreignUuid('changed_by_platform_administrator_id')
                ->nullable()
                ->after('changed_by')
                ->constrained('platform_administrators')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('tenant_application_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('changed_by_platform_administrator_id');
        });

        Schema::table('tenant_application_states', function (Blueprint $table) {
            $table->dropConstrainedForeignId('changed_by_platform_administrator_id');
        });
    }
};
