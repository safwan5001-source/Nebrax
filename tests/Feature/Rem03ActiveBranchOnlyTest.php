<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Quote;
use App\Models\ReturnDocument;
use App\Http\Controllers\Api\ApiController;
use App\Models\User;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-03 / SEC-01 — «الفرع النشط فقط» للعمليات المستهدفة على مستند بمعرّفه
 * ═══════════════════════════════════════════════════════════════
 *  قرار المالك (موثَّق): عملية تغييرية/قراءة بمعرّف على فاتورة أو مرتجع أو
 *  عرض سعر أو سجلّ تعديلات تُقبل فقط إن كان فرع المستند هو **الفرع النشط**.
 *  مستخدمٌ مسموحٌ له بفرعين يعمل في أحدهما بينما الآخر غير نشط ⇒ 404 للآخر
 *  حتى لو كان ضمن `allowedBranchIds()`؛ ويبدّل الفرع النشط صراحةً ليصل إليه.
 *
 *  هذه الاختبارات تثبت أيضاً أن السياسة العامة لـ Access Control V2 **لم تتغيّر**:
 *  قراءة فاتورة الفرع الآخر بـ `?branch=all` (مسار القراءة القائم) ما زالت تعمل،
 *  والمستخدم غير المقيَّد ما زال يرى كل شيء عند التبديل، والصفوف بلا فرع متاحة.
 *
 *  تشغيل: php artisan test --filter=Rem03ActiveBranchOnlyTest
 */
