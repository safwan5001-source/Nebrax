<?php

namespace Tests\Feature;

use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * يحرس عزل نطاق الفرع في التقارير نفسها، لا في الواجهة فقط.
 * المستخدم المقيّد لا يستطيع توسيع التقرير بتمرير branch_id يدوياً.
 */
class ReportBranchAuthorizationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function postInvoice(string $token, int $unitPrice, string $branchId): void
    {
        $headers = ['X-Branch-Id' => $branchId];

        $partnerId = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $invoice = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/invoices', [
                'partner_id' => $partnerId,
                'payment_type' => 'cash',
                'items' => [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            ])
            ->assertCreated()['data'];

        $this->withToken($token)->withHeaders($headers)
            ->postJson("/api/invoices/{$invoice['id']}/post")
            ->assertOk();
    }

    /** @test */
    public function a_restricted_user_cannot_expand_reports_beyond_assigned_branches(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $khobar = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'فرع الخبر'])
            ->assertCreated()['data']['id'];

        $this->postInvoice($auth['token'], 10000, $main);   // 100 ريال
        $this->postInvoice($auth['token'], 20000, $khobar); // 200 ريال

        $restrictedToken = $this->tokenForRole($auth['tenant_id'], 'owner', 'restricted-reports@acme.test');
        $restricted = User::where('email', 'restricted-reports@acme.test')->firstOrFail();
        $restricted->branches()->attach($khobar);

        // قائمة الفروع نفسها لا تكشف إلا الفرع المسموح.
        $branches = $this->withToken($restrictedToken)->getJson('/api/branches')->assertOk()['data'];
        $this->assertSame([$khobar], collect($branches)->pluck('id')->values()->all());

        // غياب المرشّح لا يعني كل فروع المستأجر للمستخدم المقيّد؛ بل كل فروعه هو فقط.
        $consolidated = $this->withToken($restrictedToken)
            ->getJson('/api/reports/income-statement')
            ->assertOk();
        $this->assertSame('200.00', $consolidated['total_revenue']);

        // تمرير فرع غير مصرح به يدوياً لا يوسّع النطاق ولا يسرّب أرقامه.
        $unauthorized = $this->withToken($restrictedToken)
            ->getJson("/api/reports/income-statement?branch_id={$main}")
            ->assertOk();
        $this->assertSame('200.00', $unauthorized['total_revenue']);

        // وحتى مزج فرع مصرح وغير مصرح به يبقى مقصوراً على المصرح فقط.
        $mixed = $this->withToken($restrictedToken)
            ->getJson("/api/reports/income-statement?branch_id[]={$main}&branch_id[]={$khobar}")
            ->assertOk();
        $this->assertSame('200.00', $mixed['total_revenue']);
    }

    /** @test */
    public function a_branch_from_another_tenant_cannot_expand_a_restricted_report(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        app(TenantContext::class)->set($a['tenant_id']);
        $allowedBranch = $this->withToken($a['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $this->postInvoice($a['token'], 10000, $allowedBranch);

        $b = $this->registerTenant('globex', 'owner@globex.test');
        app(TenantContext::class)->set($b['tenant_id']);
        $foreignBranch = $this->withToken($b['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];

        app(TenantContext::class)->set($a['tenant_id']);
        $restrictedToken = $this->tokenForRole($a['tenant_id'], 'owner', 'restricted-foreign@acme.test');
        $restricted = User::where('email', 'restricted-foreign@acme.test')->firstOrFail();
        $restricted->branches()->attach($allowedBranch);

        $report = $this->withToken($restrictedToken)
            ->getJson("/api/reports/income-statement?branch_id={$foreignBranch}")
            ->assertOk();

        $this->assertSame('100.00', $report['total_revenue']);
    }
}
