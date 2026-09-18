<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUSTOM-DOMAIN-EDGE-1 — حالة Edge/TLS منفصلة عن ملكية DNS TXT.
 *
 * كل الأعمدة nullable/افتراضية آمنة. الصفوف القائمة (AWJ-managed والمخصَّصة
 * المُتحقَّق ملكيتها) تبقى صالحة بـ`edge_status = none` بلا أي اتصال Railway
 * وبلا تفعيل تلقائي. لا SoftDeletes، لا شهادة، لا معرّفات مشروع/خدمة Railway.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_domains', function (Blueprint $table) {
            $table->string('edge_status', 32)->default('none')->after('verified_at');
            $table->string('edge_provider', 32)->nullable()->after('edge_status');
            $table->string('edge_provider_id', 64)->nullable()->after('edge_provider');
            $table->json('edge_dns_instructions')->nullable()->after('edge_provider_id');
            $table->text('edge_last_error')->nullable()->after('edge_dns_instructions');
            $table->timestamp('edge_checked_at')->nullable()->after('edge_last_error');
            $table->timestamp('edge_ready_at')->nullable()->after('edge_checked_at');
        });
    }

    public function down(): void
    {
        Schema::table('storefront_domains', function (Blueprint $table) {
            $table->dropColumn([
                'edge_status',
                'edge_provider',
                'edge_provider_id',
                'edge_dns_instructions',
                'edge_last_error',
                'edge_checked_at',
                'edge_ready_at',
            ]);
        });
    }
};
