<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * الموجة الأخيرة (P3-ج-٣) — عزل **مشروط** لآخر نموذجين في قائمة الانتظار:
     *
     *  • `partners.branch_id`     → يحكمه **مفتاحان**: العملاء ومفتاحهم، الموردون
     *    ومفتاحهم، و`both` مشترك ما دام أحدهما مفعّلاً (إعفاء جزئي).
     *  • `cost_centers.branch_id` → يحكمه «مشاركة مراكز التكلفة».
     *
     * كلا المفتاحين مفعّل افتراضياً ⇒ لا تصفية إطلاقاً حتى يُطفئهما المستخدم.
     */
    private const TABLES = ['partners', 'cost_centers'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('branch_id')->nullable()
                    ->constrained('branches')->nullOnDelete();
                $table->index(['tenant_id', 'branch_id']);
            });
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
