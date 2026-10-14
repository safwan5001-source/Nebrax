<?php

namespace Tests\Feature;

use App\Jobs\Accounting\SendZatcaSubmission;
use App\Models\User;
use App\Models\ZatcaCredential;
use App\Services\TenantApplicationService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-03b / SEC-01 — «الفرع النشط فقط» لست عمليات متبقية
 * ═══════════════════════════════════════════════════════════════
 *  امتداد لـ REM-03 (`Rem03ActiveBranchOnlyTest`) على ست عمليات فقط:
 *    InvoiceController   : duplicate · storeNote
 *    ZatcaSubmissionController : store · dispatch
 *    CreditNoteController: show · post
 *
 *  القاعدة (قرار المالك): `record.branch_id == BranchContext::id()` أو `NULL`.
 *  الفرع المسموح غير النشط، و`?branch=all`، والمالك غير المقيَّد — لا يكفي أيٌّ منها.
 *  الرفض = 404 غير مميَّز، قبل أي أثر جانبي (مسودة/ملاحظة/ملف/محاولة/طابور/قيد).
 *
 *  مستثنيات محفوظة (اختبارات توصيف فقط، بلا تغيير إنتاج):
 *   - ReturnableController: مرجع المصدر عبر الفروع المسموحة.
 *   - AppointmentController: يبقى على `scopeToActiveBranch()` (`?branch=all`).
 *   - الفاتورة المصدر لإشعار الدائن (`original_invoice_id`): سياسة الفروع المسموحة كما هي.
 *
 *  تشغيل: php artisan test --filter=Rem03bActiveBranchOnlyTest
 */
