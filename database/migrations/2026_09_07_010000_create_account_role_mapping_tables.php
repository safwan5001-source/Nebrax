<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ACC-2: تعيين كل مستأجر الصريح من دور محاسبي دلالي (App\Support\AccountingRoles)
        // إلى حساب فعلي في دليله. صفٌّ واحد لكل (tenant_id, role_key) — دائماً موجود بعد
        // التهيئة/الـbackfill (Clean Seeded Cutover): لا حالة "بلا تعيين" مقصودة تصل
        // للمحلِّل؛ غيابه أو فساده حالتا فشلٍ مغلق سواء بسواء، لا مسار حلٍّ بديل بالكود.
        Schema::create('account_role_mappings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('role_key');
            // restrict: لا يجوز حذف حساب مُعيَّن حالياً لدور — يُعاد تعيين الدور أولاً.
            // يحافظ على سلامة الـFK دون أي منطق إضافي في نموذج Account نفسه.
            $table->foreignUuid('account_id')->constrained('accounts')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'role_key']);
            $table->index(['tenant_id', 'account_id']);
        });

        // سجل تدقيق ثابت لإنشاء/تغيير/استعادة تعيين دور. لا يُحدَّث ولا يُحذف بعد
        // الإنشاء. اللقطات (previous/new *_code) بلا قيد FK عمداً: يجب أن تبقى
        // مقروءة حتى لو حُذف الحساب المرجعي لاحقاً بعد أن كفّ عن كونه مُعيَّناً.
        Schema::create('account_role_mapping_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('role_key');
            $table->string('action'); // mapping_created | mapping_changed | mapping_reset
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('previous_account_id')->nullable();
            $table->string('previous_account_code')->nullable();
            $table->uuid('new_account_id');
            $table->string('new_account_code');
            $table->timestamps();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'role_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_role_mapping_events');
        Schema::dropIfExists('account_role_mappings');
    }
};
