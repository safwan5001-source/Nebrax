<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * R3: الوصول المباشر لفاتورة POS بمعرّفها يجب أن يحترم الفرع النشط — معرفة
 * UUID وحدها لا تكفي لتجاوز فرعٍ لا يملك المستخدم صلاحيته، حتى داخل المستأجر
 * نفسه. المستخدم غير المقيَّد (بلا فروع معيَّنة) يبقى يرى كل شيء — هذا هو
 * النموذج القائم (`User::allowedBranchIds()`/`canAccessBranch()`)، لا قاعدة
 * جديدة.
 */
class PosInvoiceBranchAccessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /**
     * @return array{main_branch_id:string,other_branch_id:string,invoice_main:array,invoice_other:array,owner_token:string,tenant_id:string}
     */
    private function twoBranchPosSetup(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $mainBranch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل فروع POS', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        // كاشيران منفصلان: المستخدم الواحد لا يملك جلسة POS مفتوحة على جهازين معاً.
        $mainCashier = $this->tokenForRole($auth['tenant_id'], 'admin', "main-cashier@{$slug}.test");
        $invoiceMain = $this->checkoutInBranch($mainCashier, $mainBranch, $customer, "{$slug}-MAIN");

        $otherBranch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع POS آخر'])
            ->assertCreated()['data']['id'];
        $otherCashier = $this->tokenForRole($auth['tenant_id'], 'admin', "other-cashier@{$slug}.test");
        $invoiceOther = $this->checkoutInBranch($otherCashier, $otherBranch, $customer, "{$slug}-OTHER");

        return [
            'main_branch_id' => $mainBranch,
            'other_branch_id' => $otherBranch,
            'invoice_main' => $invoiceMain,
            'invoice_other' => $invoiceOther,
            'owner_token' => $auth['token'],
            'tenant_id' => $auth['tenant_id'],
        ];
    }

    private function checkoutInBranch(string $token, string $branchId, string $customerId, string $code): array
    {
        $headers = ['X-Branch-Id' => $branchId];
        $warehouse = $this->withToken($token)->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => "مخزن {$code}", 'code' => "W-{$code}", 'branch_id' => $branchId, 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($token)->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => "كاشير {$code}", 'code' => "D-{$code}", 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $session = $this->withToken($token)->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()['data'];
        // ترقيم جلسة POS على مستوى المستأجر لا الفرع (نظير PosRecentInvoicesTest)؛
        // فرعان في اختبار واحد يحتاجان تمييزاً صريحاً كي لا يتصادم الرقم.
        \App\Models\PosSession::whereKey($session['id'])->update(['number' => "POS-{$code}-001"]);

        // بلا تحصيل (بيع آجل بالكامل): سند القبض غير جوهري لاختبار الوصول
        // بمعرّف الفاتورة، وتفادي دفعتين بنفس الرقم عبر فرعين في مستأجر واحد —
        // فهرس `payments_tenant_id_number_branchless_unique` قيدٌ عام غير جزئي
        // في هذه القاعدة (انظر §المخاطر في التقرير)، عيبٌ مسبقٌ خارج نطاق R3/R6.
        return $this->withToken($token)->withHeaders($headers)->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $customerId,
            'pos_session_id' => $session['id'],
            'warehouse_id' => $warehouse['id'],
            'items' => [['description' => "بيع {$code}", 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 0, 'card' => 0, 'transfer' => 0, 'credit' => 0],
        ])->assertCreated()['data'];
    }

    private function restrictedTo(string $tenantId, string $branchId, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        $user = User::create([
            'tenant_id' => $tenantId, 'name' => 'كاشير مقيَّد', 'email' => $email,
            'password' => 'password123', 'role' => 'admin',
        ]);
        $user->branches()->sync([$branchId]);

        return $user->createToken('api')->plainTextToken;
    }

    /** @test */
    public function a_branch_restricted_user_can_view_a_pos_invoice_from_their_own_authorized_branch(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-allow');
        $restricted = $this->restrictedTo($setup['tenant_id'], $setup['main_branch_id'], 'restricted-allow@test.local');

        $this->withToken($restricted)->withHeaders(['X-Branch-Id' => $setup['main_branch_id']])
            ->getJson("/api/invoices/{$setup['invoice_main']['id']}")
            ->assertOk()
            ->assertJsonPath('data.id', $setup['invoice_main']['id']);
    }

    /**
     * الهجوم الحقيقي: جلسة المستخدم عادية على فرعه، ومعرّف الفاتورة من فرعٍ
     * آخر معروفٌ بأي وسيلة (تخمين، تسريب، رابط قديم) — لا ترويسة فرعٍ مزوَّرة.
     *
     * @test
     */
    public function a_branch_restricted_user_cannot_view_a_pos_invoice_from_an_unauthorized_branch_by_id_alone(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-deny');
        $restricted = $this->restrictedTo($setup['tenant_id'], $setup['main_branch_id'], 'restricted-deny@test.local');

        $this->withToken($restricted)
            ->getJson("/api/invoices/{$setup['invoice_other']['id']}")
            ->assertNotFound();
    }

    /** @test */
    public function branch_all_for_a_restricted_user_still_excludes_a_branch_outside_their_assignment(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-all');
        $restricted = $this->restrictedTo($setup['tenant_id'], $setup['main_branch_id'], 'restricted-all@test.local');

        // ?branch=all يعني «كل ما يملكه المستخدم» لا «كل فروع المؤسسة».
        $this->withToken($restricted)
            ->getJson("/api/invoices/{$setup['invoice_other']['id']}?branch=all")
            ->assertNotFound();
        $this->withToken($restricted)
            ->getJson("/api/invoices/{$setup['invoice_main']['id']}?branch=all")
            ->assertOk();
    }

    /** @test */
    public function an_unrestricted_user_retains_cross_branch_invoice_access_within_the_same_tenant(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-unrestricted');

        // مالك المستأجر بلا فروع معيَّنة = غير مقيَّد (allowedBranchIds() === null)،
        // فيبقى يرى فاتورة أي فرع — سلوك ERP القائم، لا كسراً جديداً.
        $this->withToken($setup['owner_token'])
            ->getJson("/api/invoices/{$setup['invoice_other']['id']}")
            ->assertOk()
            ->assertJsonPath('data.id', $setup['invoice_other']['id']);
    }

    /** @test */
    public function a_different_tenant_cannot_reach_the_invoice_at_all(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-tenant-a');
        $otherTenant = $this->registerTenant('inv-branch-tenant-b', 'owner@inv-branch-tenant-b.test');

        $this->withToken($otherTenant['token'])
            ->getJson("/api/invoices/{$setup['invoice_main']['id']}")
            ->assertNotFound();
    }

    /** @test */
    public function zatca_receipt_data_enforces_the_same_branch_boundary_as_the_invoice_itself(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-zatca');
        $restricted = $this->restrictedTo($setup['tenant_id'], $setup['main_branch_id'], 'restricted-zatca@test.local');

        $this->withToken($restricted)
            ->getJson("/api/invoices/{$setup['invoice_other']['id']}/zatca")
            ->assertNotFound();
        $this->withToken($restricted)
            ->getJson("/api/invoices/{$setup['invoice_main']['id']}/zatca")
            ->assertOk();
    }

    /**
     * انحدار: مسار المرتجع/الاستبدال يحلّ الفاتورة المصدر خارج تصفية الفرع
     * عمداً (`BranchScope::reference`) لكن يتحقق فوراً من تطابق فرع الجلسة —
     * حارسٌ قائم مستقل عن R3، ولا يجوز أن يضعفه هذا التغيير.
     *
     * @test
     */
    public function returning_a_foreign_branch_invoice_is_still_rejected_by_the_existing_session_branch_guard(): void
    {
        $setup = $this->twoBranchPosSetup('inv-branch-return');
        $headers = ['X-Branch-Id' => $setup['main_branch_id']];
        $warehouse = $this->withToken($setup['owner_token'])->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => 'مخزن مرتجع فرع', 'code' => 'RET-BRANCH-W', 'branch_id' => $setup['main_branch_id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($setup['owner_token'])->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => 'كاشير مرتجع فرع', 'code' => 'RET-BRANCH-1', 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $mainSession = $this->withToken($setup['owner_token'])->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()['data'];

        $invoiceOther = Invoice::with('lines')->findOrFail($setup['invoice_other']['id']);
        $this->withToken($setup['owner_token'])->withHeaders($headers)->postJson('/api/pos/returns', [
            'idempotency_key' => (string) Str::uuid(),
            'pos_session_id' => $mainSession['id'],
            'original_invoice_id' => $invoiceOther->id,
            'payment_type' => 'cash',
            'items' => [['source_line_id' => $invoiceOther->lines->firstOrFail()->id, 'quantity' => 1]],
        ])->assertStatus(422);
    }
}
