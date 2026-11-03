<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\PartnerStatementImportService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A4a0 — واجهات القراءة N1–N4 (قائمة · رأس · سطور · سياق السطر/القرار في `matches`). **قراءة فقط**: العزل (مستأجر/فرع/طرف)، RBAC وبوابة القدرة،
 * لا تسريب في العدّادات والبحث والفرز، ثبات عدد الاستعلامات (لا N+1)، توافق `matches` القديمة، وعدم الأثر المالي.
 * تشغيل: php artisan test --filter=PartnerStatementReadApiTest
 */
class PartnerStatementReadApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const BASE = '/api/partner-statement-reconciliations';

    private array $auth;

    private User $owner;

    private Partner $customer;

    private Partner $supplier;

    private Partner $both;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant('ps-a4a0', 'owner@ps-a4a0.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a4a0.test')->firstOrFail();
        $this->customer = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل ألفا', 'is_active' => true]);
        $this->supplier = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد بيتا', 'is_active' => true]);
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف جاما', 'is_active' => true]);
    }

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    /** مقارنة مباشرة بالنموذج (بلا استيراد) لاختبارات القائمة: كل صف بهوية فريدة. @param array<string, mixed> $over */
    private function recon(array $over = [], ?string $tenantId = null): PartnerStatementReconciliation
    {
        app(TenantContext::class)->set($tenantId ?? $this->auth['tenant_id']);
        $this->seq++;
        $creator = $tenantId === null ? $this->owner->id : User::query()->where('tenant_id', $tenantId)->value('id');

        // `forceFill`: created_at/الحالة تُثبَّتان عند الإدراج (حراس القاعدة تمنع تعديلهما لاحقاً).
        $model = new PartnerStatementReconciliation;
        $model->forceFill($over + [
            'partner_id' => $this->customer->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30', 'currency' => 'SAR',
            'status' => 'draft', 'original_filename' => 'statement-'.$this->seq.'.csv', 'file_sha256' => hash('sha256', 'f'.$this->seq), 'identity_sha256' => hash('sha256', 'i'.$this->seq),
            'line_count' => 0, 'policy' => ['version' => 1, 'date_tolerance_days' => 3, 'amount_tolerance_minor' => 0, 'branch_id' => null], 'created_by' => $creator,
        ]);
        $model->save();

        return $model;
    }

    private function lineOf(PartnerStatementReconciliation $r, int $ordinal, array $over = []): PartnerStatementLine
    {
        app(TenantContext::class)->set((string) $r->tenant_id);

        return PartnerStatementLine::create($over + [
            'reconciliation_id' => $r->id, 'ordinal' => $ordinal, 'line_date' => '2026-09-'.str_pad((string) min(28, $ordinal), 2, '0', STR_PAD_LEFT),
            'reference' => 'REF-'.$ordinal, 'reference_key' => 'ref'.$ordinal, 'description' => 'سطر '.$ordinal, 'debit_minor' => 0, 'credit_minor' => 1000 * $ordinal,
        ]);
    }

    private function role(string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($this->auth['tenant_id'], $slug, $email);
    }

    private function restricted(string $slug, array $branchIds, array $permissions = ['partner_statements.view', 'partner_statements.reconcile', 'partners.view']): string
    {
        $token = $this->role($slug, $permissions, $slug.'@ps-a4a0.test');
        User::query()->where('email', $slug.'@ps-a4a0.test')->firstOrFail()->branches()->sync($branchIds);

        return $token;
    }

    private function list(string $token, array $query = [])
    {
        return $this->withToken($token)->getJson(self::BASE.($query === [] ? '' : '?'.http_build_query($query)));
    }

    /** @return list<string> */
    private function ids(string $token, array $query = []): array
    {
        return array_column($this->list($token, $query + ['per_page' => 50])->assertOk()->json('data'), 'id');
    }

    private function queryCount(callable $fn): int
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $fn();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    }

    /** @return array<string, int> */
    private function financialCounts(): array
    {
        $tables = ['journal_entries', 'journal_lines', 'account_balances', 'invoices', 'payments', 'purchases', 'stock_movements', 'credit_notes', 'return_documents'];

        return array_map(fn (string $t): int => DB::table($t)->count(), array_combine($tables, $tables));
    }

    // ═══════════════════════════════ N1: القائمة ═══════════════════════════════

    /** @test */
    public function the_list_returns_the_documented_shape_newest_first_with_consistent_pagination(): void
    {
        $branch = Branch::create(['code' => 'B1', 'name' => 'فرع الدمام']);
        $first = $this->recon(['original_filename' => 'a.csv', 'created_at' => '2026-10-01 10:00:00']);
        $second = $this->recon(['original_filename' => 'b.csv', 'created_at' => '2026-10-02 10:00:00', 'partner_id' => $this->both->id, 'policy' => ['version' => 1, 'branch_id' => $branch->id]]);

        $res = $this->list($this->auth['token'])->assertOk();
        $this->assertSame([$second->id, $first->id], array_column($res->json('data'), 'id'));
        $this->assertSame(['current_page' => 1, 'last_page' => 1, 'per_page' => 25, 'total' => 2], $res->json('meta'));

        $row = $res->json('data.0');
        $this->assertEqualsCanonicalizing([
            'id', 'status', 'role', 'partner_id', 'partner', 'branch_id', 'branch', 'period_from', 'period_to', 'currency', 'original_filename', 'line_count',
            'total_debit_minor', 'total_credit_minor', 'created_by', 'created_at', 'reviewed_at', 'closed_at', 'voided_at', 'superseded_by_id',
        ], array_keys($row));
        $this->assertSame(['id' => $this->both->id, 'name' => 'طرف جاما', 'name_en' => null, 'type' => 'both'], $row['partner']);
        $this->assertSame(['id' => $branch->id, 'name' => 'فرع الدمام', 'code' => 'B1'], $row['branch']);
        $this->assertSame('2026-09-01', $row['period_from']);
        $this->assertNull($res->json('data.1.branch'));

        // الترقيم: صفحتان بلا تكرار ولا فقد.
        foreach (range(1, 4) as $_) {
            $this->recon();
        }
        $p1 = $this->list($this->auth['token'], ['per_page' => 4, 'page' => 1])->assertOk();
        $p2 = $this->list($this->auth['token'], ['per_page' => 4, 'page' => 2])->assertOk();
        $this->assertSame(6, $p1->json('meta.total'));
        $this->assertSame(2, $p1->json('meta.last_page'));
        $this->assertCount(4, $p1->json('data'));
        $this->assertCount(2, $p2->json('data'));
        $this->assertSame([], array_intersect(array_column($p1->json('data'), 'id'), array_column($p2->json('data'), 'id')));
    }

    /** @test */
    public function the_list_filters_by_status_partner_role_period_branch_and_search(): void
    {
        $branch = Branch::create(['code' => 'B1', 'name' => 'فرع']);
        $draft = $this->recon(['original_filename' => 'invoices-sept.csv']);
        $other = $this->recon(['original_filename' => 'oct.csv', 'period_from' => '2026-10-01', 'period_to' => '2026-10-31', 'policy' => ['version' => 1, 'branch_id' => $branch->id]]);
        $supplierRecon = $this->recon(['role' => 'supplier', 'partner_id' => $this->supplier->id, 'original_filename' => 'مورد-سبتمبر.csv']);
        // حالة `reviewed` حقيقية عبر الدورة الكاملة (الإدراج المباشر بغير draft محروس في القاعدة).
        $reviewed = $this->reviewedReconciliation();
        $token = $this->auth['token'];

        $this->assertEqualsCanonicalizing([$draft->id, $other->id, $supplierRecon->id], $this->ids($token, ['status' => ['draft']]));
        $this->assertSame([$reviewed], $this->ids($token, ['status' => ['reviewed']]));
        $this->assertSame([], $this->ids($token, ['status' => ['closed', 'voided', 'superseded']]));
        $this->assertCount(4, $this->ids($token, ['status' => ['draft', 'reviewed']]));
        $this->assertSame([$supplierRecon->id], $this->ids($token, ['role' => 'supplier']));
        $this->assertEqualsCanonicalizing([$draft->id, $other->id], $this->ids($token, ['partner_id' => $this->customer->id]));
        // نافذة الفترة تقاطعية.
        $this->assertSame([$other->id], $this->ids($token, ['period_from' => '2026-10-15']));
        $this->assertEqualsCanonicalizing([$draft->id, $supplierRecon->id, $reviewed], $this->ids($token, ['period_to' => '2026-09-15']));
        $this->assertSame([$other->id], $this->ids($token, ['period_from' => '2026-10-31', 'period_to' => '2026-11-30']));
        $this->assertSame([$other->id], $this->ids($token, ['branch_id' => $branch->id]));
        // البحث: اسم الملف أو اسم الطرف (غير حساس لحالة الأحرف)، ورموز LIKE حرفية.
        $this->assertSame([$draft->id], $this->ids($token, ['q' => 'INVOICES']));
        $this->assertSame([$supplierRecon->id], $this->ids($token, ['q' => 'بيتا']));
        $this->assertEqualsCanonicalizing([$draft->id, $other->id], $this->ids($token, ['q' => 'ألفا']));
        $this->assertSame([$reviewed], $this->ids($token, ['q' => 'جاما']));
        $this->assertSame([], $this->ids($token, ['q' => '%']));
        $this->assertSame([], $this->ids($token, ['q' => '_']));
        $this->assertSame([], $this->ids($token, ['q' => '!']));
        $this->assertSame([], $this->ids($token, ['q' => '\\']));
    }

    /** @test */
    public function sorting_is_whitelisted_and_stable(): void
    {
        $a = $this->recon(['original_filename' => 'b.csv', 'line_count' => 5, 'period_from' => '2026-09-02']);
        $b = $this->recon(['original_filename' => 'a.csv', 'line_count' => 5, 'period_from' => '2026-09-03', 'partner_id' => $this->both->id]);
        $c = $this->recon(['original_filename' => 'c.csv', 'line_count' => 1, 'period_from' => '2026-09-01', 'partner_id' => $this->supplier->id, 'role' => 'supplier']);
        $token = $this->auth['token'];

        $this->assertSame([$b->id, $a->id, $c->id], $this->ids($token, ['sort' => 'original_filename']));
        $this->assertSame([$c->id, $a->id, $b->id], $this->ids($token, ['sort' => 'period_from']));
        $this->assertSame([$b->id, $a->id, $c->id], $this->ids($token, ['sort' => '-period_from']));
        // تعادل line_count يُحسم بالمعرّف: نفس الترتيب في كل استدعاء.
        $first = $this->ids($token, ['sort' => '-line_count']);
        $this->assertSame($first, $this->ids($token, ['sort' => '-line_count']));
        $this->assertSame($c->id, end($first));
        // اسم الطرف: ألفا (customer) < بيتا (supplier) < جاما (both) بالترتيب الأبجدي العربي المعتاد للقاعدة — يكفي ثبات وتطابق مع الترتيب المعاكس.
        $asc = $this->ids($token, ['sort' => 'partner_name']);
        $this->assertSame(array_reverse($asc), $this->ids($token, ['sort' => '-partner_name']));
        $this->assertCount(3, $asc);
    }

    /** @test */
    public function the_list_rejects_unknown_parameters_and_invalid_pagination_filters_and_sort(): void
    {
        $this->recon();
        $token = $this->auth['token'];
        $bad = [
            ['unknown' => '1'], ['per_page' => 51], ['per_page' => 0], ['per_page' => 'x'], ['page' => 0], ['page' => 100001], ['status' => ['nope']], ['status' => 'draft'],
            ['role' => 'both'], ['partner_id' => 'not-a-uuid'], ['branch_id' => 'x'], ['period_from' => '2026-13-01'], ['period_from' => '01/09/2026'],
            ['period_from' => '2026-10-01', 'period_to' => '2026-09-01'], ['sort' => 'tenant_id'], ['sort' => 'policy'], ['sort' => 'created_at desc'], ['q' => str_repeat('x', 101)],
        ];
        foreach ($bad as $query) {
            $this->list($token, $query)->assertStatus(422);
        }
        // الصفحة الخالية ليست خطأ.
        $this->assertSame([], $this->list($token, ['page' => 9])->assertOk()->json('data'));
    }

    // ═══════════════════════════════ العزل والرؤية ═══════════════════════════════

    /** @test */
    public function another_tenants_reconciliations_never_appear_and_answer_with_the_uniform_refusal(): void
    {
        $mine = $this->recon();
        $other = $this->registerTenant('ps-a4a0-b', 'b@ps-a4a0.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirPartner = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل آخر', 'is_active' => true]);
        $theirs = $this->recon(['partner_id' => $theirPartner->id, 'original_filename' => 'secret-other-tenant.csv'], $other['tenant_id']);
        $this->lineOf($theirs, 1);

        $this->assertSame([$mine->id], $this->ids($this->auth['token']));
        $this->assertSame(0, $this->list($this->auth['token'], ['q' => 'secret'])->json('meta.total'));   // البحث لا يعثر عليه
        $this->assertSame([$theirs->id], $this->ids($other['token']));

        $unknown = $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.Str::uuid())->assertStatus(422);
        foreach (['', '/lines'] as $suffix) {
            $res = $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$theirs->id.$suffix)->assertStatus(422);
            $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $res->json('message'));
            $this->assertSame($unknown->json('message'), $res->json('message'));
        }
        // معرّف غير UUID: يردّه الموجّه (`Route::pattern('id')`) بـ404 كبقية مسارات الوحدة — لا يصل إلى الخدمة.
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/not-a-uuid')->assertNotFound();
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/not-a-uuid/lines')->assertNotFound();
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/not-a-uuid/status')->assertNotFound();
    }

    /** @test */
    public function hidden_partners_and_unavailable_branches_are_excluded_from_rows_totals_search_and_sort(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخلي']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارجي']);
        $deletedPartner = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل محذوف سرّي', 'is_active' => true]);

        $visibleOrg = $this->recon(['original_filename' => 'visible-org.csv']);
        $visibleIn = $this->recon(['original_filename' => 'visible-in.csv', 'policy' => ['version' => 1, 'branch_id' => $inside->id]]);
        $outsideBranch = $this->recon(['original_filename' => 'secret-branch.csv', 'policy' => ['version' => 1, 'branch_id' => $outside->id]]);
        $deleted = $this->recon(['original_filename' => 'secret-deleted.csv', 'partner_id' => $deletedPartner->id]);
        $wrongType = $this->recon(['original_filename' => 'secret-wrongtype.csv', 'partner_id' => $this->supplier->id, 'role' => 'customer']);
        $ghostBranch = $this->recon(['original_filename' => 'secret-ghost.csv', 'policy' => ['version' => 1, 'branch_id' => (string) Str::uuid()]]);
        $deletedPartner->delete();

        $token = $this->restricted('ps-r1', [$inside->id]);
        $this->assertEqualsCanonicalizing([$visibleOrg->id, $visibleIn->id], $this->ids($token));
        // المالك غير مقيَّد بفرع، لكن الطرف المحذوف والنوع الخاطئ والفرع غير الموجود محجوبة عنه أيضاً (كالرأس).
        $this->assertEqualsCanonicalizing([$visibleOrg->id, $visibleIn->id, $outsideBranch->id], $this->ids($this->auth['token']));

        // العدّاد والترقيم والبحث والفرز كلها على المرئي فقط.
        $res = $this->list($token, ['per_page' => 1])->assertOk();
        $this->assertSame(2, $res->json('meta.total'));
        $this->assertSame(2, $res->json('meta.last_page'));
        $this->assertSame(0, $this->list($token, ['q' => 'secret'])->json('meta.total'));
        $this->assertSame(0, $this->list($token, ['q' => 'سرّي'])->json('meta.total'));
        $this->assertSame(0, $this->list($token, ['branch_id' => $outside->id])->json('meta.total'));
        $this->assertSame(0, $this->list($token, ['partner_id' => $deletedPartner->id])->json('meta.total'));
        $this->assertSame(0, $this->list($token, ['status' => ['draft'], 'q' => 'secret-branch'])->json('meta.total'));
        $this->assertCount(2, $this->ids($token, ['sort' => 'partner_name']));
        $this->assertStringNotContainsString('secret', (string) $this->list($token)->getContent());
        $this->assertStringNotContainsString($outside->id, (string) $this->list($token)->getContent());

        // رفض الرأس موحَّد لكل ما هو محجوب.
        foreach ([$outsideBranch, $deleted, $wrongType, $ghostBranch] as $hidden) {
            $tok = $hidden->is($outsideBranch) ? $token : $this->auth['token'];
            $this->withToken($tok)->getJson(self::BASE.'/'.$hidden->id)->assertStatus(422)->assertJsonPath('message', PartnerStatementImportService::PARTNER_UNAVAILABLE);
        }
    }

    /** @test */
    public function list_visibility_is_equivalent_to_the_header_access_rule_for_every_row_and_actor(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'داخل']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'خارج']);
        $removed = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'سيُحذف', 'is_active' => true]);
        $variants = [];
        foreach ([$this->customer, $this->supplier, $this->both, $removed] as $partner) {
            foreach (['customer', 'supplier'] as $role) {
                foreach ([null, $inside->id, $outside->id, (string) Str::uuid()] as $branchId) {
                    $variants[] = $this->recon(['partner_id' => $partner->id, 'role' => $role, 'policy' => ['version' => 1, 'branch_id' => $branchId]]);
                }
            }
        }
        $removed->delete();
        $this->assertCount(32, $variants);

        foreach ([$this->auth['token'], $this->restricted('ps-r2', [$inside->id]), $this->restricted('ps-r3', [$outside->id, $inside->id])] as $token) {
            $listed = $this->ids($token);
            $accessible = [];
            foreach ($variants as $variant) {
                if ($this->withToken($token)->getJson(self::BASE.'/'.$variant->id)->getStatusCode() === 200) {
                    $accessible[] = $variant->id;
                }
            }
            $this->assertEqualsCanonicalizing($accessible, $listed, 'القائمة تخالف قاعدة الرأس');
            $this->assertSame(count($accessible), $this->list($token)->json('meta.total'));
        }
    }

    /** @test */
    public function the_list_issues_a_constant_number_of_queries_regardless_of_row_count(): void
    {
        $branch = Branch::create(['code' => 'B1', 'name' => 'فرع']);
        foreach (range(1, 3) as $_) {
            $this->recon(['policy' => ['version' => 1, 'branch_id' => $branch->id], 'partner_id' => $this->both->id]);
        }
        $token = $this->auth['token'];
        $this->list($token)->assertOk();   // تسخين (تحميل الأدوار/الإعدادات)
        $few = $this->queryCount(fn () => $this->list($token, ['per_page' => 50])->assertOk());

        foreach (range(1, 27) as $i) {
            $this->recon(['policy' => ['version' => 1, 'branch_id' => $branch->id], 'partner_id' => [$this->customer->id, $this->both->id][$i % 2]]);
        }
        $many = $this->queryCount(fn () => $this->list($token, ['per_page' => 50])->assertOk());
        $this->assertSame(30, $this->list($token, ['per_page' => 50])->json('meta.total'));
        $this->assertSame($few, $many, 'عدد الاستعلامات يجب ألا ينمو مع الصفوف (لا فحص لكل صف)');

        // المقيَّد بفرع: القاعدة نفسها.
        $restricted = $this->restricted('ps-r4', [$branch->id]);
        $this->list($restricted)->assertOk();
        $one = $this->queryCount(fn () => $this->list($restricted, ['per_page' => 1])->assertOk());
        $this->assertSame($one, $this->queryCount(fn () => $this->list($restricted, ['per_page' => 50])->assertOk()));
    }

    // ═══════════════════════════════ RBAC وبوابة القدرة ═══════════════════════════════

    /** @test */
    public function permissions_and_actor_invariants_gate_every_read_route(): void
    {
        $r = $this->recon();
        $this->lineOf($r, 1);
        $paths = [self::BASE, self::BASE.'/'.$r->id, self::BASE.'/'.$r->id.'/lines'];

        // بلا `partner_statements.view` ⇒ 403 على المسار (ولو امتلك `reconcile` وحدها: لا منح ضمني).
        $noView = $this->role('ps-noview', ['partner_statements.reconcile', 'partners.view'], 'noview@ps-a4a0.test');
        foreach ($paths as $path) {
            $this->withToken($noView)->getJson($path)->assertForbidden();
        }
        $viewer = $this->role('ps-viewer', ['partner_statements.view', 'partners.view'], 'viewer@ps-a4a0.test');
        foreach ($paths as $path) {
            $this->withToken($viewer)->getJson($path)->assertOk();
        }
        // `view` بلا `partners.view` ⇒ لا يرى أي مقارنة: رفض موحَّد في القائمة والرأس والسطور.
        $noPartners = $this->role('ps-nopartners', ['partner_statements.view'], 'nopartners@ps-a4a0.test');
        foreach ($paths as $path) {
            $this->withToken($noPartners)->getJson($path)->assertStatus(422)->assertJsonPath('message', PartnerStatementImportService::PARTNER_UNAVAILABLE);
        }
        $this->withToken('invalid-token')->getJson(self::BASE)->assertUnauthorized();
        // المحاسب (دور نظامي بلا صلاحيات الكشوف) ممنوع.
        $accountant = $this->tokenForRole($this->auth['tenant_id'], 'accountant', 'acc@ps-a4a0.test');
        $this->withToken($accountant)->getJson(self::BASE)->assertForbidden();
    }

    /** @test */
    public function a_non_sar_tenant_is_refused_like_the_header(): void
    {
        $r = $this->recon();
        Tenant::query()->whereKey($this->auth['tenant_id'])->update(['currency' => 'USD']);
        foreach ([self::BASE, self::BASE.'/'.$r->id] as $path) {
            $this->withToken($this->auth['token'])->getJson($path)->assertStatus(422)->assertJsonPath('message', 'كشوف الأطراف بالريال السعودي فقط، وعملة مؤسستك مختلفة.');
        }
    }

    /** @test */
    public function the_capability_gate_is_enforced_disabled_denies_and_suspended_is_read_only(): void
    {
        // معطّلة ولا بيانات ⇒ منع كامل.
        $empty = $this->registerTenant('ps-a4a0-gate1', 'g1@ps-a4a0.test');
        $this->withToken($empty['token'])->postJson('/api/applications/disable', ['application_key' => 'accounting.partner_statements'])->assertOk();
        $this->withToken($empty['token'])->getJson(self::BASE)->assertForbidden();
        $this->withToken($empty['token'])->getJson(self::BASE.'/'.Str::uuid())->assertForbidden();
        $this->withToken($empty['token'])->getJson(self::BASE.'/'.Str::uuid().'/lines')->assertForbidden();

        // موقوفة (توجد بيانات) ⇒ القراءة تمرّ.
        $r = $this->recon();
        $this->lineOf($r, 1);
        $this->withToken($this->auth['token'])->postJson('/api/applications/disable', ['application_key' => 'accounting.partner_statements'])->assertOk()->assertJsonPath('data.status', 'suspended');
        $this->list($this->auth['token'])->assertOk()->assertJsonPath('meta.total', 1);
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id)->assertOk();
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'/lines')->assertOk();
    }

    // ═══════════════════════════════ N2: الرأس ═══════════════════════════════

    /** @test */
    public function the_header_returns_metadata_policy_and_checks_and_rejects_unknown_parameters(): void
    {
        $branch = Branch::create(['code' => 'B1', 'name' => 'فرع']);
        $r = $this->recon([
            'policy' => ['version' => 1, 'date_tolerance_days' => 5, 'amount_tolerance_minor' => 100, 'branch_id' => $branch->id],
            'checks' => ['balance_consistent' => true], 'line_count' => 3, 'total_debit_minor' => 500, 'total_credit_minor' => 7000,
        ]);

        $data = $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id)->assertOk()->json('data');
        $this->assertSame($r->id, $data['id']);
        $this->assertSame('draft', $data['status']);
        $this->assertSame(['version' => 1, 'date_tolerance_days' => 5, 'amount_tolerance_minor' => 100, 'branch_id' => $branch->id], $data['policy']);
        $this->assertSame(['balance_consistent' => true], $data['checks']);
        $this->assertSame([3, 500, 7000], [$data['line_count'], $data['total_debit_minor'], $data['total_credit_minor']]);
        $this->assertSame($branch->id, $data['branch']['id']);
        $this->assertSame($this->owner->id, $data['created_by']);
        foreach (['source_import_job_id', 'reviewed_by', 'reviewed_run_id', 'closed_by', 'scope_key', 'voided_by', 'void_reason'] as $key) {
            $this->assertArrayHasKey($key, $data);
        }
        // لا بصمات داخلية.
        foreach (['file_sha256', 'identity_sha256', 'lines_digest', 'tenant_id'] as $key) {
            $this->assertArrayNotHasKey($key, $data);
        }
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'?x=1')->assertStatus(422);
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'?page=1')->assertStatus(422);
    }

    // ═══════════════════════════════ N4: السطور ═══════════════════════════════

    /** @test */
    public function lines_are_returned_before_any_match_run_in_stable_ordinal_order_with_pagination(): void
    {
        $r = $this->recon(['line_count' => 7]);
        foreach ([5, 2, 7, 3, 6, 4, 1] as $ordinal) {   // إدراج بترتيب مخلوط
            $this->lineOf($r, $ordinal, $ordinal === 4 ? ['balance_minor' => 123456, 'kind' => 'invoice', 'our_reference' => 'INV-9'] : []);
        }
        $this->assertSame(0, DB::table('partner_statement_match_runs')->count());   // لا تشغيلة

        $p1 = $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'/lines?per_page=3&page=1')->assertOk();
        $p2 = $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'/lines?per_page=3&page=2')->assertOk();
        $p3 = $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'/lines?per_page=3&page=3')->assertOk();
        $this->assertSame([1, 2, 3], array_column($p1->json('data'), 'ordinal'));
        $this->assertSame([4, 5, 6], array_column($p2->json('data'), 'ordinal'));
        $this->assertSame([7], array_column($p3->json('data'), 'ordinal'));
        $this->assertSame(['current_page' => 1, 'last_page' => 3, 'per_page' => 3, 'total' => 7], $p1->json('meta'));

        $line = $p2->json('data.0');
        $this->assertEqualsCanonicalizing(['id', 'ordinal', 'date', 'reference', 'our_reference', 'description', 'debit_minor', 'credit_minor', 'balance_minor', 'kind'], array_keys($line));
        $this->assertSame([4, 'REF-4', 'INV-9', 0, 4000, 123456, 'invoice', '2026-09-04'], [$line['ordinal'], $line['reference'], $line['our_reference'], $line['debit_minor'], $line['credit_minor'], $line['balance_minor'], $line['kind'], $line['date']]);
        $this->assertNull($p1->json('data.0.balance_minor'));

        // تحقق المدخلات.
        foreach (['per_page=51', 'per_page=0', 'page=0', 'run_id='.Str::uuid(), 'q=x'] as $bad) {
            $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$r->id.'/lines?'.$bad)->assertStatus(422);
        }
    }

    /** @test */
    public function lines_of_a_hidden_reconciliation_are_refused_uniformly(): void
    {
        $outside = Branch::create(['code' => 'OUT', 'name' => 'خارج']);
        $inside = Branch::create(['code' => 'IN', 'name' => 'داخل']);
        $r = $this->recon(['policy' => ['version' => 1, 'branch_id' => $outside->id]]);
        $this->lineOf($r, 1, ['description' => 'محتوى سرّي']);
        $token = $this->restricted('ps-r5', [$inside->id]);

        $res = $this->withToken($token)->getJson(self::BASE.'/'.$r->id.'/lines')->assertStatus(422);
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $res->json('message'));
        $this->assertStringNotContainsString('محتوى سرّي', (string) $res->getContent());
    }

    // ═══════════════════════════════ N3: سياق السطر والقرار في matches ═══════════════════════════════

    private function invoice(string $date, int $unitPrice, ?string $branchId = null): Invoice
    {
        $service = app(InvoiceService::class);
        $context = app(BranchContext::class);
        $branchId !== null ? $context->set($branchId) : $context->forget();
        try {
            return $service->post($service->create(
                ['partner_id' => $this->both->id, 'payment_type' => 'credit', 'invoice_date' => $date],
                [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            ));
        } finally {
            $context->forget();
        }
    }

    /** @param list<array{date: string, ref?: string, our?: string, debit?: int, credit?: int}> $rows */
    private function importStatement(array $rows): string
    {
        $money = fn (?int $minor): string => $minor === null ? '' : number_format($minor / 100, 2, '.', '');
        $csv = SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مرجعنا', 'مدين', 'دائن'], array_map(fn (array $r): array => [
            $r['date'], $r['ref'] ?? '', $r['our'] ?? '', $money($r['debit'] ?? null), $money($r['credit'] ?? null),
        ], $rows));
        $file = UploadedFile::fake()->createWithContent('s'.uniqid().'.csv', $csv);
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->actingAs($this->owner);

        return app(PartnerStatementImportService::class)->apply($file, [
            'partner_id' => $this->both->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30',
        ], (string) $this->owner->id)['reconciliation_id'];
    }

    private function match(string $token, string $id): array
    {
        return $this->withToken($token)->postJson(self::BASE."/{$id}/match")->assertSuccessful()->json('data');
    }

    private function lineId(string $id, int $ordinal): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return (string) PartnerStatementLine::query()->where('reconciliation_id', $id)->where('ordinal', $ordinal)->value('id');
    }

    /** @return array{0: string, 1: array<string, mixed>} */
    private function matchedScenario(): array
    {
        $a = $this->invoice('2026-09-01', 100000);
        $this->invoice('2026-09-05', 20000);
        $id = $this->importStatement([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],
            ['date' => '2026-09-25', 'credit' => 23000],
            ['date' => '2026-09-28', 'credit' => 99900],
        ]);

        return [$id, $this->match($this->auth['token'], $id)];
    }

    /** مقارنة `reviewed` حقيقية (طرف `both`، سبتمبر) عبر الدورة الكاملة. */
    private function reviewedReconciliation(): string
    {
        $invoice = $this->invoice('2026-09-02', 50000);
        $id = $this->importStatement([['date' => '2026-09-02', 'our' => $invoice->number, 'credit' => 57500]]);
        $run = $this->match($this->auth['token'], $id);
        $this->withToken($this->auth['token'])->postJson(self::BASE."/{$id}/decisions", ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $this->withToken($this->auth['token'])->postJson(self::BASE."/{$id}/review", ['run_id' => $run['id']])->assertCreated();

        return $id;
    }

    /** @test */
    public function statement_rows_gain_line_and_effective_decision_additively_and_ledger_rows_get_nulls(): void
    {
        [$id, $run] = $this->matchedScenario();
        $token = $this->auth['token'];
        $lineTwo = $this->lineId($id, 2);

        $before = $this->withToken($token)->getJson(self::BASE."/{$id}/matches?per_page=50")->assertOk();
        $rows = $before->json('data');
        $statementRows = array_values(array_filter($rows, fn (array $r): bool => $r['side'] === 'statement'));
        $ledgerRows = array_values(array_filter($rows, fn (array $r): bool => $r['side'] === 'ledger'));
        $this->assertNotEmpty($statementRows);
        $this->assertNotEmpty($ledgerRows);

        // الحقول القائمة حرفياً (لا إعادة تسمية ولا حذف) + المضافتان.
        $legacy = ['id', 'side', 'line_id', 'ordinal', 'outcome', 'rule', 'unit_key', 'difference_minor', 'day_difference', 'explanation', 'warnings', 'unit', 'candidates', 'suggestions'];
        foreach ($rows as $row) {
            $this->assertSame(array_merge($legacy, ['line', 'decision']), array_keys($row));
        }
        foreach ($ledgerRows as $row) {
            $this->assertNull($row['line']);
            $this->assertNull($row['decision']);
        }
        $this->assertSame(['run', 'ledger_changed'], array_values(array_intersect(array_keys($before->json()), ['run', 'ledger_changed'])));
        $this->assertSame($run['id'], $before->json('run.id'));

        $row = collect($statementRows)->firstWhere('ordinal', 2);
        $this->assertSame($lineTwo, $row['line']['id']);
        $this->assertSame(['id', 'ordinal', 'date', 'reference', 'our_reference', 'description', 'debit_minor', 'credit_minor', 'balance_minor', 'kind'], array_keys($row['line']));
        $this->assertSame([2, '2026-09-01', 0, 115000], [$row['line']['ordinal'], $row['line']['date'], $row['line']['debit_minor'], $row['line']['credit_minor']]);
        $this->assertNull($row['decision']);   // لا قرار بعد

        // قرار ⇒ يظهر مطابقاً لـ`GET decisions` حرفياً.
        $this->withToken($token)->postJson(self::BASE."/{$id}/decisions", ['run_id' => $run['id'], 'line_id' => $lineTwo, 'action' => 'confirm'])->assertCreated();
        $after = collect($this->withToken($token)->getJson(self::BASE."/{$id}/matches?per_page=50")->json('data'))->firstWhere('ordinal', 2);
        $listed = $this->withToken($token)->getJson(self::BASE."/{$id}/decisions?line_id={$lineTwo}")->assertOk()->json('data.0');
        unset($listed['ordinal']);
        $this->assertSame($listed, $after['decision']);
        $this->assertSame('confirm', $after['decision']['action']);
        $this->assertSame($run['id'], $after['decision']['run_id']);

        // سحب القرار (clear) ⇒ لا قرار فعّال.
        $this->withToken($token)->postJson(self::BASE."/{$id}/decisions", ['run_id' => $run['id'], 'line_id' => $lineTwo, 'action' => 'clear'])->assertSuccessful();
        $cleared = collect($this->withToken($token)->getJson(self::BASE."/{$id}/matches?per_page=50")->json('data'))->firstWhere('ordinal', 2);
        $this->assertNull($cleared['decision']);
        $this->assertSame($lineTwo, $cleared['line']['id']);

        // صفحة/مرشّح بلا صفوف كشف: بنية سليمة.
        $ledgerOnly = $this->withToken($token)->getJson(self::BASE."/{$id}/matches?side=ledger")->assertOk()->json('data');
        $this->assertNotEmpty($ledgerOnly);
        $this->assertNull($ledgerOnly[0]['line']);
    }

    /** @test */
    public function matches_context_uses_a_constant_number_of_queries_and_hides_decisions_on_unreadable_runs(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'داخل']);
        $this->invoice('2026-09-03', 100000, $inside->id);
        $id = $this->importStatement([['date' => '2026-09-03', 'credit' => 115000], ['date' => '2026-09-10', 'credit' => 5000], ['date' => '2026-09-11', 'credit' => 6000], ['date' => '2026-09-12', 'credit' => 7000]]);
        $orgRun = $this->match($this->auth['token'], $id);
        $this->withToken($this->auth['token'])->postJson(self::BASE."/{$id}/decisions", ['run_id' => $orgRun['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        foreach ([3, 4, 5] as $ordinal) {
            $this->withToken($this->auth['token'])->postJson(self::BASE."/{$id}/decisions", [
                'run_id' => $orgRun['id'], 'line_id' => $this->lineId($id, $ordinal), 'action' => 'dismiss', 'reason' => 'غير موجود في الدفاتر',
            ])->assertCreated();
        }

        // ثبات عدد الاستعلامات: صفحة بصفين مقابل صفحة بأربعة (كلها بقرارات).
        $url = fn (int $perPage): string => self::BASE."/{$id}/matches?side=statement&per_page={$perPage}";
        $this->withToken($this->auth['token'])->getJson($url(2))->assertOk();
        $two = $this->queryCount(fn () => $this->withToken($this->auth['token'])->getJson($url(2))->assertOk());
        $four = $this->queryCount(fn () => $this->withToken($this->auth['token'])->getJson($url(4))->assertOk());
        $this->assertCount(4, $this->withToken($this->auth['token'])->getJson($url(4))->json('data'));
        $this->assertSame($two, $four, 'سياق السطر/القرار يجب ألا يضيف استعلاماً لكل صف');

        // المقيَّد بفرع: قرارات تشغيلة المؤسسة غير مقروءة له فلا تظهر في صفوف تشغيلته.
        $token = $this->restricted('ps-r6', [$inside->id]);
        $own = $this->match($token, $id);
        $this->assertSame('branch', $own['scope']['kind']);
        $rows = $this->withToken($token)->getJson(self::BASE."/{$id}/matches?side=statement&per_page=50")->assertOk()->json('data');
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertNull($row['decision'], 'قرار على تشغيلة غير مقروءة يجب ألا يظهر');
            $this->assertNotNull($row['line']);
        }
        $this->assertStringNotContainsString($orgRun['id'], (string) $this->withToken($token)->getJson(self::BASE."/{$id}/matches?side=statement&per_page=50")->getContent());
        // وبعد أن يقرر هو على تشغيلته يظهر قراره.
        $this->withToken($token)->postJson(self::BASE."/{$id}/decisions", ['run_id' => $own['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $second = collect($this->withToken($token)->getJson(self::BASE."/{$id}/matches?side=statement&per_page=50")->json('data'))->firstWhere('ordinal', 2);
        $this->assertSame($own['id'], $second['decision']['run_id']);
    }

    /** @test */
    public function decision_context_loads_the_actors_branches_once_even_when_decisions_span_several_runs(): void
    {
        $this->invoice('2026-09-03', 100000);
        $id = $this->importStatement([['date' => '2026-09-03', 'credit' => 115000], ['date' => '2026-09-10', 'credit' => 5000], ['date' => '2026-09-11', 'credit' => 6000], ['date' => '2026-09-12', 'credit' => 7000]]);
        $token = $this->auth['token'];
        $decide = fn (array $run, int $ordinal, array $extra) => $this->withToken($token)->postJson(self::BASE."/{$id}/decisions", [
            'run_id' => $run['id'], 'line_id' => $this->lineId($id, $ordinal),
        ] + $extra)->assertCreated();

        $run1 = $this->match($token, $id);
        $decide($run1, 2, ['action' => 'confirm']);
        $decide($run1, 3, ['action' => 'dismiss', 'reason' => 'غير موجود في الدفاتر']);
        // تغيّر الدفتر ⇒ تشغيلة ثانية، وقراراها الجديدان عليها؛ القراران الأولان يبقيان على التشغيلة الأولى.
        $this->invoice('2026-09-20', 31337);
        $run2 = $this->match($token, $id);
        $this->assertNotSame($run1['id'], $run2['id']);
        $decide($run2, 4, ['action' => 'dismiss', 'reason' => 'غير موجود في الدفاتر']);
        $decide($run2, 5, ['action' => 'dismiss', 'reason' => 'غير موجود في الدفاتر']);

        $url = fn (int $perPage): string => self::BASE."/{$id}/matches?side=statement&per_page={$perPage}";
        $this->withToken($token)->getJson($url(4))->assertOk();   // تسخين
        $oneRun = $this->queryCount(fn () => $this->withToken($token)->getJson($url(2))->assertOk());     // ترتيب 2،3 ⇒ تشغيلة واحدة
        $twoRuns = $this->queryCount(fn () => $this->withToken($token)->getJson($url(4))->assertOk());    // 2..5 ⇒ تشغيلتان
        $rows = $this->withToken($token)->getJson($url(4))->json('data');
        $this->assertSame([$run1['id'], $run1['id'], $run2['id'], $run2['id']], array_map(fn (array $r): string => $r['decision']['run_id'], $rows));
        $this->assertSame($oneRun, $twoRuns, 'تحميل فروع الفاعل يجب أن يكون مرة واحدة لا لكل تشغيلة');
    }

    // ═══════════════════════════════ لا أثر مالي ولا كتابة ═══════════════════════════════

    /** @test */
    public function reads_change_nothing_financial_and_write_nothing_at_all(): void
    {
        [$id] = $this->matchedScenario();
        $r = $this->recon();
        $this->lineOf($r, 1);
        $financial = $this->financialCounts();
        $own = [
            'partner_statement_reconciliations' => DB::table('partner_statement_reconciliations')->count(), 'partner_statement_lines' => DB::table('partner_statement_lines')->count(),
            'partner_statement_match_runs' => DB::table('partner_statement_match_runs')->count(), 'partner_statement_matches' => DB::table('partner_statement_matches')->count(),
            'partner_statement_review_decisions' => DB::table('partner_statement_review_decisions')->count(), 'partner_statement_reconciliation_events' => DB::table('partner_statement_reconciliation_events')->count(),
        ];
        $digest = DB::table('partner_statement_reconciliations')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();

        $token = $this->auth['token'];
        foreach ([self::BASE, self::BASE.'/'.$id, self::BASE.'/'.$id.'/lines', self::BASE.'/'.$id.'/matches'] as $path) {
            $this->withToken($token)->getJson($path)->assertOk();
        }

        $this->assertSame($financial, $this->financialCounts());
        $this->assertSame($own, array_map(fn (string $t): int => DB::table($t)->count(), array_combine(array_keys($own), array_keys($own))));
        $this->assertSame($digest, DB::table('partner_statement_reconciliations')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all());
    }

    /** @test */
    public function the_new_read_code_has_no_write_or_financial_surface_and_only_get_routes(): void
    {
        $files = ['app/Services/PartnerStatementReconciliationQuery.php', 'app/Http/Controllers/Api/PartnerStatementReconciliationController.php'];
        $forbidden = ['LedgerService', 'JournalEntry', 'JournalLine', 'journal_entries', 'journal_lines', 'InventoryService', 'StockMovement', 'Zatca', 'InvoiceService', 'PaymentService',
            'PurchaseService', 'ExpenseService', 'CreditNoteService', 'ReturnService', 'AccountBalance', 'DB::table(\'journal', '->save(', '->delete(', '->forceDelete(', '::create(', '::insert(',
            '->insert(', '->update(', '->upsert(', '::updateOrCreate(', '::forceCreate(', 'firstOrCreate', 'DB::transaction', 'lockForUpdate', 'Settings::put', 'Event::dispatch'];
        foreach (array_merge($files, ['app/Http/Controllers/Api/PartnerStatementMatchController.php']) as $file) {
            $source = '';
            foreach (token_get_all((string) file_get_contents(base_path($file))) as $token) {
                if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                    continue;
                }
                $source .= is_array($token) ? $token[1] : $token;
            }
            foreach ($forbidden as $needle) {
                if ($file === 'app/Http/Controllers/Api/PartnerStatementMatchController.php' && $needle === '::create(') {
                    continue;
                }
                $this->assertStringNotContainsString($needle, $source, "{$file} يذكر {$needle}");
            }
        }

        $new = [];
        foreach (app('router')->getRoutes() as $route) {
            if (str_contains((string) $route->getActionName(), 'PartnerStatementReconciliationController')) {
                $new[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }
        sort($new);
        $this->assertSame([
            'GET|HEAD api/partner-statement-reconciliations',
            'GET|HEAD api/partner-statement-reconciliations/{id}',
            'GET|HEAD api/partner-statement-reconciliations/{id}/lines',
        ], $new);
    }
}
