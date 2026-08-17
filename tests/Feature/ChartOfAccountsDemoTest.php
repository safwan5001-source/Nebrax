<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ChartOfAccountsDemoTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function the_default_chart_places_expense_leaves_under_the_five_management_groups(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $expenses = Account::where('code', '5')->firstOrFail();
        foreach (['51', '52', '53', '54', '55'] as $code) {
            $group = Account::where('code', $code)->firstOrFail();
            $this->assertSame($expenses->id, $group->parent_id);
            $this->assertTrue($group->is_group);
        }

        $this->assertSame('51', Account::where('code', '5110')->firstOrFail()->parent->code);
        $this->assertSame('52', Account::where('code', '5120')->firstOrFail()->parent->code);
        $this->assertSame('53', Account::where('code', '5160')->firstOrFail()->parent->code);
        $this->assertSame('54', Account::where('code', '5180')->firstOrFail()->parent->code);
    }

    /** @test */
    public function demo_command_adds_only_labelled_zero_balance_custom_accounts_to_one_tenant_and_is_idempotent(): void
    {
        $auth = $this->registerTenant();

        $this->artisan('accounts:seed-demo', ['--tenant' => $auth['tenant_id']])
            ->expectsOutputToContain('لم يُنشأ أي قيد يومية')
            ->assertSuccessful();

        app(TenantContext::class)->set($auth['tenant_id']);
        $group = Account::where('code', '51')->firstOrFail();
        $leaf = Account::where('code', '5190')->firstOrFail();

        $this->assertSame($group->id, $leaf->parent_id);
        $this->assertFalse($leaf->is_system);
        $this->assertFalse($leaf->is_group);
        $this->assertSame(0, $leaf->balance->balance);
        $this->assertSame(0, $leaf->lines()->count());

        $before = Account::count();
        $this->artisan('accounts:seed-demo', ['--tenant' => $auth['tenant_id']])->assertSuccessful();
        $this->assertSame($before, Account::count());

        $other = $this->registerTenant('other', 'owner@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $this->assertNull(Account::where('code', '5190')->first());
    }
}
