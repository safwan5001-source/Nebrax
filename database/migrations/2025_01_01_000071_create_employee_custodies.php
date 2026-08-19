<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_custodies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // مستند مالي موسوم بالفرع: لا Scope عالمي حتى لا تنكسر تقارير كل الفروع.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number');
            $table->foreignUuid('employee_id')->constrained('employees')->restrictOnDelete();
            $table->foreignUuid('custody_account_id')->constrained('accounts')->restrictOnDelete();
            $table->foreignUuid('cash_account_id')->constrained('accounts')->restrictOnDelete();
            $table->enum('method', ['cash', 'bank'])->default('cash');
            $table->date('custody_date');
            $table->date('due_date')->nullable();
            $table->bigInteger('amount'); // هللات
            $table->enum('status', ['draft', 'posted'])->default('draft');
            $table->text('notes')->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->index(['tenant_id', 'custody_date']);
            $table->index(['tenant_id', 'employee_id']);
            $table->index(['tenant_id', 'status']);
        });

        // NULL لا يتصادم في الفهرس المركب؛ للمستندات التاريخية غير الموسومة بالفرع قيدٌ صريح.
        DB::statement('CREATE UNIQUE INDEX employee_custodies_unbranched_number_unique ON employee_custodies (tenant_id, number) WHERE branch_id IS NULL');

        // يضاف الحساب الجديد صراحةً إلى المستأجرين القائمين؛ لا يُعاد ترتيب أو تعديل حساباتهم الحالية.
        foreach (DB::table('tenants')->select('id')->get() as $tenant) {
            if (DB::table('accounts')->where('tenant_id', $tenant->id)->where('code', '1160')->exists()) {
                continue;
            }

            $currentAssetsId = DB::table('accounts')
                ->where('tenant_id', $tenant->id)
                ->where('code', '11')
                ->value('id');

            if (! $currentAssetsId) {
                continue;
            }

            DB::table('accounts')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenant->id,
                'parent_id' => $currentAssetsId,
                'code' => '1160',
                'name' => 'عُهَد الموظفين',
                'name_en' => 'Employee Custodies',
                'type' => 'asset',
                'normal_balance' => 'debit',
                'is_group' => false,
                'is_system' => true,
                'currency' => 'SAR',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS employee_custodies_unbranched_number_unique');
        Schema::dropIfExists('employee_custodies');
        // حساب 1160 يُبقى عند العكس: قد يكون قد استُخدم في قيود لاحقة ولا يجوز حذفه بلا فحص.
    }
};
