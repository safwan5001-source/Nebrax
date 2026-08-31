<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('zatca_submission_attempts', function (Blueprint $table) {
            $table->unsignedInteger('queue_count')->default(0)->after('requested_at');
            $table->timestamp('queued_at')->nullable()->after('queue_count');
        });
    }

    public function down(): void
    {
        Schema::table('zatca_submission_attempts', function (Blueprint $table) {
            $table->dropColumn(['queue_count', 'queued_at']);
        });
    }
};
