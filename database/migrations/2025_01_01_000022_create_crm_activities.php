<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // سجلّ تفاعلات العملاء (CRM) — مكالمات/اجتماعات/بريد/ملاحظات/مهام.
        // غير محاسبي (لا يولّد قيوداً).
        Schema::create('crm_activities', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->nullOnDelete();
            $table->enum('type', ['call', 'meeting', 'email', 'note', 'task'])->default('note');
            $table->string('subject');
            $table->dateTime('activity_at');
            $table->enum('status', ['open', 'done'])->default('open');
            $table->string('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'activity_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('crm_activities');
    }
};
