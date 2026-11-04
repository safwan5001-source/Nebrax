<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Partner;
use App\Models\PartnerStatementReconciliation;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\PartnerStatementImportService;
use App\Support\PartnerStatementBranchScopeException;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * SEC #1974 — مسارات «مقارنة قائمة» لا تفرّق بين «غير موجودة» و«موجودة في فرع خارج نطاقي» (كان الأخير يردّ `هذا الفرع خارج نطاق صلاحياتك.` بينما الأول `PARTNER_UNAVAILABLE`).
 * يُثبت: تكافؤ الحالة والجسم على المسارات الاثني عشر (بحمولات صالحة تصل إلى التفويض فلا يحجبها التحقق ولا الـthrottle)، حيادية رفض المستأجر الآخر والطرف المحذوف/نوعه الخاطئ،
 * بقاء الوصول المصرَّح (مقيَّد في فرعه وغير مقيَّد وN1–N4)، بقاء رسالة الفرع المفصَّلة لمدخل الاستيراد، وأن التحويل لا يبتلع 422 أخرى (عملة/`partners.view`/403).
 * تشغيل: php artisan test --filter=PartnerStatementBranchRefusalSecurityTest
 */
class PartnerStatementBranchRefusalSecurityTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private const BASE = '/api/partner-statement-reconciliations';

    private const LEGACY = 'هذا الفرع خارج نطاق صلاحياتك.';

    private array $auth;

    private User $owner;

    private Partner $both;

    private Partner $supplier;

    private Branch $inside;

    private Branch $outside;

    private string $restricted;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        // جسم الإنتاج الحرفي: وضع التصحيح يضيف exception/trace بأرقام أسطر تختلف بين الطلبات فيُخفي المقارنة.
        config(['app.debug' => false]);
        Storage::fake('local');
        $this->auth = $this->registerTenant('sec-1974', 'owner@sec-1974.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@sec-1974.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف السلامة', 'is_active' => true]);
        $this->supplier = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد', 'is_active' => true]);
        $this->inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $this->outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارج']);
        $this->restricted = $this->restrictedUser('sec-restricted', [$this->inside->id]);
    }

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    private function restrictedUser(string $slug, array $branchIds, array $permissions = ['partner_statements.view', 'partner_statements.reconcile', 'partner_statements.close', 'partner_statements.void', 'partners.view']): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $token = $this->tokenForRole($this->auth['tenant_id'], $slug, $slug.'@sec-1974.test');
        User::query()->where('email', $slug.'@sec-1974.test')->firstOrFail()->branches()->sync($branchIds);

        return $token;
    }

    /** @param array<string, mixed> $over */
    private function recon(array $over = [], ?string $tenantId = null, ?string $partnerId = null): PartnerStatementReconciliation
    {
        app(TenantContext::class)->set($tenantId ?? $this->auth['tenant_id']);
        $this->seq++;
        $model = new PartnerStatementReconciliation;
        $model->forceFill($over + [
            'partner_id' => $partnerId ?? $this->both->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30', 'currency' => 'SAR',
            'status' => 'draft', 'original_filename' => 'sec-'.$this->seq.'.csv', 'file_sha256' => hash('sha256', 'f'.$this->seq), 'identity_sha256' => hash('sha256', 'i'.$this->seq),
            'line_count' => 0, 'policy' => ['version' => 1, 'date_tolerance_days' => 3, 'amount_tolerance_minor' => 0, 'branch_id' => null],
            'created_by' => $tenantId === null ? $this->owner->id : User::query()->where('tenant_id', $tenantId)->value('id'),
        ]);
        $model->save();

        return $model;
    }

    private function inBranch(Branch $branch): PartnerStatementReconciliation
    {
        return $this->recon(['policy' => ['version' => 1, 'date_tolerance_days' => 3, 'amount_tolerance_minor' => 0, 'branch_id' => $branch->id]]);
    }

    /**
     * المسارات الاثنا عشر بحمولات **صالحة** (تعبر التحقق إلى التفويض). @return array<string, array{0: string, 1: string, 2: array<string, mixed>}>
     */
    private function routes(): array
    {
        $uuid = fn (): string => (string) Str::uuid();

        return [
            'match' => ['POST', '/match', []],
            'matches' => ['GET', '/matches', []],
            'verify-set' => ['GET', '/verify-set?'.http_build_query(['line_id' => $uuid(), 'unit_keys' => ['invoice#'.$uuid()]]), []],
            'decisions.get' => ['GET', '/decisions', []],
            'decisions.post' => ['POST', '/decisions', ['run_id' => $uuid(), 'line_id' => $uuid(), 'action' => 'confirm']],
            'reversed-pairs' => ['GET', '/reversed-pairs', []],
            'status' => ['GET', '/status', []],
            'events' => ['GET', '/events', []],
            'review' => ['POST', '/review', ['run_id' => $uuid()]],
            'reopen' => ['POST', '/reopen', ['reason' => 'سبب إعادة الفتح']],
            'close' => ['POST', '/close', ['run_id' => $uuid()]],
            'void' => ['POST', '/void', ['reason' => 'سبب الإبطال']],
            'replace' => ['POST', '/replace', ['run_id' => $uuid(), 'replaces' => [$uuid()], 'reason' => 'سبب الاستبدال']],
        ];
    }

    private function send(string $token, string $method, string $id, string $suffix, array $payload)
    {
        // مفتاح throttle غير المسمّى مشترك بين كل مسارات المستخدم؛ تصفير العدّاد يمنع 429 من حجب الوصول إلى التفويض (إيجابي كاذب) — لا يمسّ التفويض نفسه.
        Cache::flush();
        $uri = self::BASE.'/'.$id.$suffix;

        return $method === 'GET' ? $this->withToken($token)->getJson($uri) : $this->withToken($token)->postJson($uri, $payload);
    }

    /** @return array{0: int, 1: string} */
    private function signature($response): array
    {
        return [$response->getStatusCode(), (string) $response->getContent()];
    }

    // ═══════════════════════════════ التكافؤ على المسارات الاثني عشر ═══════════════════════════════

    /** @test */
    public function every_per_reconciliation_route_answers_an_out_of_scope_branch_exactly_like_an_unknown_id(): void
    {
        $outRecon = $this->inBranch($this->outside);
        $other = $this->registerTenant('sec-1974-b', 'b@sec-1974.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirPartner = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف آخر', 'is_active' => true]);
        $theirs = $this->recon([], $other['tenant_id'], $theirPartner->id);

        $this->assertCount(13, $this->routes(), 'المسارات الاثنا عشر (القرارات GET وPOST معاً = ثلاثة عشر طلباً).');
        foreach ($this->routes() as $name => [$method, $suffix, $payload]) {
            $unknown = $this->send($this->restricted, $method, (string) Str::uuid(), $suffix, $payload);
            $outOfScope = $this->send($this->restricted, $method, $outRecon->id, $suffix, $payload);
            $foreignTenant = $this->send($this->restricted, $method, $theirs->id, $suffix, $payload);

            $unknown->assertStatus(422);
            $this->assertSame(['message' => PartnerStatementImportService::PARTNER_UNAVAILABLE], $unknown->json(), "{$name}: شكل الرفض الموحَّد");
            $this->assertSame($this->signature($unknown), $this->signature($outOfScope), "{$name}: فرع خارج النطاق يخالف المجهول (وجود مكشوف)");
            $this->assertSame($this->signature($unknown), $this->signature($foreignTenant), "{$name}: مستأجر آخر يخالف المجهول");
            $this->assertStringNotContainsString('الفرع', (string) $outOfScope->getContent(), "{$name}: لا إشارة إلى الفرع");
            $this->assertStringNotContainsString($this->outside->id, (string) $outOfScope->getContent(), "{$name}: لا معرّف فرع");
        }
    }

    /** @test */
    public function hidden_partners_and_wrong_partner_types_keep_the_same_neutral_refusal_for_every_route(): void
    {
        $deletedPartner = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'سيُحذف', 'is_active' => true]);
        $deleted = $this->recon([], null, $deletedPartner->id);
        $deletedPartner->delete();
        $wrongType = $this->recon(['role' => 'customer'], null, $this->supplier->id);   // مورد بدور عميل

        foreach ($this->routes() as $name => [$method, $suffix, $payload]) {
            foreach ([$this->auth['token'], $this->restricted] as $token) {
                $unknown = $this->send($token, $method, (string) Str::uuid(), $suffix, $payload);
                $this->assertSame($this->signature($unknown), $this->signature($this->send($token, $method, $deleted->id, $suffix, $payload)), "{$name}: طرف محذوف");
                $this->assertSame($this->signature($unknown), $this->signature($this->send($token, $method, $wrongType->id, $suffix, $payload)), "{$name}: نوع طرف خاطئ");
            }
        }
    }

    // ═══════════════════════════════ الوصول المصرَّح باقٍ ═══════════════════════════════

    /** @test */
    public function authorized_actors_still_reach_their_reconciliations_including_the_new_read_apis(): void
    {
        $inRecon = $this->inBranch($this->inside);
        $orgRecon = $this->recon();
        $outRecon = $this->inBranch($this->outside);

        // المقيَّد: فرعه والمؤسسة (بلا فرع في السياسة) مرئيان في كل القراءات؛ الفرع الآخر محجوب.
        foreach ([$inRecon, $orgRecon] as $visible) {
            foreach (['', '/lines', '/status', '/events', '/decisions', '/matches'] as $suffix) {
                $this->withToken($this->restricted)->getJson(self::BASE.'/'.$visible->id.$suffix)->assertOk();
            }
        }
        $listed = array_column($this->withToken($this->restricted)->getJson(self::BASE.'?per_page=50')->assertOk()->json('data'), 'id');
        $this->assertEqualsCanonicalizing([$inRecon->id, $orgRecon->id], $listed);
        $this->assertNotContains($outRecon->id, $listed);

        // غير المقيَّد: يرى الثلاثة كلها (رأس وسطور وحالة وقائمة).
        foreach ([$inRecon, $orgRecon, $outRecon] as $any) {
            foreach (['', '/lines', '/status', '/events', '/decisions', '/matches'] as $suffix) {
                $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$any->id.$suffix)->assertOk();
            }
        }
        $this->assertEqualsCanonicalizing([$inRecon->id, $orgRecon->id, $outRecon->id], array_column($this->withToken($this->auth['token'])->getJson(self::BASE.'?per_page=50')->json('data'), 'id'));
    }

    // ═══════════════════════════════ التحويل لا يبتلع غيره ═══════════════════════════════

    /** @test */
    public function unrelated_refusals_are_not_turned_into_unavailability(): void
    {
        $recon = $this->recon();

        // صلاحية: 403 لا 422.
        $noView = $this->restrictedUser('sec-noview', [], ['partner_statements.reconcile', 'partners.view']);
        $this->withToken($noView)->getJson(self::BASE.'/'.$recon->id.'/status')->assertForbidden();
        // بلا partners.view: الرفض الموحَّد التاريخي (لم يتغيّر).
        $noPartners = $this->restrictedUser('sec-nopartners', [], ['partner_statements.view']);
        $this->withToken($noPartners)->getJson(self::BASE.'/'.$recon->id.'/status')->assertStatus(422)->assertJsonPath('message', PartnerStatementImportService::PARTNER_UNAVAILABLE);
        // عملة غير SAR: رسالتها الخاصة تبقى (ليست رفض وجود).
        Tenant::query()->whereKey($this->auth['tenant_id'])->update(['currency' => 'USD']);
        $this->withToken($this->auth['token'])->getJson(self::BASE.'/'.$recon->id.'/status')->assertStatus(422)
            ->assertJsonPath('message', 'كشوف الأطراف بالريال السعودي فقط، وعملة مؤسستك مختلفة.');
    }

    // ═══════════════════════════════ الاستيراد: رسالة الفرع المفصَّلة باقية ═══════════════════════════════

    /** @test */
    public function user_supplied_branch_validation_keeps_its_specific_typed_message(): void
    {
        $service = app(PartnerStatementImportService::class);
        $restrictedUser = User::query()->where('email', 'sec-restricted@sec-1974.test')->firstOrFail();
        $options = ['partner_id' => $this->both->id, 'role' => 'customer', 'branch_id' => $this->outside->id];

        // الخدمة نفسها (preview وapply وPartnerLedgerCandidates يمرّون بها): نوع محدد ورسالة مفصَّلة كما كانت.
        $e = $this->thrown(fn () => $service->assertAccess($options, (string) $restrictedUser->getKey()), 'لا رفض لفرع خارج النطاق', PartnerStatementBranchScopeException::class);
        $this->assertSame(self::LEGACY, $e->getMessage());
        $this->assertInstanceOf(\RuntimeException::class, $e);   // 422 عبر ApiController::domain كما كان

        // apply: المدخل المختار من المستخدم يرفض بالرسالة نفسها.
        $csv = UploadedFile::fake()->createWithContent('s.csv', SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مدين', 'دائن'], [['2026-09-01', 'INV-1', '', '100.00']]));
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->actingAs($restrictedUser);
        $e = $this->thrown(fn () => $service->apply($csv, ['partner_id' => $this->both->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30', 'branch_id' => $this->outside->id], (string) $restrictedUser->getKey()), 'apply لا يرفض', PartnerStatementBranchScopeException::class);
        $this->assertSame(self::LEGACY, $e->getMessage());
        // وفرعٌ داخل النطاق أو غير مطلوب يمرّ.
        $this->assertSame($this->both->id, $service->assertAccess(['partner_id' => $this->both->id, 'role' => 'customer', 'branch_id' => $this->inside->id], (string) $restrictedUser->getKey())->id);
        $this->assertSame($this->both->id, $service->assertAccess(['partner_id' => $this->both->id, 'role' => 'customer', 'branch_id' => null], (string) $restrictedUser->getKey())->id);
    }

    // ═══════════════════════════════ حارس ساكن ═══════════════════════════════

    /** @test */
    public function no_string_matching_on_the_branch_message_exists_outside_the_typed_exception(): void
    {
        $hits = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->getExtension() === 'php' && str_contains((string) file_get_contents($file->getPathname()), 'هذا الفرع خارج نطاق صلاحياتك')) {
                $hits[] = str_replace(base_path().'/', '', $file->getPathname());
            }
        }
        $this->assertSame(['app/Support/PartnerStatementBranchScopeException.php'], $hits, 'الرسالة تُعرَّف في الاستثناء المحدد النوع وحده؛ لا مطابقة نصية في مكان آخر.');

        $match = (string) file_get_contents(base_path('app/Services/PartnerStatementMatchService.php'));
        $this->assertSame(2, substr_count($match, 'catch (PartnerStatementBranchScopeException)'), 'authorize() وsource() فقط');
        $query = (string) file_get_contents(base_path('app/Services/PartnerStatementReconciliationQuery.php'));
        $this->assertStringNotContainsString('BRANCH_REFUSAL', $query);
        $this->assertStringNotContainsString('getMessage()', $query);
    }
}
