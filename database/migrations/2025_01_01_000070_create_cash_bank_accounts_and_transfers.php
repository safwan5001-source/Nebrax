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
        Schema::create('cash_bank_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // ربط واحد-لواحد بحساب الأستاذ: الرصيد لا يُخزن على الكيان نفسه.
            $table->foreignUuid('account_id')->constrained('accounts')->restrictOnDelete();
            $table->enum('type', ['cash', 'bank']);
            $table->string('name');
            $table->string('bank_name')->nullable();
            $table->string('account_number')->nullable();
            $table->string('currency', 3)->default('SAR');
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('is_main')->default(false);
            // نطاق فعل الإيداع/السحب: all | role | user | branch.
            $table->enum('deposit_scope', ['all', 'role', 'user', 'branch'])->default('all');
            $table->string('deposit_scope_subject')->nullable();
            $table->enum('withdraw_scope', ['all', 'role', 'user', 'branch'])->default('all');
            $table->string('withdraw_scope_subject')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'account_id']);
            $table->index(['tenant_id', 'type', 'is_active']);
            $table->index(['tenant_id', 'type', 'account_number']);
        });

        // خزانة رئيسية واحدة وحساب بنكي رئيسي واحد لكل مؤسسة ونوع.
        DB::statement('CREATE UNIQUE INDEX cash_bank_accounts_one_main_per_type ON cash_bank_accounts (tenant_id, type) WHERE is_main = true');

        Schema::create('cash_bank_transfers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number');
            $table->foreignUuid('source_cash_bank_account_id')->constrained('cash_bank_accounts')->restrictOnDelete();
            $table->foreignUuid('destination_cash_bank_account_id')->constrained('cash_bank_accounts')->restrictOnDelete();
            $table->bigInteger('amount'); // هللات
            $table->string('currency', 3)->default('SAR');
            $table->date('transfer_date');
            $table->string('reference')->nullable();
            $table->text('notes')->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->index(['tenant_id', 'transfer_date']);
            $table->index(['tenant_id', 'source_cash_bank_account_id']);
            $table->index(['tenant_id', 'destination_cash_bank_account_id']);
        });

        // NULL لا يساوي NULL في الفهرس المركب؛ السلسلة غير الموزعة تحتاج قيداً صريحاً.
        DB::statement('CREATE UNIQUE INDEX cash_bank_transfers_unbranched_number_unique ON cash_bank_transfers (tenant_id, number) WHERE branch_id IS NULL');

        // الشركات القائمة: لا نغيّر 1110/1120 أو تاريخها، بل نكشفهما كافتراضين للوحدة.
        foreach (DB::table('tenants')->select('id')->get() as $tenant) {
            $currentAssetsId = DB::table('accounts')
                ->where('tenant_id', $tenant->id)
                ->where('code', '11')
                ->value('id');

            foreach ([
                ['code' => '111', 'name' => 'الخزائن', 'name_en' => 'Cash Treasuries'],
                ['code' => '112', 'name' => 'الحسابات البنكية', 'name_en' => 'Bank Accounts'],
            ] as $group) {
                if ($currentAssetsId && ! DB::table('accounts')->where('tenant_id', $tenant->id)->where('code', $group['code'])->exists()) {
                    DB::table('accounts')->insert([
                        'id' => (string) Str::uuid(), 'tenant_id' => $tenant->id, 'parent_id' => $currentAssetsId,
                        'code' => $group['code'], 'name' => $group['name'], 'name_en' => $group['name_en'],
                        'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => true, 'is_system' => true,
                        'currency' => 'SAR', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                    ]);
                }
            }

            // كل حساب نهائي قائم من عائلة 111x أو 112x يصبح كياناً ظاهراً للوحدة،
            // ما يحفظ اختيار المستخدمين للخزائن المخصصة قبل إطلاق الشاشة.
            foreach (DB::table('accounts')->where('tenant_id', $tenant->id)->where('is_group', false)->orderBy('code')->get() as $account) {
                $type = str_starts_with($account->code, '111') ? 'cash' : (str_starts_with($account->code, '112') ? 'bank' : null);
                if ($type === null || DB::table('cash_bank_accounts')->where('account_id', $account->id)->exists()) {
                    continue;
                }

                $isLegacyDefault = in_array($account->code, ['1110', '1120'], true);
                DB::table('cash_bank_accounts')->insert([
                    'id' => (string) Str::uuid(), 'tenant_id' => $tenant->id, 'account_id' => $account->id,
                    'type' => $type,
                    'name' => $isLegacyDefault ? ($type === 'cash' ? 'الخزينة الافتراضية' : 'الحساب البنكي الافتراضي') : $account->name,
                    'currency' => $account->currency, 'is_active' => $account->is_active,
                    'is_main' => $isLegacyDefault && ! DB::table('cash_bank_accounts')->where('tenant_id', $tenant->id)->where('type', $type)->where('is_main', true)->exists(),
                    'deposit_scope' => 'all', 'withdraw_scope' => 'all',
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS cash_bank_transfers_unbranched_number_unique');
        Schema::dropIfExists('cash_bank_transfers');
        DB::statement('DROP INDEX IF EXISTS cash_bank_accounts_one_main_per_type');
        Schema::dropIfExists('cash_bank_accounts');
        // مجموعتا 111 و112 تبقيان في الدليل إذا نُفذت الهجرة عكسياً بعد استخدامها؛
        // لا تحذف هجرة down حسابات نظامية قد تملك مراجع لاحقة.
    }
};
