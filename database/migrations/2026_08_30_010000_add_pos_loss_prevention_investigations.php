<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 3 — إدارة قضايا التحقيق فوق أدلة/استثناءات Phase 1/2 (append-only، بلا مصدر حقيقة موازٍ).
 *
 * لا تلمس هذه الهجرة `pos_session_events` ولا `pos_exceptions` ولا أي جدول مالي: القضايا وروابط
 * أدلتها **تشير** إلى معرّفات ثابتة ولا تعدّلها ولا تنسخ قيمها المالية كحقيقة نهائية. `confirmed_loss`
 * و`recovered_amount` قرارا تحقيق بشريّان صرفان، لا يمرّان عبر `LedgerService` ولا يعدّلان رصيداً.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ملف تحقيق — بيانات تشغيلية معزولة بفرع أصل القضية (BranchScoped)، مرقَّم عبر
        // GeneratesDocumentNumbers القياسي (بادئة LP، تسلسل مستقل لكل فرع من التصنيف ذاته).
        Schema::create('pos_investigation_cases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->string('number', 40);
            $table->string('title', 200);
            $table->text('summary')->nullable();

            $table->string('status', 30)->default('open');
            $table->string('priority', 20)->default('normal');

            $table->uuid('owner_id')->nullable();
            $table->uuid('opened_by')->nullable();
            $table->timestamp('opened_at');
            $table->timestamp('last_activity_at');
            $table->timestamp('resolved_at')->nullable();
            $table->timestamp('closed_at')->nullable();

            // سياق مصدري مُلتقَط وقت الفتح/الترقية — نسخة سياق نصية لا مرجع فعلي يُعاد اشتقاقه.
            $table->uuid('subject_user_id')->nullable();
            $table->foreignUuid('pos_session_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('cart_id')->nullable();
            $table->uuid('correlation_id')->nullable();

            // مبالغ بالهللات — bigint حصراً، بلا float.
            $table->bigInteger('amount_under_review_minor')->default(0);
            $table->bigInteger('confirmed_loss_minor')->nullable();
            $table->bigInteger('recovered_amount_minor')->nullable();

            $table->string('outcome', 30)->nullable();
            $table->string('resolution_reason', 80)->nullable();
            $table->text('resolution_summary')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number'], 'pos_cases_tenant_branch_number_unique');
            $table->index(['tenant_id', 'branch_id', 'status', 'priority'], 'pos_cases_status_priority_index');
            $table->index(['tenant_id', 'owner_id'], 'pos_cases_owner_index');
            $table->index(['tenant_id', 'subject_user_id'], 'pos_cases_subject_index');
            $table->index(['tenant_id', 'opened_at'], 'pos_cases_opened_index');
            $table->index(['tenant_id', 'last_activity_at'], 'pos_cases_activity_index');
            $table->index(['tenant_id', 'pos_session_id'], 'pos_cases_session_index');
        });

        // فهرس جزئي: صفوف بلا فرع (`branch_id IS NULL`) لا تتصادم بفهرس فريد عادي بين محرّكين
        // مختلفين، فيُضاف صراحة (نفس نمط ترقيم ZATCA ICV الموثَّق في numbering-reference).
        $driver = Schema::getConnection()->getDriverName();
        if (in_array($driver, ['pgsql', 'sqlite'], true)) {
            \Illuminate\Support\Facades\DB::statement(
                'CREATE UNIQUE INDEX pos_cases_tenant_number_no_branch_unique ON pos_investigation_cases (tenant_id, number) WHERE branch_id IS NULL'
            );
        }

        // رابط دليل — لا نسخ لقيم الاستثناء/الحدث، معرّفات فقط. الفكّ يُسجَّل بـ`unlinked_at`
        // (لا حذف صلب) والنشاط المقابل append-only في pos_case_activities.
        Schema::create('pos_case_evidence_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('case_id')->constrained('pos_investigation_cases')->cascadeOnDelete();
            $table->foreignUuid('pos_exception_id')->nullable()->constrained('pos_exceptions')->nullOnDelete();
            $table->foreignUuid('pos_session_event_id')->nullable()->constrained('pos_session_events')->nullOnDelete();
            $table->uuid('cart_id')->nullable();
            $table->uuid('correlation_id')->nullable();
            $table->string('link_type', 30)->default('exception');
            $table->text('rationale')->nullable();
            $table->uuid('linked_by')->nullable();
            $table->timestamp('linked_at');
            $table->uuid('unlinked_by')->nullable();
            $table->timestamp('unlinked_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'case_id', 'unlinked_at'], 'pos_case_links_case_index');
            $table->index(['tenant_id', 'pos_exception_id'], 'pos_case_links_exception_index');
            $table->index(['tenant_id', 'pos_session_event_id'], 'pos_case_links_event_index');
        });

        // سجلّ نشاط append-only — لا يُعدَّل ولا يُحذف (نفس نمط pos_exception_reviews).
        Schema::create('pos_case_activities', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('case_id')->constrained('pos_investigation_cases')->cascadeOnDelete();
            $table->string('action', 40);
            $table->uuid('actor_id')->nullable();
            $table->json('meta')->nullable();
            $table->text('note')->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'case_id', 'created_at'], 'pos_case_activities_timeline_index');
            $table->index(['tenant_id', 'action'], 'pos_case_activities_action_index');
        });

        // ملاحظات تحقيق append-only — لا مدوَّنة واحدة قابلة للطمس.
        Schema::create('pos_case_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('case_id')->constrained('pos_investigation_cases')->cascadeOnDelete();
            $table->uuid('author_id')->nullable();
            $table->string('category', 30)->default('general');
            $table->text('body');
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'case_id', 'created_at'], 'pos_case_notes_timeline_index');
        });

        // مرجع كاميرا — بيانات وصفية فقط، لا فيديو يُخزَّن أو يُرفع. الحذف Soft (SoftDeletes)
        // ومُدقَّق عبر نشاط قضية مقابل؛ لا حذف صلب.
        Schema::create('pos_cctv_bookmarks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('case_id')->constrained('pos_investigation_cases')->cascadeOnDelete();
            $table->foreignUuid('pos_session_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('cart_id')->nullable();
            $table->uuid('correlation_id')->nullable();
            $table->string('camera_label', 120);
            $table->timestamp('timestamp_start');
            $table->timestamp('timestamp_end')->nullable();
            $table->string('source_timezone', 60)->default('UTC');
            $table->string('external_reference', 2048)->nullable();
            $table->text('note')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'case_id'], 'pos_cctv_bookmarks_case_index');
            $table->index(['tenant_id', 'pos_session_id'], 'pos_cctv_bookmarks_session_index');
        });

        // الملخص الرقابي اليومي — صفّ واحد لكل (tenant, تاريخ) يحمل تفصيل الفروع داخل JSON،
        // لا صفّاً لكل فرع (يمنع ازدواج AUR لاستثناءات بلا فرع صريح). CompanyWide (منتج تجميعي
        // كالتقارير)، توليد حتمي idempotent.
        Schema::create('pos_lp_digests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->date('digest_date');
            $table->string('timezone', 60);
            $table->timestamp('period_start');
            $table->timestamp('period_end');
            $table->timestamp('generated_at');
            $table->uuid('generated_by')->nullable();

            $table->unsignedInteger('new_exceptions_count')->default(0);
            $table->unsignedInteger('priority_exceptions_count')->default(0);
            $table->bigInteger('amount_under_review_minor')->default(0);
            $table->unsignedInteger('new_cases_count')->default(0);
            $table->unsignedInteger('unresolved_high_priority_cases_count')->default(0);
            $table->unsignedInteger('confirmed_loss_count')->default(0);
            $table->bigInteger('confirmed_loss_minor')->default(0);
            $table->unsignedInteger('control_failure_count')->default(0);
            $table->unsignedInteger('material_variance_sessions_count')->default(0);

            $table->json('data_sufficiency_caveats')->nullable();
            $table->json('branch_breakdown')->nullable();
            $table->json('payload')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'digest_date'], 'pos_lp_digests_tenant_date_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_lp_digests');
        Schema::dropIfExists('pos_cctv_bookmarks');
        Schema::dropIfExists('pos_case_notes');
        Schema::dropIfExists('pos_case_activities');
        Schema::dropIfExists('pos_case_evidence_links');

        $driver = Schema::getConnection()->getDriverName();
        if (in_array($driver, ['pgsql', 'sqlite'], true)) {
            \Illuminate\Support\Facades\DB::statement('DROP INDEX IF EXISTS pos_cases_tenant_number_no_branch_unique');
        }
        Schema::dropIfExists('pos_investigation_cases');
    }
};