class Rem03bActiveBranchOnlyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    // ───────────────────────── عالم الاختبار ─────────────────────────

    /** @return array<string, mixed> */
    private function world(string $slug = 'rem03b'): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $tid = $auth['tenant_id'];
        app(TenantContext::class)->set($tid);
        $owner = $auth['token'];

        $a = $this->withToken($owner)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $b = $this->withToken($owner)->postJson('/api/branches', ['name' => 'فرع ب'])->assertCreated()['data']['id'];
        $c = $this->withToken($owner)->postJson('/api/branches', ['name' => 'فرع ج'])->assertCreated()['data']['id'];

        $partner = $this->withToken($owner)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        return [
            'tid' => $tid, 'owner' => $owner, 'a' => $a, 'b' => $b, 'c' => $c, 'partner' => $partner,
            'multi' => $this->userToken($tid, 'admin', "multi@{$slug}.test", [$a, $b]),   // مسموح A و B
            'onlyA' => $this->userToken($tid, 'admin', "onlya@{$slug}.test", [$a]),       // مقيَّد بـ A
            'onlyB' => $this->userToken($tid, 'admin', "onlyb@{$slug}.test", [$b]),       // مقيَّد بـ B
            'staff' => $this->userToken($tid, 'staff', "staff@{$slug}.test", []),         // لا invoices.manage
            'selfService' => $this->userToken($tid, 'self_service', "ss@{$slug}.test", []), // لا invoices.view
        ];
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

    private function call_(string $token, ?string $branch, string $method, string $uri, array $payload = [])
    {
        $headers = $branch ? ['X-Branch-Id' => $branch] : [];

        return $this->withToken($token)->withHeaders($headers)->json($method, $uri, $payload);
    }

    private function invoicePayload(array $w, int $price = 10000): array
    {
        return [
            'partner_id' => $w['partner'], 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        ];
    }

    private function draftInvoice(array $w, string $branch): array
    {
        return $this->call_($w['owner'], $branch, 'POST', '/api/invoices', $this->invoicePayload($w))
            ->assertCreated()['data'];
    }

    /** فاتورة مرحَّلة (تحمل أثر ZATCA) في الفرع المحدد. */
    private function postedInvoice(array $w, string $branch): array
    {
        $draft = $this->draftInvoice($w, $branch);

        return $this->call_($w['owner'], $branch, 'POST', "/api/invoices/{$draft['id']}/post")
            ->assertOk()['data'];
    }

    /** إشعار دائن مسودة في فرع `$noteBranch` مصدره فاتورة مرحَّلة `$source`. */
    private function draftNote(array $w, string $noteBranch, array $source): string
    {
        $id = $this->call_($w['owner'], $noteBranch, 'POST', '/api/credit-notes', [
            'partner_id' => $source['partner_id'],
            'original_invoice_id' => $source['id'],
            'items' => [['source_line_id' => $source['lines'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()['data']['id'];

        // ترقيم الإشعارات لكل فرع، وفهرس SQLite `(tenant_id, number)` بلا شرط الفرع (قيد قاعدة اختبار معروف).
        DB::table('credit_notes')->where('id', $id)->update(['number' => 'T-' . $id]);

        return $id;
    }

    private function makeBranchless(string $table, string $id): void
    {
        // الرقم يُميَّز مع إسقاط الوسم (فهرس SQLite للصفوف بلا فرع بلا شرط `branch_id IS NULL`)، بصيغةٍ
        // تنتهي برقم كي تبقى متوافقة مع مُولِّد الترقيم (`max()+1`) عند نسخ المستند لاحقاً.
        $number = (string) DB::table($table)->where('id', $id)->value('number');
        DB::table($table)->where('id', $id)->update([
            'branch_id' => null,
            'number' => preg_replace('/(\d+)$/', '9$1', $number),
        ]);
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

    /** محاولة إرسال pending لفاتورة في فرعها (بيد المالك). الإرسال معطَّل افتراضياً ⇒ لا طابور. */
    private function attemptFor(array $w, array $invoice, string $branch, string $key): string
    {
        return $this->withToken($w['owner'])->withHeaders(['X-Branch-Id' => $branch, 'Idempotency-Key' => $key])
            ->postJson("/api/invoices/{$invoice['id']}/zatca/submissions")
            ->assertStatus(202)['data']['id'];
    }

    // ───────────────────────── لقطات «لا أثر عند الرفض» ─────────────────────────

    private function counts(): array
    {
        return [
            'invoices' => DB::table('invoices')->count(),
            'invoice_lines' => DB::table('invoice_lines')->count(),
            'invoice_notes' => DB::table('invoice_notes')->count(),
            'invoice_note_attachments' => DB::table('invoice_note_attachments')->count(),
            'attempts' => DB::table('zatca_submission_attempts')->count(),
            'credit_notes' => DB::table('credit_notes')->count(),
            'credit_note_lines' => DB::table('credit_note_lines')->count(),
            'journal_entries' => DB::table('journal_entries')->count(),
            'journal_lines' => DB::table('journal_lines')->count(),
            'stock_movements' => DB::table('stock_movements')->count(),
            'payments' => DB::table('payments')->count(),
            'revisions' => DB::table('document_revisions')->count(),
            'max_icv' => DB::table('invoices')->max('zatca_icv'),
        ];
    }

    private function row(string $table, string $id): array
    {
        return (array) DB::table($table)->where('id', $id)->first();
    }

    private function files(): array
    {
        return Storage::disk('local')->allFiles();
    }

    // ═══════════════════════ 1. InvoiceController::duplicate ═══════════════════════

    /** @test */
    public function duplicate_is_active_branch_only_and_leaves_no_trace_on_denial(): void
    {
        $w = $this->world();
        $inA = $this->draftInvoice($w, $w['a']);
        $inB = $this->draftInvoice($w, $w['b']);

        // الفرع النشط A + المصدر في A: السلوك القائم.
        $this->call_($w['multi'], $w['a'], 'POST', "/api/invoices/{$inA['id']}/duplicate")->assertCreated();

        // المصدر في B (مسموح لكن غير نشط) ⇒ 404 بلا أي أثر؛ و`?branch=all` لا يوسّع.
        foreach (['', '?branch=all'] as $q) {
            $before = $this->counts();
            $src = $this->row('invoices', $inB['id']);
            $this->call_($w['multi'], $w['a'], 'POST', "/api/invoices/{$inB['id']}/duplicate{$q}")->assertNotFound();
            $this->assertSame($before, $this->counts(), "duplicate{$q}: لا مسودة/سطر/مراجعة");
            $this->assertSame($src, $this->row('invoices', $inB['id']));
        }

        // مالك غير مقيَّد: يجب التبديل أيضاً.
        $this->call_($w['owner'], $w['a'], 'POST', "/api/invoices/{$inB['id']}/duplicate")->assertNotFound();

        // ضابط إيجابي: بعد التبديل إلى B تنجح وفق القواعد القائمة.
        $this->call_($w['multi'], $w['b'], 'POST', "/api/invoices/{$inB['id']}/duplicate")->assertCreated();

        // فرع خارج نطاق المقيَّد (حتى مع ترويسة مزوّرة) ⇒ 404.
        $inC = $this->draftInvoice($w, $w['c']);
        $before = $this->counts();
        $this->call_($w['onlyA'], null, 'POST', "/api/invoices/{$inC['id']}/duplicate")->assertNotFound();
        $this->call_($w['onlyA'], $w['c'], 'POST', "/api/invoices/{$inC['id']}/duplicate")->assertNotFound();
        $this->assertSame($before, $this->counts());

        // بلا فرع (توافق رجعي) ⇒ متاح.
        $legacy = $this->draftInvoice($w, $w['b']);
        $this->makeBranchless('invoices', $legacy['id']);
        $this->call_($w['multi'], $w['a'], 'POST', "/api/invoices/{$legacy['id']}/duplicate")->assertCreated();

        // الصلاحية: 403 وليس 404 (المسار يتحقق منها أولاً) — وبلا أثر.
        $before = $this->counts();
        $this->call_($w['staff'], $w['a'], 'POST', "/api/invoices/{$inA['id']}/duplicate")->assertForbidden();
        $this->call_($w['staff'], $w['a'], 'POST', "/api/invoices/{$inB['id']}/duplicate")->assertForbidden();
        $this->assertSame($before, $this->counts());
    }

    /** @test */
    public function duplicate_foreign_tenant_and_nonexistent_are_404(): void
    {
        $w1 = $this->world('rem03b-d1');
        $w2 = $this->world('rem03b-d2');
        $foreign = $this->draftInvoice($w2, $w2['a']);
        $before = $this->counts();

        $this->call_($w1['owner'], $w2['a'], 'POST', "/api/invoices/{$foreign['id']}/duplicate")->assertNotFound();
        $this->call_($w1['multi'], $w1['a'], 'POST', "/api/invoices/{$foreign['id']}/duplicate")->assertNotFound();
        $this->call_($w1['multi'], $w1['a'], 'POST', '/api/invoices/00000000-0000-4000-8000-000000000000/duplicate')->assertNotFound();
        $this->assertSame($before, $this->counts());
    }

    // ═══════════════════════ 2. InvoiceController::storeNote ═══════════════════════

    /** @test */
    public function store_note_is_active_branch_only_with_no_note_row_attachment_row_or_object_on_denial(): void
    {
        Storage::fake('local');
        $w = $this->world();
        $inA = $this->draftInvoice($w, $w['a']);
        $inB = $this->draftInvoice($w, $w['b']);

        // الفرع النشط A: ملاحظة نصية ثم ملاحظة بمرفق تنجحان.
        $this->call_($w['multi'], $w['a'], 'POST', "/api/invoices/{$inA['id']}/notes", ['body' => 'ملاحظة'])->assertCreated();
        $this->withToken($w['multi'])->withHeaders(['X-Branch-Id' => $w['a']])
            ->post("/api/invoices/{$inA['id']}/notes", [
                'body' => 'مع مرفق', 'attachments' => [UploadedFile::fake()->create('p.pdf', 20, 'application/pdf')],
            ])->assertCreated();

        // B (مسموح لكن غير نشط): نصية ومرفقة، بدون/مع `?branch=all` ⇒ 404 بلا أي أثر ولا كائن مخزَّن.
        foreach (['', '?branch=all'] as $q) {
            $beforeCounts = $this->counts();
            $beforeFiles = $this->files();
            $beforeInvoice = $this->row('invoices', $inB['id']);

            $this->call_($w['multi'], $w['a'], 'POST', "/api/invoices/{$inB['id']}/notes{$q}", ['body' => 'محاولة'])->assertNotFound();
            $this->withToken($w['multi'])->withHeaders(['X-Branch-Id' => $w['a']])
                ->post("/api/invoices/{$inB['id']}/notes{$q}", [
                    'body' => 'محاولة بمرفق', 'attachments' => [UploadedFile::fake()->create('x.pdf', 20, 'application/pdf')],
                ])->assertNotFound();

            $this->assertSame($beforeCounts, $this->counts(), "notes{$q}: لا ملاحظة ولا صف مرفق");
            $this->assertSame($beforeFiles, $this->files(), "notes{$q}: لا كائن مخزَّن");
            $this->assertSame($beforeInvoice, $this->row('invoices', $inB['id']));
        }

        // مالك غير مقيَّد ومقيَّد خارج نطاقه.
        $this->call_($w['owner'], $w['a'], 'POST', "/api/invoices/{$inB['id']}/notes", ['body' => 'x'])->assertNotFound();
        $this->call_($w['onlyA'], $w['b'], 'POST', "/api/invoices/{$inB['id']}/notes", ['body' => 'x'])->assertNotFound();

        // ضابط إيجابي: بعد التبديل إلى B.
        $this->call_($w['multi'], $w['b'], 'POST', "/api/invoices/{$inB['id']}/notes", ['body' => 'الآن'])->assertCreated();

        // القراءة لم تتغيّر (سياسة القراءة): `notes()` على B مع ?branch=all ما زالت تعمل لمن يملك B.
        $this->call_($w['multi'], $w['a'], 'GET', "/api/invoices/{$inB['id']}/notes?branch=all")->assertOk();

        // الصلاحية: 403.
        $beforeCounts = $this->counts();
        $this->call_($w['staff'], $w['a'], 'POST', "/api/invoices/{$inA['id']}/notes", ['body' => 'x'])->assertForbidden();
        $this->call_($w['staff'], $w['a'], 'POST', "/api/invoices/{$inB['id']}/notes", ['body' => 'x'])->assertForbidden();
        $this->assertSame($beforeCounts, $this->counts());
    }

    /** @test */
    public function store_note_foreign_tenant_and_branchless_behaviour(): void
    {
        Storage::fake('local');
        $w1 = $this->world('rem03b-n1');
        $w2 = $this->world('rem03b-n2');
        $foreign = $this->draftInvoice($w2, $w2['a']);
        $beforeCounts = $this->counts();
        $beforeFiles = $this->files();

        $this->call_($w1['owner'], $w2['a'], 'POST', "/api/invoices/{$foreign['id']}/notes", ['body' => 'x'])->assertNotFound();
        $this->assertSame($beforeCounts, $this->counts());
        $this->assertSame($beforeFiles, $this->files());

        $legacy = $this->draftInvoice($w1, $w1['b']);
        $this->makeBranchless('invoices', $legacy['id']);
        $this->call_($w1['multi'], $w1['a'], 'POST', "/api/invoices/{$legacy['id']}/notes", ['body' => 'قديم'])->assertCreated();
    }

    // ═══════════════════════ 3. ZatcaSubmissionController::store ═══════════════════════

    /** @test */
    public function zatca_store_is_active_branch_only_and_creates_no_attempt_job_or_network_call_on_denial(): void
    {
        $w = $this->world();
        $invB = $this->postedInvoice($w, $w['b']);
        $invA = $this->postedInvoice($w, $w['a']);

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w); // لو تسرّب الحارس لدُفعت مهمة

        foreach (['', '?branch=all'] as $q) {
            $before = $this->counts();
            $invoiceRow = $this->row('invoices', $invB['id']);
            $this->withToken($w['multi'])->withHeaders(['X-Branch-Id' => $w['a'], 'Idempotency-Key' => 'wrong-branch'])
                ->postJson("/api/invoices/{$invB['id']}/zatca/submissions{$q}")->assertNotFound();

            $this->assertSame($before, $this->counts(), "store{$q}: لا محاولة");
            $this->assertSame($invoiceRow, $this->row('invoices', $invB['id']), 'لا تعديل لحقول ZATCA');
        }
        Queue::assertNothingPushed();
        Http::assertNothingSent();

        // مالك غير مقيَّد (مع `?branch=all` أيضاً) + مقيَّد خارج النطاق (ترويسة مزوّرة لفرع غير مسموح).
        $this->withToken($w['owner'])->withHeaders(['X-Branch-Id' => $w['a'], 'Idempotency-Key' => 'k-owner'])
            ->postJson("/api/invoices/{$invB['id']}/zatca/submissions")->assertNotFound();
        $this->withToken($w['owner'])->withHeaders(['X-Branch-Id' => $w['a'], 'Idempotency-Key' => 'k-owner-all'])
            ->postJson("/api/invoices/{$invB['id']}/zatca/submissions?branch=all")->assertNotFound();
        $this->withToken($w['onlyA'])->withHeaders(['X-Branch-Id' => $w['b'], 'Idempotency-Key' => 'k-onlya'])
            ->postJson("/api/invoices/{$invB['id']}/zatca/submissions")->assertNotFound();
        $this->assertSame(0, DB::table('zatca_submission_attempts')->count());
        Queue::assertNothingPushed();

        // الصلاحية: 403 (staff بلا invoices.manage) وبلا أثر.
        $this->withToken($w['staff'])->withHeaders(['X-Branch-Id' => $w['a'], 'Idempotency-Key' => 'k-staff'])
            ->postJson("/api/invoices/{$invA['id']}/zatca/submissions")->assertForbidden();
        $this->assertSame(0, DB::table('zatca_submission_attempts')->count());

        // ضابط إيجابي: الفرع النشط الصحيح ⇒ السلوك القائم (محاولة + طابور).
        $this->withToken($w['multi'])->withHeaders(['X-Branch-Id' => $w['b'], 'Idempotency-Key' => 'right-branch'])
            ->postJson("/api/invoices/{$invB['id']}/zatca/submissions")
            ->assertStatus(202)->assertJsonPath('meta.network_submission_performed', false);
        $this->assertSame(1, DB::table('zatca_submission_attempts')->count());
        Queue::assertPushed(SendZatcaSubmission::class, 1);
        Http::assertNothingSent();
    }

    /** @test */
    public function zatca_store_foreign_tenant_nonexistent_and_entitlement_are_preserved(): void
    {
        $w1 = $this->world('rem03b-z1');
        $w2 = $this->world('rem03b-z2');
        $foreign = $this->postedInvoice($w2, $w2['a']);
        $own = $this->postedInvoice($w1, $w1['a']);
        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();

        $send = fn (string $token, ?string $branch, string $id, string $key) => $this->withToken($token)
            ->withHeaders(array_filter(['X-Branch-Id' => $branch, 'Idempotency-Key' => $key]))
            ->postJson("/api/invoices/{$id}/zatca/submissions");

        $send($w1['owner'], $w2['a'], $foreign['id'], 'f1')->assertNotFound();
        $send($w1['multi'], $w1['a'], $foreign['id'], 'f2')->assertNotFound();
        $send($w1['multi'], $w1['a'], '00000000-0000-4000-8000-000000000000', 'f3')->assertNotFound();
        $this->assertSame(0, DB::table('zatca_submission_attempts')->count());

        // الترويسة الأجنبية لا تصير فرعاً نشطاً: فاتورتنا في A تعمل (الافتراضي).
        $send($w1['owner'], $w2['a'], $own['id'], 'ok-1')->assertStatus(202);

        // التفعيل (الأهلية) محفوظ: عند تعطيل compliance.zatca يبقى الرد الحالي (403) وبلا أثر.
        app(TenantContext::class)->set($w1['tid']);
        app(TenantApplicationService::class)->disable('compliance.zatca', null);
        $before = DB::table('zatca_submission_attempts')->count();
        $send($w1['owner'], $w1['a'], $own['id'], 'ent-1')->assertForbidden();
        $this->assertSame($before, DB::table('zatca_submission_attempts')->count());
        Http::assertNothingSent();
    }

    // ═══════════════════════ 4. ZatcaSubmissionController::dispatch ═══════════════════════

    /** @test */
    public function zatca_dispatch_is_active_branch_only_and_leaves_the_attempt_untouched_on_denial(): void
    {
        $w = $this->world();
        $invB = $this->postedInvoice($w, $w['b']);
        $invA = $this->postedInvoice($w, $w['a']);
        $attB = $this->attemptFor($w, $invB, $w['b'], 'att-b');
        $attA = $this->attemptFor($w, $invA, $w['a'], 'att-a');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        $dispatch = fn (string $token, ?string $branch, string $inv, string $att, string $q = '') => $this
            ->withToken($token)->withHeaders(array_filter(['X-Branch-Id' => $branch]))
            ->postJson("/api/invoices/{$inv}/zatca/submissions/{$att}/dispatch{$q}");

        // B (مسموح لكن غير نشط): 404 — ولو كررناه ثلاثاً (مع `?branch=all`) لا يتغيّر شيء.
        $attemptRow = $this->row('zatca_submission_attempts', $attB);
        $invoiceRow = $this->row('invoices', $invB['id']);
        $before = $this->counts();
        for ($i = 0; $i < 3; $i++) {
            $dispatch($w['multi'], $w['a'], $invB['id'], $attB)->assertNotFound();
            $dispatch($w['multi'], $w['a'], $invB['id'], $attB, '?branch=all')->assertNotFound();
        }
        $dispatch($w['owner'], $w['a'], $invB['id'], $attB)->assertNotFound();           // مالك غير مقيَّد
        $dispatch($w['owner'], $w['a'], $invB['id'], $attB, '?branch=all')->assertNotFound(); // …و?branch=all
        $dispatch($w['onlyA'], $w['b'], $invB['id'], $attB)->assertNotFound();           // مقيَّد + ترويسة مزوّرة
        $this->assertSame($attemptRow, $this->row('zatca_submission_attempts', $attB), 'الصف كاملاً (queue_count/queued_at/…) بلا تغيير');
        $this->assertSame($invoiceRow, $this->row('invoices', $invB['id']));
        $this->assertSame($before, $this->counts());
        Queue::assertNothingPushed();
        Http::assertNothingSent();

        // الصلاحية: 403 لـ staff على فاتورة الفرع النشط الصحيحة وعلى الخاطئة، بلا أثر.
        $dispatch($w['staff'], $w['a'], $invA['id'], $attA)->assertForbidden();
        $dispatch($w['staff'], $w['a'], $invB['id'], $attB)->assertForbidden();
        $this->assertSame($attemptRow, $this->row('zatca_submission_attempts', $attB));

        // ضابط إيجابي: الفرع النشط الصحيح ⇒ السلوك القائم (queue_count=1 + مهمة واحدة).
        $dispatch($w['multi'], $w['b'], $invB['id'], $attB)->assertStatus(202)->assertJsonPath('data.queue_count', 1);
        Queue::assertPushed(SendZatcaSubmission::class, 1);
        Http::assertNothingSent();
    }

    /**
     * ربط المحاولة بالفاتورة نفسها (المحلولة بالفرع النشط) وبالمستأجر. الحالات كلها ممثَّلة عبر
     * الـAPI العام لأن المسار يحمل المعرّفين `{id}` و`{attemptId}`.
     *
     * @test
     */
    public function zatca_dispatch_binds_the_attempt_to_the_exact_authorized_invoice_and_tenant(): void
    {
        $w = $this->world();
        $w2 = $this->world('rem03b-bind2');
        $invA1 = $this->postedInvoice($w, $w['a']);
        $invA2 = $this->postedInvoice($w, $w['a']);
        $invB = $this->postedInvoice($w, $w['b']);
        $foreignInv = $this->postedInvoice($w2, $w2['a']);

        $attA1 = $this->attemptFor($w, $invA1, $w['a'], 'a1');
        $attA2 = $this->attemptFor($w, $invA2, $w['a'], 'a2');
        $attB = $this->attemptFor($w, $invB, $w['b'], 'b1');
        $foreignAtt = $this->attemptFor($w2, $foreignInv, $w2['a'], 'f1');

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        $this->zatcaReady($w);

        $dispatch = fn (string $inv, string $att, ?string $branch = null, ?string $token = null) => $this
            ->withToken($token ?? $w['multi'])->withHeaders(array_filter(['X-Branch-Id' => $branch ?? $w['a']]))
            ->postJson("/api/invoices/{$inv}/zatca/submissions/{$att}/dispatch");

        $snap = fn () => [
            $this->row('zatca_submission_attempts', $attA1), $this->row('zatca_submission_attempts', $attA2),
            $this->row('zatca_submission_attempts', $attB), $this->row('zatca_submission_attempts', $foreignAtt),
        ];
        $before = $snap();
        $counts = $this->counts();

        // (2) فاتورة A1 + محاولة فاتورة A2 (نفس الفرع/المستأجر) ⇒ 404.
        $dispatch($invA1['id'], $attA2)->assertNotFound();
        // محاولة فاتورة في B تحت مسار فاتورة A1 النشطة ⇒ 404.
        $dispatch($invA1['id'], $attB)->assertNotFound();
        // (3) فاتورة A1 + محاولة من مستأجر آخر ⇒ 404 بلا كشف.
        $dispatch($invA1['id'], $foreignAtt)->assertNotFound();
        // (5) فاتورة أجنبية (مسار) + محاولة أجنبية بمعرّفها مباشرة، من مستأجرنا ⇒ 404.
        $dispatch($foreignInv['id'], $foreignAtt)->assertNotFound();
        // فاتورة أجنبية + محاولتنا ⇒ 404.
        $dispatch($foreignInv['id'], $attA1)->assertNotFound();
        // محاولة غير موجودة.
        $dispatch($invA1['id'], '00000000-0000-4000-8000-000000000000')->assertNotFound();

        $this->assertSame($before, $snap(), 'كل المحاولات كما هي حرفياً');
        $this->assertSame($counts, $this->counts());
        Queue::assertNothingPushed();
        Http::assertNothingSent();

        // (1) فاتورة صحيحة + محاولتها ⇒ السلوك القائم.
        $dispatch($invA1['id'], $attA1)->assertStatus(202)->assertJsonPath('data.queue_count', 1);
        Queue::assertPushed(SendZatcaSubmission::class, 1);
        $this->assertSame($before[1], $this->row('zatca_submission_attempts', $attA2), 'محاولة A2 لم تُمسّ');
    }

    /**
     * البيئة: صفوف المحاولات **لا تحمل عمود بيئة** (لا `environment` في `zatca_submission_attempts`)،
     * فعدم تطابق «بيئة المحاولة» غير قابل للتمثيل. القاعدة القائمة هي جاهزية بيئة المستأجر **النشطة** عند
     * الصف؛ نثبّت أن بيئةً غير جاهزة ترفض بلا أي تغيير (تقييد البيئة لكل محاولة = REM-25 خارج النطاق).
     *
     * @test
     */
    public function zatca_dispatch_with_a_non_ready_environment_is_rejected_without_any_mutation(): void
    {
        $w = $this->world();
        $inv = $this->postedInvoice($w, $w['a']);
        $att = $this->attemptFor($w, $inv, $w['a'], 'env-1'); // بيئة التطوير الافتراضية: لا صف

        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('zatca_submission_attempts', 'environment'));

        Queue::fake();
        Http::fake();
        Http::preventStrayRequests();
        config([
            'zatca.transport.dispatch_enabled' => true,
            'zatca.transport.queue_connection' => 'database',
            'zatca.transport.queue' => 'zatca',
        ]); // لا اعتماد/بيئة جاهزة

        $row = $this->row('zatca_submission_attempts', $att);
        $this->withToken($w['multi'])->withHeaders(['X-Branch-Id' => $w['a']])
            ->postJson("/api/invoices/{$inv['id']}/zatca/submissions/{$att}/dispatch")->assertUnprocessable();
        $this->assertSame($row, $this->row('zatca_submission_attempts', $att));
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    // ═══════════════════════ 5. CreditNoteController::show ═══════════════════════

    /** @test */
    public function credit_note_show_is_active_branch_only(): void
    {
        $w = $this->world();
        $srcA = $this->postedInvoice($w, $w['a']);
        $noteA = $this->draftNote($w, $w['a'], $srcA);
        $noteB = $this->draftNote($w, $w['b'], $srcA); // مصدر في A، إشعار في B

        $this->call_($w['multi'], $w['a'], 'GET', "/api/credit-notes/{$noteA}")->assertOk();

        foreach (['', '?branch=all'] as $q) {
            $this->call_($w['multi'], $w['a'], 'GET', "/api/credit-notes/{$noteB}{$q}")->assertNotFound();
        }
        $this->call_($w['owner'], $w['a'], 'GET', "/api/credit-notes/{$noteB}")->assertNotFound();

        // التبديل إلى B ⇒ القراءة القائمة (والبنية نفسها).
        $this->call_($w['multi'], $w['b'], 'GET', "/api/credit-notes/{$noteB}")
            ->assertOk()->assertJsonPath('data.id', $noteB)->assertJsonStructure(['data' => ['id', 'lines']]);

        // مقيَّد بـ A لا يرى B حتى بترويسة مزوّرة.
        $this->call_($w['onlyA'], $w['b'], 'GET', "/api/credit-notes/{$noteB}")->assertNotFound();

        // بلا فرع (توافق رجعي).
        $legacy = $this->draftNote($w, $w['b'], $srcA);
        $this->makeBranchless('credit_notes', $legacy);
        $this->call_($w['multi'], $w['a'], 'GET', "/api/credit-notes/{$legacy}")->assertOk();

        // الصلاحية: بلا invoices.view ⇒ 403 (لا 404) للفرع الخاطئ والصحيح.
        $this->call_($w['selfService'], $w['a'], 'GET', "/api/credit-notes/{$noteA}")->assertForbidden();
        $this->call_($w['selfService'], $w['a'], 'GET', "/api/credit-notes/{$noteB}")->assertForbidden();
    }

    /** @test */
    public function credit_note_show_foreign_tenant_is_404(): void
    {
        $w1 = $this->world('rem03b-c1');
        $w2 = $this->world('rem03b-c2');
        $src2 = $this->postedInvoice($w2, $w2['a']);
        $foreign = $this->draftNote($w2, $w2['a'], $src2);

        $this->call_($w1['owner'], $w2['a'], 'GET', "/api/credit-notes/{$foreign}")->assertNotFound();
        $this->call_($w1['multi'], $w1['a'], 'GET', "/api/credit-notes/{$foreign}?branch=all")->assertNotFound();
    }

    // ═══════════════════════ 6. CreditNoteController::post ═══════════════════════

    /** @test */
    public function credit_note_post_is_active_branch_only_with_zero_accounting_footprint_on_denial(): void
    {
        $w = $this->world();
        $srcA = $this->postedInvoice($w, $w['a']);
        $noteB = $this->draftNote($w, $w['b'], $srcA);   // الإشعار في B، مصدره في A (مرجع عبر الفروع)

        foreach (['', '?branch=all'] as $q) {
            $note = $this->row('credit_notes', $noteB);
            $source = $this->row('invoices', $srcA['id']);
            $before = $this->counts();
            $this->call_($w['multi'], $w['a'], 'POST', "/api/credit-notes/{$noteB}/post{$q}")->assertNotFound();
            $this->assertSame($note, $this->row('credit_notes', $noteB), "post{$q}: الإشعار كما هو");
            $this->assertSame($source, $this->row('invoices', $srcA['id']), 'الفاتورة المصدر كما هي');
            $this->assertSame($before, $this->counts(), 'لا قيد/سطر/مخزون/دفعة/مراجعة');
        }
        $this->call_($w['owner'], $w['a'], 'POST', "/api/credit-notes/{$noteB}/post")->assertNotFound(); // مالك غير مقيَّد
        $this->call_($w['owner'], $w['a'], 'POST', "/api/credit-notes/{$noteB}/post?branch=all")->assertNotFound(); // …ولا يوسّعه ?branch=all
        $this->call_($w['onlyA'], $w['b'], 'POST', "/api/credit-notes/{$noteB}/post")->assertNotFound();  // مقيَّد + مزوّرة

        // الصلاحية: 403 لـ staff، وبلا أثر.
        $before = $this->counts();
        $this->call_($w['staff'], $w['b'], 'POST', "/api/credit-notes/{$noteB}/post")->assertForbidden();
        $this->assertSame($before, $this->counts());

        // ضابط إيجابي: الفرع النشط الصحيح ⇒ الترحيل القائم (قيد جديد واحد على الأقل، دون تقييم أرقام).
        $entries = DB::table('journal_entries')->count();
        $this->call_($w['multi'], $w['b'], 'POST', "/api/credit-notes/{$noteB}/post")->assertOk();
        $this->assertGreaterThan($entries, DB::table('journal_entries')->count());
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $noteB)->value('status'));
    }

    /** @test */
    public function credit_note_post_keeps_the_original_invoice_reference_policy_unchanged(): void
    {
        $w = $this->world();
        $srcA = $this->postedInvoice($w, $w['a']);
        $noteB = $this->draftNote($w, $w['b'], $srcA);

        // مقيَّد بـ B وحده: الإشعار في B (فرعه النشط) لكن فاتورته المصدر في A خارج نطاقه ⇒ يرفض
        // بقاعدة المرجع القائمة (404 غير مُسرِّب) لا بقاعدة REM-03b — ولا أثر.
        $before = $this->counts();
        $note = $this->row('credit_notes', $noteB);
        $this->call_($w['onlyB'], $w['b'], 'POST', "/api/credit-notes/{$noteB}/post")->assertNotFound();
        $this->assertSame($note, $this->row('credit_notes', $noteB));
        $this->assertSame($before, $this->counts());

        // ومن يملك B و A (multi) ينجح بمصدر في فرع آخر مسموح (لم يُشدَّد المرجع إلى «النشط فقط»).
        $this->call_($w['multi'], $w['b'], 'POST', "/api/credit-notes/{$noteB}/post")->assertOk();
    }

    /** @test */
    public function credit_note_post_foreign_tenant_and_branchless_behaviour(): void
    {
        $w1 = $this->world('rem03b-p1');
        $w2 = $this->world('rem03b-p2');
        $src2 = $this->postedInvoice($w2, $w2['a']);
        $foreign = $this->draftNote($w2, $w2['a'], $src2);
        $before = $this->counts();
        $row = $this->row('credit_notes', $foreign);

        $this->call_($w1['owner'], $w2['a'], 'POST', "/api/credit-notes/{$foreign}/post")->assertNotFound();
        $this->assertSame($row, $this->row('credit_notes', $foreign));
        $this->assertSame($before, $this->counts());

        $src1 = $this->postedInvoice($w1, $w1['a']);
        $legacy = $this->draftNote($w1, $w1['b'], $src1);
        $this->makeBranchless('credit_notes', $legacy);
        $this->call_($w1['multi'], $w1['a'], 'POST', "/api/credit-notes/{$legacy}/post")->assertOk();
    }

    // ═══════════════════════ 7. توصيف المستثنيات (بلا تغيير إنتاج) ═══════════════════════

    /** @test */
    public function returnable_credit_note_source_reference_still_uses_the_allowed_branch_policy(): void
    {
        $w = $this->world();
        $srcB = $this->postedInvoice($w, $w['b']);

        // الفرع النشط A والمصدر في B (مسموح): المرجع يعمل (لم يصر «نشط فقط»).
        $this->call_($w['multi'], $w['a'], 'GET', "/api/credit-notes/returnable/{$srcB['id']}")->assertOk();
        // خارج الفروع المسموحة ⇒ سياسة المرجع القائمة (404).
        $this->call_($w['onlyA'], $w['a'], 'GET', "/api/credit-notes/returnable/{$srcB['id']}")->assertNotFound();
    }

    /** @test */
    public function appointments_keep_the_general_read_policy_including_branch_all(): void
    {
        $w = $this->world();
        $invB = $this->draftInvoice($w, $w['b']);

        $this->call_($w['multi'], $w['a'], 'GET', "/api/invoices/{$invB['id']}/appointments")->assertNotFound();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/invoices/{$invB['id']}/appointments?branch=all")->assertOk();
    }
}
