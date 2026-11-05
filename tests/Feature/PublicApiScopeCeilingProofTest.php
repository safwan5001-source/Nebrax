<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-AIA D-08 — اختبار إثبات (Characterization / Proof), لا إصلاح.
 *
 * السؤال: هل يستطيع مستخدم بصلاحيات محدودة إصدار مفتاح Public API بـscope يتجاوز
 * صلاحياته هو، ثم يقرأ به بياناتٍ يُحجب عنها داخلياً؟
 *
 * المسار الكامل المُختبَر (كل خطوة مُثبتة بتأكيد منفصل):
 *   1) مستخدم بدور مخصّص يملك `developer.manage` فقط، بلا `reports.view`/`partners.view`.
 *   2) يُرفض داخلياً من تقرير كشف الحساب (403) — خطّ الأساس.
 *   3) يُصدر مفتاحاً بـ`statements:read` عبر `/api/developer/api-clients` (يُقبل؟).
 *   4) يستعمل المفتاح على `/api/v1/partners/{id}/statement` (يقرأ؟).
 *
 * هذه الاختبارات **تصف السلوك الحالي** وتنجح عليه. لا تُعدَّل لتخفي النتيجة:
 * عند تنفيذ AIA-0.4 (سقف الصلاحيات عند الإصدار) تنقلب تأكيدات الخطوتين 3 و4
 * عمداً إلى الرفض، ويُحدَّث هذا الملف في PR الإصلاح نفسه.
 *
 * النتيجة تُقرأ في `docs/ai/AWJ_AI_ACTIONS_SECURITY_AND_FINANCIAL_ACCURACY_GATES.md` (G-S2).
 * تشغيل: php artisan test --filter=PublicApiScopeCeilingProofTest
 */
class PublicApiScopeCeilingProofTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const ISSUE_URI = '/api/developer/api-clients';

    /** مستأجر بعميل وفاتورة آجلة مرحَّلة + مستخدم محدود يملك `developer.manage` وحدها. */
    private function scenario(): array
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');

        $partnerId = $this->withToken($owner['token'])->postJson('/api/partners', [
            'name' => 'عميل الإثبات', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $invoiceId = $this->withToken($owner['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'credit', 'invoice_date' => '2026-03-10',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $this->withToken($owner['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk();

        app(TenantContext::class)->set($owner['tenant_id']);
        Role::create([
            'tenant_id' => $owner['tenant_id'], 'slug' => 'dev_only', 'name' => 'Developer only',
            'permissions' => ['developer.view', 'developer.manage'],
        ]);
        app(TenantContext::class)->forget();

        return [
            'tenant_id' => $owner['tenant_id'],
            'partner_id' => $partnerId,
            'limited' => $this->tokenForRole($owner['tenant_id'], 'dev_only', 'dev@acme.test'),
        ];
    }

    private function asProductionProcess(): void
    {
        // كل طلب إنتاجي عملية مستقلة (حارس `web`)؛ مسارات الـ Internal تترك `sanctum` في عملية الاختبار.
        $this->app['auth']->shouldUse('web');
        $this->app['auth']->forgetGuards();
    }

    #[Test]
    public function step_1_the_limited_user_is_denied_the_statement_internally(): void
    {
        $s = $this->scenario();

        $this->withToken($s['limited'])
            ->getJson("/api/reports/partner-statement/{$s['partner_id']}")
            ->assertStatus(403);
        $this->withToken($s['limited'])->getJson('/api/partners')->assertStatus(403);
    }

    #[Test]
    public function step_2_the_limited_user_cannot_issue_when_holding_only_developer_view(): void
    {
        // خطّ أساس: الحارس الحالي هو `developer.manage` فقط.
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        app(TenantContext::class)->set($owner['tenant_id']);
        Role::create(['tenant_id' => $owner['tenant_id'], 'slug' => 'dev_view', 'name' => 'V', 'permissions' => ['developer.view']]);
        app(TenantContext::class)->forget();
        $viewer = $this->tokenForRole($owner['tenant_id'], 'dev_view', 'v@acme.test');

        $this->withToken($viewer)->postJson(self::ISSUE_URI, ['name' => 'x', 'scopes' => ['statements:read']])
            ->assertStatus(403);
    }

    #[Test]
    public function step_3_current_behaviour_issuance_accepts_a_scope_the_issuer_does_not_hold(): void
    {
        $s = $this->scenario();

        // المُصدِر لا يملك reports.view (مُثبت في الخطوة 1)، ومع ذلك يُقبل الإصدار.
        $this->withToken($s['limited'])->postJson(self::ISSUE_URI, [
            'name' => 'escalation-probe', 'scopes' => ['statements:read', 'partners:read'],
        ])->assertCreated()->assertJsonStructure(['secret']);
    }

    #[Test]
    public function step_4_current_behaviour_the_escalated_key_reads_data_the_issuer_cannot_read(): void
    {
        $s = $this->scenario();

        $secret = $this->withToken($s['limited'])->postJson(self::ISSUE_URI, [
            'name' => 'escalation-probe', 'scopes' => ['statements:read', 'partners:read'],
        ])->assertCreated()['secret'];

        $this->asProductionProcess();

        $statement = $this->withToken($secret)->getJson("/api/v1/partners/{$s['partner_id']}/statement")
            ->assertOk();
        // بيانات مالية حقيقية (مدين 1130 بـ 115000 هللة) محجوبة عن المُصدِر داخلياً.
        $this->assertSame(115000, $statement['data']['closing_balance_minor']);
        $this->withToken($secret)->getJson('/api/v1/partners')->assertOk();
    }
}
