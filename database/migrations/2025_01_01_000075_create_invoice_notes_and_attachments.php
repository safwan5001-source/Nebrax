<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * سجل تشغيلي داخلي للفواتير: لا يغيّر الفاتورة أو حالة السداد أو القيد.
     * المرفق يحفظ وصف الملف فقط؛ فلا يصل العميل لمسار تخزين حر أو رابط عام.
     */
    public function up(): void
    {
        Schema::create('invoice_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('invoice_id')->constrained('invoices')->cascadeOnDelete();
            $table->dateTime('recorded_at');
            $table->text('body')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'invoice_id', 'recorded_at']);
        });

        Schema::create('invoice_note_attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('invoice_note_id')->constrained('invoice_notes')->cascadeOnDelete();
            $table->string('disk');
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 100)->nullable();
            $table->unsignedBigInteger('size');
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'invoice_note_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_note_attachments');
        Schema::dropIfExists('invoice_notes');
    }
};
