<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H1-01 — تحصين اتصال بوابة الدفع (إضافي فقط).
 *
 * - `status` دورة حياة الاتصال (draft/active/suspended/revoked). الصفوف القائمة تُثبَّت
 *   على حالتها الفعلية (`is_active` ⇒ active وإلا suspended) فلا يتغيّر سلوك أي مستأجر.
 * - `webhook_key` معرّف عشوائي غير سرّي لمسار الاستقبال المستقبلي؛ يُملأ للصفوف القائمة.
 * - `credential_version` + `previous_webhook_secret` + `previous_secret_expires_at`:
 *   نافذة سماح لتدوير سر الـwebhook.
 * - `payment_connection_events`: سجل تدقيق append-only بلا أسرار؛ بلا مفتاح أجنبي على البوابة
 *   عمداً كي يبقى أثر بوابة مسودة محذوفة.
 *
 * لا مساس بـ`payments` أو القيود أو أي جدول مالي.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payment_gateways', function (Blueprint $table) {
            $table->string('connection_mode', 16)->default('byog');
            $table->string('status', 16)->default('draft');
            $table->string('webhook_key', 64)->nullable();
            $table->unsignedInteger('credential_version')->default(1);
            $table->text('previous_webhook_secret')->nullable();
            $table->timestamp('previous_secret_expires_at')->nullable();
            $table->text('capabilities')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('deactivated_at')->nullable();
            $table->unique('webhook_key', 'payment_gateways_webhook_key_unique');
        });

        DB::table('payment_gateways')->orderBy('id')->chunkById(200, function ($rows) {
            foreach ($rows as $row) {
                $active = (bool) $row->is_active;
                DB::table('payment_gateways')->where('id', $row->id)->update([
                    'status' => $active ? 'active' : 'suspended',
                    'activated_at' => $active ? $row->created_at : null,
                    'deactivated_at' => $active ? null : $row->updated_at,
                    'webhook_key' => bin2hex(random_bytes(32)),
                ]);
            }
        });

        Schema::create('payment_connection_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('payment_gateway_id');
            $table->string('provider', 32);
            $table->string('gateway_name');
            $table->string('event_type', 32);
            $table->string('from_status', 16)->nullable();
            $table->string('to_status', 16)->nullable();
            $table->unsignedInteger('credential_version')->nullable();
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->text('changed_fields')->nullable();
            // دقة الميكروثانية: أحداث متتابعة في الثانية نفسها تحتفظ بترتيبها.
            $table->timestamp('occurred_at', 6);

            $table->index(['tenant_id', 'payment_gateway_id', 'occurred_at'], 'pce_tenant_gateway_time_idx');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('payment_connection_events') && DB::table('payment_connection_events')->exists()) {
            throw new RuntimeException('التراجع مرفوض: سجل تدقيق اتصالات الدفع يحوي أحداثاً ولا يُحذف.');
        }

        Schema::dropIfExists('payment_connection_events');

        Schema::table('payment_gateways', function (Blueprint $table) {
            $table->dropUnique('payment_gateways_webhook_key_unique');
        });
        Schema::table('payment_gateways', function (Blueprint $table) {
            $table->dropColumn([
                'connection_mode',
                'status',
                'webhook_key',
                'credential_version',
                'previous_webhook_secret',
                'previous_secret_expires_at',
                'capabilities',
                'verified_at',
                'activated_at',
                'deactivated_at',
            ]);
        });
    }
};
