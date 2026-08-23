<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commercial_product_versions', function (Blueprint $table) {
            $table->timestamp('retired_at')->nullable()->after('published_at');
            $table->index('retired_at');
        });

        Schema::table('commercial_plan_versions', function (Blueprint $table) {
            $table->timestamp('retired_at')->nullable()->after('published_at');
            $table->index('retired_at');
        });
    }

    public function down(): void
    {
        Schema::table('commercial_plan_versions', function (Blueprint $table) {
            $table->dropIndex(['retired_at']);
            $table->dropColumn('retired_at');
        });

        Schema::table('commercial_product_versions', function (Blueprint $table) {
            $table->dropIndex(['retired_at']);
            $table->dropColumn('retired_at');
        });
    }
};
