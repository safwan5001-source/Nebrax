<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // حقول ZATCA المرحلة 2 (الربط): UUID، عدّاد ICV، سلسلة الهاش PIH، ومستند UBL.
        Schema::table('invoices', function (Blueprint $table) {
            $table->uuid('zatca_uuid')->nullable()->after('zatca_hash');
            $table->unsignedInteger('zatca_icv')->nullable()->after('zatca_uuid'); // Invoice Counter Value
            $table->string('zatca_previous_hash')->nullable()->after('zatca_icv'); // PIH
            $table->longText('zatca_xml')->nullable()->after('zatca_previous_hash');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_xml']);
        });
    }
};
