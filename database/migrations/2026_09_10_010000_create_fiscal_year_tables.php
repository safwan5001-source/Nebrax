<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // FISCAL-2: السنة المالية كياناً واحداً على مستوى المؤسسة (CompanyWide).
        // **لا صفوف فترات شهرية**: تقسيم السنة إلى اثنتي عشرة فترة لا يخدم أي
        // قرار في V1 ويضاعف حالات الحياة بلا مقابل. والحدّان شاملان، فتُدعم
        // السنة غير التقويمية (تبدأ في أي يوم) بلا حالة خاصة.
        Schema::create('fiscal_years', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->date('start_date');
            $table->date('end_date');
            // open | closing | closed | reopening
            // `closing`/`reopening` حالتان انتقاليتان داخل المعاملة نفسها: صفٌّ
            // عالقٌ فيهما (انهيار عملية) يمنع إقفالاً/فتحاً موازياً حتى يُحسم،
            // بدل أن يمرّ بصمت.
            $table->string('status')->default('open');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'start_date', 'end_date']);
        });

        // جيل إقفال: كل إقفال يُنشئ جيلاً جديداً، والفتح يعكسه ويُبقيه. لا حذف
        // فعلي إطلاقاً — إعادة الإقفال بعد الفتح لا تعيد استعمال جيلٍ سابق ولا
        // تمحوه، فيبقى التاريخ المحاسبي كاملاً قابلاً للتدقيق.
        Schema::create('fiscal_year_closes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fiscal_year_id')->constrained('fiscal_years')->cascadeOnDelete();
            $table->unsignedInteger('generation');
            $table->string('status')->default('active'); // active | reversed

            // `null` = سنة بلا نشاط: أُقفلت فعلاً بلا قيدٍ لأن لا رصيد يُقفل.
            // تمييزُها عن سنةٍ لم تُقفل يأتي من حالة السنة + وجود هذا الجيل.
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('reversal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();

            // لقطة الأرقام وقت الإقفال (هللات) — تُقرأ بعد سنوات كما حُسبت.
            $table->bigInteger('total_revenue')->default(0);
            $table->bigInteger('total_expense')->default(0);
            $table->bigInteger('net_income')->default(0);
            // الحساب **الفعلي** الذي استُعمل، لا الدور: التعيين قد يتغيّر لاحقاً
            // ولا يجوز أن يغيّر قراءة ما حدث.
            $table->uuid('retained_earnings_account_id')->nullable();

            $table->foreignUuid('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('closed_at')->nullable();
            $table->foreignUuid('reopened_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reopened_at')->nullable();
            $table->text('reopen_reason')->nullable();
            $table->timestamps();

            $table->unique(['fiscal_year_id', 'generation']);
            $table->index(['tenant_id', 'fiscal_year_id', 'status']);
        });

        // سجل تدقيق ثابت: لا يُحدَّث ولا يُحذف بعد الإنشاء (نمط ACC-2/ACC-6).
        // المعرّفات لقطاتٌ بلا FK كي يبقى السجل مقروءاً مهما تغيّر ما يشير إليه.
        Schema::create('fiscal_year_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('fiscal_year_id');
            $table->uuid('fiscal_year_close_id')->nullable();
            // year_created | year_updated | year_closed | year_reopened
            $table->string('action');
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedInteger('generation')->nullable();
            $table->uuid('journal_entry_id')->nullable();
            $table->text('reason')->nullable();
            $table->json('details')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'fiscal_year_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_year_events');
        Schema::dropIfExists('fiscal_year_closes');
        Schema::dropIfExists('fiscal_years');
    }
};
