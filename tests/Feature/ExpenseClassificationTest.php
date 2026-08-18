<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\ExpenseAttachment;
use App\Models\ExpenseCategory;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * تصنيفات ومرفقات المصروفات: التصنيف تسمية تحليلية لا يبدّل قيد المصروف،
 * والمرفق إثبات خاص بالمستند لا مسار يفرضه العميل.
 */
class ExpenseClassificationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function expenseAccountId(string $tenantId): string
    {
        app(TenantContext::class)->set($tenantId);

        return Account::where('code', '5130')->firstOrFail()->id;
    }

    private function category(string $token, string $name = 'إيجار', array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/expense-categories', array_merge([
            'name' => $name,
            'description' => 'مصروفات دورية للمقر',
        ], $extra))->assertCreated()['data'];
    }

    /** التصنيف يحمل الاسم والوصف ولا يسمح بالتكرار في نطاق الفرع المرئي. */
    /** @test */
    public function expense_categories_are_managed_by_name_and_description(): void
    {
        $auth = $this->registerTenant();
        $category = $this->category($auth['token']);

        $this->assertSame('إيجار', $category['name']);
        $this->assertSame('مصروفات دورية للمقر', $category['description']);
        $this->assertTrue($category['is_active']);

        $this->withToken($auth['token'])
            ->postJson('/api/expense-categories', ['name' => 'إيجار'])
            ->assertStatus(422);
    }

    /** التصنيف يُحفظ في المستند، ويبقى حساب المصروف هو الحساب المرسل للترحيل. */
    /** @test */
    public function an_expense_links_to_its_category_without_changing_its_account(): void
    {
        $auth = $this->registerTenant();
        $category = $this->category($auth['token'], 'مرافق');
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $expense = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId,
            'category_id' => $category['id'],
            'vendor_name' => 'شركة الكهرباء',
            'amount' => 100000,
            'tax_rate' => 15,
        ])->assertCreated()['data'];

        $this->assertSame($category['id'], $expense['category_id']);
        $this->assertSame('مرافق', $expense['category_name']);
        $this->assertSame('شركة الكهرباء', $expense['vendor_name']);
        $this->assertSame($accountId, $expense['account_id']);
    }

    /** التصنيف المعطّل حقيقة ظاهرة في الواجهة ولا يقبل الخادم استعماله في مستند جديد. */
    /** @test */
    public function an_inactive_expense_category_cannot_be_used_for_a_new_expense(): void
    {
        $auth = $this->registerTenant();
        $category = $this->category($auth['token'], 'موقوف', ['is_active' => false]);
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId,
            'category_id' => $category['id'],
            'amount' => 100000,
        ])->assertStatus(422);
    }

    /** الحذف لا يمحو تصنيفاً تستند إليه مستندات قائمة. */
    /** @test */
    public function an_expense_category_in_use_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $category = $this->category($auth['token']);
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId,
            'category_id' => $category['id'],
            'amount' => 100000,
        ])->assertCreated();

        $this->withToken($auth['token'])
            ->deleteJson("/api/expense-categories/{$category['id']}")
            ->assertStatus(422);
    }

    /** الملفات تصل كمرفقات فعلية وتُخزَّن في مسار خاص مشتق من المستند لا من العميل. */
    /** @test */
    public function expense_attachments_are_stored_with_the_expense(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $expense = $this->withToken($auth['token'])->post('/api/expenses', [
            'account_id' => $accountId,
            'amount' => 100000,
            'attachments' => [UploadedFile::fake()->create('receipt.pdf', 120, 'application/pdf')],
        ], ['Accept' => 'application/json'])->assertCreated()['data'];

        app(TenantContext::class)->set($auth['tenant_id']);
        $attachment = ExpenseAttachment::where('expense_id', $expense['id'])->firstOrFail();

        Storage::disk('local')->assertExists($attachment->path);
        $this->assertSame('receipt.pdf', $attachment->original_name);
        $this->assertSame($expense['id'], $attachment->expense_id);
    }

    /** تصنيف مستأجر آخر لا يظهر ولا يمكن حقنه في سند مصروف. */
    /** @test */
    public function expense_categories_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $theirs = $this->category($a['token'], 'خاص بهم');

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $accountId = $this->expenseAccountId($b['tenant_id']);

        $this->withToken($b['token'])->getJson('/api/expense-categories')
            ->assertOk()->assertJsonCount(0, 'data');

        $this->withToken($b['token'])->postJson('/api/expenses', [
            'account_id' => $accountId,
            'category_id' => $theirs['id'],
            'amount' => 100000,
        ])->assertStatus(422);
    }
}
