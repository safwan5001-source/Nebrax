<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\InvoiceService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P1-3b-2a-0 — مُشغّلات القاعدة التي تثبّت `invoices.issued_at` و`party_snapshot` و`invoice_date` بعد الإصدار (PostgreSQL وSQLite).
 *
 * يثبت: (1) كل قاعدة R1–R5 ترفض في القاعدة نفسها حتى لو تجاوزت `DB::table`/Builder/SQL الخام حارس النموذج؛ (2) كل مسار شرعي ما زال يعمل بلا أي تغيير:
 * إنشاء/تعديل المسودة بتاريخ، الترحيل (الكتابة الأولى لـissued_at وparty_snapshot في التحديث الذي يرحّل)، وتحديث أي عمود آخر لفاتورة مرحَّلة (سداد، ZATCA…)،
 * وصفوف ما قبل الميزة (NULL) تقبل كل ما عدا الختم الرجعي؛ (3) لا أثر على قيود الفاتورة ولا مبالغها.
 * حدود الحارس التطبيقي في `Invoice::booted` تبقى (طبقة ثانية) ويحرسها `InvoicePartySnapshotTest`.
 */
class InvoiceFrozenDatesFenceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use SimulatesLegacyInvoiceRows;

    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant('frozen-dates', 'frozen-dates@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::findOrFail($auth['tenant_id'])->update(['name' => 'شركة الأفق', 'vat_number' => '300000000000003', 'country' => 'SA']);
        $this->customer = Partner::create(['name' => 'شركة الأمل', 'type' => 'customer', 'vat_number' => '300111222333003', 'country' => 'SA']);
    }

    private function draft(array $header = []): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'] + $header,
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
    }

    private function posted(): Invoice
    {
        return app(InvoiceService::class)->post($this->draft(['invoice_date' => '2026-10-15']));
    }

    private function row(string $id): object
    {
        return DB::table('invoices')->where('id', $id)->first();
    }

    /** يتوقّع رفض القاعدة داخل savepoint كي لا تُجهَض معاملة PostgreSQL المحيطة. */
    private function rejects(callable $operation, string $label): QueryException
    {
        try {
            DB::transaction($operation);
        } catch (QueryException $e) {
            return $e;
        }

        $this->fail("القاعدة كان يجب أن ترفض: {$label}");
    }

    // ───────── الرفض في القاعدة (تتجاوز حارس النموذج عمداً) ─────────

    /** @test */
    public function issued_at_cannot_be_changed_or_cleared_by_any_write_path(): void
    {
        $invoice = $this->posted();
        $stored = $this->row($invoice->id)->issued_at;
        $this->assertNotNull($stored);

        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['issued_at' => '2020-01-01 00:00:00']), 'تغيير issued_at بـ DB::table');
        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['issued_at' => null]), 'مسح issued_at');
        $this->rejects(fn () => Invoice::query()->whereKey($invoice->id)->update(['issued_at' => '2020-01-01 00:00:00']), 'تغيير issued_at بـ Builder (يتجاوز حارس النموذج)');
        $this->rejects(fn () => DB::statement('UPDATE invoices SET issued_at = ? WHERE id = ?', ['2020-01-01 00:00:00', $invoice->id]), 'SQL خام');

        $this->assertSame($stored, $this->row($invoice->id)->issued_at, 'القيمة المخزَّنة لم تتغيّر');
    }

    /** @test */
    public function party_snapshot_cannot_be_changed_or_cleared_by_any_write_path(): void
    {
        $invoice = $this->posted();
        $stored = $this->row($invoice->id)->party_snapshot;
        $this->assertNotNull($stored);

        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['party_snapshot' => json_encode(['v' => 1, 'seller' => [], 'buyer' => []])]), 'تغيير اللقطة');
        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['party_snapshot' => null]), 'مسح اللقطة');
        $this->rejects(fn () => Invoice::query()->whereKey($invoice->id)->update(['party_snapshot' => json_encode(['v' => 1])]), 'Builder');

        $this->assertSame($stored, $this->row($invoice->id)->party_snapshot);
    }

    /** @test */
    public function invoice_date_is_frozen_once_the_invoice_has_left_draft(): void
    {
        $invoice = $this->posted();
        $this->assertSame('2026-10-15', substr((string) $this->row($invoice->id)->invoice_date, 0, 10));

        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['invoice_date' => '2026-01-01']), 'تغيير invoice_date لفاتورة مرحَّلة');
        $this->rejects(fn () => Invoice::query()->whereKey($invoice->id)->update(['invoice_date' => '2026-11-30']), 'Builder');

        $this->assertSame('2026-10-15', substr((string) $this->row($invoice->id)->invoice_date, 0, 10));
    }

    /** @test */
    public function a_posted_row_without_the_write_once_values_cannot_be_stamped_retroactively(): void
    {
        $invoice = $this->posted();
        // صف مرحَّل قبل REM-13a/REM-14: يُحاكى بإسقاط المُشغّلات مؤقتاً (لا مسار إنتاجي ينتج هذه الحالة).
        $this->withoutInvoiceFrozenDateFences(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['issued_at' => null, 'party_snapshot' => null]));

        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['issued_at' => '2026-10-16 10:00:00']), 'ختم رجعي لـ issued_at (لا Backfill)');
        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['party_snapshot' => json_encode(['v' => 1, 'seller' => [], 'buyer' => []])]), 'ختم رجعي للقطة');
        $this->assertNull($this->row($invoice->id)->issued_at);
        $this->assertNull($this->row($invoice->id)->party_snapshot);

        // وكل ما عدا ذلك على الصف التاريخي يعمل كما كان.
        $this->assertSame(1, DB::table('invoices')->where('id', $invoice->id)->update(['notes' => 'ملاحظة على صف تاريخي', 'paid_amount' => 0]));
    }

    // ───────── المسارات الشرعية لا تتغيّر ─────────

    /** @test */
    public function the_draft_can_still_be_created_edited_with_a_new_date_and_posted(): void
    {
        $draft = $this->draft(['invoice_date' => '2026-10-01']);
        $this->assertSame('2026-10-01', $draft->fresh()->invoice_date->toDateString());

        $edited = app(InvoiceService::class)->update(
            $draft,
            ['partner_id' => $this->customer->id, 'invoice_date' => '2026-10-20'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $this->assertSame('2026-10-20', $edited->fresh()->invoice_date->toDateString(), 'تاريخ المسودة قابل للتعديل');
        $this->assertNull($this->row($draft->id)->issued_at);

        $posted = app(InvoiceService::class)->post($edited);
        $row = $this->row($posted->id);
        $this->assertSame('posted', $row->status);
        $this->assertNotNull($row->issued_at, 'الكتابة الأولى لـ issued_at تحدث في تحديث الترحيل نفسه');
        $this->assertNotNull($row->party_snapshot, 'وكذلك اللقطة');
        $this->assertSame('2026-10-20', substr((string) $row->invoice_date, 0, 10), 'الترحيل لا يغيّر تاريخ الفاتورة');
    }

    /** @test */
    public function other_columns_of_a_posted_invoice_stay_writable_and_a_same_value_write_passes(): void
    {
        $invoice = $this->posted();
        $row = $this->row($invoice->id);

        // أعمدة أخرى (سداد/ملاحظات/طباعة) لا تلمسها المُشغّلات.
        $this->assertSame(1, DB::table('invoices')->where('id', $invoice->id)->update(['notes' => 'ملاحظة بعد الترحيل']));
        // إعادة كتابة القيمة نفسها مسموحة (لا تغيير).
        $this->assertSame(1, DB::table('invoices')->where('id', $invoice->id)->update(['issued_at' => $row->issued_at, 'invoice_date' => $row->invoice_date]));
        Invoice::findOrFail($invoice->id)->update(['notes' => 'عبر النموذج']);

        $this->assertSame('عبر النموذج', $this->row($invoice->id)->notes);
        $this->assertSame($row->issued_at, $this->row($invoice->id)->issued_at);
    }

    /** @test */
    public function posting_effects_and_amounts_are_unchanged_by_the_fences(): void
    {
        $invoice = $this->posted();
        $fresh = Invoice::findOrFail($invoice->id);
        $this->assertSame(100000, (int) $fresh->subtotal);
        $this->assertSame(15000, (int) $fresh->tax_amount);
        $this->assertSame(115000, (int) $fresh->total);
        $this->assertNotNull($fresh->journal_entry_id);
        $this->assertSame(1, (int) $fresh->zatca_icv);
    }

    /** @test */
    public function rolling_the_fences_back_removes_only_the_triggers(): void
    {
        $invoice = $this->posted();
        $this->withoutInvoiceFrozenDateFences(function () use ($invoice) {
            // بلا المُشغّلات يعود السلوك السابق (حارس النموذج وحده) — يثبت أن الهجرة لا تغيّر البيانات ولا الأعمدة.
            $this->assertSame(1, DB::table('invoices')->where('id', $invoice->id)->update(['invoice_date' => '2026-09-09']));
        });
        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['invoice_date' => '2026-08-08']), 'المُشغّلات عادت بعد إعادة الهجرة');
    }

    /** @test */
    public function the_fence_triggers_exist_after_a_fresh_migration_on_the_active_engine(): void
    {
        // حارس ضد إسقاط صامت: أي هجرة لاحقة تعيد بناء invoices عبر منشئ المخطط تُسقط مُشغّلات SQLite بلا إنذار.
        if (DB::connection()->getDriverName() === 'pgsql') {
            $names = DB::table('pg_trigger')->where('tgrelid', DB::raw("'invoices'::regclass"))->where('tgisinternal', false)->pluck('tgname')->all();
            $this->assertContains('invoices_frozen_dates_fence', $names);

            return;
        }
        $names = DB::table('sqlite_master')->where('type', 'trigger')->where('tbl_name', 'invoices')->pluck('name')->all();
        foreach (['invoices_frozen_dates_issued_at', 'invoices_frozen_dates_party_snapshot', 'invoices_frozen_dates_invoice_date'] as $trigger) {
            $this->assertContains($trigger, $names);
        }
    }

    /** @test */
    public function an_unchanged_snapshot_containing_a_nul_escape_does_not_break_other_updates_on_postgres(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('تحويل jsonb خاص بـ PostgreSQL.');
        }
        $invoice = $this->posted();
        $this->withoutInvoiceFrozenDateFences(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['party_snapshot' => '{"v":1,"seller":{"name":"a\\u0000b"},"buyer":{}}']));

        // إعادة كتابة اللقطة نفسها نصاً لا تمرّ بتحويل jsonb فلا تفشل.
        $same = DB::table('invoices')->where('id', $invoice->id)->value('party_snapshot');
        $this->assertSame(1, DB::table('invoices')->where('id', $invoice->id)->update(['party_snapshot' => $same]));
        // والتغيير الحقيقي مرفوض (فشل مغلق).
        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice->id)->update(['party_snapshot' => '{"v":1}']), 'تغيير لقطة تحوي NUL');
    }

    /** @test */
    public function the_migration_adds_no_columns_and_touches_no_rows(): void
    {
        $source = (string) file_get_contents(base_path('database/migrations/2027_01_20_010000_add_invoice_frozen_date_fences.php'));
        foreach (['Schema::create', 'Schema::table', 'ALTER TABLE', 'DROP COLUMN', 'UPDATE invoices', "DB::table('invoices')", 'INSERT INTO'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $source, "الهجرة مُشغّلات فقط: لا {$forbidden}");
        }
    }
}
