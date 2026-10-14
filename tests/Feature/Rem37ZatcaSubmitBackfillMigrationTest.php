<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * REM-37 / SEC-07 — هجرة التوافق: `zatca.submit` لكل دور مخزَّن كان يملك `invoices.manage`.
 *
 * تُشغَّل `up()` يدوياً على بيانات مُدخلة خاماً (نصوص JSON بأيدينا) لإثبات الحرفية:
 * ما لا يُفترض أن يتغيّر لا يتغيّر بايتاً، وما يتغيّر يُلحَق بآخر القائمة فقط.
 *
 * تشغيل: php artisan test --filter=Rem37ZatcaSubmitBackfillMigrationTest
 */
class Rem37ZatcaSubmitBackfillMigrationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const MIGRATION = 'database/migrations/2026_11_08_010000_backfill_zatca_submit_permission_for_invoice_managers.php';

    private const FIXED_TS = '2026-01-01 00:00:00';

    private function migrate(): void
    {
        $migration = require base_path(self::MIGRATION);
        $migration->up();
    }

    /** يُدخل صفاً خاماً بنص JSON حرفي لنقارنه لاحقاً بايتاً ببايت. */
    private function rawRole(string $tenantId, string $slug, string $json, bool $system = false, ?string $deletedAt = null): string
    {
        $id = (string) Str::uuid();
        DB::table('roles')->insert([
            'id' => $id, 'tenant_id' => $tenantId, 'slug' => $slug, 'name' => $slug,
            'permissions' => $json, 'is_system' => $system,
            'created_at' => self::FIXED_TS, 'updated_at' => self::FIXED_TS, 'deleted_at' => $deletedAt,
        ]);

        return $id;
    }

    private function stored(string $id): object
    {
        return DB::table('roles')->where('id', $id)->first(['permissions', 'updated_at']);
    }

    private function perms(string $id): array
    {
        return json_decode((string) $this->stored($id)->permissions, true);
    }

    private function raw(string $id): string
    {
        return (string) $this->stored($id)->permissions;
    }

    // ═══════════════ 1 — دور مخصَّص بـ invoices.manage يحصل على zatca.submit ═══════════════

    /** @test */
    public function a_custom_role_with_invoices_manage_receives_zatca_submit_appended_last(): void
    {
        $t = $this->registerTenant('mig1', 'owner@mig1.test')['tenant_id'];
        $id = $this->rawRole($t, 'cashier_plus', '["invoices.view","invoices.manage","zatca.view","reports.view"]');

        $this->migrate();

        $this->assertSame(
            ['invoices.view', 'invoices.manage', 'zatca.view', 'reports.view', 'zatca.submit'],
            $this->perms($id),
        );
    }

    /** @test */
    public function the_stored_system_accountant_of_an_existing_tenant_is_upgraded(): void
    {
        $t = $this->registerTenant('mig1b', 'owner@mig1b.test')['tenant_id'];
        // حالة ما قبل REM-37: صف المحاسب المزروع بلا zatca.submit.
        $legacy = array_values(array_diff(\App\Support\Rbac::MATRIX['accountant'], ['zatca.submit']));
        DB::table('roles')->where('tenant_id', $t)->where('slug', 'accountant')
            ->update(['permissions' => json_encode($legacy)]);

        $this->migrate();

        app(TenantContext::class)->set($t);
        $this->assertTrue(Role::where('slug', 'accountant')->firstOrFail()->grants('zatca.submit'));
        $this->assertSame($legacy, array_slice(
            json_decode((string) DB::table('roles')->where('tenant_id', $t)->where('slug', 'accountant')->value('permissions'), true),
            0, count($legacy),
        ), 'القائمة القديمة بنفس ترتيبها في المقدّمة');
    }

    // ═══════════════ 2 — دور بلا invoices.manage لا يتغيّر ═══════════════

    /** @test */
    public function roles_without_invoices_manage_are_untouched_byte_for_byte(): void
    {
        $t = $this->registerTenant('mig2', 'owner@mig2.test')['tenant_id'];
        $cases = [
            'viewer'  => '["invoices.view","zatca.view"]',
            'empty'   => '[]',
            'staffish' => '["partners.view","products.view","reports.view"]',
            'selfsvc' => '["self_service.access"]',
            'lookalike' => '["invoices.manage_all","xinvoices.manage","invoices.view"]', // لا مطابقة جزئية
        ];
        $ids = [];
        foreach ($cases as $slug => $json) {
            $ids[$slug] = $this->rawRole($t, $slug, $json);
        }

        $this->migrate();

        foreach ($cases as $slug => $json) {
            $this->assertSame($json, $this->raw($ids[$slug]), "{$slug}: بايتاً ببايت");
            $this->assertSame(self::FIXED_TS, (string) $this->stored($ids[$slug])->updated_at, "{$slug}: لم يُكتب الصف");
        }
    }

    // ═══════════════ 3 — الأدوار الشاملة تبقى كما هي حرفياً ═══════════════

    /** @test */
    public function wildcard_roles_stay_byte_equivalent_even_when_they_also_list_invoices_manage(): void
    {
        $t = $this->registerTenant('mig3', 'owner@mig3.test')['tenant_id'];
        $star = $this->rawRole($t, 'star', '["*"]');
        $starPlus = $this->rawRole($t, 'star_plus', '["*","invoices.manage"]');
        $starLate = $this->rawRole($t, 'star_late', '["invoices.manage","*"]');

        $ownerAdmin = DB::table('roles')->where('tenant_id', $t)->whereIn('slug', ['owner', 'admin'])->get(['id', 'permissions']);
        $this->assertCount(2, $ownerAdmin);

        $this->migrate();

        $this->assertSame('["*"]', $this->raw($star));
        $this->assertSame('["*","invoices.manage"]', $this->raw($starPlus));
        $this->assertSame('["invoices.manage","*"]', $this->raw($starLate));
        foreach ($ownerAdmin as $row) {
            $this->assertSame($row->permissions, $this->raw($row->id), 'owner/admin الأصليان بلا تغيير');
        }
    }

    // ═══════════════ 4 — لا تكرار على بيانات مُرقّاة + عدم التأثر بإعادة التشغيل ═══════════════

    /** @test */
    public function already_upgraded_roles_get_no_duplicate_and_rerunning_is_a_no_op(): void
    {
        $t = $this->registerTenant('mig4', 'owner@mig4.test')['tenant_id'];
        $done = $this->rawRole($t, 'done', '["invoices.manage","zatca.submit","reports.view"]');
        $fresh = $this->rawRole($t, 'fresh', '["invoices.manage"]');

        $this->migrate();

        $this->assertSame('["invoices.manage","zatca.submit","reports.view"]', $this->raw($done));
        $this->assertSame(self::FIXED_TS, (string) $this->stored($done)->updated_at);
        $this->assertSame(['invoices.manage', 'zatca.submit'], $this->perms($fresh));

        $afterFirst = [$this->raw($done), $this->raw($fresh)];
        $this->migrate();
        $this->migrate();
        $this->assertSame($afterFirst, [$this->raw($done), $this->raw($fresh)], 'إعادة التشغيل بلا أثر');
        $this->assertCount(1, array_keys($this->perms($fresh), 'zatca.submit', true));
    }

    // ═══════════════ 5 — بقية الصلاحيات حرفية ═══════════════

    /** @test */
    public function unrelated_permissions_keep_their_exact_values_and_order(): void
    {
        $t = $this->registerTenant('mig5', 'owner@mig5.test')['tenant_id'];
        $original = [
            'pos.session.handover.confirm', 'invoices.manage', 'zatca.view', 'fuel.shift.cash_variance_review',
            'products.view_cost', 'sales.minimum_price_override', 'partners.manage',
        ];
        $id = $this->rawRole($t, 'mix', json_encode($original));

        $this->migrate();

        $after = $this->perms($id);
        $this->assertSame($original, array_slice($after, 0, count($original)), 'المفاتيح الأصلية حرفياً وبترتيبها');
        $this->assertSame(['zatca.submit'], array_slice($after, count($original)), 'الإضافة الوحيدة');
        $this->assertSame(count($original) + 1, count($after));
    }

    /** @test */
    public function soft_deleted_roles_are_upgraded_too_so_a_restore_does_not_lose_the_capability(): void
    {
        $t = $this->registerTenant('mig5b', 'owner@mig5b.test')['tenant_id'];
        $id = $this->rawRole($t, 'gone', '["invoices.manage"]', false, '2026-02-02 00:00:00');

        $this->migrate();

        $this->assertSame(['invoices.manage', 'zatca.submit'], $this->perms($id));
    }

    /** @test */
    public function an_unreadable_permissions_value_is_left_alone(): void
    {
        $t = $this->registerTenant('mig5c', 'owner@mig5c.test')['tenant_id'];
        $obj = $this->rawRole($t, 'weird_obj', '{"invoices.manage":true}');
        $scalar = $this->rawRole($t, 'weird_scalar', '"invoices.manage"');

        $this->migrate();

        $this->assertSame('{"invoices.manage":true}', $this->raw($obj));
        $this->assertSame('"invoices.manage"', $this->raw($scalar));
    }

    // ═══════════════ 6 — المستأجرون: صفاً صفاً، بلا تسرّب ═══════════════

    /** @test */
    public function the_migration_is_per_row_across_tenants_and_never_leaks_between_them(): void
    {
        $a = $this->registerTenant('mig6a', 'owner@mig6a.test')['tenant_id'];
        $b = $this->registerTenant('mig6b', 'owner@mig6b.test')['tenant_id'];

        // نفس الـslug في المستأجرين، بمحتويات مختلفة.
        $aMgr = $this->rawRole($a, 'ops', '["invoices.view","invoices.manage"]');
        $bView = $this->rawRole($b, 'ops', '["invoices.view"]');
        $bMgr = $this->rawRole($b, 'finance', '["invoices.manage","zatca.view"]');

        $this->migrate();

        $this->assertSame(['invoices.view', 'invoices.manage', 'zatca.submit'], $this->perms($aMgr));
        $this->assertSame('["invoices.view"]', $this->raw($bView), 'دور ب بلا invoices.manage لم يتأثر بتعديل دور أ المماثل بالاسم');
        $this->assertSame(['invoices.manage', 'zatca.view', 'zatca.submit'], $this->perms($bMgr), 'وصف ب المؤهّل ترقّى بصفّه هو');

        // وتحرير دورٍ في أ بعد الهجرة لا يمسّ ب.
        $bSnapshot = [$this->raw($bView), $this->raw($bMgr)];
        DB::table('roles')->where('id', $aMgr)->update(['permissions' => '["invoices.view"]']);
        $this->assertSame($bSnapshot, [$this->raw($bView), $this->raw($bMgr)]);
    }

    // ═══════════════ 7 — بعد الهجرة: إزالة zatca.submit مع بقاء invoices.manage ⇒ 403 ═══════════════

    /** @test */
    public function after_the_backfill_removing_zatca_submit_while_keeping_invoices_manage_returns_403(): void
    {
        $auth = $this->registerTenant('mig7', 'owner@mig7.test');
        $t = $auth['tenant_id'];
        app(TenantContext::class)->set($t);

        $branch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $partner = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
        $invoice = function () use ($auth, $partner, $branch) {
            $draft = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branch])->postJson('/api/invoices', [
                'partner_id' => $partner, 'payment_type' => 'credit',
                'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            ])->assertCreated()['data'];

            return $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branch])
                ->postJson("/api/invoices/{$draft['id']}/post")->assertOk()['data']['id'];
        };
        $inv1 = $invoice();
        $inv2 = $invoice();
        $att = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branch, 'Idempotency-Key' => 'seed'])
            ->postJson("/api/invoices/{$inv1}/zatca/submissions")->assertStatus(202)['data']['id'];

        // دور مخزَّن كما كان قبل REM-37: invoices.manage بلا zatca.submit.
        $roleId = $this->rawRole($t, 'legacy_ops', '["invoices.view","invoices.manage","zatca.view"]');
        $user = User::create([
            'tenant_id' => $t, 'name' => 'ops', 'email' => 'ops@mig7.test', 'password' => 'password123', 'role' => 'legacy_ops',
        ]);
        $token = $user->createToken('api')->plainTextToken;

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $send = fn (string $inv, string $key) => $this->withToken($token)
            ->withHeaders(['X-Branch-Id' => $branch, 'Idempotency-Key' => $key])
            ->postJson("/api/invoices/{$inv}/zatca/submissions");
        $dispatch = fn () => $this->withToken($token)->withHeaders(['X-Branch-Id' => $branch])
            ->postJson("/api/invoices/{$inv1}/zatca/submissions/{$att}/dispatch");

        // قبل الهجرة (حالة النشر الأولى): الدور القديم محجوب ⇒ هذا هو سبب وجود الهجرة.
        $send($inv2, 'pre')->assertForbidden();

        $this->migrate();

        // بعدها: يعمل كما كان قبل REM-37.
        $send($inv2, 'post')->assertStatus(202);

        // نُزيل zatca.submit ونُبقي invoices.manage ⇒ 403 على المسارين، ولا مسار بديل.
        DB::table('roles')->where('id', $roleId)->update(['permissions' => '["invoices.view","invoices.manage","zatca.view"]']);
        $attempts = DB::table('zatca_submission_attempts')->count();
        $send($inv1, 'after-removal')->assertForbidden();
        $dispatch()->assertForbidden();
        $this->assertSame($attempts, DB::table('zatca_submission_attempts')->count());
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }
}
