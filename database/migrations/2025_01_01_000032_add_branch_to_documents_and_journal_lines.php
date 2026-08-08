<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** المستندات التي تُوسم بالفرع (رؤوس المستندات فقط — السطور تتبع رأسها). */
    private const DOCUMENTS = [
        'invoices', 'purchases', 'payments', 'quotes',
        'credit_notes', 'return_documents', 'expenses', 'pos_sessions',
    ];

    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // بُعد الفرع (Branch dimension) — وسم اختياري كمركز التكلفة تماماً.
        // كل الأعمدة nullable بقيمة null للصفوف القائمة (إضافة غير كاسرة)،
        // ولا يوجد Global Scope للفرع: التصفية صريحة في التقارير فقط، حتى
        // يبقى ميزان المراجعة المجمّع شاملاً كل القيود.
        // ═══════════════════════════════════════════════════════
        Schema::table('journal_lines', function (Blueprint $table) {
            $table->foreignUuid('branch_id')->nullable()->after('cost_center_id')
                ->constrained('branches')->nullOnDelete();
            $table->index(['tenant_id', 'branch_id']);
        });

        foreach (self::DOCUMENTS as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('branch_id')->nullable()
                    ->constrained('branches')->nullOnDelete();
                $table->index(['tenant_id', 'branch_id']);
            });
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::DOCUMENTS) as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('branch_id');
            });
        }

        Schema::table('journal_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
