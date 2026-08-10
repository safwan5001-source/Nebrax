<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  الإشعار المدين — نظير الإشعار الدائن على جانب المشتريات
     * ═══════════════════════════════════════════════════════════════
     *  `credit_notes` كان مبنيّاً للعميل حصراً. يكتسب هنا `type` تمييزاً بين
     *  إشعار دائن (للعميل) وإشعار مدين (للمورّد) — نفس نمط `ReturnDocument`.
     *
     *  ويُضاف حساب **5115 مردودات ومسموحات المشتريات** (contra-expense):
     *  الإشعار المدين لا حركة مخزون فيه، فحملُه على 1140 كان يخفض حساب
     *  المراقبة دون أن ينقص أي منتج — فينفصل الدفتر العام عن دفتر المخزون
     *  المساعد صامتاً. الحساب المستقلّ يحفظ المطابقة ويُظهر الخصومات بنداً
     *  مقروءاً في قائمة الدخل.
     */
    public function up(): void
    {
        Schema::table('credit_notes', function (Blueprint $table) {
            // الصفوف القائمة كلها إشعارات دائنة — والافتراضي يحفظ ذلك.
            $table->enum('type', ['sales', 'purchase'])->default('sales')->after('tenant_id');
            $table->foreignUuid('original_purchase_id')->nullable()->after('original_invoice_id')
                ->constrained('purchases')->nullOnDelete();
            $table->index(['tenant_id', 'type']);
        });

        $this->backfillAllowanceAccount();
    }

    /**
     * يضيف 5115 لكل مستأجر قائم لا يملكه — الدليل يُبذَر عند التسجيل فقط،
     * فالمستأجرون السابقون لن يروه بلا هذه التعبئة.
     */
    private function backfillAllowanceAccount(): void
    {
        $parents = DB::table('accounts')->where('code', '5')->get(['id', 'tenant_id']);

        foreach ($parents as $parent) {
            $exists = DB::table('accounts')
                ->where('tenant_id', $parent->tenant_id)->where('code', '5115')->exists();

            if ($exists) {
                continue;
            }

            DB::table('accounts')->insert([
                'id'             => (string) Str::uuid(),
                'tenant_id'      => $parent->tenant_id,
                'parent_id'      => $parent->id,
                'code'           => '5115',
                'name'           => 'مردودات ومسموحات المشتريات',
                'name_en'        => 'Purchase Returns & Allowances',
                'type'           => 'expense',
                'normal_balance' => 'debit', // مصروف مقابل: حركته دائنة فيظهر رصيده سالباً
                'is_group'       => false,
                'is_active'      => true,
                'is_system'      => true,
                'created_at'     => now(),
                'updated_at'     => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('accounts')->where('code', '5115')->delete();

        Schema::table('credit_notes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('original_purchase_id');
            $table->dropColumn('type');
        });
    }
};
