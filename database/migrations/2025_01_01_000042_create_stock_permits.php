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
     *  الأذون المخزنية — إضافة · صرف · تحويل
     * ═══════════════════════════════════════════════════════════════
     *  أول وحدة تمسّ حساب المراقبة **1140** بلا فاتورة شراء ولا بيع: بضاعة
     *  تدخل أو تخرج لأسباب تشغيلية (تلف، استهلاك داخلي، عيّنات، بضاعة وُجدت).
     *
     *  ويُضاف حساب **5180 فروق الجرد والتلف** — الطرف المقابل في الاتجاهين:
     *  العجز يُدينه والزيادة تُدَيِّنه دائناً، فيظهر صافي الفروق بنداً واحداً
     *  مقروءاً في قائمة الدخل.
     *
     *  **لماذا لا 5110 تكلفة البضاعة المباعة:** لأن بضاعةً تالفة لم تُبَع.
     *  خلطُها بالتكلفة يُفسد هامش الربح الإجمالي — وهو أهمّ نسبة في قائمة
     *  الدخل — ويجعل مطابقة 5110 مع المبيعات مستحيلة. نفس منطق 5115 للإشعار
     *  المدين: حسابٌ مستقلّ يحفظ صلاحية ما حوله.
     */
    public function up(): void
    {
        Schema::create('stock_permits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // receipt إذن إضافة · issue إذن صرف · transfer إذن تحويل بين مخزنين
            $table->enum('type', ['receipt', 'issue', 'transfer']);
            $table->string('number');                                   // SR/SI/ST-2026-00001

            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            // مخزن الوجهة — للتحويل وحده.
            $table->foreignUuid('target_warehouse_id')->nullable()
                ->constrained('warehouses')->restrictOnDelete();

            $table->date('permit_date');
            $table->enum('status', ['draft', 'posted'])->default('draft');
            $table->string('reason')->nullable();                       // تلف · استهلاك داخلي · عيّنات…
            $table->string('notes')->nullable();

            // قيمة الحركة بالهللات — تُحسب عند الترحيل من متوسط التكلفة.
            $table->bigInteger('total_cost')->default(0);

            $table->foreignUuid('journal_entry_id')->nullable()
                ->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'type', 'status']);
            $table->index(['tenant_id', 'warehouse_id']);
        });

        Schema::create('stock_permit_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('stock_permit_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->restrictOnDelete();
            $table->integer('quantity');
            // تكلفة الوحدة: مُدخَلة في إذن الإضافة، ومحسوبة من المتوسط في الصرف
            // والتحويل — فلا يختار المستخدم تكلفةَ ما يُخرِجه.
            $table->bigInteger('unit_cost')->default(0);
            $table->bigInteger('line_cost')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'stock_permit_id']);
        });

        $this->backfillAdjustmentAccount();
    }

    /**
     * يضيف 5180 لكل مستأجر قائم لا يملكه — الدليل يُبذَر عند التسجيل فقط،
     * فالمستأجرون السابقون لن يروه بلا هذه التعبئة (كما في 5115).
     */
    private function backfillAdjustmentAccount(): void
    {
        foreach (DB::table('accounts')->where('code', '5')->get(['id', 'tenant_id']) as $parent) {
            $exists = DB::table('accounts')
                ->where('tenant_id', $parent->tenant_id)->where('code', '5180')->exists();

            if ($exists) {
                continue;
            }

            DB::table('accounts')->insert([
                'id'             => (string) Str::uuid(),
                'tenant_id'      => $parent->tenant_id,
                'parent_id'      => $parent->id,
                'code'           => '5180',
                'name'           => 'فروق الجرد والتلف',
                'name_en'        => 'Inventory Adjustments',
                'type'           => 'expense',
                'normal_balance' => 'debit', // العجز يزيده والزيادة تنقصه
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
        Schema::dropIfExists('stock_permit_lines');
        Schema::dropIfExists('stock_permits');
        DB::table('accounts')->where('code', '5180')->delete();
    }
};
