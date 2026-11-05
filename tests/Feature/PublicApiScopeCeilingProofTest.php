<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-AIA D-08 — اختبار إثبات (Proof) لا يثبّت الثغرة.
 *
 * السؤال: هل يستطيع مستخدم بصلاحيات محدودة إصدار مفتاح Public API بـscope يتجاوز
 * صلاحياته هو، ثم يقرأ به بياناتٍ يُحجب عنها داخلياً؟
 *
 * المسار الكامل المُختبَر (كل خطوة بتأكيد منفصل):
 *   1) مستخدم بدور مخصّص يملك `developer.manage` دون `reports.view`/`partners.view`.
 *   2) يُرفض داخلياً من كشف الحساب (403) — خطّ الأساس.
 *   3) يحاول إصدار مفتاح بـ`statements:read` عبر `/api/developer/api-clients`.
 *   4) إن أُصدر المفتاح، يُستعمل على `/api/v1/partners/{id}/statement`.
 *
 * **الاختبار يقبل حالتين ولا يفرض استمرار الثغرة:**
 *   - **حالة معيبة (الوضع الحالي، D-08 مفتوح):** يُنفَّذ المسار كاملاً وتُتحقق نتيجته (201 ثم 200)
 *     ثم يُعلَّم الاختبار `incomplete` برسالة صريحة — يظهر في CI كإنذار ولا يُفشل البناء.
 *   - **حالة مُصلَحة (بعد AIA-0.4):** الإصدار يُرفض (403/422) ولا يُعاد نص سرّي؛ يمرّ الاختبار
 *     بصرامة كحارس انحدار حقيقي بلا أي تعديل.
 *
 * اختبارات الثبات (تنجح قبل الإصلاح وبعده) تحرس ألّا يُفرط الإصلاح في المنع:
 * المالك يُصدر أي scope، ومن يملك الصلاحية المقابلة يُصدر.
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

    /** يُصدر مفتاحاً بنص scopes معيّن بصفة المستخدم المحدود (استجابة خام). */
    private function attemptIssue(string $token, array $scopes): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson(self::ISSUE_URI, ['name' => 'escalation-probe', 'scopes' => $scopes]);
    }

    #[Test]
    public function step_3_4_issuing_a_scope_the_issuer_lacks_is_rejected_or_is_the_documented_open_gap(): void
    {
        $s = $this->scenario();

        $res = $this->attemptIssue($s['limited'], ['statements:read', 'partners:read']);

        if (in_array($res->getStatusCode(), [403, 422], true)) {
            // الحالة المُصلَحة: رفض صريح بلا سرّ. هذا هو الحارس الدائم بعد AIA-0.4.
            $this->assertArrayNotHasKey('secret', (array) $res->json());

            return;
        }

        // الحالة المعيبة (قبل AIA-0.4): نُثبت المسار كاملاً ثم نُعلِّم الاختبار incomplete.
        $res->assertCreated()->assertJsonStructure(['secret']);
        $secret = $res['secret'];

        $this->asProductionProcess();
        $statement = $this->withToken($secret)->getJson("/api/v1/partners/{$s['partner_id']}/statement")->assertOk();
        // بيانات مالية حقيقية (مدين 1130 بـ 115000 هللة) محجوبة عن المُصدِر داخلياً (الخطوة 1).
        $this->assertSame(115000, $statement['data']['closing_balance_minor']);
        $this->withToken($secret)->getJson('/api/v1/partners')->assertOk();

        $this->markTestIncomplete(
            'D-08 مفتوح (معروف): مستخدم بلا reports.view أصدر مفتاح statements:read وقرأ به رصيداً. يُغلقه AIA-0.4؛ عندها يمرّ هذا الاختبار صارماً.'
        );
    }

    #[Test]
    public function invariant_a_user_who_holds_the_matching_permission_can_still_issue_it(): void
    {
        // يصحّ قبل الإصلاح وبعده: السقف لا يمنع من يملك الصلاحية فعلاً.
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        app(TenantContext::class)->set($owner['tenant_id']);
        Role::create([
            'tenant_id' => $owner['tenant_id'], 'slug' => 'dev_reports', 'name' => 'Dev + reports',
            'permissions' => ['developer.view', 'developer.manage', 'reports.view'],
        ]);
        app(TenantContext::class)->forget();
        $token = $this->tokenForRole($owner['tenant_id'], 'dev_reports', 'dr@acme.test');

        $this->attemptIssue($token, ['statements:read'])->assertCreated()->assertJsonStructure(['secret']);
    }

    #[Test]
    public function invariant_the_owner_can_issue_any_known_scope(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');

        $this->attemptIssue($owner['token'], \App\Support\PublicApiScope::all())
            ->assertCreated()->assertJsonStructure(['secret']);
    }
}
