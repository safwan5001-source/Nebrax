<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaService;
use App\Support\UtcSecondInstant;
use App\Support\ZatcaIssueTimestamp;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-13a / ADR-0001 — لحظة الإصدار القانونية للفاتورة (`invoices.issued_at`)
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن: المسودة بلا لحظة · الترحيل يلتقط لحظة واحدة UTC بدقة ثانية داخل المعاملة · الثبات بعدها ·
 *  التراجع والإعادة · XML بتوقيت السعودية (AST) بلا Z من اللحظة نفسها · الوسم 3 في QR المرحلة الأولى من
 *  اللحظة نفسها بصيغته الحرفية القائمة · الفواتير القديمة تبقى NULL بلا backfill ومخرجاتها لا تُمَسّ ·
 *  ولا أثر على القيد/الضريبة/ICV · وعزل المستأجرين.
 *
 *  لا يفترض أي اختبار هنا تطابقاً حرفياً بين نصّ XML ونصّ QR — المقارنة دائماً على **اللحظة** بعد تحليل
 *  كل تمثيل (Q1 غير محسوم: D-06 / TAX-E01). اختبارات QR المرحلة الثانية والتوقيع في
 *  ZatcaSignedInvoicePostingTest (فيها أدوات الشهادات).
 *
 *  تشغيل: php artisan test --filter=InvoiceIssuedAtTest
 */
class InvoiceIssuedAtTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('issued-at', 'issued-at@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
    }

    protected function tearDown(): void
    {
        $this->travelBack();
        parent::tearDown();
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function at(string $utc): CarbonImmutable
    {
        return CarbonImmutable::parse($utc, 'UTC');
    }

    private function draft(int $price = 100000): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        );
    }

    private function postAt(string $utc, ?Invoice $draft = null): Invoice
    {
        $draft ??= $this->draft();
        $this->travelTo($this->at($utc));

        return app(InvoiceService::class)->post($draft);
    }

    /** @return array<int,string> */
    private function parseTlv(string $bytes): array
    {
        $fields = [];
        for ($i = 0, $len = strlen($bytes); $i + 2 <= $len;) {
            $length = ord($bytes[$i + 1]);
            $fields[ord($bytes[$i])] = substr($bytes, $i + 2, $length);
            $i += 2 + $length;
        }

        return $fields;
    }

    private function xmlValue(string $xml, string $element): string
    {
        $this->assertSame(1, preg_match('#<cbc:'.$element.'>([^<]*)</cbc:'.$element.'>#', $xml, $m), $element);

        return $m[1];
    }

    /** يحلّل (IssueDate, IssueTime) كما يقرؤهما مستهلك XML — AST بلا Z (BR-KSA-70) — إلى لحظة. */
    private function xmlInstant(string $xml): CarbonImmutable
    {
        $time = $this->xmlValue($xml, 'IssueTime');
        $this->assertDoesNotMatchRegularExpression('/Z$/', $time, 'AST بلا Z');
        $this->assertMatchesRegularExpression('/^\d{2}:\d{2}:\d{2}$/', $time);

        return CarbonImmutable::parse($this->xmlValue($xml, 'IssueDate').' '.$time, 'Asia/Riyadh')->utc();
    }

    /** @return array<string,mixed> */
    private function artifacts(Invoice $invoice): array
    {
        $row = DB::table('invoices')->where('id', $invoice->id)->first();

        return [
            'xml' => $row->zatca_xml, 'hash' => $row->zatca_hash, 'qr' => $row->zatca_qr,
            'uuid' => $row->zatca_uuid, 'icv' => $row->zatca_icv, 'prev' => $row->zatca_previous_hash,
            'issued_at' => $row->issued_at,
        ];
    }

    // ───────────────────────── المسودة والترحيل ─────────────────────────

    /** @test */
    public function a_draft_has_a_null_issued_at(): void
    {
        $draft = $this->draft();

        $this->assertNull($draft->fresh()->issued_at);
        $this->assertNull(DB::table('invoices')->where('id', $draft->id)->value('issued_at'));
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$draft->id}")
            ->assertOk()->assertJsonPath('data.issued_at', null);
    }

    /** @test */
    public function posting_records_one_utc_second_precision_instant_not_the_draft_creation_time(): void
    {
        $this->travelTo($this->at('2026-10-11 08:00:00'));
        $draft = $this->draft();
        $this->assertSame('2026-10-11 08:00:00', $draft->created_at->format('Y-m-d H:i:s'));

        $posted = $this->postAt('2026-10-15 21:30:00.789123', $draft);

        // الخام في القاعدة: UTC بالثانية، بلا كسر.
        $this->assertSame('2026-10-15 21:30:00', DB::table('invoices')->where('id', $posted->id)->value('issued_at'));
        $this->assertInstanceOf(CarbonImmutable::class, $posted->issued_at);
        $this->assertSame('UTC', $posted->issued_at->getTimezone()->getName());
        $this->assertSame('2026-10-15T21:30:00+00:00', $posted->issued_at->toIso8601String());
        $this->assertSame(0, (int) $posted->issued_at->format('u'));
        // لا علاقة له بوقت المسودة.
        $this->assertNotEquals($draft->created_at->format('Y-m-d H:i:s'), $posted->issued_at->format('Y-m-d H:i:s'));
        // التاريخ المحاسبي لم يتغيّر دلالةً: invoice_date ما زال تاريخ الإنشاء الافتراضي.
        $this->assertSame('2026-10-11', $posted->invoice_date->toDateString());
    }

    /** @test */
    public function issued_at_is_stored_as_utc_regardless_of_the_php_default_timezone(): void
    {
        $previous = date_default_timezone_get();
        date_default_timezone_set('Asia/Riyadh');
        try {
            $posted = $this->postAt('2026-10-15 21:30:00');

            $this->assertSame('2026-10-15 21:30:00', DB::table('invoices')->where('id', $posted->id)->value('issued_at'));
            $reloaded = Invoice::findOrFail($posted->id);
            $this->assertSame('2026-10-15T21:30:00+00:00', $reloaded->issued_at->toIso8601String());
        } finally {
            date_default_timezone_set($previous);
        }
    }

    /** @test */
    public function the_cast_normalises_any_timezone_to_utc_and_truncates_fractions(): void
    {
        $cast = new UtcSecondInstant();
        $model = new Invoice();

        $this->assertSame('2026-10-15 21:30:00', $cast->set($model, 'issued_at', CarbonImmutable::parse('2026-10-16 00:30:00.999', 'Asia/Riyadh'), []));
        $this->assertNull($cast->set($model, 'issued_at', null, []));
        $this->assertNull($cast->get($model, 'issued_at', null, []));
        $this->assertSame('2026-10-15T21:30:00+00:00', $cast->get($model, 'issued_at', '2026-10-15 21:30:00', [])->toIso8601String());
    }

    // ───────────────────────── الثبات ─────────────────────────

    /** @test */
    public function issued_at_cannot_be_changed_or_cleared_after_posting(): void
    {
        $posted = $this->postAt('2026-10-15 10:00:00');
        $original = $this->artifacts($posted)['issued_at'];

        foreach ([
            fn (Invoice $i) => $i->forceFill(['issued_at' => $this->at('2026-10-20 10:00:00')])->save(),
            fn (Invoice $i) => $i->forceFill(['issued_at' => null])->save(),
        ] as $mutation) {
            try {
                $mutation(Invoice::findOrFail($posted->id));
                $this->fail('كان يجب رفض تعديل لحظة الإصدار.');
            } catch (LogicException $e) {
                $this->assertStringContainsString('issued_at', $e->getMessage());
            }
        }

        $this->assertSame($original, $this->artifacts($posted)['issued_at']);

        // تحديث عادي لا يمسّ اللحظة مسموح ولا يغيّرها.
        $fresh = Invoice::findOrFail($posted->id);
        $fresh->update(['notes' => 'ملاحظة بعد الترحيل']);
        $this->assertSame($original, $this->artifacts($posted)['issued_at']);
    }

    /** @test */
    public function mass_assignment_and_api_input_cannot_set_issued_at(): void
    {
        $bypass = $this->at('2030-01-01 00:00:00');

        // خدمة الإنشاء تتجاهل المفتاح.
        $viaService = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'issued_at' => $bypass],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
        $this->assertNull($viaService->fresh()->issued_at);

        // fill() لا يقبله (ليس في $fillable).
        $model = Invoice::findOrFail($viaService->id);
        $model->fill(['issued_at' => $bypass])->save();
        $this->assertNull($model->fresh()->issued_at);

        // API: إنشاء وتعديل مسودة بمفتاح issued_at يُتجاهلان.
        $created = $this->withToken($this->auth['token'])->postJson('/api/invoices', [
            'partner_id' => $this->customer->id, 'payment_type' => 'credit', 'issued_at' => '2030-01-01T00:00:00Z',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->assertJsonPath('data.issued_at', null);
        $id = $created['data']['id'];

        $this->withToken($this->auth['token'])->putJson("/api/invoices/{$id}", [
            'partner_id' => $this->customer->id, 'payment_type' => 'credit', 'issued_at' => '2030-01-01T00:00:00Z', 'notes' => 'تعديل',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertOk()->assertJsonPath('data.issued_at', null);
        $this->assertNull(DB::table('invoices')->where('id', $id)->value('issued_at'));

        // ثم يُرحَّل عبر API فتُسجَّل اللحظة الحقيقية لا المرسَلة.
        $this->travelTo($this->at('2026-10-15 12:00:00'));
        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$id}/post")
            ->assertOk()->assertJsonPath('data.issued_at', '2026-10-15T12:00:00Z');
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$id}/zatca")
            ->assertOk()->assertJsonPath('issued_at', '2026-10-15T12:00:00Z');
    }

    // ───────────────────────── التراجع والإعادة ─────────────────────────

    /** @test */
    public function a_failed_posting_leaves_no_issued_at_and_the_retry_captures_a_fresh_instant(): void
    {
        $draft = $this->draft();
        $this->travelTo($this->at('2026-10-15 10:00:00'));

        // يفشل في settle() — بعد كتابة issued_at والقيد وICV داخل المعاملة — فيتراجع الكل.
        app()->bind(InvoiceService::class, fn ($app) => $app->build(Rem04FlakyInvoiceService::class));
        Rem04FlakyInvoiceService::reset(1, 'HY000');

        try {
            app(InvoiceService::class)->post($draft);
            $this->fail('كان يجب أن يفشل الترحيل المحقون.');
        } catch (QueryException) {
            // متوقع
        }

        $row = DB::table('invoices')->where('id', $draft->id)->first();
        $this->assertSame('draft', $row->status);
        $this->assertNull($row->issued_at);
        $this->assertNull($row->zatca_icv);
        $this->assertNull($row->zatca_xml);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->where('source_id', $draft->id)->count());

        // إعادة المحاولة بعد مرور وقت: اللحظة الجديدة هي لحظة الإصدار الفعلية (لا لحظة المحاولة الفاشلة).
        $this->travelTo($this->at('2026-10-15 10:05:30'));
        $posted = app(InvoiceService::class)->post(Invoice::findOrFail($draft->id));

        $this->assertSame('2026-10-15 10:05:30', DB::table('invoices')->where('id', $draft->id)->value('issued_at'));
        $this->assertSame(1, (int) $posted->zatca_icv);
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $draft->id)->count());
    }

    /** @test */
    public function a_second_post_is_rejected_and_neither_the_instant_nor_any_artifact_changes(): void
    {
        $posted = $this->postAt('2026-10-15 10:00:00');
        $before = $this->artifacts($posted);

        $this->travelTo($this->at('2026-10-16 09:00:00'));
        try {
            app(InvoiceService::class)->post(Invoice::findOrFail($posted->id));
            $this->fail('الترحيل الثاني يجب أن يُرفض.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('مسوّدة', $e->getMessage());
        }

        $this->assertSame($before, $this->artifacts($posted));
    }

    // ───────────────────────── XML وQR: اللحظة نفسها بتمثيلات مختلفة ─────────────────────────

    public static function boundaryProvider(): array
    {
        return [
            'ظهر UTC'                         => ['2026-10-15 09:00:00', '2026-10-15', '12:00:00'],
            'قبل منتصف الليل السعودي بثانية'   => ['2026-10-15 20:59:59', '2026-10-15', '23:59:59'],
            'منتصف الليل السعودي تماماً'       => ['2026-10-15 21:00:00', '2026-10-16', '00:00:00'],
            'بعد منتصف الليل السعودي'          => ['2026-10-15 21:30:00', '2026-10-16', '00:30:00'],
            'منتصف ليل UTC (تاريخ AST نفسه)'   => ['2026-10-16 00:00:00', '2026-10-16', '03:00:00'],
            'حد السنة (31/12 → 1/1 السعودي)'   => ['2026-12-31 21:00:00', '2027-01-01', '00:00:00'],
        ];
    }

    /**
     * @test
     *
     * @dataProvider boundaryProvider
     */
    public function xml_issue_date_and_time_are_saudi_local_without_z_and_represent_the_stored_instant(
        string $utc, string $astDate, string $astTime
    ): void {
        $posted = $this->postAt($utc);

        $this->assertSame($astDate, $this->xmlValue($posted->zatca_xml, 'IssueDate'));
        $this->assertSame($astTime, $this->xmlValue($posted->zatca_xml, 'IssueTime'));
        // اللحظة التي يعبّر عنها XML = المخزَّنة (مقارنة لحظية لا نصّية).
        $this->assertTrue($this->xmlInstant($posted->zatca_xml)->equalTo($posted->issued_at));
        $this->assertTrue($posted->issued_at->equalTo($this->at($utc)));
    }

    /** @test */
    public function phase_one_qr_tag_three_is_the_same_instant_with_its_existing_literal_format(): void
    {
        $posted = $this->postAt('2026-10-15 21:30:00');
        $tag3 = $this->parseTlv(base64_decode($posted->zatca_qr, true))[3];

        // الصيغة الحرفية القائمة: ISO 8601 بإزاحة (UTC ⇒ +00:00). لا نستنتج صيغة مطلوبة من قبول SDK (Q1).
        $this->assertSame('2026-10-15T21:30:00+00:00', $tag3);
        $this->assertSame(ZatcaIssueTimestamp::phase1QrText($posted->issued_at), $tag3);
        // وهي اللحظة نفسها التي يمثّلها XML.
        $this->assertTrue(CarbonImmutable::parse($tag3)->equalTo($this->xmlInstant($posted->zatca_xml)));
        // وصيغتا النصّين مختلفتان بالتصميم (لا تطابق حرفي مفترض).
        $this->assertNotSame($tag3, $this->xmlValue($posted->zatca_xml, 'IssueDate').'T'.$this->xmlValue($posted->zatca_xml, 'IssueTime'));
    }

    /** @test */
    public function zatca_generation_fails_closed_without_a_stored_issue_instant(): void
    {
        $draft = $this->draft();
        $this->assertNull($draft->issued_at);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('issued_at');
        app(ZatcaService::class)->qrFor($draft);
    }

    // ───────────────────────── إعادة الطباعة والإرسال ─────────────────────────

    /** @test */
    public function reprint_and_resend_never_change_the_instant_or_any_artifact(): void
    {
        $posted = $this->postAt('2026-10-15 10:00:00');
        $before = $this->artifacts($posted);

        $this->travelTo($this->at('2026-10-20 15:00:00'));

        // قراءة/إعادة طباعة (show + zatca) بعد ٥ أيام.
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$posted->id}")
            ->assertOk()->assertJsonPath('data.issued_at', '2026-10-15T10:00:00Z');
        $zatca = $this->withToken($this->auth['token'])->getJson("/api/invoices/{$posted->id}/zatca")->assertOk();
        $this->assertSame($before['xml'], $zatca['xml']);
        $this->assertSame($before['qr'], $zatca['qr']);
        $this->assertSame('2026-10-15T10:00:00Z', $zatca['issued_at']);

        // إعادة إرسال (طلب محاولة): يحمل XML المخزَّن نفسه ولا يمسّ الفاتورة.
        $this->withToken($this->auth['token'])->withHeader('Idempotency-Key', 'resend-1')
            ->postJson("/api/invoices/{$posted->id}/zatca/submissions")->assertStatus(202);
        $this->assertSame(hash('sha256', $before['xml']), ZatcaSubmissionAttempt::sole()->request_hash);

        $this->assertSame($before, $this->artifacts($posted));
    }

    // ───────────────────────── الفواتير القديمة بلا لحظة ─────────────────────────

    /** @test */
    public function legacy_posted_invoices_without_issued_at_stay_null_and_are_never_regenerated(): void
    {
        $legacy = $this->postAt('2026-10-15 10:00:00');
        // محاكاة صف مرحَّل قبل REM-13a: بلا لحظة إصدار (تحديث خام يتجاوز النموذج عمداً).
        DB::table('invoices')->where('id', $legacy->id)->update(['issued_at' => null]);
        $before = $this->artifacts($legacy);
        $this->assertNull($before['issued_at']);

        $this->travelTo($this->at('2026-10-17 09:00:00'));

        // لا تحديث عادي ولا قراءة يملأ اللحظة أو يعيد التوليد.
        $model = Invoice::findOrFail($legacy->id);
        $model->update(['notes' => 'تحديث على فاتورة قديمة']);
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$legacy->id}")
            ->assertOk()->assertJsonPath('data.issued_at', null);
        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$legacy->id}/zatca")
            ->assertOk()->assertJsonPath('issued_at', null)->assertJsonPath('xml', $before['xml']);
        $this->assertSame($before, $this->artifacts($legacy));

        // سلسلة PIH تستمر من XML المحفوظ القديم، وICV يتقدّم بواحد، والفاتورة الجديدة تحمل لحظتها.
        $new = app(InvoiceService::class)->post($this->draft());
        $this->assertSame(2, (int) $new->zatca_icv);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($before['xml']), $new->zatca_previous_hash);
        $this->assertSame('2026-10-17 09:00:00', DB::table('invoices')->where('id', $new->id)->value('issued_at'));
    }

    /** @test */
    public function the_migration_adds_a_nullable_column_and_never_backfills_existing_rows(): void
    {
        $posted = $this->postAt('2026-10-15 10:00:00');
        $this->assertNotNull(DB::table('invoices')->where('id', $posted->id)->value('issued_at'));

        $migration = require base_path('database/migrations/2026_11_11_010000_add_issued_at_to_invoices.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('invoices', 'issued_at'));

        $migration->up();
        $this->assertTrue(Schema::hasColumn('invoices', 'issued_at'));
        // الصف الموجود يعود بلا لحظة — لا ملء رجعي من created_at ولا من أي مصدر آخر.
        $this->assertNull(DB::table('invoices')->where('id', $posted->id)->value('issued_at'));
        // وبقية الصف سليمة.
        $this->assertSame($posted->zatca_hash, DB::table('invoices')->where('id', $posted->id)->value('zatca_hash'));
    }

    // ───────────────────────── لا أثر مالي ─────────────────────────

    /** @test */
    public function the_issue_instant_has_no_effect_on_journal_amounts_vat_or_icv_numbering(): void
    {
        $first = $this->postAt('2026-10-15 09:00:00');
        $second = $this->postAt('2026-12-31 21:30:00');

        foreach ([$first, $second] as $invoice) {
            $this->assertSame(100000, (int) $invoice->subtotal);
            $this->assertSame(15000, (int) $invoice->tax_amount);
            $this->assertSame(115000, (int) $invoice->total);
            $entry = JournalEntry::findOrFail($invoice->journal_entry_id);
            $lines = JournalLine::where('journal_entry_id', $entry->id)->get();
            $this->assertSame(115000, (int) $lines->sum('debit'));
            $this->assertSame(115000, (int) $lines->sum('credit'));
            // تاريخ القيد = invoice_date (دلالته المحاسبية لم تتغيّر)، لا لحظة الإصدار.
            $this->assertSame($invoice->invoice_date->toDateString(), $entry->entry_date->toDateString());
        }
        $this->assertSame([1, 2], [(int) $first->zatca_icv, (int) $second->zatca_icv]);
    }

    // ───────────────────────── العزل ─────────────────────────

    /** @test */
    public function the_instant_and_artifacts_are_tenant_isolated(): void
    {
        $mine = $this->postAt('2026-10-15 10:00:00');

        $otherId = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'issued-at-other', 'vat_number' => '300000000000011', 'currency' => 'SAR',
        ])->id;
        app(TenantContext::class)->set($otherId);
        app(ChartOfAccountsSeeder::class)->seed($otherId);
        $theirCustomer = Partner::create(['name' => 'عميلهم', 'type' => 'customer']);
        $theirs = app(InvoiceService::class)->create(
            ['partner_id' => $theirCustomer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]],
        );

        // مستأجر آخر لا يرى فاتورتي، وسلسلته (ICV/PIH) مستقلة تماماً.
        $this->assertNull(Invoice::find($mine->id));
        $this->travelTo($this->at('2026-10-15 11:00:00'));
        $postedTheirs = app(InvoiceService::class)->post($theirs);
        $this->assertSame(1, (int) $postedTheirs->zatca_icv);
        $this->assertSame('2026-10-15 11:00:00', DB::table('invoices')->where('id', $postedTheirs->id)->value('issued_at'));

        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame('2026-10-15 10:00:00', DB::table('invoices')->where('id', $mine->id)->value('issued_at'));
        $this->assertNull(Invoice::find($postedTheirs->id));
    }
}
