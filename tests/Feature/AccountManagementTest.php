<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\JournalEntry;
use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class AccountManagementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function expenseGroupId(string $tenantId): string
    {
        app(TenantContext::class)->set($tenantId);

        return Account::where('code', '5')->firstOrFail()->id;
    }

    private function createCustomAccount(string $token, string $tenantId, array $overrides = []): array
    {
        $payload = array_merge([
            'code'      => '5190',
            'name'      => 'مصروف اختبار قابل للمراجعة',
            'name_en'   => 'Reviewable Test Expense',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($tenantId),
            'is_group'  => false,
            'is_active' => true,
        ], $overrides);

        return $this->withToken($token)->postJson('/api/accounts', $payload)->assertCreated()['data'];
    }

    /** @test */
    public function owner_creates_a_custom_account_under_a_matching_active_group(): void
    {
        $auth = $this->registerTenant();
        $account = $this->createCustomAccount($auth['token'], $auth['tenant_id']);

        $this->assertSame('5190', $account['code']);
        $this->assertSame('expense', $account['type']);
        $this->assertSame('debit', $account['normal_balance']);
        $this->assertFalse($account['is_system']);
        $this->assertTrue($account['is_active']);
        $this->assertSame('0.00', $account['balance']);

        $this->withToken($auth['token'])->getJson('/api/accounts')
            ->assertOk()
            ->assertJsonFragment([
                'id'        => $account['id'],
                'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            ]);
    }

    /** @test */
    public function owner_can_create_a_custom_root_group_without_an_accounting_entry(): void
    {
        $auth = $this->registerTenant();

        $account = $this->withToken($auth['token'])->postJson('/api/accounts', [
            'code' => '6',
            'name' => 'تصنيف جذري مخصص',
            'type' => 'expense',
            'parent_id' => null,
            'is_group' => true,
            'is_active' => true,
        ])->assertCreated()['data'];

        $this->assertNull($account['parent_id']);
        $this->assertTrue($account['is_group']);
        $this->assertSame('debit', $account['normal_balance']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function duplicate_codes_and_invalid_parents_are_rejected(): void
    {
        $auth = $this->registerTenant();
        $this->createCustomAccount($auth['token'], $auth['tenant_id']);

        $this->withToken($auth['token'])->postJson('/api/accounts', [
            'code'      => '5190',
            'name'      => 'رمز مكرر',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            'is_group'  => false,
        ])->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $liabilities = Account::where('code', '2')->firstOrFail();

        $this->withToken($auth['token'])->postJson('/api/accounts', [
            'code'      => '5191',
            'name'      => 'أب بطبيعة مخالفة',
            'type'      => 'expense',
            'parent_id' => $liabilities->id,
            'is_group'  => false,
        ])->assertStatus(422);

        $leaf = Account::where('code', '5130')->firstOrFail();
        $this->withToken($auth['token'])->postJson('/api/accounts', [
            'code'      => '5192',
            'name'      => 'أب غير تجميعي',
            'type'      => 'expense',
            'parent_id' => $leaf->id,
            'is_group'  => false,
        ])->assertStatus(422);
    }

    /** @test */
    public function system_accounts_are_not_editable(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $system = Account::where('code', '5110')->firstOrFail();

        $this->withToken($auth['token'])->putJson("/api/accounts/{$system->id}", [
            'code'      => '5110',
            'name'      => 'اسم لا يجب أن يتغير',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            'is_group'  => false,
            'is_active' => true,
        ])->assertStatus(422);

        $this->assertSame('تكلفة البضاعة المباعة', $system->fresh()->name);
    }

    /** @test */
    public function an_account_with_history_keeps_its_code_type_and_parent_but_may_be_renamed_or_deactivated(): void
    {
        $auth = $this->registerTenant();
        $account = $this->createCustomAccount($auth['token'], $auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $cash = Account::where('code', '1110')->firstOrFail();
        app(LedgerService::class)->post([
            ['account_id' => $cash->id, 'debit' => 2500],
            ['account_id' => $account['id'], 'credit' => 2500],
        ], ['description' => 'حركة اختبار حساب مخصص']);

        $this->withToken($auth['token'])->putJson("/api/accounts/{$account['id']}", [
            'code'      => '5191',
            'name'      => 'محاولة تغيير كود تاريخي',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            'is_group'  => false,
            'is_active' => true,
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/accounts/{$account['id']}", [
            'code'      => '5190',
            'name'      => 'مصروف اختبار معتمد',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            'is_group'  => false,
            'is_active' => false,
        ])->assertOk()
            ->assertJsonPath('data.name', 'مصروف اختبار معتمد')
            ->assertJsonPath('data.is_active', false);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير مفعّل');
        app(LedgerService::class)->post([
            ['account_id' => $cash->id, 'debit' => 1000],
            ['account_id' => $account['id'], 'credit' => 1000],
        ]);
    }

    /** @test */
    public function a_group_with_active_children_cannot_be_deactivated_and_an_accountant_cannot_manage_accounts(): void
    {
        $auth = $this->registerTenant();
        $group = $this->createCustomAccount($auth['token'], $auth['tenant_id'], [
            'code'     => '5190',
            'name'     => 'مجموعة اختبار',
            'is_group' => true,
        ]);
        $this->createCustomAccount($auth['token'], $auth['tenant_id'], [
            'code'      => '5191',
            'name'      => 'فرع اختبار',
            'parent_id' => $group['id'],
        ]);

        $this->withToken($auth['token'])->putJson("/api/accounts/{$group['id']}", [
            'code'      => '5190',
            'name'      => 'مجموعة اختبار',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            'is_group'  => true,
            'is_active' => false,
        ])->assertStatus(422);

        $accountantToken = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');
        $this->withToken($accountantToken)->postJson('/api/accounts', [
            'code'      => '5192',
            'name'      => 'محاولة بلا صلاحية',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($auth['tenant_id']),
            'is_group'  => false,
        ])->assertForbidden();
    }

    /** @test */
    public function account_workspace_aggregates_descendants_and_filters_balances_by_branch(): void
    {
        $auth = $this->registerTenant();
        $group = $this->createCustomAccount($auth['token'], $auth['tenant_id'], [
            'code' => '5190',
            'name' => 'مجموعة مصروفات الاختبار',
            'is_group' => true,
        ]);
        $child = $this->createCustomAccount($auth['token'], $auth['tenant_id'], [
            'code' => '519001',
            'name' => 'مصروف اختبار فرعي',
            'parent_id' => $group['id'],
        ]);

        $secondBranch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع اختبار ثان'])
            ->assertCreated()['data'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $mainBranch = Branch::where('is_main', true)->firstOrFail();
        $cash = Account::where('code', '1110')->firstOrFail();

        app(LedgerService::class)->post([
            ['account_id' => $child['id'], 'debit' => 1200],
            ['account_id' => $cash->id, 'credit' => 1200],
        ], ['description' => 'حركة فرع رئيسي', 'branch_id' => $mainBranch->id]);
        app(LedgerService::class)->post([
            ['account_id' => $child['id'], 'debit' => 3400],
            ['account_id' => $cash->id, 'credit' => 3400],
        ], ['description' => 'حركة فرع ثان', 'branch_id' => $secondBranch['id']]);

        $all = $this->withToken($auth['token'])->getJson('/api/accounts/workspace')->assertOk()['data'];
        $allGroup = collect($all)->firstWhere('id', $group['id']);
        $this->assertSame('46.00', $allGroup['balance']);
        $this->assertSame('0.00', $allGroup['direct_balance']);
        $this->assertSame('46.00', $allGroup['aggregated_balance']);
        $this->assertSame(1, $allGroup['children_count']);

        $main = $this->withToken($auth['token'])
            ->getJson("/api/accounts/workspace?branch_id={$mainBranch->id}")
            ->assertOk()['data'];
        $mainGroup = collect($main)->firstWhere('id', $group['id']);
        $this->assertSame('12.00', $mainGroup['balance']);

        $second = $this->withToken($auth['token'])
            ->getJson("/api/accounts/workspace?branch_id={$secondBranch['id']}")
            ->assertOk()['data'];
        $secondGroup = collect($second)->firstWhere('id', $group['id']);
        $this->assertSame('34.00', $secondGroup['balance']);
    }

    /** @test */
    public function code_suggestion_uses_existing_numeric_siblings_and_cross_tenant_parent_is_rejected(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $group = $this->createCustomAccount($a['token'], $a['tenant_id'], [
            'code' => '5190',
            'name' => 'مجموعة اقتراح الكود',
            'is_group' => true,
        ]);
        $this->createCustomAccount($a['token'], $a['tenant_id'], [
            'code' => '519001',
            'parent_id' => $group['id'],
        ]);
        $this->createCustomAccount($a['token'], $a['tenant_id'], [
            'code' => '519003',
            'parent_id' => $group['id'],
        ]);

        $this->withToken($a['token'])
            ->getJson("/api/accounts/code-suggestion?type=expense&parent_id={$group['id']}")
            ->assertOk()
            ->assertJsonPath('data.code', '519004');

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->postJson('/api/accounts', [
            'code' => '5190',
            'name' => 'محاولة أب أجنبي',
            'type' => 'expense',
            'parent_id' => $group['id'],
            'is_group' => false,
        ])->assertStatus(422);
    }

    /** @test */
    public function account_deletion_is_protected_for_children_and_financial_history(): void
    {
        $auth = $this->registerTenant();
        $group = $this->createCustomAccount($auth['token'], $auth['tenant_id'], [
            'code' => '5190',
            'name' => 'مجموعة حماية الحذف',
            'is_group' => true,
        ]);
        $child = $this->createCustomAccount($auth['token'], $auth['tenant_id'], [
            'code' => '519001',
            'parent_id' => $group['id'],
        ]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $groupModel = Account::findOrFail($group['id']);
        try {
            $groupModel->delete();
            $this->fail('يجب منع حذف الحساب الذي لديه أبناء.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('حسابات فرعية', $exception->getMessage());
        }

        $cash = Account::where('code', '1110')->firstOrFail();
        app(LedgerService::class)->post([
            ['account_id' => $child['id'], 'debit' => 500],
            ['account_id' => $cash->id, 'credit' => 500],
        ], ['description' => 'حركة لاختبار حماية الحذف']);

        try {
            Account::findOrFail($child['id'])->delete();
            $this->fail('يجب منع حذف الحساب ذي الحركات المالية.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('حركات مالية', $exception->getMessage());
        }

        $this->withToken($auth['token'])->deleteJson("/api/accounts/{$child['id']}")
            ->assertStatus(405);
    }

    /** @test */
    public function accounts_remain_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $account = $this->createCustomAccount($a['token'], $a['tenant_id']);

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->putJson("/api/accounts/{$account['id']}", [
            'code'      => '5190',
            'name'      => 'اختراق',
            'type'      => 'expense',
            'parent_id' => $this->expenseGroupId($b['tenant_id']),
            'is_group'  => false,
            'is_active' => true,
        ])->assertNotFound();
    }
}
