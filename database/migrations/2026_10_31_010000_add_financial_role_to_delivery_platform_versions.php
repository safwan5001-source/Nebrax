<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-FINANCIAL-ROLE-CONFIG-1 — لقطة الدور المالي على النسخة الإلحاقية.
 *
 * القيم الافتراضية `unknown` حتى لا تُفسَّر الصفوف القديمة كدليل.
 * لا ملف عقد ولا سر. تغيير المعنى يتم بنسخة جديدة لا بتعديل الصف.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_platform_profile_versions', function (Blueprint $table) {
            $table->string('selling_role', 32)->default('unknown');
            $table->string('invoice_responsibility', 40)->default('unknown');
            $table->string('collection_role', 40)->default('unknown');
            $table->string('merchant_vat_status_at_supply', 32)->default('unknown');
            $table->string('financial_evidence_ref', 500)->nullable();
            $table->timestamp('financial_verified_at', 6)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('delivery_platform_profile_versions', function (Blueprint $table) {
            $table->dropColumn([
                'selling_role',
                'invoice_responsibility',
                'collection_role',
                'merchant_vat_status_at_supply',
                'financial_evidence_ref',
                'financial_verified_at',
            ]);
        });
    }
};
