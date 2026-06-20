<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // حقول ZATCA (المرحلة 1) على فاتورة المبيعات: رمز QR والهاش.
        Schema::table('invoices', function (Blueprint $table) {
            $table->text('zatca_qr')->nullable()->after('cogs_entry_id');   // Base64 لحقول TLV
            $table->string('zatca_hash')->nullable()->after('zatca_qr');    // SHA-256 (Base64)
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['zatca_qr', 'zatca_hash']);
        });
    }
};
