<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Asset;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات الأصول الثابتة: اشتقاق الإجمالي، قيد اقتناء متوازن (مدين 12xx + 1150
 * / دائن 1110)، وإهلاك بالقسط الثابت (مدين 5160 / دائن 1230) يتوقّف عند الاكتمال.
 * تشغيل: php artisan test --filter=AssetTest
 */
class AssetTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function accountId(string $tenantId, string $code): string
    {
        app(TenantContext::class)->set($tenantId);

        return Account::where('code', $code)->firstOrFail()->id;
    }

    private function newAsset(string $token, string $accountId, array $overrides = []): string
    {
        return $this->withToken($token)->postJson('/api/assets', array_merge([
            'name' => 'مولّد كهربائي', 'account_id' => $accountId,
            'cost' => 1000000, 'tax_rate' => 15, 'useful_life_months' => 60,
        ], $overrides))['data']['id'];
    }

    /** @test */
    public function creating_an_asset_derives_total_without_an_entry(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->accountId($auth['tenant_id'], '1210');

        $res = $this->withToken($auth['token'])->postJson('/api/assets', [
            'name' => 'مولّد', 'account_id' => $accountId, 'cost' => 1000000, 'tax_rate' => 15,
        ])->assertCreated();

        $this->assertSame('draft', $res['data']['status']);
        $this->assertSame('11500.00', $res['data']['total']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', Asset::class)->count());
    }

    /** @test */
    public function posting_acquisition_generates_a_balanced_entry_and_activates(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->accountId($auth['tenant_id'], '1210');
        $id = $this->newAsset($auth['token'], $accountId);

        $posted = $this->withToken($auth['token'])->postJson("/api/assets/{$id}/post")->assertOk();
        $this->assertSame('active', $posted['data']['status']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Asset::class)->where('source_id', $id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(1150000, $entry->lines->sum('debit'));
        $this->assertEquals(1000000, $this->line($entry, '1210')->debit);  // حساب الأصل
        $this->assertEquals(150000,  $this->line($entry, '1150')->debit);  // ضريبة المدخلات
        $this->assertEquals(1150000, $this->line($entry, '1110')->credit); // الصندوق
    }

    /** @test */
    public function depreciation_posts_a_balanced_entry_and_accumulates(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->accountId($auth['tenant_id'], '1210');
        // تكلفة 12000 ﷼، عمر 12 شهراً، بلا ضريبة → قسط شهري = 100000 هللة
        $id = $this->newAsset($auth['token'], $accountId, ['cost' => 1200000, 'tax_rate' => 0, 'useful_life_months' => 12]);
        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/post")->assertOk();

        $res = $this->withToken($auth['token'])->postJson("/api/assets/{$id}/depreciate")->assertOk();
        $this->assertSame('1000.00', $res['data']['accumulated_depreciation']);
        $this->assertSame('11000.00', $res['data']['book_value']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Asset::class)->where('description', 'like', 'إهلاك%')->firstOrFail();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(100000, $this->line($entry, '5160')->debit);  // مصروف الإهلاك
        $this->assertEquals(100000, $this->line($entry, '1230')->credit); // مجمع الإهلاك
    }

    /** @test */
    public function depreciation_stops_when_fully_depreciated(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->accountId($auth['tenant_id'], '1220');
        // تكلفة 1000 ﷼، عمر شهرين → قسطان كاملان ثم يُرفض الثالث
        $id = $this->newAsset($auth['token'], $accountId, ['cost' => 100000, 'tax_rate' => 0, 'useful_life_months' => 2]);
        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/post")->assertOk();

        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/depreciate")->assertOk();
        $res = $this->withToken($auth['token'])->postJson("/api/assets/{$id}/depreciate")->assertOk();
        $this->assertSame('1000.00', $res['data']['accumulated_depreciation']); // = التكلفة
        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/depreciate")->assertStatus(422);
    }

    /** @test */
    public function a_draft_asset_cannot_be_depreciated(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->accountId($auth['tenant_id'], '1210');
        $id = $this->newAsset($auth['token'], $accountId);

        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/depreciate")->assertStatus(422);
    }

    /** @test */
    public function an_acquisition_cannot_be_posted_twice(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->accountId($auth['tenant_id'], '1210');
        $id = $this->newAsset($auth['token'], $accountId);

        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/post")->assertOk();
        $this->withToken($auth['token'])->postJson("/api/assets/{$id}/post")->assertStatus(422);
    }

    /** @test */
    public function a_non_fixed_asset_account_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $cashId = $this->accountId($auth['tenant_id'], '1110'); // أصل متداول لا ثابت

        $this->withToken($auth['token'])->postJson('/api/assets', [
            'name' => 'خطأ', 'account_id' => $cashId, 'cost' => 500000,
        ])->assertStatus(422);
    }

    /** @test */
    public function assets_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $accountA = $this->accountId($a['tenant_id'], '1210');
        $id = $this->newAsset($a['token'], $accountA);

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/assets/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/assets')->assertOk()->assertJsonCount(0, 'data');
    }
}
