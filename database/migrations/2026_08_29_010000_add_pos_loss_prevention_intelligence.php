<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 2 — طبقة الذكاء الرقابي المشتقّة فوق أدلة Phase 1 (append-only).
 *
 * لا تلمس هذه الهجرة `pos_session_events` ولا أي جدول مالي: الاستثناءات والدرجات
 * سجلّات مشتقّة **تشير** إلى معرّفات الأحداث الثابتة ولا تعدّلها. لا قيود خارجية
 * على معرّفات الأحداث المرجعية (تُخزَّن في JSON) كي يبقى الدليل الأصلي غير قابل
 * للتغيير مهما حُذف استثناء مشتقّ.
 */
return new class extends Migration
{
    public function up(): void
    {
        // كتالوج قواعد الكشف — إعداد مشترك للمؤسسة (CompanyWide). لكل تعديل
        // على قاعدة يرتفع `version`، وتحفظ الاستثناءات لقطة الإصدار وقت الكشف
        // كي تبقى مفسَّرة تاريخياً بعد تغيير الإعداد.
        Schema::create('pos_exception_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('rule_key', 80);
            $table->string('category', 40);
            $table->boolean('is_enabled')->default(true);
            // وزن القاعدة في الدرجة (نقاط قصوى تسهم بها)، والحد الأدنى للعينة،
            // والنافذة، والعتبة — كلها بالهللات/الأعداد الصحيحة، بلا float.
            $table->unsignedSmallInteger('weight')->default(10);
            $table->unsignedInteger('min_sample')->default(0);
            $table->unsignedSmallInteger('window_days')->default(30);
            // عتبة نسبة التجاوز فوق خط الأساس (بالنقاط المئوية ×100 لتفادي float):
            // 150 يعني «يتجاوز خط الأساس بنسبة 50%». الثابت الافتراضي في الكتالوج.
            $table->unsignedInteger('threshold')->default(150);
            $table->unsignedInteger('version')->default(1);
            $table->json('config')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'rule_key'], 'pos_exception_rules_tenant_key_unique');
            $table->index(['tenant_id', 'category'], 'pos_exception_rules_category_index');
        });

        // الاستثناءات المشتقّة — بيانات تشغيلية معزولة بالفرع (BranchScoped).
        Schema::create('pos_exceptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->string('rule_key', 80);
            $table->string('category', 40);
            $table->unsignedInteger('rule_version')->default(1);
            // لقطة إعداد القاعدة وقت الكشف — تُجمّد التفسير التاريخي.
            $table->json('rule_snapshot')->nullable();

            // الموضوع والمراجع (كلها اختيارية بحسب القاعدة).
            $table->uuid('subject_user_id')->nullable();
            $table->foreignUuid('pos_session_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('cart_id')->nullable();
            $table->uuid('performed_by')->nullable();
            $table->uuid('approved_by')->nullable();

            $table->timestamp('window_start')->nullable();
            $table->timestamp('window_end')->nullable();

            // المقاييس: العدد المرصود، خط الأساس، المعدّل المطبّع (×1000 كعدد
            // صحيح لتفادي float)، حجم العينة، ونوع خط الأساس المستخدم.
            $table->unsignedInteger('observed_count')->default(0);
            $table->unsignedBigInteger('denominator')->default(0);
            $table->integer('observed_rate_milli')->default(0);
            $table->integer('baseline_rate_milli')->nullable();
            $table->string('baseline_type', 20)->default('static');
            $table->unsignedInteger('sample_size')->default(0);

            // الشدّة والدرجة والمبلغ قيد المراجعة (بالهللات).
            $table->string('severity', 20)->default('watch');
            $table->unsignedSmallInteger('risk_contribution')->default(0);
            $table->bigInteger('amount_under_review')->default(0);

            // ثقة الدليل مشتقّة من مصدر الأدلة (server/client_observed).
            $table->string('evidence_confidence', 30)->default('server_authoritative');
            // مفتاح إزالة التكرار (idempotency): نفس القاعدة/الموضوع/النافذة =
            // صف واحد يُحدَّث لا يتكرر عند إعادة الكشف.
            $table->string('dedup_key', 191);
            // معرّفات أحداث الأدلة، ومعرّفات الأحداث الحاملة للمبلغ (لإزالة
            // ازدواج المبلغ قيد المراجعة عبر القواعد المتداخلة).
            $table->json('evidence_event_ids')->nullable();
            $table->json('amount_event_ids')->nullable();
            $table->json('explanation')->nullable();

            $table->timestamp('detected_at');
            // دورة المراجعة الخفيفة.
            $table->string('review_state', 30)->default('new');
            $table->uuid('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->string('review_reason', 80)->nullable();
            $table->text('review_note')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'dedup_key'], 'pos_exceptions_dedup_unique');
            $table->index(['tenant_id', 'branch_id', 'detected_at'], 'pos_exceptions_timeline_index');
            $table->index(['tenant_id', 'branch_id', 'review_state', 'severity'], 'pos_exceptions_review_index');
            $table->index(['tenant_id', 'subject_user_id', 'detected_at'], 'pos_exceptions_subject_index');
            $table->index(['tenant_id', 'rule_key', 'detected_at'], 'pos_exceptions_rule_index');
            $table->index(['tenant_id', 'category', 'detected_at'], 'pos_exceptions_category_index');
            $table->index(['tenant_id', 'pos_session_id'], 'pos_exceptions_session_index');
            $table->index(['tenant_id', 'performed_by', 'approved_by'], 'pos_exceptions_pair_index');
        });

        // سجلّ إجراءات المراجعة — append-only، لا يُعدَّل ولا يُحذف. لا يمسّ
        // الدليل الأصلي؛ يوثّق فقط انتقالات حالة الاستثناء المشتقّ.
        Schema::create('pos_exception_reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_exception_id')->constrained('pos_exceptions')->cascadeOnDelete();
            $table->string('from_state', 30)->nullable();
            $table->string('to_state', 30);
            $table->uuid('reviewed_by')->nullable();
            $table->string('reason', 80)->nullable();
            $table->text('note')->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'pos_exception_id', 'created_at'], 'pos_exception_reviews_timeline_index');
        });

        // لقطة درجة المخاطرة لكل موضوع (مستخدم) ضمن فرع/نافذة — تُحدَّث (upsert)
        // عند كل كشف فتبقى القراءة idempotent. مشتقّة بالكامل من الاستثناءات.
        Schema::create('pos_risk_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->string('scope', 20)->default('user');
            $table->uuid('subject_user_id')->nullable();
            $table->timestamp('window_start')->nullable();
            $table->timestamp('window_end')->nullable();
            $table->unsignedSmallInteger('total_score')->default(0);
            $table->string('band', 30)->default('normal');
            $table->unsignedInteger('exception_count')->default(0);
            $table->bigInteger('amount_under_review')->default(0);
            $table->unsignedInteger('sample_size')->default(0);
            $table->boolean('sample_sufficient')->default(false);
            // مساهمة كل فئة (نقاط)، وسائقو الدرجة، وأساس المقارنة — للعرض المفسَّر.
            $table->json('components')->nullable();
            $table->timestamp('calculated_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'scope', 'subject_user_id'], 'pos_risk_snapshots_subject_unique');
            $table->index(['tenant_id', 'branch_id', 'total_score'], 'pos_risk_snapshots_score_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_risk_snapshots');
        Schema::dropIfExists('pos_exception_reviews');
        Schema::dropIfExists('pos_exceptions');
        Schema::dropIfExists('pos_exception_rules');
    }
};
