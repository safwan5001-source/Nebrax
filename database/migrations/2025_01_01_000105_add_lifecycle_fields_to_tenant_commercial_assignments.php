<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenant_commercial_assignments', function (Blueprint $table) {
            $table->string('lifecycle_state', 32)->default('active')->after('status');
            $table->timestamp('payment_failed_at')->nullable()->after('ends_at');
            $table->timestamp('scheduled_cancellation_at')->nullable()->after('payment_failed_at');
            $table->timestamp('ended_at')->nullable()->after('scheduled_cancellation_at');
            $table->index(['tenant_id', 'lifecycle_state'], 'commercial_assignment_lifecycle_index');
            $table->index('payment_failed_at');
            $table->index('scheduled_cancellation_at');
        });
    }

    public function down(): void
    {
        Schema::table('tenant_commercial_assignments', function (Blueprint $table) {
            $table->dropIndex('commercial_assignment_lifecycle_index');
            $table->dropIndex(['payment_failed_at']);
            $table->dropIndex(['scheduled_cancellation_at']);
            $table->dropColumn(['lifecycle_state', 'payment_failed_at', 'scheduled_cancellation_at', 'ended_at']);
        });
    }
};
