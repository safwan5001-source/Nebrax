<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_session_events', function (Blueprint $table) {
            // امتداد للسجل append-only القائم، لا جدول أدلة موازٍ. لا قيود خارجية
            // لـ cart/correlation لأنهما هويتان تشغيليتان لا مستندين ماليين.
            $table->uuid('cart_id')->nullable()->after('pos_session_id');
            $table->uuid('correlation_id')->nullable()->after('cart_id');
            $table->string('category', 40)->nullable()->after('type');
            $table->bigInteger('amount')->nullable()->after('actor_id');
            $table->string('reason_code', 80)->nullable()->after('amount');
            $table->text('reason_note')->nullable()->after('reason_code');
            $table->foreignUuid('performed_by')->nullable()->after('reason_note')
                ->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->after('performed_by')
                ->constrained('users')->nullOnDelete();

            $table->index(['tenant_id', 'branch_id', 'created_at'], 'pos_events_audit_timeline_index');
            $table->index(['tenant_id', 'cart_id', 'created_at'], 'pos_events_cart_timeline_index');
            $table->index(['tenant_id', 'correlation_id'], 'pos_events_correlation_index');
            $table->index(['tenant_id', 'type', 'created_at'], 'pos_events_type_timeline_index');
            $table->index(['tenant_id', 'reason_code'], 'pos_events_reason_code_index');
        });

        Schema::table('pos_held_sales', function (Blueprint $table) {
            $table->uuid('cart_id')->nullable()->after('pos_session_id');
            $table->index(['tenant_id', 'cart_id'], 'pos_held_sales_cart_index');
        });

        Schema::table('pos_sessions', function (Blueprint $table) {
            // لا يغيّر العد الأعمى معادلة expected/difference؛ يضيف فقط توقيت
            // تثبيت الإدخال والكشف، وسجل أحداث مستقل لكل إعادة عد.
            $table->timestamp('counted_balance_locked_at')->nullable()->after('closing_balance');
            $table->timestamp('closing_count_revealed_at')->nullable()->after('counted_balance_locked_at');
            // UUID مفهرس بلا FK: لا يغيّر هذا الدليل التاريخي عند حذف مستخدم،
            // ويتفادى إعادة بناء SQLite للجدول وفقد الفهارس الجزئية للجلسات.
            $table->uuid('recounted_by')->nullable()->after('closing_count_revealed_at');
            $table->index(['tenant_id', 'recounted_by'], 'pos_sessions_recounted_by_index');
            $table->timestamp('recounted_at')->nullable()->after('recounted_by');
        });

        Schema::create('pos_reason_codes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code', 80);
            $table->string('name_ar', 160);
            $table->string('name_en', 160);
            $table->boolean('requires_note')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'code'], 'pos_reason_codes_tenant_code_unique');
            $table->index(['tenant_id', 'is_active'], 'pos_reason_codes_active_index');
        });

        // حالة سير الاعتماد ليست مصدر الأدلة: كل انتقال لها يكتب أيضاً حدثاً
        // append-only في pos_session_events. هذا الجدول يحمي عدم استهلاك اعتماد
        // واحد أكثر من مرة ويتيح طلباً معلقاً قابلاً للمراجعة.
        Schema::create('pos_override_approvals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_session_id')->constrained()->cascadeOnDelete();
            $table->uuid('cart_id')->nullable();
            $table->uuid('correlation_id');
            $table->string('operation', 80);
            $table->string('policy', 30);
            $table->string('status', 30);
            $table->string('reason_code', 80)->nullable();
            $table->text('reason_note')->nullable();
            $table->foreignUuid('performed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->json('context')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'status', 'created_at'], 'pos_approvals_review_index');
            $table->index(['tenant_id', 'correlation_id'], 'pos_approvals_correlation_index');
            $table->index(['pos_session_id', 'cart_id'], 'pos_approvals_cart_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_override_approvals');
        Schema::dropIfExists('pos_reason_codes');

        Schema::table('pos_held_sales', function (Blueprint $table) {
            $table->dropIndex('pos_held_sales_cart_index');
            $table->dropColumn('cart_id');
        });

        Schema::table('pos_sessions', function (Blueprint $table) {
            $table->dropIndex('pos_sessions_recounted_by_index');
            $table->dropColumn(['counted_balance_locked_at', 'closing_count_revealed_at', 'recounted_by', 'recounted_at']);
        });

        Schema::table('pos_session_events', function (Blueprint $table) {
            $table->dropIndex('pos_events_audit_timeline_index');
            $table->dropIndex('pos_events_cart_timeline_index');
            $table->dropIndex('pos_events_correlation_index');
            $table->dropIndex('pos_events_type_timeline_index');
            $table->dropIndex('pos_events_reason_code_index');
            $table->dropForeign(['performed_by']);
            $table->dropForeign(['approved_by']);
            $table->dropColumn([
                'cart_id', 'correlation_id', 'category', 'amount', 'reason_code',
                'reason_note', 'performed_by', 'approved_by',
            ]);
        });
    }
};