class Rem03ActiveBranchOnlyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const INVOICE_OPS = ['update', 'classify', 'destroy', 'post'];

    // ───────────────────────── عالم الاختبار ─────────────────────────

    /** @return array<string, mixed> */
    private function world(string $slug = 'rem03'): array
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
        $product = $this->withToken($owner)->postJson('/api/products', [
            'name' => 'خدمة', 'sku' => "SVC-{$slug}", 'type' => 'service', 'sale_price' => 10000, 'tax_rate' => 15,
        ])->assertCreated()['data']['id'];

        return [
            'tid' => $tid, 'owner' => $owner, 'a' => $a, 'b' => $b, 'c' => $c,
            'partner' => $partner, 'product' => $product,
            // admin مسموحٌ له بـ A و B فقط (غير نشط في B ما دام A هو الرئيسي/الافتراضي).
            'multi' => $this->userToken($tid, 'admin', "multi@{$slug}.test", [$a, $b]),
            // admin مقيَّد بـ A وحده.
            'onlyA' => $this->userToken($tid, 'admin', "onlya@{$slug}.test", [$a]),
            // دور بلا invoices.manage / returns.manage (قراءة فقط) وغير مقيَّد بفروع.
            'staff' => $this->userToken($tid, 'staff', "staff@{$slug}.test", []),
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

    /** طلب API باسم توكن، بفرع نشط (ترويسة) اختيارياً. */
    private function call_(string $token, ?string $branch, string $method, string $uri, array $payload = [])
    {
        $headers = $branch ? ['X-Branch-Id' => $branch] : [];

        return $this->withToken($token)->withHeaders($headers)->json($method, $uri, $payload);
    }

    private function invoicePayload(array $w, int $price = 10000): array
    {
        return [
            'partner_id' => $w['partner'], 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        ];
    }

    /** مسودة فاتورة في فرع محدّد (بيد المالك غير المقيَّد). */
    private function draftInvoice(array $w, string $branch, int $price = 10000): string
    {
        return $this->call_($w['owner'], $branch, 'POST', '/api/invoices', $this->invoicePayload($w, $price))
            ->assertCreated()['data']['id'];
    }

    private function draftQuote(array $w, string $branch): string
    {
        $id = $this->call_($w['owner'], $branch, 'POST', '/api/quotes', [
            'partner_id' => $w['partner'], 'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        // ترقيم عروض الأسعار لكل فرع، لكن فهرس SQLite `(tenant_id, number)` لا يحمل
        // شرط الفرع (قيد قاعدة اختبار معروف — يتكرّر في اختبارات متعددة الفروع الأخرى)؛
        // نميّز الرقم صراحةً كي يتّسع الاختبار لفرعين في مستأجر واحد على القاعدتين.
        DB::table('quotes')->where('id', $id)->update(['number' => 'T-' . $id]);

        return $id;
    }

    private function draftReturn(array $w, string $branch): string
    {
        $id = $this->call_($w['owner'], $branch, 'POST', '/api/returns', [
            'type' => 'sales', 'partner_id' => $w['partner'], 'payment_type' => 'credit',
            'items' => [['product_id' => $w['product'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        // نفس قيد فهرس SQLite المذكور في draftQuote().
        DB::table('return_documents')->where('id', $id)->update(['number' => 'T-' . $id]);

        return $id;
    }

    /** يحذف وسم الفرع (صفّ ما قبل الفروع) مباشرةً — سيناريو التوافق الرجعي. */
    private function makeBranchless(string $table, string $id): void
    {
        // الرقم يُميَّز مع إسقاط الوسم: فهرس SQLite للصفوف بلا فرع `(tenant_id, number)` بلا
        // شرط `WHERE branch_id IS NULL` (قيد قاعدة اختبار معروف)، فيصطدم برقم مستندٍ آخر.
        DB::table($table)->where('id', $id)->update(['branch_id' => null, 'number' => 'L-' . $id]);
    }

    // ───────────────────────── لقطات «لا أثر عند الرفض» ─────────────────────────

    /** كل ما قد تمسّه عمليةٌ تغييرية: الصف نفسه + عدّادات الأثر المحاسبي والمخزني وZATCA. */
    private function footprint(string $table, string $id): array
    {
        return [
            'row' => (array) DB::table($table)->where('id', $id)->first(),
            'journal_entries' => DB::table('journal_entries')->count(),
            'journal_lines' => DB::table('journal_lines')->count(),
            'stock_movements' => DB::table('stock_movements')->count(),
            'payments' => DB::table('payments')->count(),
            'invoices' => DB::table('invoices')->count(),
            'quotes' => DB::table('quotes')->count(),
            'returns' => DB::table('return_documents')->count(),
            'max_icv' => DB::table('invoices')->max('zatca_icv'),
            'revisions' => DB::table('document_revisions')->count(),
        ];
    }

    private function invoiceRequest(string $op, string $id, array $w): array
    {
        return match ($op) {
            'update' => ['PUT', "/api/invoices/{$id}", $this->invoicePayload($w, 99900)],
            'classify' => ['PUT', "/api/invoices/{$id}/classification", ['classification_id' => null]],
            'destroy' => ['DELETE', "/api/invoices/{$id}", []],
            'post' => ['POST', "/api/invoices/{$id}/post", []],
        };
    }

    // ═══════════════════════ A. الفواتير ═══════════════════════

    /** @test */
    public function multi_branch_user_succeeds_on_the_active_branch_for_every_invoice_mutation(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['a']);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);
            $this->call_($w['multi'], $w['a'], $m, $u, $p)->assertOk();
        }
    }

    /**
     * الاختبار المحوري: B ضمن `allowedBranchIds()` للمستخدم (يصل إليه بالقراءة
     * والتبديل) لكن الفرع النشط A ⇒ كل عملية تغييرية على B = 404 بلا أثر.
     *
     * @test
     */
    public function multi_branch_user_gets_404_on_an_allowed_but_inactive_branch_with_no_side_effects(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['b']);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);

            $before = $this->footprint('invoices', $id);
            $this->call_($w['multi'], $w['a'], $m, $u, $p)->assertNotFound();
            $this->assertSame($before, $this->footprint('invoices', $id), "{$op}: رفضٌ بلا أي أثر");
        }

        // السياسة العامة لم تتغيّر: B مسموح له بالقراءة (مسار القراءة القائم)…
        $bInvoice = $this->draftInvoice($w, $w['b']);
        $this->call_($w['multi'], $w['b'], 'GET', "/api/invoices/{$bInvoice}")->assertOk();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/invoices/{$bInvoice}?branch=all")->assertOk();

        // …وبتبديل الفرع النشط إلى B تصبح العملية المستهدفة ممكنة.
        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['b']);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);
            $this->call_($w['multi'], $w['b'], $m, $u, $p)->assertOk();
        }
    }

    /** @test */
    public function branch_all_never_widens_a_targeted_invoice_mutation(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['b']);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);

            $before = $this->footprint('invoices', $id);
            $this->call_($w['multi'], $w['a'], $m, $u . '?branch=all', $p)->assertNotFound();
            $this->assertSame($before, $this->footprint('invoices', $id));
        }

        // المالك غير المقيَّد أيضاً: ?branch=all لا يكفي بدل التبديل.
        $id = $this->draftInvoice($w, $w['b']);
        $this->call_($w['owner'], $w['a'], 'POST', "/api/invoices/{$id}/post?branch=all")->assertNotFound();
    }

    /** @test */
    public function a_branch_outside_the_restricted_users_scope_is_404_even_with_a_forged_branch_header(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['c']);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);

            $before = $this->footprint('invoices', $id);
            // بلا ترويسة، وبترويسة مزوَّرة لفرع غير مسموح (SetBranch يتجاهلها).
            $this->call_($w['onlyA'], null, $m, $u, $p)->assertNotFound();
            $this->call_($w['onlyA'], $w['c'], $m, $u, $p)->assertNotFound();
            $this->assertSame($before, $this->footprint('invoices', $id));
        }
    }

    /** @test */
    public function an_unrestricted_owner_must_switch_the_active_branch_too(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['b']);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);

            $this->call_($w['owner'], $w['a'], $m, $u, $p)->assertNotFound();
            $this->call_($w['owner'], $w['b'], $m, $u, $p)->assertOk();
        }
    }

    /** @test */
    public function a_branchless_legacy_invoice_stays_reachable(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $id = $this->draftInvoice($w, $w['b']);
            $this->makeBranchless('invoices', $id);
            [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);

            $this->call_($w['multi'], $w['a'], $m, $u, $p)->assertOk();
        }
    }

    /** @test */
    public function a_nonexistent_id_and_a_foreign_branch_id_return_the_identical_404_body(): void
    {
        $w = $this->world();
        $b = $this->draftInvoice($w, $w['b']);
        $ghost = '00000000-0000-4000-8000-000000000000';

        foreach (self::INVOICE_OPS as $op) {
            [$m, $u, $p] = $this->invoiceRequest($op, $b, $w);
            [, $uGhost] = $this->invoiceRequest($op, $ghost, $w);

            $denied = $this->call_($w['multi'], $w['a'], $m, $u, $p)->assertNotFound();
            $missing = $this->call_($w['multi'], $w['a'], $m, $uGhost, $p)->assertNotFound();

            // الرسالة ونوع الاستثناء متطابقان بعد توحيد المعرّف (لا تمييز لوجود المستند).
            // (حقل `trace` في وضع التصحيح يحمل أرقام أسطر الاختبار نفسه فلا يُقارَن؛
            // في الإنتاج `APP_DEBUG=false` يُعاد جسمٌ موحَّد.)
            $this->assertSame(
                str_replace($ghost, $b, (string) $missing->json('message')),
                (string) $denied->json('message'),
                "{$op}: رسالة 404 المرفوض لا تختلف عن غير الموجود",
            );
            $this->assertSame($missing->json('exception'), $denied->json('exception'));
            $this->assertSame($missing->status(), $denied->status());
        }
    }

    /** @test */
    public function a_user_without_the_action_permission_still_gets_403_before_any_branch_logic(): void
    {
        $w = $this->world();

        foreach (self::INVOICE_OPS as $op) {
            $inActive = $this->draftInvoice($w, $w['a']);
            $inOther = $this->draftInvoice($w, $w['b']);

            foreach ([$inActive, $inOther] as $id) {
                [$m, $u, $p] = $this->invoiceRequest($op, $id, $w);
                $before = $this->footprint('invoices', $id);
                $this->call_($w['staff'], $w['a'], $m, $u, $p)->assertForbidden();
                $this->assertSame($before, $this->footprint('invoices', $id));
            }
        }

        // وعكسه: الصلاحية وحدها لا تكفي مع فرع نشط خاطئ ⇒ 404 لا 403.
        $other = $this->draftInvoice($w, $w['b']);
        $this->call_($w['multi'], $w['a'], 'DELETE', "/api/invoices/{$other}")->assertNotFound();
    }

    /** @test */
    public function a_denied_invoice_post_leaves_no_ledger_stock_icv_payment_or_zatca_footprint(): void
    {
        $w = $this->world();
        $id = $this->draftInvoice($w, $w['b']);

        $before = $this->footprint('invoices', $id);
        $this->call_($w['multi'], $w['a'], 'POST', "/api/invoices/{$id}/post")->assertNotFound();
        $after = $this->footprint('invoices', $id);

        $this->assertSame($before, $after);
        $this->assertSame('draft', $after['row']['status']);
        $this->assertNull($after['row']['zatca_icv'], 'لم يُستهلك ICV');
        $this->assertNull($after['row']['zatca_qr']);
        $this->assertNull($after['row']['zatca_xml']);
        $this->assertNull($after['row']['zatca_hash']);

        // والترحيل الحقيقي في الفرع النشط الصحيح يعمل ويستهلك ICV (ضابط إيجابي).
        $this->call_($w['multi'], $w['b'], 'POST', "/api/invoices/{$id}/post")->assertOk();
        $this->assertSame(1, (int) DB::table('invoices')->where('id', $id)->value('zatca_icv'));
    }

    /** @test */
    public function a_foreign_tenant_invoice_is_404_and_a_forged_cross_tenant_branch_header_selects_nothing(): void
    {
        $w1 = $this->world('rem03-t1');
        $w2 = $this->world('rem03-t2');

        $foreign = $this->draftInvoice($w2, $w2['a']);
        $own = $this->draftInvoice($w1, $w1['a']);

        $beforeForeign = $this->footprint('invoices', $foreign);

        foreach (self::INVOICE_OPS as $op) {
            [$m, $u, $p] = $this->invoiceRequest($op, $foreign, $w1);
            // حتى مع ترويسة فرع المستأجر الآخر.
            $this->call_($w1['owner'], $w2['a'], $m, $u, $p)->assertNotFound();
            $this->call_($w1['multi'], $w1['a'], $m, $u, $p)->assertNotFound();
        }
        $this->assertSame($beforeForeign, $this->footprint('invoices', $foreign), 'لا كتابة في المستأجر الأجنبي');

        // الترويسة الأجنبية لا تصير فرعاً نشطاً: العملية على مستند فرعنا (الافتراضي A) تنجح.
        $this->call_($w1['owner'], $w2['a'], 'PUT', "/api/invoices/{$own}", $this->invoicePayload($w1, 55500))->assertOk();
        $this->call_($w1['owner'], 'not-a-uuid', 'PUT', "/api/invoices/{$own}", $this->invoicePayload($w1, 66600))->assertOk();
    }

    // ═══════════════════════ B. المرتجعات ═══════════════════════

    /** @test */
    public function return_show_and_post_are_active_branch_only(): void
    {
        $w = $this->world();

        // الفرع النشط: نجاح.
        $own = $this->draftReturn($w, $w['a']);
        $this->call_($w['multi'], $w['a'], 'GET', "/api/returns/{$own}")->assertOk();
        $this->call_($w['multi'], $w['a'], 'POST', "/api/returns/{$own}/post")->assertOk();

        // فرع مسموح لكن غير نشط: 404، ولا أثر على الترحيل.
        $other = $this->draftReturn($w, $w['b']);
        $this->call_($w['multi'], $w['a'], 'GET', "/api/returns/{$other}")->assertNotFound();
        $before = $this->footprint('return_documents', $other);
        $this->call_($w['multi'], $w['a'], 'POST', "/api/returns/{$other}/post")->assertNotFound();
        $this->call_($w['multi'], $w['a'], 'POST', "/api/returns/{$other}/post?branch=all")->assertNotFound();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/returns/{$other}?branch=all")->assertNotFound();
        $this->assertSame($before, $this->footprint('return_documents', $other));
        $this->assertSame('draft', $before['row']['status']);

        // فرع خارج نطاق المقيَّد.
        $outside = $this->draftReturn($w, $w['c']);
        $this->call_($w['onlyA'], $w['a'], 'GET', "/api/returns/{$outside}")->assertNotFound();
        $this->call_($w['onlyA'], $w['c'], 'POST', "/api/returns/{$outside}/post")->assertNotFound();

        // بتبديل الفرع النشط تصل إليه.
        $this->call_($w['multi'], $w['b'], 'GET', "/api/returns/{$other}")->assertOk();
        $this->call_($w['multi'], $w['b'], 'POST', "/api/returns/{$other}/post")->assertOk();

        // بلا فرع (توافق رجعي) متاح.
        $legacy = $this->draftReturn($w, $w['b']);
        $this->makeBranchless('return_documents', $legacy);
        $this->call_($w['multi'], $w['a'], 'GET', "/api/returns/{$legacy}")->assertOk();

        // الصلاحية: 403 لا 404.
        $this->call_($w['staff'], $w['a'], 'POST', "/api/returns/{$own}/post")->assertForbidden();
    }

    /** @test */
    public function return_denial_covers_foreign_tenants_and_unrestricted_owners(): void
    {
        $w1 = $this->world('rem03-r1');
        $w2 = $this->world('rem03-r2');
        $foreign = $this->draftReturn($w2, $w2['a']);
        $this->call_($w1['owner'], $w2['a'], 'GET', "/api/returns/{$foreign}")->assertNotFound();
        $this->call_($w1['owner'], null, 'POST', "/api/returns/{$foreign}/post")->assertNotFound();
        $this->assertSame('draft', DB::table('return_documents')->where('id', $foreign)->value('status'));

        $other = $this->draftReturn($w1, $w1['b']);
        $this->call_($w1['owner'], $w1['a'], 'GET', "/api/returns/{$other}")->assertNotFound();
        $this->call_($w1['owner'], $w1['b'], 'GET', "/api/returns/{$other}")->assertOk();
    }

    // ═══════════════════════ C. عروض الأسعار ═══════════════════════

    private function quoteRequest(string $op, string $id, array $w): array
    {
        return match ($op) {
            'show' => ['GET', "/api/quotes/{$id}", []],
            'update' => ['PUT', "/api/quotes/{$id}", [
                'partner_id' => $w['partner'], 'items' => [['quantity' => 3, 'unit_price' => 20000, 'tax_rate' => 15]],
            ]],
            'destroy' => ['DELETE', "/api/quotes/{$id}", []],
            'issue' => ['POST', "/api/quotes/{$id}/issue", []],
            'revise' => ['POST', "/api/quotes/{$id}/revise", []],
            'convert' => ['POST', "/api/quotes/{$id}/convert", ['payment_type' => 'credit']],
        };
    }

    /** @test */
    public function quote_operations_succeed_in_the_active_branch(): void
    {
        $w = $this->world();

        foreach (['show', 'update', 'destroy', 'issue', 'convert'] as $op) {
            $id = $this->draftQuote($w, $w['a']);
            [$m, $u, $p] = $this->quoteRequest($op, $id, $w);
            $this->call_($w['multi'], $w['a'], $m, $u, $p)->assertSuccessful();
        }

        // revise يتطلّب عرضاً صادراً.
        $id = $this->draftQuote($w, $w['a']);
        $this->call_($w['multi'], $w['a'], 'POST', "/api/quotes/{$id}/issue")->assertOk();
        $this->call_($w['multi'], $w['a'], 'POST', "/api/quotes/{$id}/revise")->assertCreated();
    }

    /** @test */
    public function every_quote_operation_is_404_for_an_allowed_but_inactive_branch_and_atomic(): void
    {
        $w = $this->world();

        foreach (['show', 'update', 'destroy', 'issue', 'revise', 'convert'] as $op) {
            $id = $this->draftQuote($w, $w['b']);
            // revise يلزمه عرض صادر لتصل المحاولة إلى منطق العمل لو لم يُرفض — نُصدره في B بيد المالك.
            if ($op === 'revise') {
                $this->call_($w['owner'], $w['b'], 'POST', "/api/quotes/{$id}/issue")->assertOk();
            }
            [$m, $u, $p] = $this->quoteRequest($op, $id, $w);

            $before = $this->footprint('quotes', $id);
            $this->call_($w['multi'], $w['a'], $m, $u, $p)->assertNotFound();
            $this->call_($w['multi'], $w['a'], $m, $u . '?branch=all', $p)->assertNotFound();
            $this->assertSame($before, $this->footprint('quotes', $id), "{$op}: لا أثر (لا فاتورة/نسخة/حذف/إصدار)");
        }

        // مقيَّد: فرع خارج نطاقه.
        $c = $this->draftQuote($w, $w['c']);
        foreach (['show', 'update', 'destroy', 'issue', 'convert'] as $op) {
            [$m, $u, $p] = $this->quoteRequest($op, $c, $w);
            $this->call_($w['onlyA'], $w['a'], $m, $u, $p)->assertNotFound();
        }

        // التبديل الصريح يفتح الوصول.
        $b = $this->draftQuote($w, $w['b']);
        $this->call_($w['multi'], $w['b'], 'POST', "/api/quotes/{$b}/convert", ['payment_type' => 'credit'])->assertCreated();

        // بلا فرع (توافق رجعي).
        $legacy = $this->draftQuote($w, $w['b']);
        $this->makeBranchless('quotes', $legacy);
        $this->call_($w['multi'], $w['a'], 'GET', "/api/quotes/{$legacy}")->assertOk();

        // الصلاحية: 403.
        $own = $this->draftQuote($w, $w['a']);
        $this->call_($w['staff'], $w['a'], 'DELETE', "/api/quotes/{$own}")->assertForbidden();
        $this->assertTrue(Quote::whereKey($own)->exists());
    }

    /** @test */
    public function a_foreign_tenant_quote_is_404(): void
    {
        $w1 = $this->world('rem03-q1');
        $w2 = $this->world('rem03-q2');
        $foreign = $this->draftQuote($w2, $w2['a']);

        foreach (['show', 'update', 'destroy', 'issue', 'revise', 'convert'] as $op) {
            [$m, $u, $p] = $this->quoteRequest($op, $foreign, $w1);
            $this->call_($w1['owner'], $w2['a'], $m, $u, $p)->assertNotFound();
        }
        $this->assertSame('draft', DB::table('quotes')->where('id', $foreign)->value('status'));
        $this->assertSame(0, DB::table('invoices')->where('tenant_id', $w2['tid'])->count());
    }

    // ═══════════════════════ D. سجلّ التعديلات ═══════════════════════

    /** @test */
    public function revision_feed_shows_only_active_branch_and_branchless_documents(): void
    {
        $w = $this->world();

        $invA = $this->draftInvoice($w, $w['a']);
        $invB = $this->draftInvoice($w, $w['b']);
        $invC = $this->draftInvoice($w, $w['c']);
        $legacy = $this->draftInvoice($w, $w['b']);
        $this->makeBranchless('invoices', $legacy);
        $quoteB = $this->draftQuote($w, $w['b']);

        // مستأجر آخر: سجلّاته لا تظهر أبداً.
        $w2 = $this->world('rem03-v2');
        $foreignInv = $this->draftInvoice($w2, $w2['a']);

        $feed = $this->call_($w['multi'], $w['a'], 'GET', '/api/revisions?limit=50')->assertOk();
        $ids = collect($feed['data'])->pluck('document_id')->all();

        $this->assertContains($invA, $ids);
        $this->assertContains($legacy, $ids, 'سجلّ مستند بلا فرع يبقى ظاهراً (عقد التوافق القائم)');
        foreach ([$invB, $invC, $quoteB, $foreignInv] as $hidden) {
            $this->assertNotContains($hidden, $ids);
        }
        $this->assertCount(2, $ids, 'لا يتسرّب عدد ما استُبعد');

        // `limit` يُطبَّق بعد الترشيح: limit=1 يعيد سجلاً مسموحاً لا فراغاً بسبب مستبعَد أحدث.
        $one = $this->call_($w['multi'], $w['a'], 'GET', '/api/revisions?limit=1')->assertOk();
        $this->assertCount(1, $one['data']);
        $this->assertContains($one['data'][0]['document_id'], [$invA, $legacy]);

        // ?branch=all لا يوسّع التغذية.
        $all = $this->call_($w['multi'], $w['a'], 'GET', '/api/revisions?limit=50&branch=all')->assertOk();
        $this->assertNotContains($invB, collect($all['data'])->pluck('document_id')->all());

        // التبديل إلى B يُظهر سجلّات B (والمستند بلا فرع) فقط.
        $asB = collect($this->call_($w['multi'], $w['b'], 'GET', '/api/revisions?limit=50')->assertOk()['data'])
            ->pluck('document_id')->all();
        $this->assertContains($invB, $asB);
        $this->assertContains($quoteB, $asB);
        $this->assertNotContains($invA, $asB);
        $this->assertNotContains($invC, $asB);
    }

    /** @test */
    public function revision_index_is_404_for_other_branch_and_foreign_tenant_documents(): void
    {
        $w = $this->world();
        $invA = $this->draftInvoice($w, $w['a']);
        $invB = $this->draftInvoice($w, $w['b']);
        $quoteB = $this->draftQuote($w, $w['b']);
        $legacy = $this->draftInvoice($w, $w['b']);
        $this->makeBranchless('invoices', $legacy);

        $this->call_($w['multi'], $w['a'], 'GET', "/api/revisions/invoice/{$invA}")->assertOk();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/revisions/invoice/{$legacy}")->assertOk();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/revisions/invoice/{$invB}")->assertNotFound();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/revisions/invoice/{$invB}?branch=all")->assertNotFound();
        $this->call_($w['multi'], $w['a'], 'GET', "/api/revisions/quote/{$quoteB}")->assertNotFound();
        $this->call_($w['owner'], $w['a'], 'GET', "/api/revisions/invoice/{$invB}")->assertNotFound();

        // التبديل يفتحها.
        $this->call_($w['multi'], $w['b'], 'GET', "/api/revisions/invoice/{$invB}")->assertOk();
        $this->call_($w['multi'], $w['b'], 'GET', "/api/revisions/quote/{$quoteB}")->assertOk();

        // مقيَّد خارج نطاقه.
        $this->call_($w['onlyA'], $w['c'], 'GET', "/api/revisions/invoice/{$invB}")->assertNotFound();

        // مستأجر آخر.
        $w2 = $this->world('rem03-vi2');
        $foreign = $this->draftInvoice($w2, $w2['a']);
        $this->call_($w['owner'], $w2['a'], 'GET', "/api/revisions/invoice/{$foreign}")->assertNotFound();

        // الصلاحية: يبقى `invoices.view` الحاجز الأول (فوق 403) — الموظف يملكها ويُحجب بالفرع.
        $this->call_($w['staff'], $w['a'], 'GET', "/api/revisions/invoice/{$invB}")->assertNotFound();
    }

    /** @test */
    public function revisions_of_a_deleted_document_are_hidden_because_its_branch_cannot_be_proven(): void
    {
        $w = $this->world();
        $id = $this->draftInvoice($w, $w['a']);
        $this->call_($w['multi'], $w['a'], 'DELETE', "/api/invoices/{$id}")->assertOk();

        $ids = collect($this->call_($w['multi'], $w['a'], 'GET', '/api/revisions?limit=50')->assertOk()['data'])
            ->pluck('document_id')->all();

        $this->assertNotContains($id, $ids, 'إغلاقٌ آمن: لا يمكن إثبات فرع مستند محذوف فلا يُعرض');
    }

    // ═══════════════════════ E. SetBranch (عدم تراجع) ═══════════════════════

    /** @test */
    public function set_branch_trust_boundary_holds_for_forged_foreign_and_malformed_headers(): void
    {
        $w = $this->world('rem03-sb1');
        $w2 = $this->world('rem03-sb2');
        $inC = $this->draftInvoice($w, $w['c']);
        $inA = $this->draftInvoice($w, $w['a']);

        // فرع غير مسموح: الترويسة تُتجاهَل ⇒ يبقى الفرع الافتراضي A.
        $this->call_($w['onlyA'], $w['c'], 'PUT', "/api/invoices/{$inC}", $this->invoicePayload($w))->assertNotFound();
        $this->call_($w['onlyA'], $w['c'], 'PUT', "/api/invoices/{$inA}", $this->invoicePayload($w))->assertOk();

        // فرع مستأجر آخر: يُتجاهَل.
        $this->call_($w['multi'], $w2['a'], 'PUT', "/api/invoices/{$inA}", $this->invoicePayload($w))->assertOk();
        $this->call_($w['multi'], $w2['b'], 'PUT', "/api/invoices/{$inC}", $this->invoicePayload($w))->assertNotFound();

        // مشوَّهة: لا 500 ولا فرع نشط.
        foreach (['br-1', '123', "'; DROP TABLE branches;--"] as $bad) {
            $this->call_($w['multi'], $bad, 'PUT', "/api/invoices/{$inA}", $this->invoicePayload($w))->assertOk();
        }

        // مسموح: يصير نشطاً.
        $inB = $this->draftInvoice($w, $w['b']);
        $this->call_($w['multi'], $w['b'], 'PUT', "/api/invoices/{$inB}", $this->invoicePayload($w))->assertOk();
    }

    /**
     * عقد الأداة نفسها (مباشرةً): تقبل الفرع النشط + الصفوف بلا فرع فقط، وبلا فرع
     * نشط لا تقبل إلا الصفوف بلا فرع، ولا تتأثر بـ `?branch=all` ولا بفروع المستخدم.
     *
     * @test
     */
    public function the_primitive_matches_only_the_active_branch_and_branchless_rows(): void
    {
        $w = $this->world();
        $inA = $this->draftInvoice($w, $w['a']);
        $inB = $this->draftInvoice($w, $w['b']);
        $legacy = $this->draftInvoice($w, $w['c']);
        $this->makeBranchless('invoices', $legacy);

        $probe = new class extends ApiController {
            public function ids(): array
            {
                return $this->scopeToCurrentBranchOnly(Invoice::query())->pluck('id')->sort()->values()->all();
            }
        };
        $ctx = app(BranchContext::class);

        $sorted = fn (array $ids) => collect($ids)->sort()->values()->all();

        // مستخدم متعدّد الفروع (A و B مسموحان) + ?branch=all: لا يوسّع الأداة.
        $this->actingAs(User::where('email', 'multi@rem03.test')->firstOrFail());
        request()->query->set('branch', 'all');
        $ctx->set($w['a']);
        $this->assertSame($sorted([$inA, $legacy]), $probe->ids());
        $ctx->set($w['b']);
        $this->assertSame($sorted([$inB, $legacy]), $probe->ids());

        // بلا فرع نشط: الصفوف بلا فرع وحدها.
        $ctx->forget();
        $this->assertSame([$legacy], $probe->ids());
    }

    /** @test */
    public function a_tenant_with_a_single_main_branch_keeps_working_unchanged(): void
    {
        $auth = $this->registerTenant('rem03-single', 'owner@rem03-single.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $partner = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'ع', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $id = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partner, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->putJson("/api/invoices/{$id}", [
            'partner_id' => $partner, 'payment_type' => 'cash',
            'items' => [['quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/invoices/{$id}/post")->assertOk();
        $this->assertTrue(Invoice::whereKey($id)->exists());
        $this->assertSame(0, ReturnDocument::count());
    }
}
