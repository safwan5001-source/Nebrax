<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\Accounting\ZatcaRolloutControlService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * REM-18b-3d — السياسة B على سياج الترحيل F2b في قاعدة البيانات (SQLite وPostgreSQL بالحالات نفسها). صفوف خام عمداً: الحماية في القاعدة
 * وتصمد أمام أي كاتب لا يمرّ بالخدمة (سكربت، SQL خام، نسخة تطبيق أقدم). الجدول المعتمد:
 *    ضابط المستأجر غائب/معطَّل ⇒ ترحيل قديم (أيّاً كان الإيقاف) · مفعَّل بلا إيقاف ⇒ قرار صريح (3b) · مفعَّل + إيقاف ⇒ مرفوض كلياً.
 */
class ZatcaCreditNoteEmergencyStopFenceTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_23_010000_add_zatca_credit_note_emergency_stop_block.php';

    private const STOP = 'blocked while the platform emergency stop';

    private ZatcaRolloutControlService $controls;

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->controls = app(ZatcaRolloutControlService::class);
        $this->admin = PlatformAdministrator::create([
            'name' => 'مدير منصة', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ]);
    }

    #[Test]
    public function raw_sql_cannot_post_an_activated_tenants_sales_note_during_the_stop(): void
    {
        $tenant = $this->tenant();
        $notes = array_map(fn () => $this->note($tenant), range(1, 8));
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');

        [$a, $b, $c, $d, $e, $f, $g, $h] = $notes;
        $attempts = [
            'update بلا قرار' => fn () => DB::statement("UPDATE credit_notes SET status = 'posted' WHERE id = ?", [$a]),
            'update غير مُجهَّز' => fn () => DB::unprepared("UPDATE credit_notes SET status = 'posted' WHERE id = '{$b}'"),
            'update بقرار disabled' => fn () => DB::statement("UPDATE credit_notes SET status = 'posted', zatca_status = 'disabled' WHERE id = ?", [$c]),
            'update بقرار not_generated' => fn () => DB::statement(
                "UPDATE credit_notes SET status = 'posted', zatca_status = 'not_generated', zatca_skip_reason = 'payment_means_unresolved' WHERE id = ?", [$d],
            ),
            'update جماعي' => fn () => DB::statement("UPDATE credit_notes SET status = 'posted' WHERE tenant_id = ?", [$tenant]),
            'upsert' => fn () => DB::statement(
                'INSERT INTO credit_notes (id, tenant_id, number, partner_id, note_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
                ."ON CONFLICT (id) DO UPDATE SET status = 'posted'",
                [$e, $tenant, 'CN-UP', DB::table('credit_notes')->where('id', $e)->value('partner_id'), '2026-02-10', 'draft', now(), now()],
            ),
            'إدراج مباشر posted' => fn () => $this->note($tenant, ['status' => 'posted']),
            'generated كامل بمدخله' => fn () => $this->issue($tenant, $f),
        ];
        foreach ($attempts as $label => $attempt) {
            $rejection = $this->rejects($attempt, $label);
            $this->assertStringContainsString(self::STOP, $rejection->getMessage(), $label);
        }

        foreach ([$a, $b, $c, $d, $e, $f] as $id) {
            $this->assertSame('draft', DB::table('credit_notes')->where('id', $id)->value('status'));
        }
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->count(), 'لا مدخل سلسلة');
        $this->assertSame(0, DB::table('credit_notes')->where('tenant_id', $tenant)->where('status', 'posted')->count());
        // المسودات قابلة للتعديل، والإدراج كمسودة سليم.
        DB::table('credit_notes')->where('id', $g)->update(['reason' => 'تعديل مسودة أثناء الإيقاف', 'zatca_status' => 'disabled']);
        $this->note($tenant);
        $this->assertSame('تعديل مسودة أثناء الإيقاف', DB::table('credit_notes')->where('id', $g)->value('reason'));
        DB::table('credit_notes')->where('id', $h)->update(['status' => 'cancelled']);
        $this->assertSame('cancelled', DB::table('credit_notes')->where('id', $h)->value('status'));
    }

    #[Test]
    public function the_stop_never_blocks_unconfigured_disabled_other_tenants_purchase_notes_or_historical_notes(): void
    {
        $activated = $this->tenant();
        $historical = $this->note($activated, ['status' => 'posted']); // قبل التفعيل
        $purchase = $this->note($activated, ['type' => 'purchase']);
        $unconfigured = $this->tenant();
        $disabled = $this->tenant();
        $this->controls->setTenantState($this->admin, $activated, true, 'تفعيل تجريبي للاختبار');
        $this->controls->setTenantState($this->admin, $disabled, true, 'تفعيل ثم تعطيل');
        $this->controls->setTenantState($this->admin, $disabled, false, 'تعطيل');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');

        foreach ([$unconfigured, $disabled] as $tenant) {
            $note = $this->note($tenant);
            DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']);
            $this->assertSame('posted', DB::table('credit_notes')->where('id', $note)->value('status'));
            $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
        }
        DB::table('credit_notes')->where('id', $purchase)->update(['status' => 'posted']);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $purchase)->value('status'));
        // إشعار تاريخي مرحَّل أصلاً: تعديل أعمدته غير الـZATCA أثناء الإيقاف لا يُحجب (الفحص عند الانتقال إلى posted فقط).
        DB::table('credit_notes')->where('id', $historical)->update(['reason' => 'تعديل بعد التفعيل والإيقاف']);
        $this->assertSame('تعديل بعد التفعيل والإيقاف', DB::table('credit_notes')->where('id', $historical)->value('reason'));
    }

    #[Test]
    public function lifting_the_stop_restores_the_previous_fence_and_issuance_resumes(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');
        $this->rejects(fn () => $this->issue($tenant, $note), 'أثناء الإيقاف');

        $this->controls->setPlatformState($this->admin, true, 'رفع الإيقاف');
        $e = $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']), 'بلا قرار بعد الرفع');
        $this->assertStringContainsString('explicit ZATCA issuance decision', $e->getMessage());
        $this->issue($tenant, $note);

        $this->assertSame('generated', DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('credit_note_id', $note)->count());
    }

    #[Test]
    public function the_migration_rolls_back_to_the_exact_previous_definitions_and_reapplies_without_touching_data(): void
    {
        $tenant = $this->tenant();
        $historical = $this->note($tenant, ['status' => 'posted']);
        $notesBefore = DB::table('credit_notes')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
        $columns = DB::getSchemaBuilder()->getColumnListing('credit_notes');
        $tablesBefore = $this->tables();

        // المرجع: تعريفات 3b كما تكتبها هجرتها هي (إسقاط ثم إعادة إنشاء).
        $f2 = require database_path('migrations/2026_11_22_010000_add_zatca_credit_note_fences.php');
        $f2->down();
        $f2->up();
        $original = $this->definitions();

        $this->migration()->up();
        $withStopBlock = $this->definitions();
        $this->assertNotSame($original, $withStopBlock, 'الهجرة تغيّر التعريفات فعلاً');
        $this->assertSame(array_keys($original), array_keys($withStopBlock), 'الأسماء نفسها تماماً (المُشغّلات والدالة)');

        $this->migration()->down();
        $this->assertSame($original, $this->definitions(), 'التراجع يعيد تعريفات 3b حرفياً');

        // السياسة A تعود فعلاً بعد التراجع: الإيقاف + مستأجر مفعَّل ⇒ ترحيل قديم.
        $active = $this->tenant();
        $note = $this->note($active);
        $this->controls->setTenantState($this->admin, $active, true, 'تفعيل تجريبي للاختبار');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');
        DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $note)->value('status'));

        // وإعادة التطبيق (مرتين) سليمة وتعيد الحجب.
        $this->migration()->up();
        $this->migration()->up();
        $this->assertSame($withStopBlock, $this->definitions());
        $blocked = $this->note($active);
        $e = $this->rejects(fn () => DB::table('credit_notes')->where('id', $blocked)->update(['status' => 'posted']), 'بعد إعادة التطبيق');
        $this->assertStringContainsString(self::STOP, $e->getMessage());

        // لا مخطط ولا بيانات: الأعمدة والجداول كما هي، وصف تاريخي لم يُمسّ.
        $this->assertSame($columns, DB::getSchemaBuilder()->getColumnListing('credit_notes'));
        $this->assertSame($tablesBefore, $this->tables());
        $this->assertSame($notesBefore[0], (array) DB::table('credit_notes')->where('id', $historical)->first());
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function migration(): object
    {
        return require database_path('migrations/'.self::MIGRATION);
    }

    /** @return array<string, string> اسم الكائن ⇒ تعريفه (سياج الترحيل F2b وحده) */
    private function definitions(): array
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            return [
                'function' => (string) DB::selectOne("SELECT pg_get_functiondef('credit_notes_zatca_posting_fence'::regproc) AS d")->d,
                'trigger' => (string) DB::selectOne("SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgname = 'credit_notes_zatca_posting_fence'")->d,
            ];
        }

        $rows = DB::select("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('credit_notes_zatca_posting_insert', 'credit_notes_zatca_posting_update') ORDER BY name");

        return array_column(array_map(fn ($r) => (array) $r, $rows), 'sql', 'name');
    }

    /** @return list<string> */
    private function tables(): array
    {
        $tables = DB::getSchemaBuilder()->getTables();
        $names = array_map(fn ($t) => is_array($t) ? $t['name'] : $t->name, $tables);
        sort($names);

        return $names;
    }

    private function rejects(callable $operation, string $label = ''): QueryException
    {
        try {
            DB::transaction($operation);
        } catch (QueryException $e) {
            return $e;
        }

        $this->fail('the database was expected to reject this operation'.($label !== '' ? ": {$label}" : ''));
    }

    private function tenant(): string
    {
        return Tenant::create([
            'name' => 'مستأجر إيقاف', 'slug' => 'zatca-stop-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
    }

    private function partnerOf(string $tenant): string
    {
        $existing = DB::table('partners')->where('tenant_id', $tenant)->value('id');
        if ($existing !== null) {
            return $existing;
        }
        $id = (string) Str::uuid();
        DB::table('partners')->insert(['id' => $id, 'tenant_id' => $tenant, 'name' => 'عميل', 'type' => 'customer', 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    /** @param array<string, mixed> $overrides */
    private function note(string $tenant, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        DB::table('credit_notes')->insert(array_merge([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'CN-'.Str::random(8), 'partner_id' => $this->partnerOf($tenant),
            'note_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ], $overrides));

        return $id;
    }

    /** يحاكي المُصدِر: مدخل السلسلة ثم تحديث الإشعار بالمستند الكامل، في معاملة واحدة. */
    private function issue(string $tenant, string $note): void
    {
        DB::transaction(function () use ($tenant, $note) {
            $chain = DB::table('zatca_chains')->where('tenant_id', $tenant)->value('id');
            if ($chain === null) {
                $chain = (string) Str::uuid();
                DB::table('zatca_chains')->insert([
                    'id' => $chain, 'tenant_id' => $tenant, 'chain_key' => 'tenant', 'last_icv' => 0, 'seed_icv' => 0, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            $icv = (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv') + 1;
            $uuid = (string) Str::uuid();
            $prev = base64_encode(hash('sha256', "p{$icv}"));
            $hash = base64_encode(hash('sha256', "h{$icv}"));
            DB::table('zatca_chain_entries')->insert([
                'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'chain_id' => $chain, 'icv' => $icv, 'document_type' => 'credit_note',
                'invoice_id' => null, 'credit_note_id' => $note, 'type_code' => '381', 'subtype' => 'standard', 'zatca_uuid' => $uuid,
                'previous_hash' => $prev, 'hash' => $hash, 'signed' => false, 'issued_at' => '2026-02-10 08:15:30', 'created_at' => now(),
            ]);
            DB::table('credit_notes')->where('id', $note)->update([
                'status' => 'posted', 'zatca_status' => 'generated', 'zatca_document_type' => 'standard', 'zatca_reason_code' => 'goods_or_services_refund',
                'issued_at' => '2026-02-10 08:15:30', 'party_snapshot' => '{"v":1}', 'zatca_uuid' => $uuid, 'zatca_icv' => $icv,
                'zatca_previous_hash' => $prev, 'zatca_hash' => $hash, 'zatca_qr' => 'cXI=', 'zatca_xml' => '<Invoice/>',
            ]);
        });
    }
}
