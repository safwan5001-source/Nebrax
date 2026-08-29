<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('platform_administrator_actions', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
            $table->uuid('tenant_id')->nullable()->change();
            $table->foreign('tenant_id')->references('id')->on('tenants')->nullOnDelete();
        });
    }

    public function down(): void
    {
        DB::table('platform_administrator_actions')->whereNull('tenant_id')->delete();

        Schema::table('platform_administrator_actions', function (Blueprint $table) {
            $table->dropForeign(['tenant_id']);
            $table->uuid('tenant_id')->nullable(false)->change();
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });
    }
};
