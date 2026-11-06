<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\PublicApiKeyIssuanceGuard;
use App\Support\PublicApiScopeCeilingException;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AIA-0.4 / D-08 — اختبارات قبول صارمة لسقف صلاحيات إصدار مفاتيح Public API (REST).
 *
 * المبدأ: لا يستطيع المستخدم إصدار مفتاح بصلاحيات تتجاوز صلاحياته الفعلية. أي قبول لـscope غير
 * مصرَّح به **يُفشل** هذه الاختبارات. لا `skip` ولا `incomplete` ولا تفرُّع على نتيجة الإصدار
 * (يحرس ذلك `PublicApiScopeCeilingArchitectureTest`). مرجعها: `PublicApiScopeCeilingProofTest`
 * (PR #2030) الذي حُوِّل هنا من إثبات إلى رفض صارم.
 *
 * تشغيل: php artisan test --filter=PublicApiScopeCeilingEnforcementTest
 */
#[Group('aia-0-4-security')]
class PublicApiScopeCeilingEnforcementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const ISSUE_URI = '/api/developer/api-clients';

    /** أدوار مخصّصة تُنشأ لكل سيناريو. */
    private const ROLE_LIMITED = ['developer.view', 'developer.manage'];
    private const ROLE_READER = ['developer.view', 'developer.manage', 'partners.view', 'products.view', 'invoices.view', 'reports.view', 'apps.view'];

    private function role(string $tenantId, string $slug, array $permissions): void
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['tenant_id' => $tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions]);
        app(TenantContext::class)->forget();
    }

    /** مستأجر + مالك + مستخدمان بدورين مخصّصين (محدود/قارئ) + عميل API قائم للمالك. */
    private function scenario(string $slug = 'acme'): array
    {
        $owner = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->role($owner['tenant_id'], 'dev_limited', self::ROLE_LIMITED);
        $this->role($owner['tenant_id'], 'dev_reader', self::ROLE_READER);

        $client = $this->withToken($owner['token'])->postJson(self::ISSUE_URI, [
            'name' => 'existing', 'scopes' => ['partners:read'],
        ])->assertCreated();

        return [
            'tenant_id' => $owner['tenant_id'],
            'owner'     => $owner['token'],
            'limited'   => $this->tokenForRole($owner['tenant_id'], 'dev_limited', "limited@{$slug}.test"),
            'reader'    => $this->tokenForRole($owner['tenant_id'], 'dev_reader', "reader@{$slug}.test"),
            'client_id' => $client['client']['id'],
        ];
    }

    private function issue(string $token, array $scopes): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson(self::ISSUE_URI, ['name' => 'k', 'scopes' => $scopes]);
    }

    private function addKey(string $token, string $clientId, array $scopes): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson(self::ISSUE_URI."/{$clientId}/keys", ['name' => 'k2', 'scopes' => $scopes]);
    }

    /** @return array{clients:int,tokens:int} لقطة السجلات لإثبات أن الرفض لم يترك أثراً. */
    private function footprint(): array
    {
        return [
            'clients' => ApiClient::withoutGlobalScopes()->count(),
            'tokens'  => PersonalAccessToken::query()->count(),
        ];
    }

    private function assertRejectedWithoutTrace(\Illuminate\Testing\TestResponse $res, array $before, array $expectedDenied): void
    {
        $res->assertStatus(403)
            ->assertJsonPath('reason', 'scope_exceeds_issuer_permissions')
            ->assertJsonMissingPath('secret')
            ->assertJsonMissingPath('key')
            ->assertJsonMissingPath('client');
        $this->assertEqualsCanonicalizing($expectedDenied, $res->json('denied_scopes'));
        $this->assertSame($before, $this->footprint(), 'الرفض يجب ألّا يترك عميلاً ولا مفتاحاً.');
    }

    // ── خطّ الأساس (يبقى صحيحاً قبل الإصلاح وبعده) ───────────────────

    #[Test]
    public function baseline_the_limited_user_is_denied_the_statement_internally(): void
    {
        $s = $this->scenario();
        $partnerId = $this->withToken($s['owner'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->withToken($s['limited'])->getJson("/api/reports/partner-statement/{$partnerId}")->assertStatus(403);
        $this->withToken($s['limited'])->getJson('/api/partners')->assertStatus(403);
    }

    #[Test]
    public function baseline_developer_view_alone_cannot_issue(): void
    {
        $s = $this->scenario();
        $this->role($s['tenant_id'], 'dev_view_only', ['developer.view']);
        $viewer = $this->tokenForRole($s['tenant_id'], 'dev_view_only', 'v@acme.test');

        $this->issue($viewer, ['partners:read'])->assertStatus(403);
    }

    // ── (1) مستخدم محدود ← statements:read دون reports.view ← رفض ───

    #[Test]
    public function a_limited_user_cannot_issue_statements_read_without_reports_view(): void
    {
        $s = $this->scenario();
        $before = $this->footprint();

        $this->assertRejectedWithoutTrace($this->issue($s['limited'], ['statements:read']), $before, ['statements:read']);
    }

    // ── (2) صلاحية قراءة ← scope كتابة ← رفض ─────────────────────────

    public static function writeScopes(): array
    {
        return [
            'partners:write'  => ['partners:write'],
            'products:write'  => ['products:write'],
            'invoices:write'  => ['invoices:write'],
            'webhooks:write'  => ['webhooks:write'],
        ];
    }

    #[Test]
    #[DataProvider('writeScopes')]
    public function a_user_with_only_view_permissions_cannot_issue_a_write_scope(string $scope): void
    {
        $s = $this->scenario();
        $before = $this->footprint();

        $this->assertRejectedWithoutTrace($this->issue($s['reader'], [$scope]), $before, [$scope]);
    }

    #[Test]
    public function a_reader_can_issue_exactly_the_read_scopes_it_holds(): void
    {
        $s = $this->scenario();

        $this->issue($s['reader'], ['partners:read', 'products:read', 'invoices:read', 'statements:read', 'webhooks:read'])
            ->assertCreated()->assertJsonStructure(['secret']);
    }

    // ── (3) طلب مختلط ← رفض كامل ────────────────────────────────────

    #[Test]
    public function a_mixed_request_is_rejected_entirely_with_no_partial_issuance(): void
    {
        $s = $this->scenario();
        $before = $this->footprint();

        // partners:read مسموح للقارئ، invoices:write ممنوع ⇒ الطلب كاملاً مرفوض.
        $this->assertRejectedWithoutTrace(
            $this->issue($s['reader'], ['partners:read', 'invoices:write']), $before, ['invoices:write']
        );
        // محدود: كل ما في القائمة ممنوع.
        $this->assertRejectedWithoutTrace(
            $this->issue($s['limited'], ['partners:read', 'statements:read', 'webhooks:write']), $before,
            ['partners:read', 'statements:read', 'webhooks:write']
        );
    }

    // ── (4) Owner/Admin ─────────────────────────────────────────────

    #[Test]
    public function owner_and_admin_can_issue_every_known_scope(): void
    {
        $s = $this->scenario();
        $admin = $this->tokenForRole($s['tenant_id'], 'admin', 'admin@acme.test');

        foreach (['owner' => $s['owner'], 'admin' => $admin] as $who => $token) {
            $this->issue($token, PublicApiScope::all())
                ->assertCreated()->assertJsonStructure(['secret', 'key', 'client']);
        }
    }

    #[Test]
    public function a_holder_of_the_matching_permission_can_issue_it_back_compat_with_normal_use(): void
    {
        $s = $this->scenario();
        $this->role($s['tenant_id'], 'dev_reports', ['developer.view', 'developer.manage', 'reports.view']);
        $token = $this->tokenForRole($s['tenant_id'], 'dev_reports', 'dr@acme.test');

        $this->issue($token, ['statements:read'])->assertCreated()->assertJsonStructure(['secret']);
    }

    #[Test]
    public function builtin_accountant_and_staff_cannot_reach_issuance_at_all(): void
    {
        $s = $this->scenario();
        $tokens = [];
        foreach (['accountant', 'staff'] as $role) {
            $tokens[$role] = $this->tokenForRole($s['tenant_id'], $role, "{$role}@acme.test");
        }
        $before = $this->footprint();

        foreach ($tokens as $token) {
            $this->issue($token, ['partners:read'])->assertStatus(403);
        }
        $this->assertSame($before, $this->footprint());
    }

    // ── (5) مفتاح إضافي لعميل قائم يخضع للسقف نفسه ───────────────────

    #[Test]
    public function an_additional_key_for_an_existing_client_obeys_the_same_ceiling(): void
    {
        $s = $this->scenario();
        $before = $this->footprint();

        $this->assertRejectedWithoutTrace(
            $this->addKey($s['limited'], $s['client_id'], ['statements:read']), $before, ['statements:read']
        );
        $this->assertRejectedWithoutTrace(
            $this->addKey($s['reader'], $s['client_id'], ['partners:read', 'products:write']), $before, ['products:write']
        );

        // المخوَّل يُصدر، والمالك يُصدر.
        $this->addKey($s['reader'], $s['client_id'], ['statements:read'])->assertCreated()->assertJsonStructure(['secret']);
        $this->addKey($s['owner'], $s['client_id'], PublicApiScope::all())->assertCreated()->assertJsonStructure(['secret']);
    }

    // ── (8) المفاتيح القديمة تستمر ──────────────────────────────────

    #[Test]
    public function keys_issued_before_the_fix_keep_working_and_keep_their_scopes(): void
    {
        $s = $this->scenario();
        $partnerId = $this->withToken($s['owner'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        // مفتاح بالمسار القديم غير المقيَّد (الخدمة مباشرةً) بـscopes لا يغطيها أي مُصدِر محدود.
        $service = app(ApiClientKeyService::class);
        $client = $service->createClient(Tenant::findOrFail($s['tenant_id']), 'legacy');
        $legacy = $service->issueKey($client, 'legacy', ['statements:read', 'partners:read', 'invoices:write']);

        // الإصدار الجديد بعد الإصلاح لا يمسّ المفتاح القديم: لا تعديل لعباراته ولا إبطال.
        $this->issue($s['limited'], ['statements:read'])->assertStatus(403);

        $this->app['auth']->shouldUse('web');
        $this->app['auth']->forgetGuards();
        $this->withToken($legacy->plainTextToken)->getJson("/api/v1/partners/{$partnerId}/statement")->assertOk();
        $this->withToken($legacy->plainTextToken)->getJson('/api/v1/partners')->assertOk();

        $this->assertEqualsCanonicalizing(
            ['statements:read', 'partners:read', 'invoices:write'],
            PersonalAccessToken::query()->findOrFail($legacy->accessToken->getKey())->abilities
        );
    }

    // ── (9) عزل المستأجر ────────────────────────────────────────────

    #[Test]
    public function tenant_isolation_is_preserved_for_issuance(): void
    {
        $a = $this->scenario('acme');
        $b = $this->scenario('beta');
        $before = $this->footprint();

        // مالك مستأجر آخر لا يصل إلى عميل مستأجر A (404) ولا يترك أثراً.
        $this->addKey($b['owner'], $a['client_id'], ['partners:read'])->assertStatus(404);
        $this->assertSame($before, $this->footprint());

        // دور بالاسم نفسه في مستأجرين: السقف يُحلّ من صلاحيات دور مستأجر المُصدِر هو.
        $this->role($a['tenant_id'], 'shared_slug', ['developer.view', 'developer.manage', 'reports.view']);
        $this->role($b['tenant_id'], 'shared_slug', ['developer.view', 'developer.manage']);
        $inA = $this->tokenForRole($a['tenant_id'], 'shared_slug', 'sa@acme.test');
        $inB = $this->tokenForRole($b['tenant_id'], 'shared_slug', 'sb@beta.test');

        $this->issue($inA, ['statements:read'])->assertCreated();
        $this->assertRejectedWithoutTrace($this->issue($inB, ['statements:read']), $this->footprint(), ['statements:read']);
    }

    // ── نقطة مساعدة للواجهة ─────────────────────────────────────────

    #[Test]
    public function the_issuable_scopes_endpoint_reflects_the_issuers_ceiling(): void
    {
        $s = $this->scenario();

        $this->assertSame([], $this->withToken($s['limited'])->getJson('/api/developer/issuable-scopes')->assertOk()['data']['scopes']);
        $this->assertEqualsCanonicalizing(
            ['partners:read', 'products:read', 'invoices:read', 'statements:read', 'webhooks:read'],
            $this->withToken($s['reader'])->getJson('/api/developer/issuable-scopes')->assertOk()['data']['scopes']
        );
        $this->assertEqualsCanonicalizing(
            PublicApiScope::all(),
            $this->withToken($s['owner'])->getJson('/api/developer/issuable-scopes')->assertOk()['data']['scopes']
        );
    }

    #[Test]
    public function the_issuable_scopes_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/developer/issuable-scopes')->assertStatus(401);
    }

    #[Test]
    public function an_unknown_scope_is_still_a_validation_error_not_a_permission_error(): void
    {
        $s = $this->scenario();

        $this->issue($s['limited'], ['not:a-scope'])->assertStatus(422);
    }

    // ── سلطة الإصدار (developer.manage) في الحارس نفسه، لا في وسيط المسار وحده ──

    #[Test]
    public function the_guard_requires_developer_manage_independently_of_the_route_middleware(): void
    {
        $s = $this->scenario();
        $this->role($s['tenant_id'], 'partners_only', ['partners.view']);
        $this->tokenForRole($s['tenant_id'], 'partners_only', 'po@acme.test');
        $guard = app(PublicApiKeyIssuanceGuard::class);

        $holderless = User::query()->where('email', 'po@acme.test')->firstOrFail();
        $this->assertFalse($guard->mayIssue($holderless));
        $this->assertTrue($guard->mayIssue(User::query()->where('email', 'owner@acme.test')->firstOrFail()));
        $this->assertTrue($guard->mayIssue(User::query()->where('email', 'reader@acme.test')->firstOrFail()));

        // يملك partners.view المقابلة لـpartners:read لكن لا سلطة إصدار ⇒ الحارس يرفض بسبب مستقل.
        try {
            $guard->assertIssuable($holderless, ['partners:read']);
            $this->fail('كان يجب أن يُرفض المُصدِر الذي لا يملك developer.manage.');
        } catch (PublicApiScopeCeilingException $e) {
            $this->assertSame(PublicApiScopeCeilingException::REASON_LACKS_AUTHORITY, $e->reason());
            $this->assertSame([], $e->deniedScopes());
        }
    }
}
