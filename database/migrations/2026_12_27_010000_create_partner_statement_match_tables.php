<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A2c — نتائج مطابقة كشوف الأطراف (مشتقّة وقابلة لإعادة الحساب، `CompanyWide`). **جدولان إضافيان فقط، بلا مساس بأي جدول قائم ولا بالأستاذ ولا مفتاح أجنبي إلى القيود.**
 *  - `partner_statement_match_runs`: تشغيلة مطابقة لمقارنة (إصدار المحرّك، السياسة والنطاق المنسوخان، بصمة الدفتر، عدّادات). المفتاح الفريد
 *    (المؤسسة، المقارنة، `run_key`) يجعل إعادة التشغيل بنفس (الإصدار + السياسة + النطاق + بصمة الدفتر) تعيد القائمة؛ تغيّر الدفتر يعطي تشغيلة جديدة وتبقى القديمة.
 *  - `partner_statement_matches`: نتيجة لكل سطر كشف (`side=statement`) ولكل وحدة دفترية في الفترة (`side=ledger`) مع القاعدة والتفسير (رموز لا نص) والمرشحين والمقترحات.
 * الربط بالتشغيلة مفتاح أجنبي مركّب (tenant_id, id) فلا يشير صفٌّ إلى تشغيلة مؤسسة أخرى. `down()` يرفض إن وُجد أي صف.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('partner_statement_match_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('reconciliation_id');
            $table->string('engine_version', 16);
            $table->char('run_key', 64);                      // sha256(إصدار المحرّك + السياسة + النطاق + بصمة الدفتر)
            $table->string('status', 16)->default('completed');
            $table->json('policy');                           // نسخة السياسة المجمَّدة وقت التشغيل (P-1..P-5)
            $table->json('scope');                            // نطاق الدفتر الفعلي المقروء (organization | branch | restricted_set)
            $table->char('ledger_fingerprint', 64);
            $table->json('counts');
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'id'], 'partner_stmt_run_tenant_id_unique');
            $table->unique(['tenant_id', 'reconciliation_id', 'run_key'], 'partner_stmt_run_key_unique');
            $table->index(['tenant_id', 'reconciliation_id', 'created_at'], 'partner_stmt_run_recon_idx');
            $table->foreign(['tenant_id', 'reconciliation_id'], 'partner_stmt_run_recon_fk')
                ->references(['tenant_id', 'id'])->on('partner_statement_reconciliations')->cascadeOnDelete();
        });

        Schema::create('partner_statement_matches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('run_id');
            $table->string('side', 12);                       // statement | ledger
            $table->uuid('line_id')->nullable();              // مرجع إلى partner_statement_lines (سطور الكشف فقط)
            $table->unsignedInteger('ordinal')->nullable();   // رقم صف الكشف كما في Excel
            $table->string('outcome', 32);
            $table->string('rule', 8)->nullable();            // R1 | R2 | R3 (مرتبة قوة الدليل لا احتمال)
            $table->string('unit_key', 100)->nullable();      // kind#source_id أو entry#id — مرجع لا مفتاح أجنبي
            $table->bigInteger('difference_minor')->nullable();
            $table->integer('day_difference')->nullable();
            $table->json('explanation');                      // {code, params}
            $table->json('warnings')->nullable();
            $table->json('unit')->nullable();                 // لقطة الوحدة المطابَقة/المرتبطة
            $table->json('candidates')->nullable();           // المرشحون عند الغموض
            $table->json('suggestions')->nullable();          // اقتراحات many-to-one — للمراجعة اليدوية فقط، لا تُطبَّق
            $table->timestamps();

            $table->unique(['tenant_id', 'run_id', 'line_id'], 'partner_stmt_match_line_unique');
            $table->index(['tenant_id', 'run_id', 'side', 'outcome'], 'partner_stmt_match_outcome_idx');
            $table->index(['tenant_id', 'run_id', 'ordinal'], 'partner_stmt_match_ordinal_idx');
            $table->foreign(['tenant_id', 'run_id'], 'partner_stmt_match_run_fk')
                ->references(['tenant_id', 'id'])->on('partner_statement_match_runs')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('partner_statement_match_runs') && DB::table('partner_statement_match_runs')->exists()) {
            throw new RuntimeException('لا يُتراجع عن جداول مطابقة كشوف الأطراف وفيها تشغيلات محفوظة.');
        }
        Schema::dropIfExists('partner_statement_matches');
        Schema::dropIfExists('partner_statement_match_runs');
    }
};
