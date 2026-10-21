<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI-ACTIONS-07: a staged image whose private objects were removed by the retention job keeps its row (the audit trail
 * of what a preview named, by hash) and records WHEN the bytes were purged. `purged_at` is the only column that may
 * ever change on that row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_action_images', function (Blueprint $table) {
            $table->timestamp('purged_at')->nullable()->after('thumb_mime');
            $table->index(['tenant_id', 'ai_action_id', 'purged_at'], 'ai_action_images_purged_idx');
        });
    }

    public function down(): void
    {
        Schema::table('ai_action_images', function (Blueprint $table) {
            $table->dropIndex('ai_action_images_purged_idx');
            $table->dropColumn('purged_at');
        });
    }
};
