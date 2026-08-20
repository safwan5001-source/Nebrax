<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * تصنيفات تحليلية مُدارة للعملاء والموردين والمستندات.
     *
     * لا تكتب هذه الهجرة قيداً ولا تعيد ترحيل مستند. التصنيف بعدٌ تحليلي
     * مستقل، أما الأثر المالي فيظل مصدره المستند وLedgerService وحدهما.
     */
    public function up(): void
    {
        Schema::create('classifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('scope'); // customer|supplier|sales_invoice|purchase_invoice|receipt|payment
            $table->string('name');
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'branch_id']);
            $table->index(['tenant_id', 'scope', 'is_active']);
            $table->index(['tenant_id', 'scope', 'name']);
        });

        // SQLite يعيد بناء الجدول كاملاً عند إضافة مفتاح أجنبي. ذلك يعيد قيد
        // الترقيم القديم (tenant_id, number) ويفسد تسلسل الفروع الذي أنشأته
        // هجرة 053؛ لذلك نضيف أعمدة UUID فقط في بيئة الاختبار. التكامل المرجعي
        // محمي أيضاً في الخدمة، بينما PostgreSQL والإنتاج يحتفظان بالـ FK الكامل.
        if (DB::getDriverName() === 'sqlite') {
            // `Schema::table()` يعيد بناء جدول SQLite حتى لإضافة عمود بسيط؛
            // أما ALTER TABLE ... ADD COLUMN فيضيفه في مكانه ويحفظ كل الفهارس.
            DB::statement('ALTER TABLE partners ADD COLUMN customer_classification_id VARCHAR');
            DB::statement('ALTER TABLE partners ADD COLUMN supplier_classification_id VARCHAR');
            DB::statement('ALTER TABLE invoices ADD COLUMN classification_id VARCHAR');
            DB::statement('ALTER TABLE purchases ADD COLUMN classification_id VARCHAR');
            DB::statement('ALTER TABLE payments ADD COLUMN classification_id VARCHAR');
        } else {
            Schema::table('partners', function (Blueprint $table) {
                $table->foreignUuid('customer_classification_id')->nullable()->after('classification')
                    ->constrained('classifications')->nullOnDelete();
                $table->foreignUuid('supplier_classification_id')->nullable()->after('customer_classification_id')
                    ->constrained('classifications')->nullOnDelete();
            });

            Schema::table('invoices', function (Blueprint $table) {
                $table->foreignUuid('classification_id')->nullable()->after('cost_center_id')
                    ->constrained('classifications')->nullOnDelete();
            });

            Schema::table('purchases', function (Blueprint $table) {
                $table->foreignUuid('classification_id')->nullable()->after('cost_center_id')
                    ->constrained('classifications')->nullOnDelete();
            });

            Schema::table('payments', function (Blueprint $table) {
                $table->foreignUuid('classification_id')->nullable()->after('invoice_id')
                    ->constrained('classifications')->nullOnDelete();
            });
        }

        $this->backfillPartnerClassifications();
    }

    /**
     * يترجم التصنيف النصي القائم إلى قائمتين مستقلتين للعميل والمورد.
     * الطرف ذو النوع both يحتفظ بالاسم نفسه في النطاقين كي لا تضيع دلالته
     * عند فتح شاشة العملاء أو الموردين بعد الترقية.
     */
    public function backfillPartnerClassifications(): void
    {
        $partners = DB::table('partners')
            ->select('id', 'tenant_id', 'branch_id', 'type', 'classification')
            ->whereNotNull('classification')
            ->where('classification', '!=', '')
            ->get();

        foreach ($partners as $partner) {
            $name = trim((string) $partner->classification);
            if ($name === '') {
                continue;
            }

            $updates = [];
            foreach ($this->partnerScopes((string) $partner->type) as $scope) {
                $id = $this->findOrCreate((string) $partner->tenant_id, $partner->branch_id, $scope, $name);
                $updates[$scope === 'customer' ? 'customer_classification_id' : 'supplier_classification_id'] = $id;
            }

            if ($updates !== []) {
                DB::table('partners')->where('id', $partner->id)->update($updates);
            }
        }
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('classification_id');
        });
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropConstrainedForeignId('classification_id');
        });
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('classification_id');
        });
        Schema::table('partners', function (Blueprint $table) {
            $table->dropConstrainedForeignId('supplier_classification_id');
            $table->dropConstrainedForeignId('customer_classification_id');
        });
        Schema::dropIfExists('classifications');
    }

    /** @return array<int, string> */
    private function partnerScopes(string $type): array
    {
        return match ($type) {
            'supplier' => ['supplier'],
            'both' => ['customer', 'supplier'],
            default => ['customer'],
        };
    }

    private function findOrCreate(string $tenantId, ?string $branchId, string $scope, string $name): string
    {
        $existing = DB::table('classifications')
            ->where('tenant_id', $tenantId)
            ->where('scope', $scope)
            ->where('name', $name)
            ->value('id');

        if ($existing) {
            return (string) $existing;
        }

        $id = (string) Str::uuid();
        DB::table('classifications')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'branch_id' => $branchId,
            'scope' => $scope,
            'name' => $name,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }
};
