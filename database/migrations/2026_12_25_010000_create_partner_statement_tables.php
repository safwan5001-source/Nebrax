<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A1 — تجهيز مقارنة كشوف حساب الأطراف (D-PS-03: CompanyWide). **جدولان إضافيان فقط، بلا مساس بأي جدول قائم ولا بالأستاذ.**
 *  - `partner_statement_reconciliations`: رأس مقارنة (طرف · دور · فترة · سياسات مجمَّدة · بصمة الملف). الفريد (المؤسسة، الطرف، الدور، الفترة، بصمة الملف) يجعل
 *    إعادة رفع الملف نفسه تعيد المقارنة القائمة لا تنشئ ثانية.
 *  - `partner_statement_lines`: سطور الكشف كما طُبعت عند الطرف الآخر (مدين/دائن بالهللات)، غير قابلة للتعديل بعد الإنشاء (حارس النموذج). الربط بالرأس مفتاح أجنبي
 *    مركّب (tenant_id, id) فلا يشير سطرٌ إلى رأس مؤسسة أخرى حتى بالخطأ.
 * لا مفتاح أجنبي إلى جداول القيود. `down()` يرفض إن وُجد أي صف (لا حذف صامت لبيانات استُوردت).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('partner_statement_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->string('role', 16);                       // customer | supplier
            $table->date('period_from');
            $table->date('period_to');
            $table->string('currency', 3)->default('SAR');    // D-PS-01: SAR فقط في V1
            $table->string('status', 16)->default('draft');
            $table->string('original_filename', 255)->nullable();
            $table->char('file_sha256', 64);
            $table->foreignUuid('source_import_job_id')->nullable()->constrained('import_jobs')->nullOnDelete();
            $table->unsignedInteger('line_count')->default(0);
            $table->bigInteger('total_debit_minor')->default(0);
            $table->bigInteger('total_credit_minor')->default(0);
            $table->json('policy');                           // السياسات المجمَّدة وقت المعاينة (P-1..P-5)
            $table->json('checks')->nullable();               // فحوص الملف (اتساق الأرصدة المطبوعة، تنبيهات الفترة)
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'id'], 'partner_stmt_recon_tenant_id_unique');
            $table->unique(['tenant_id', 'partner_id', 'role', 'period_from', 'period_to', 'file_sha256'], 'partner_stmt_recon_idem_unique');
            $table->index(['tenant_id', 'partner_id', 'role'], 'partner_stmt_recon_partner_idx');
        });

        Schema::create('partner_statement_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('reconciliation_id');
            $table->unsignedInteger('ordinal');               // رقم الصف في الملف كما في Excel (العناوين صف 1)
            $table->date('line_date');
            $table->string('reference', 100)->nullable();     // رقم مستند الطرف الآخر كما كُتب
            $table->string('reference_key', 100)->nullable(); // المطبَّع للمطابقة لاحقاً (PS-A2)
            $table->string('our_reference', 100)->nullable(); // إحالته إلى رقمٍ عندنا
            $table->string('our_reference_key', 100)->nullable();
            $table->string('description', 500)->nullable();
            $table->bigInteger('debit_minor')->default(0);    // كما طُبع في كشفه
            $table->bigInteger('credit_minor')->default(0);
            $table->bigInteger('balance_minor')->nullable();  // الرصيد الجاري المطبوع — فحص اتساق فقط، لا مدخل للمطابقة
            $table->string('kind', 24)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'reconciliation_id', 'ordinal'], 'partner_stmt_line_unique');
            $table->index(['tenant_id', 'reconciliation_id', 'line_date'], 'partner_stmt_line_date_idx');
            $table->foreign(['tenant_id', 'reconciliation_id'], 'partner_stmt_line_recon_fk')
                ->references(['tenant_id', 'id'])->on('partner_statement_reconciliations')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('partner_statement_reconciliations') && \Illuminate\Support\Facades\DB::table('partner_statement_reconciliations')->exists()) {
            throw new RuntimeException('لا يُتراجع عن جداول كشوف الأطراف وفيها بيانات مستوردة.');
        }
        Schema::dropIfExists('partner_statement_lines');
        Schema::dropIfExists('partner_statement_reconciliations');
    }
};
