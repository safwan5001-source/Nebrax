<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\JournalEntry;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات مراكز التكلفة: CRUD معزول بالمستأجر + وسم سطر القيد بمركز التكلفة
 * عبر مسار المصروفات (بُعد تحليلي إضافي غير كاسر للمحرك).
 * تشغيل: php artisan test --filter=CostCenterTest
 */
class CostCenterTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeCenter(string $token, string $code = 'CC-01', string $name = 'فرع الدمام'): string
    {
        return $this->withToken($token)->postJson('/api/cost-centers', [
            'code' => $code, 'name' => $name,
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function it_creates_and_lists_cost_centers(): void
    {
        $auth = $this->registerTenant();
        $this->makeCenter($auth['token']);

        $this->withToken($auth['token'])->getJson('/api/cost-centers')
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.code', 'CC-01');
    }

    /** @test */
    public function duplicate_code_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $this->makeCenter($auth['token'], 'CC-01');

        $this->withToken($auth['token'])->postJson('/api/cost-centers', [
            'code' => 'CC-01', 'name' => 'آخر',
        ])->assertStatus(422);
    }

    /** @test */
    public function it_updates_and_deletes_a_cost_center(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeCenter($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/cost-centers/{$id}", [
            'code' => 'CC-01', 'name' => 'فرع الخبر', 'is_active' => false,
        ])->assertOk()->assertJsonPath('data.name', 'فرع الخبر')->assertJsonPath('data.is_active', false);

        $this->withToken($auth['token'])->deleteJson("/api/cost-centers/{$id}")->assertOk();
        $this->withToken($auth['token'])->getJson('/api/cost-centers')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function posting_an_expense_tags_the_debit_line_with_the_cost_center(): void
    {
        $auth = $this->registerTenant();
        $centerId = $this->makeCenter($auth['token']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $accountId = Account::where('code', '5130')->firstOrFail()->id;

        $id = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId, 'amount' => 100000, 'tax_rate' => 15, 'cost_center_id' => $centerId,
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/expenses/{$id}/post")->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Expense::class)->where('source_id', $id)->firstOrFail();

        // سطر المصروف (5130) موسوم بمركز التكلفة؛ سطرا الضريبة والدائن غير موسومين.
        $expLine = $entry->lines->first(fn ($l) => $l->account->code === '5130');
        $vatLine = $entry->lines->first(fn ($l) => $l->account->code === '1150');
        $this->assertSame($centerId, $expLine->cost_center_id);
        $this->assertNull($vatLine->cost_center_id);
    }

    /** @test */
    public function cost_centers_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $id = $this->makeCenter($a['token']);

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson('/api/cost-centers')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($b['token'])->putJson("/api/cost-centers/{$id}", [
            'code' => 'X', 'name' => 'اختراق',
        ])->assertNotFound();
    }
}
