<?php

namespace Tests\Feature;

use App\Jobs\Accounting\SendZatcaSubmission;
use App\Models\Role;
use App\Models\User;
use App\Models\ZatcaCredential;
use App\Services\TenantApplicationService;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-37 / SEC-07 — صلاحية `zatca.submit` المستقلة (فصل المهام)
 * ═══════════════════════════════════════════════════════════════
 *  مساران فقط يتغيّران:
 *    POST /invoices/{id}/zatca/submissions                      (store)
 *    POST /invoices/{id}/zatca/submissions/{attemptId}/dispatch (dispatch)
 *  كانا يطلبان `invoices.manage`؛ يطلبان الآن `zatca.submit` وحدها مع بقاء
 *  `compliance.zatca` والـthrottle وحارس REM-03b (الفرع النشط فقط) وربط المحاولة.
 *  القراءة `GET …/submissions` تبقى `zatca.view`.
 *
 *  ترتيب الطبقات (مُوصَّف لا مُغيَّر): صلاحية 403 ← أهلية compliance.zatca 403 ←
 *  (المتحكّم) فرع/مستأجر/محاولة 404.
 *
 *  تشغيل: php artisan test --filter=Rem37ZatcaSubmitPermissionTest
 */
class Rem37ZatcaSubmitPermissionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    // ───────────────────────── عالم الاختبار ─────────────────────────

    /** @return array<string, mixed> */
    private function world(string $slug = 'rem37'): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $tid = $auth['tenant_id'];
        app(TenantContext::class)->set($tid);
        $owner = $auth['token'];

        $a = $this->withToken($owner)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $b = $this->withToken($owner)->postJson('/api/branches', ['name' => 'فرع ب'])->assertCreated()['data']['id'];
        $partner = $this->withToken($owner)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        // أدوار مخصَّصة مخزَّنة بصلاحيات صريحة (كما في بيانات الإنتاج).
        $this->role($tid, 'zviewer', ['invoices.view', 'zatca.view']);                       // قراءة فقط
        $this->role($tid, 'imanager', ['invoices.view', 'invoices.manage', 'zatca.view']);   // كان يرسل قبل REM-37
        $this->role($tid, 'submitter', ['zatca.submit']);                                    // بلا view وبلا invoices.manage
        $this->role($tid, 'submitter_view', ['invoices.view', 'zatca.view', 'zatca.submit']);

        return [
            'tid' => $tid, 'owner' => $owner, 'a' => $a, 'b' => $b, 'partner' => $partner,
            'viewer'   => $this->userToken($tid, 'zviewer', "viewer@{$slug}.test", []),
            'imanager' => $this->userToken($tid, 'imanager', "imanager@{$slug}.test", []),
            'submitter' => $this->userToken($tid, 'submitter', "submitter@{$slug}.test", []),
            'submitterAB' => $this->userToken($tid, 'submitter', "submitterab@{$slug}.test", [$a, $b]),
            'submitterA'  => $this->userToken($tid, 'submitter', "submittera@{$slug}.test", [$a]),
            'both' => $this->userToken($tid, 'submitter_view', "both@{$slug}.test", []),
            'admin' => $this->userToken($tid, 'admin', "admin@{$slug}.test", []),
            'staff' => $this->userToken($tid, 'staff', "staff@{$slug}.test", []),
        ];
    }

    /** @param array<int, string> $permissions */
    private function role(string $tid, string $slug, array $permissions): void
    {
        app(TenantContext::class)->set($tid);
        Role::create([
            'tenant_id' => $tid, 'slug' => $slug, 'name' => $slug,
            'permissions' => $permissions, 'is_system' => false,
        ]);
    }

    /** @param array<int, string> $branchIds فارغة = غير مقيَّد */
    private function userToken(string $tid, string $role, string $email, array $branchIds): string
    {
        app(TenantContext::class)->set($tid);
        $user = User::create([
            'tenant_id' => $tid, 'name' => $role, 'email' => $email,
            'password' => 'password123', 'role' => $role,
        ]);
        if ($branchIds !== []) {
            $user->branches()->sync($branchIds);
        }

        return $user->createToken('api')->plainTextToken;
    }

    private function postedInvoice(array $w, string $branch): array
    {
        $draft = $this->withToken($w['owner'])->withHeaders(['X-Branch-Id' => $branch])->postJson('/api/invoices', [
            'partner_id' => $w['partner'], 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        return $this->withToken($w['owner'])->withHeaders(['X-Branch-Id' => $branch])
            ->postJson("/api/invoices/{$draft['id']}/post")->assertOk()['data'];
    }

    /** يجعل نقل ZATCA «جاهزاً» (محاكاة): لو تسرّب حارسٌ لدُفعت مهمة فعلاً. */
    private function zatcaReady(array $w): void
    {
        app(TenantContext::class)->set($w['tid']);
        ZatcaCredential::create([
            'environment' => 'simulation', 'stage' => 'production', 'status' => 'configured',
            'credentials' => ['binary_security_token' => 'csid', 'secret' => 'secret'],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(), 'expires_at' => now()->addDay(),
        ]);
        Settings::put('zatca', ['active_environment' => 'simulation']);
        config([
            'zatca.transport.dispatch_enabled' => true,
            'zatca.transport.queue_connection' => 'database',
            'zatca.transport.queue' => 'zatca',
        ]);
    }

    /** محاولة pending بيد المالك قبل تفعيل النقل (لا طابور). */
    private function attemptFor(array $w, array $invoice, string $branch, string $key): string
    {
        return $this->withToken($w['owner'])->withHeaders(['X-Branch-Id' => $branch, 'Idempotency-Key' => $key])
            ->postJson("/api/invoices/{$invoice['id']}/zatca/submissions")
            ->assertStatus(202)['data']['id'];
    }

    private function store(string $token, string $invoiceId, string $key, ?string $branch = null, string $q = '')
    {
        return $this->withToken($token)
            ->withHeaders(array_filter(['X-Branch-Id' => $branch, 'Idempotency-Key' => $key]))
            ->postJson("/api/invoices/{$invoiceId}/zatca/submissions{$q}");
    }

    private function dispatchAttempt(string $token, string $invoiceId, string $attemptId, ?string $branch = null, string $q = '')
    {
        return $this->withToken($token)
            ->withHeaders(array_filter(['X-Branch-Id' => $branch]))
            ->postJson("/api/invoices/{$invoiceId}/zatca/submissions/{$attemptId}/dispatch{$q}");
    }

    // ───────────────────────── لقطات «لا أثر عند الرفض» ─────────────────────────

    private function counts(): array
    {
        return [
            'attempts' => DB::table('zatca_submission_attempts')->count(),
            'invoices' => DB::table('invoices')->count(),
            'journal_entries' => DB::table('journal_entries')->count(),
            'journal_lines' => DB::table('journal_lines')->count(),
            'stock_movements' => DB::table('stock_movements')->count(),
            'payments' => DB::table('payments')->count(),
            'max_icv' => DB::table('invoices')->max('zatca_icv'),
            'jobs' => DB::table('jobs')->count(),
        ];
    }

    private function row(string $table, string $id): array
    {
        return (array) DB::table($table)->where('id', $id)->first();
    }

    private function assertNoTrace(array $countsBefore): void
    {
        $this->assertSame($countsBefore, $this->counts());
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    // ═══════════════ A — `zatca.view` فقط: يقرأ ولا يُرسل ═══════════════

    /** @test */
    public function view_only_can_read_but_cannot_submit_or_dispatch(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $att = $this->attemptFor($w, $inv, $w['a'], 'seed');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        // القراءة تعمل ببنيتها المعتادة.
        $this->withToken($w['viewer'])->getJson("/api/invoices/{$inv['id']}/zatca/submissions")
            ->assertOk()->assertJsonPath('data.0.id', $att)->assertJsonStructure(['data' => [['id', 'invoice_id', 'status', 'queue_count']]]);

        $before = $this->counts();
        $attemptRow = $this->row('zatca_submission_attempts', $att);
        $invoiceRow = $this->row('invoices', $inv['id']);

        $this->store($w['viewer'], $inv['id'], 'v-1', $w['a'])->assertForbidden();
        $this->dispatchAttempt($w['viewer'], $inv['id'], $att, $w['a'])->assertForbidden();

        $this->assertSame($attemptRow, $this->row('zatca_submission_attempts', $att));
        $this->assertSame($invoiceRow, $this->row('invoices', $inv['id']));
        $this->assertNoTrace($before);
    }

    // ═══════════════ B — `invoices.manage` فقط: الاختبار السلبي الجوهري ═══════════════

    /** @test */
    public function invoices_manage_alone_no_longer_authorises_zatca_submission(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $att = $this->attemptFor($w, $inv, $w['a'], 'seed');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        $before = $this->counts();
        $attemptRow = $this->row('zatca_submission_attempts', $att);

        $this->store($w['imanager'], $inv['id'], 'im-1', $w['a'])->assertForbidden();
        $this->dispatchAttempt($w['imanager'], $inv['id'], $att, $w['a'])->assertForbidden();
        $this->assertSame($attemptRow, $this->row('zatca_submission_attempts', $att));
        $this->assertNoTrace($before);

        // `invoices.manage` لم يُمسّ خارج مسارَي الإرسال: ما زال ينشئ مسودة فاتورة.
        $this->withToken($w['imanager'])->postJson('/api/invoices', [
            'partner_id' => $w['partner'], 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 5000, 'tax_rate' => 15]],
        ])->assertCreated();

        // وقراءة ZATCA مرهونة بـ`zatca.view` وهو يملكها.
        $this->withToken($w['imanager'])->getJson("/api/invoices/{$inv['id']}/zatca/submissions")->assertOk();
    }

    // ═══════════════ C — `zatca.submit` وحدها تكفي (مستقلة عن view) ═══════════════

    /** @test */
    public function submit_alone_passes_the_gate_for_store_and_dispatch_without_view_or_invoices_manage(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $fresh = $this->postedInvoice($w, $w['a']); // store على فاتورة بلا محاولة (وإلا 409 تعارض قائم)
        $att = $this->attemptFor($w, $inv, $w['a'], 'seed');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        // dispatch لمحاولة قائمة ⇒ مهمة واحدة في الطابور.
        $this->dispatchAttempt($w['submitter'], $inv['id'], $att, $w['a'])
            ->assertStatus(202)->assertJsonPath('data.queue_count', 1);
        Queue::assertPushed(SendZatcaSubmission::class, 1);

        // store بمفتاح جديد ⇒ محاولة جديدة + مهمة (النقل مفعّل)، وردّ المتحكّم بنيته كما هي.
        $this->store($w['submitter'], $fresh['id'], 'sub-new', $w['a'])
            ->assertJsonPath('meta.network_submission_performed', false)
            ->assertJsonStructure(['data' => ['id', 'status'], 'meta' => ['created', 'dispatch_status', 'queue_dispatch_performed']]);
        Http::assertNothingSent();

        // الاستقلال في الاتجاه المعاكس: `zatca.submit` لا تمنح القراءة.
        $this->withToken($w['submitter'])->getJson("/api/invoices/{$inv['id']}/zatca/submissions")->assertForbidden();
        // وصاحب الاثنتين يقرأ ويرسل.
        $this->withToken($w['both'])->getJson("/api/invoices/{$inv['id']}/zatca/submissions")->assertOk();
    }

    // ═══════════════ D — الأهلية المعطّلة: 403 قائم بلا أثر ═══════════════

    /** @test */
    public function entitlement_disabled_still_denies_a_submit_holder_without_side_effects(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $att = $this->attemptFor($w, $inv, $w['a'], 'seed');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        app(TenantContext::class)->set($w['tid']);
        app(TenantApplicationService::class)->disable('compliance.zatca', null);

        $before = $this->counts();
        $attemptRow = $this->row('zatca_submission_attempts', $att);

        $this->store($w['submitter'], $inv['id'], 'ent-1', $w['a'])->assertForbidden();
        $this->dispatchAttempt($w['submitter'], $inv['id'], $att, $w['a'])->assertForbidden();
        $this->store($w['owner'], $inv['id'], 'ent-2', $w['a'])->assertForbidden(); // حتى المالك: الأهلية بوابة مستقلة

        $this->assertSame($attemptRow, $this->row('zatca_submission_attempts', $att));
        $this->assertNoTrace($before);
    }

    // ═══════════════ E — الفرع النشط الخاطئ: REM-03b يبقى حاكماً بعد الصلاحية ═══════════════

    /** @test */
    public function wrong_active_branch_is_404_after_the_permission_passes_and_leaves_no_trace(): void
    {
        $w = $this->world();
        $invB = $this->postedInvoice($w, $w['b']);
        $attB = $this->attemptFor($w, $invB, $w['b'], 'seed-b');
        $legacy = $this->postedInvoice($w, $w['a']);
        DB::table('invoices')->where('id', $legacy['id'])->update([
            'branch_id' => null,
            'number' => preg_replace('/(\d+)$/', '9$1', (string) DB::table('invoices')->where('id', $legacy['id'])->value('number')),
        ]);

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        $before = $this->counts();
        $attemptRow = $this->row('zatca_submission_attempts', $attB);
        $invoiceRow = $this->row('invoices', $invB['id']);

        foreach (['', '?branch=all'] as $q) {
            // A+B مسموح، A نشط، فاتورة B ⇒ 404 (وليس 403: الصلاحية تعدّت).
            $this->store($w['submitterAB'], $invB['id'], 'wb-1', $w['a'], $q)->assertNotFound();
            $this->dispatchAttempt($w['submitterAB'], $invB['id'], $attB, $w['a'], $q)->assertNotFound();
            // مالك غير مقيَّد بفرع خاطئ.
            $this->store($w['owner'], $invB['id'], 'wb-2', $w['a'], $q)->assertNotFound();
            $this->dispatchAttempt($w['owner'], $invB['id'], $attB, $w['a'], $q)->assertNotFound();
        }
        // مقيَّد بـA بترويسة فرع غير مسموح.
        $this->store($w['submitterA'], $invB['id'], 'wb-3', $w['b'])->assertNotFound();

        $this->assertSame($attemptRow, $this->row('zatca_submission_attempts', $attB));
        $this->assertSame($invoiceRow, $this->row('invoices', $invB['id']));
        $this->assertNoTrace($before);

        // الفرع الصحيح: يمضي. ثم فاتورة بلا فرع (قديمة) تبقى على تعريفها الحالي: تُقبل من أي فرع نشط.
        $this->dispatchAttempt($w['submitterAB'], $invB['id'], $attB, $w['b'])->assertStatus(202);
        Queue::assertPushed(SendZatcaSubmission::class, 1);

        $this->store($w['submitterAB'], $legacy['id'], 'legacy-1', $w['a'])->assertStatus(202);
    }

    // ═══════════════ F — عزل المستأجرين ═══════════════

    /** @test */
    public function submit_never_crosses_tenants_and_foreign_rows_stay_untouched(): void
    {
        $w1 = $this->world('rem37-t1');
        $w2 = $this->world('rem37-t2');
        $own = $this->postedInvoice($w1, $w1['a']);
        $foreign = $this->postedInvoice($w2, $w2['a']);
        $foreignAtt = $this->attemptFor($w2, $foreign, $w2['a'], 'f-att');
        $ownAtt = $this->attemptFor($w1, $own, $w1['a'], 'o-att');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w1);
        $this->zatcaReady($w2);

        $before = $this->counts();
        $foreignRows = [$this->row('zatca_submission_attempts', $foreignAtt), $this->row('invoices', $foreign['id'])];
        $ownRow = $this->row('zatca_submission_attempts', $ownAtt);

        // مستأجر 1: حامل `zatca.submit` وكذلك المالك (`*`) على معرّفات مستأجر 2.
        foreach (['submitter', 'owner'] as $who) {
            $this->store($w1[$who], $foreign['id'], "x-{$who}", $w2['a'])->assertNotFound();
            $this->store($w1[$who], $foreign['id'], "x2-{$who}", $w1['a'])->assertNotFound();
            $this->dispatchAttempt($w1[$who], $foreign['id'], $foreignAtt, $w1['a'])->assertNotFound();
            // فاتورتي + محاولة المستأجر الآخر ⇒ 404 (ربط المحاولة + TenantScope).
            $this->dispatchAttempt($w1[$who], $own['id'], $foreignAtt, $w1['a'])->assertNotFound();
        }
        $this->store($w1['submitter'], '00000000-0000-4000-8000-000000000000', 'nx', $w1['a'])->assertNotFound();

        $this->assertSame($foreignRows, [$this->row('zatca_submission_attempts', $foreignAtt), $this->row('invoices', $foreign['id'])]);
        $this->assertSame($ownRow, $this->row('zatca_submission_attempts', $ownAtt));
        $this->assertNoTrace($before);

        // دور المستأجر 1 لا يمنح شيئاً في المستأجر 2: توكنه يُحلّ بدور مستأجره فقط.
        $this->dispatchAttempt($w2['submitter'], $foreign['id'], $foreignAtt, $w2['a'])->assertStatus(202);
        Queue::assertPushed(SendZatcaSubmission::class, 1);
    }

    // ═══════════════ G — ربط المحاولة بالفاتورة ═══════════════

    /** @test */
    public function an_attempt_of_another_invoice_cannot_be_dispatched_through_a_submit_holder(): void
    {
        $w = $this->world();
        $x = $this->postedInvoice($w, $w['a']);
        $y = $this->postedInvoice($w, $w['a']);
        $attY = $this->attemptFor($w, $y, $w['a'], 'att-y');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        $before = $this->counts();
        $row = $this->row('zatca_submission_attempts', $attY);
        $this->dispatchAttempt($w['submitter'], $x['id'], $attY, $w['a'])->assertNotFound();
        $this->assertSame($row, $this->row('zatca_submission_attempts', $attY));
        $this->assertNoTrace($before);
    }

    // ═══════════════ H — الأدوار الافتراضية ═══════════════

    /** @test */
    public function built_in_roles_map_zatca_submit_exactly_as_invoices_manage_did(): void
    {
        $this->assertContains('zatca.submit', Rbac::MATRIX['accountant']);
        $this->assertNotContains('zatca.submit', Rbac::MATRIX['staff']);
        $this->assertNotContains('zatca.submit', Rbac::MATRIX['self_service']);
        $this->assertSame(['*'], Rbac::MATRIX['owner']);
        $this->assertSame(['*'], Rbac::MATRIX['admin']);

        // قاعدة مشتقّة: كل دور نظامي غير شامل كان يملك invoices.manage ⇒ يملك zatca.submit، والعكس.
        foreach (Rbac::MATRIX as $slug => $permissions) {
            if (in_array('*', $permissions, true)) {
                continue;
            }
            $this->assertSame(
                in_array('invoices.manage', $permissions, true),
                in_array('zatca.submit', $permissions, true),
                "الدور {$slug}: zatca.submit ⇔ invoices.manage",
            );
        }

        // الدور المزروع لمستأجر جديد نسخةٌ طبق الأصل.
        $auth = $this->registerTenant('rem37-seed', 'owner@rem37-seed.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(Role::where('slug', 'accountant')->firstOrFail()->grants('zatca.submit'));
        $this->assertFalse(Role::where('slug', 'staff')->firstOrFail()->grants('zatca.submit'));
        $this->assertFalse(Role::where('slug', 'self_service')->firstOrFail()->grants('zatca.submit'));
    }

    /** @test */
    public function a_default_accountant_can_submit_and_default_staff_cannot(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $acct = $this->userToken($w['tid'], 'accountant', 'acct@rem37.test', []);

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();

        $this->store($acct, $inv['id'], 'acct-1', $w['a'])->assertStatus(202);
        $before = $this->counts();
        $this->store($w['staff'], $inv['id'], 'staff-1', $w['a'])->assertForbidden();
        $this->assertSame($before['attempts'], $this->counts()['attempts']);
    }

    // ═══════════════ I — كتالوج الصلاحيات ═══════════════

    /** @test */
    public function the_permission_catalogue_lists_zatca_submit_once_next_to_zatca_view(): void
    {
        $this->assertSame(1, count(array_keys(Rbac::PERMISSIONS, 'zatca.submit', true)));
        $this->assertSame(1, count(array_keys(Rbac::PERMISSIONS, 'zatca.view', true)));
        $this->assertSame(count(Rbac::PERMISSIONS), count(array_unique(Rbac::PERMISSIONS)), 'لا مفاتيح مكرّرة في الكتالوج');

        $zatca = array_values(array_filter(Rbac::PERMISSIONS, fn (string $p) => str_starts_with($p, 'zatca.')));
        sort($zatca);
        $this->assertSame(['zatca.submit', 'zatca.view'], $zatca, 'وحدة zatca: العرض والإرسال فقط');

        // الكتالوج الذي تستهلكه الواجهة (meta.permissions) هو نفسه المصدر.
        $auth = $this->registerTenant('rem37-cat', 'owner@rem37-cat.test');
        $meta = $this->withToken($auth['token'])->getJson('/api/roles')->assertOk()->json('meta.permissions');
        $this->assertSame(1, count(array_keys($meta, 'zatca.submit', true)));

        // يقبله التحقق عند إنشاء دور مخصَّص، ويرفض اسماً قريباً مجهولاً.
        $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مرسل', 'permissions' => ['zatca.submit'],
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'خاطئ', 'permissions' => ['zatca.submitt'],
        ])->assertStatus(422);
    }

    // ═══════════════ J — الشاملة `*` ═══════════════

    /** @test */
    public function owner_and_admin_wildcards_resolve_zatca_submit_inside_their_tenant(): void
    {
        $w = $this->world();
        $invO = $this->postedInvoice($w, $w['a']);
        $invA = $this->postedInvoice($w, $w['a']); // فاتورة لكلٍّ: محاولة ثانية على نفس الفاتورة = 409 قائم

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();

        $this->assertTrue(Rbac::allows('owner', 'zatca.submit'));
        $this->assertTrue(Rbac::allows('admin', 'zatca.submit'));

        $this->store($w['owner'], $invO['id'], 'own-1', $w['a'])->assertStatus(202);
        $this->store($w['admin'], $invA['id'], 'adm-1', $w['a'])->assertStatus(202);
    }

    // ═══════════════ K — إزالة الصلاحية مع بقاء invoices.manage ═══════════════

    /** @test */
    public function removing_zatca_submit_from_a_role_takes_effect_on_the_next_request(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $att = $this->attemptFor($w, $inv, $w['a'], 'seed');
        $this->role($w['tid'], 'both_perms', ['invoices.view', 'invoices.manage', 'zatca.view', 'zatca.submit']);
        $token = $this->userToken($w['tid'], 'both_perms', 'bothp@rem37.test', []);

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();

        // قبل الإزالة: الصلاحية تعدّت (أياً كان ردّ الحالة: محاولة جديدة أو مكرّرة) — المهم ليس 403.
        $this->assertNotSame(403, $this->store($token, $inv['id'], 'k-1', $w['a'])->getStatusCode());
        Role::where('slug', 'both_perms')->firstOrFail()->update(['permissions' => ['invoices.view', 'invoices.manage', 'zatca.view']]);

        $before = $this->counts();
        $this->store($token, $inv['id'], 'k-2', $w['a'])->assertForbidden();
        $this->dispatchAttempt($token, $inv['id'], $att, $w['a'])->assertForbidden();
        $this->assertSame($before['attempts'], $this->counts()['attempts']);
        Queue::assertNothingPushed();
    }
}
