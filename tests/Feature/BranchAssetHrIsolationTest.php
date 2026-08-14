<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  P3-ب — الأصول معزولة · الموظفون والرواتب مركزيّون
 * ═══════════════════════════════════════════════════════════════
 *  ثلاثة تصنيفات مختلفة تُختبر معاً لأن التمييز بينها هو جوهر الموجة:
 *
 *   • `Asset`      → BranchScoped     : فرع لا يرى أصول فرع آخر.
 *   • `Employee`   → BelongsToBranch  : موسوم بمكان العمل، **مرئي للجميع**.
 *   • `PayrollRun` → CompanyWide      : مركزي، يشمل كل الموظفين بلا تمييز فرع.
 *
 *  تشغيل: php artisan test --filter=BranchAssetHrIsolationTest
 */
class BranchAssetHrIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function mainBranch(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
    }

    /** حساب أصل ثابت من دليل الحسابات (12xx) لاستخدامه في الاقتناء. */
    private function assetAccount(string $token): string
    {
        $accounts = $this->withToken($token)->getJson('/api/accounts')['data'];
        foreach ($accounts as $a) {
            if (str_starts_with((string) $a['code'], '12') && ! $a['is_group']) {
                return $a['id'];
            }
        }

        return $this->withToken($token)->postJson('/api/accounts', [
            'code' => '1210', 'name' => 'المعدات', 'type' => 'asset',
        ])->assertCreated()['data']['id'];
    }

    /** ينشئ أصلاً في فرع محدّد ويُعيد استجابته. */
    private function createAsset(string $token, string $branchId, string $accountId, int $cost = 1000000): array
    {
        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->postJson('/api/assets', [
                'name' => 'معدّة', 'account_id' => $accountId, 'cost' => $cost,
                'acquisition_date' => '2026-01-15', 'useful_life_months' => 10,
            ])->assertCreated()['data'];
    }

    /** @test */
    public function a_branch_never_sees_another_branch_assets(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main    = $this->mainBranch($auth['token']);
        $khobar  = $this->branch($auth['token'], 'فرع الخبر');
        $account = $this->assetAccount($auth['token']);

        $asset = $this->createAsset($auth['token'], $khobar, $account);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/assets')->assertOk()->assertJsonCount(0, 'data');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/assets/{$asset['id']}")->assertNotFound();

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->getJson('/api/assets')->assertOk()->assertJsonCount(1, 'data');
    }

    /**
     * لكل فرع سجلُّ أصولٍ مستقلٌّ يبدأ من ١.
     *
     * كان التسلسل مؤسسياً لسببٍ تقنيٍّ بحت: القيد `(tenant_id, number)` كان
     * ينفجر لو بدأ كل فرع من ١. وقد توسّع القيد إلى `(tenant_id, branch_id,
     * number)` فزال السبب. والفرع هنا **لا يرى** أصول غيره (`BranchScoped`)،
     * فلو بقي التسلسل مؤسسياً لظهر سجلُّ كل فرع مثقوباً بأرقامٍ غائبة تخصّ
     * أصولاً لا يملك رؤيتها أصلاً.
     *
     * @test
     */
    public function each_branch_keeps_its_own_asset_sequence(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main    = $this->mainBranch($auth['token']);
        $khobar  = $this->branch($auth['token'], 'فرع الخبر');
        $account = $this->assetAccount($auth['token']);

        $first  = $this->createAsset($auth['token'], $main, $account);
        $second = $this->createAsset($auth['token'], $khobar, $account);
        $third  = $this->createAsset($auth['token'], $main, $account);

        // الرقم نفسه في فرعين — يتعايشان تحت القيد الموسَّع.
        $this->assertSame('FA-2026-00001', $first['number']);
        $this->assertSame('FA-2026-00001', $second['number']);

        // ولكلٍّ تسلسله المتصل داخل فرعه.
        $this->assertSame('FA-2026-00002', $third['number']);
    }

    /**
     * قيدا الاقتناء والإهلاك يتبعان **فرع الأصل** — فلا يُحمَّل إهلاك فرعٍ على آخر.
     *
     * @test
     */
    public function acquisition_and_depreciation_entries_follow_the_asset_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar  = $this->branch($auth['token'], 'فرع الخبر');
        $account = $this->assetAccount($auth['token']);
        $asset   = $this->createAsset($auth['token'], $khobar, $account);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson("/api/assets/{$asset['id']}/post")->assertOk();
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson("/api/assets/{$asset['id']}/depreciate")->assertOk();

        $entries = JournalEntry::where('source_type', Asset::class)
            ->where('source_id', $asset['id'])->pluck('id');
        $this->assertCount(2, $entries); // اقتناء + قسط إهلاك واحد

        $lines = JournalLine::whereIn('journal_entry_id', $entries)->get();
        $this->assertNotEmpty($lines);
        foreach ($lines as $line) {
            $this->assertSame($khobar, $line->branch_id);
        }
        $this->assertSame($lines->sum('debit'), $lines->sum('credit'));
    }

    /**
     * أصل بلا فرع ⇒ قيوده **غير موزَّعة**، لا محمَّلة على فرع من ضغط الزرّ.
     * نتيجة مقصودة لتمييز `LedgerService` بين «الفرع غائب» و«null صريحة».
     *
     * @test
     */
    public function a_branchless_asset_posts_unallocated_entries(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main    = $this->mainBranch($auth['token']);
        $account = $this->assetAccount($auth['token']);

        app(BranchContext::class)->forget(); // أصل منشأ قبل الفروع
        $asset = Asset::create([
            'tenant_id' => $auth['tenant_id'],
            'number' => 'FA-2026-09001', 'name' => 'أصل بلا فرع',
            'account_id' => $account, 'acquisition_date' => '2026-01-15',
            'cost' => 600000, 'useful_life_months' => 10,
        ]);
        $this->assertNull($asset->branch_id);

        // الترحيل يجري والفرع النشط هو الرئيسي — ومع ذلك لا يُحمَّل عليه
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson("/api/assets/{$asset->id}/post")->assertOk();

        $lines = JournalLine::whereIn(
            'journal_entry_id',
            JournalEntry::where('source_type', Asset::class)->where('source_id', $asset->id)->pluck('id')
        )->get();

        $this->assertNotEmpty($lines);
        foreach ($lines as $line) {
            $this->assertNull($line->branch_id);
        }
    }

    /** @test */
    public function legacy_assets_without_a_branch_stay_visible_to_everyone(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main    = $this->mainBranch($auth['token']);
        $khobar  = $this->branch($auth['token'], 'فرع الخبر');
        $account = $this->assetAccount($auth['token']);

        // بلا سياق فرع فلا يوسمه BelongsToBranch — كصفٍّ منشأ قبل الفروع
        app(BranchContext::class)->forget();
        $legacy = Asset::create([
            'tenant_id' => $auth['tenant_id'],
            'number' => 'FA-2020-00001', 'name' => 'أصل قديم',
            'account_id' => $account, 'acquisition_date' => '2020-01-01', 'cost' => 500000,
        ]);
        $this->assertNull($legacy->branch_id);

        foreach ([$main, $khobar] as $branchId) {
            $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branchId])
                ->getJson('/api/assets')->assertOk()->assertJsonCount(1, 'data');
        }
    }

    /**
     * الموظف موسوم بمكان عمله — لكنه **مرئي من كل فرع** (لا حاجز عزل).
     *
     * @test
     */
    public function employees_are_tagged_with_a_work_location_but_stay_visible_to_all_branches(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $emp = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/employees', ['name' => 'موظف الخبر', 'basic_salary' => 500000])
            ->assertCreated()['data'];

        $this->assertSame($khobar, $emp['branch_id']); // وُسم بمكان العمل

        // ومع ذلك يراه الفرع الرئيسي — شؤون الموظفين مركزية
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/employees')->assertOk()->assertJsonCount(1, 'data');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/employees/{$emp['id']}")->assertOk();
    }

    /** @test */
    public function a_branch_of_another_tenant_is_rejected_as_a_work_location(): void
    {
        $b = $this->registerTenant('globex', 'owner@globex.test');
        $branchB = $this->mainBranch($b['token']);

        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/employees', [
            'name' => 'موظف', 'basic_salary' => 500000, 'branch_id' => $branchB,
        ])->assertStatus(422);
    }

    /**
     * المسيّر مركزي: يشمل موظفي كل الفروع مهما كان الفرع النشط، ويُرى من أي فرع.
     *
     * @test
     */
    public function a_payroll_run_covers_employees_of_every_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        foreach ([[$main, 'موظف الرئيسي'], [$khobar, 'موظف الخبر']] as [$branchId, $name]) {
            $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branchId])
                ->postJson('/api/employees', ['name' => $name, 'basic_salary' => 500000])
                ->assertCreated();
        }

        // المسيّر يُنشأ من الفرع الرئيسي — ويجب أن يضمّ موظفي الفرعين
        $run = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/payroll-runs', ['period' => '2026-01'])->assertCreated()['data'];

        $this->assertSame('10000.00', $run['total_gross']); // ٥٠٠٠ × ٢

        // ويُرى من فرع آخر (مركزي لا معزول)
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->getJson('/api/payroll-runs')->assertOk()->assertJsonCount(1, 'data');
    }
}
