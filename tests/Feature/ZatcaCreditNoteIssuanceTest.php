<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CreditNote;
use App\Models\Partner;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\ZatcaCredential;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaRolloutControlService;
use App\Support\Settings;
use App\Support\ZatcaCreditNoteEmergencyStopException;
use App\Support\ZatcaCreditNoteIneligibleException;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-18b-3c — إصدار الإشعار الدائن النقدي (381) ذرّياً عند الترحيل، على المحرّكين. الخدمات الحقيقية (فاتورة ← إشعار ← ترحيل)
 * مع ضوابط التفعيل الحقيقية. لا اتصال بأي جهة، ولا مفاتيح حقيقية: الاعتماد اصطناعي مؤقت لكل تشغيل.
 */
class ZatcaCreditNoteIssuanceTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

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

    // ═══════════════ الإصدار الناجح ═══════════════

    #[Test]
    public function an_eligible_cash_note_for_an_activated_tenant_posts_and_issues_atomically(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);

        $note = $this->postNote($this->draft($s, 1));

        $row = DB::table('credit_notes')->where('id', $note->id)->first();
        $this->assertSame('posted', $row->status);
        $this->assertSame('generated', $row->zatca_status);
        $this->assertSame('simplified', $row->zatca_document_type);
        $this->assertSame('goods_or_services_refund', $row->zatca_reason_code);
        $this->assertNull($row->zatca_skip_reason);
        $entry = DB::table('zatca_chain_entries')->where('credit_note_id', $note->id)->sole();
        $this->assertSame('credit_note', $entry->document_type);
        $this->assertSame('381', $entry->type_code);
        $this->assertSame('simplified', $entry->subtype);
        $this->assertSame($s['tenant'], $entry->tenant_id);
        $this->assertSame((int) $entry->icv, (int) $row->zatca_icv);
        $this->assertSame($entry->zatca_uuid, $row->zatca_uuid);
        $this->assertSame($entry->previous_hash, $row->zatca_previous_hash);
        $this->assertSame($entry->hash, $row->zatca_hash);
        $this->assertFalse((bool) $entry->signed, 'لا اعتماد ⇒ المرحلة الأولى');
    }

    #[Test]
    public function the_stored_document_agrees_with_the_entry_the_hash_the_snapshot_and_the_source(): void
    {
        $s = $this->scene('standard');
        $this->activate($s['tenant']);

        $note = $this->postNote($this->draft($s, 1));
        $row = DB::table('credit_notes')->where('id', $note->id)->first();
        $invoice = DB::table('invoices')->where('id', $s['invoice'])->first();

        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($row->zatca_xml), $row->zatca_hash, 'الهاش = هاش XML المخزَّن');
        $this->assertStringContainsString('>381</cbc:InvoiceTypeCode>', $row->zatca_xml);
        $this->assertStringContainsString('<cbc:UUID>'.$row->zatca_uuid.'</cbc:UUID>', $row->zatca_xml);
        $this->assertStringContainsString('<cbc:UUID>'.$row->zatca_icv.'</cbc:UUID>', $row->zatca_xml);
        $this->assertStringContainsString($row->zatca_previous_hash, $row->zatca_xml);
        $this->assertStringContainsString($row->zatca_qr, $row->zatca_xml);
        $this->assertStringContainsString('<cbc:ID>'.$invoice->number.'</cbc:ID>', $row->zatca_xml, 'المرجع BT-25');
        $this->assertStringContainsString('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>', $row->zatca_xml);
        $this->assertSame(json_decode($invoice->party_snapshot, true), json_decode($row->party_snapshot, true), 'لقطة الطرفين منسوخة من الفاتورة المصدر');
        $this->assertStringNotContainsString('__NEBRAX_ZATCA_QR__', $row->zatca_xml);
    }

    #[Test]
    public function invoices_and_credit_notes_share_one_contiguous_icv_and_pih_chain(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $first = DB::table('invoices')->where('id', $s['invoice'])->first();

        $noteA = $this->postNote($this->draft($s, 1));
        $secondInvoice = $this->invoice($s, 'INV-SECOND');
        $noteB = $this->postNote($this->draft($s + ['invoice' => $secondInvoice], 1));

        $entries = DB::table('zatca_chain_entries')->where('tenant_id', $s['tenant'])->orderBy('icv')->get();
        $this->assertSame([1, 2, 3, 4], $entries->pluck('icv')->map(fn ($v) => (int) $v)->all());
        $this->assertSame(['invoice', 'credit_note', 'invoice', 'credit_note'], $entries->pluck('document_type')->all());
        $this->assertSame(\App\Services\Accounting\ZatcaChainAllocator::genesisHash(), $entries[0]->previous_hash);
        foreach ([1, 2, 3] as $i) {
            $this->assertSame($entries[$i - 1]->hash, $entries[$i]->previous_hash, "PIH للمدخل {$i} = هاش السابق");
        }
        $this->assertSame($first->zatca_hash, $entries[0]->hash);
        $this->assertSame($entries[1]->hash, DB::table('credit_notes')->where('id', $noteA->id)->value('zatca_hash'));
        $this->assertSame($entries[3]->hash, DB::table('credit_notes')->where('id', $noteB->id)->value('zatca_hash'));
    }

    #[Test]
    public function the_signed_path_uses_the_production_finalizer_when_a_credential_exists(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $this->configureSigningCredential();

        $note = $this->postNote($this->draft($s, 1));

        $row = DB::table('credit_notes')->where('id', $note->id)->first();
        $entry = DB::table('zatca_chain_entries')->where('credit_note_id', $note->id)->sole();
        $this->assertTrue((bool) $entry->signed);
        $this->assertStringContainsString('SignatureValue', $row->zatca_xml);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($row->zatca_xml), $row->zatca_hash);
        $this->assertSame($entry->hash, $row->zatca_hash);
        $this->assertStringContainsString($row->zatca_qr, $row->zatca_xml);
    }

    #[Test]
    public function missing_signing_policy_fails_closed_and_rolls_everything_back(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $this->configureSigningCredential();
        config()->set('zatca.signature_policy.identifier', null);
        config()->set('zatca.signature_policy.digest', null);
        $draft = $this->draft($s, 1);

        $this->thrown(fn () => $this->postNote($draft), 'سياسة التوقيع غير متاحة');

        $this->assertNothingIssuedAndNothingPosted($s, $draft);
    }

    #[Test]
    public function a_failure_after_the_chain_entry_rolls_back_the_entry_the_head_and_the_journal(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $draft = $this->draft($s, 1);
        Event::listen('eloquent.created: '.\App\Models\ZatcaChainEntry::class, function (): void {
            throw new RuntimeException('simulated failure right after the entry insert');
        });

        $this->thrown(fn () => $this->postNote($draft), 'فشل بعد المدخل');

        $this->assertNothingIssuedAndNothingPosted($s, $draft);
    }

    // ═══════════════ الأهلية: المفعَّل يفشل مغلقاً ═══════════════

    /** @return array<string, array{0: string}> */
    public static function ineligibleCases(): array
    {
        return [
            'credit refund' => ['credit'],
            'standalone' => ['standalone'],
            'source without snapshot' => ['no_snapshot'],
            'unsupported document type' => ['bad_class'],
        ];
    }

    #[Test]
    #[DataProvider('ineligibleCases')]
    public function an_ineligible_sales_note_for_an_activated_tenant_fails_closed_with_an_explicit_reason(string $case): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $expected = ['credit' => 'refund_type_unsupported', 'standalone' => 'standalone_not_supported',
            'no_snapshot' => 'source_snapshot_missing', 'bad_class' => 'document_type_unsupported'][$case];

        $draft = match ($case) {
            'credit' => $this->draft($s, 1, refund: 'credit'),
            'standalone' => $this->standaloneDraft($s),
            'no_snapshot' => $this->draft($s, 1),
            'bad_class' => $this->draft($s, 1),
        };
        if ($case === 'no_snapshot') {
            DB::table('invoices')->where('id', $s['invoice'])->update(['party_snapshot' => null]);
        }
        if ($case === 'bad_class') {
            $this->bypassDocumentTypeCheck($s['invoice']);
        }

        $e = $this->thrown(fn () => $this->postNote($draft), $case);
        $this->assertInstanceOf(ZatcaCreditNoteIneligibleException::class, $e);
        $this->assertSame($expected, $e->reason);
        $this->assertNothingIssuedAndNothingPosted($s, $draft);
    }

    #[Test]
    public function purchase_notes_are_untouched_for_an_activated_tenant(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $purchase = $this->purchaseDraft($s);

        $posted = $this->postNote($purchase);

        $row = DB::table('credit_notes')->where('id', $posted->id)->first();
        $this->assertSame('posted', $row->status);
        $this->assertNull($row->zatca_status);
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $posted->id)->count());
    }

    // ═══════════════ التوافق الرجعي ═══════════════

    #[Test]
    public function an_unconfigured_tenant_posts_exactly_as_before_and_never_touches_the_chain(): void
    {
        $s = $this->scene('simplified');
        $chainsBefore = DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv');
        $entriesBefore = DB::table('zatca_chain_entries')->where('tenant_id', $s['tenant'])->count();

        $note = $this->postNote($this->draft($s, 1));
        $creditNote = $this->postNote($this->draft($s, 1, refund: 'credit'));

        foreach ([$note, $creditNote] as $n) {
            $row = DB::table('credit_notes')->where('id', $n->id)->first();
            $this->assertSame('posted', $row->status);
            foreach (['zatca_status', 'zatca_skip_reason', 'zatca_uuid', 'zatca_icv', 'zatca_xml', 'zatca_hash', 'zatca_qr', 'issued_at', 'party_snapshot'] as $column) {
                $this->assertNull($row->{$column}, $column);
            }
        }
        $this->assertSame($chainsBefore, DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'));
        $this->assertSame($entriesBefore, DB::table('zatca_chain_entries')->where('tenant_id', $s['tenant'])->count());
    }

    #[Test]
    public function a_disabled_tenant_keeps_the_legacy_posting_even_after_having_been_activated(): void
    {
        // D-B2: الإيقاف الصريح لمستأجر فُعِّل سابقاً يعيده إلى الترحيل القديم بلا قرار (فجوة امتثال معلنة في الوثائق، لا ثغرة مخفية).
        $disabled = $this->scene('simplified', 'disabled');
        $this->activate($disabled['tenant']);
        $this->controls->setTenantState($this->admin, $disabled['tenant'], false, 'تعطيل بعد التفعيل');

        $note = $this->postNote($this->draft($disabled, 1));

        $row = DB::table('credit_notes')->where('id', $note->id)->first();
        $this->assertSame('posted', $row->status);
        $this->assertNull($row->zatca_status);
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $note->id)->count());
    }

    #[Test]
    public function an_activated_tenant_cannot_post_a_sales_note_during_the_platform_emergency_stop_and_everything_rolls_back(): void
    {
        // REM-18b-3d (السياسة B) يستبدل توقّع السياسة A («الإيقاف = ترحيل قديم»): الآن الرفض صريح وذرّي.
        $s = $this->scene('simplified', 'stopped');
        $this->activate($s['tenant']);
        $headBefore = (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');
        $cash = $this->draft($s, 1);
        $credit = $this->draft($s, 1, refund: 'credit'); // غير مؤهَّل أيضاً: الإيقاف يسبق الأهلية

        foreach ([$cash, $credit] as $draft) {
            $e = $this->thrown(fn () => $this->postNote($draft), 'محجوب أثناء الإيقاف');
            $this->assertInstanceOf(ZatcaCreditNoteEmergencyStopException::class, $e);
            $this->assertSame('platform_emergency_stop', $e->reason);
            $this->assertSame(ZatcaCreditNoteEmergencyStopException::MESSAGE_AR, $e->getMessage());
            $this->assertNothingIssuedAndNothingPosted($s, $draft);
        }
        $this->assertSame($headBefore, (int) DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'), 'لا ICV مستهلك');

        // رفع الإيقاف ثم إعادة الترحيل يدوياً: الإصدار يستأنف بالـICV التالي.
        $this->controls->setPlatformState($this->admin, true, 'رفع الإيقاف');
        $note = $this->postNote(CreditNote::findOrFail($cash->id));
        $this->assertSame('generated', DB::table('credit_notes')->where('id', $note->id)->value('zatca_status'));
        $this->assertSame($headBefore + 1, (int) DB::table('credit_notes')->where('id', $note->id)->value('zatca_icv'));
    }

    #[Test]
    public function the_emergency_stop_never_touches_unconfigured_disabled_or_other_tenants_and_not_purchase_notes(): void
    {
        $activated = $this->scene('simplified', 'activated');
        $this->activate($activated['tenant']);
        $purchase = $this->purchaseDraft($activated); // قبل الإيقاف: المسودة تُنشأ عادياً
        $unconfigured = $this->scene('simplified', 'unconfigured');
        $disabled = $this->scene('simplified', 'disabled');
        $this->activate($disabled['tenant']);
        $this->controls->setTenantState($this->admin, $disabled['tenant'], false, 'تعطيل');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');

        foreach ([$unconfigured, $disabled] as $scene) {
            $note = $this->postNote($this->draft($scene, 1));
            $row = DB::table('credit_notes')->where('id', $note->id)->first();
            $this->assertSame('posted', $row->status);
            $this->assertNull($row->zatca_status, 'ترحيل قديم بلا قرار');
        }
        app(TenantContext::class)->set($activated['tenant']);
        $posted = $this->postNote($purchase);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $posted->id)->value('status'), 'إشعار المشتريات لمستأجر مفعَّل غير متأثر');
        $this->assertNull(DB::table('credit_notes')->where('id', $posted->id)->value('zatca_status'));
    }

    #[Test]
    public function issuance_does_not_change_the_journal_in_any_way(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $issued = $this->postNote($this->draft($s, 1));
        $this->controls->setTenantState($this->admin, $s['tenant'], false, 'تعطيل للمقارنة');
        $legacy = $this->postNote($this->draft($s, 1));

        $this->assertSame($this->journal($legacy->id), $this->journal($issued->id), 'القيد نفسه حرفياً: الحسابات والمدين والدائن');
        $this->assertNotSame([], $this->journal($issued->id));
        foreach (['subtotal', 'tax_amount', 'total'] as $column) {
            $this->assertSame(DB::table('credit_notes')->where('id', $legacy->id)->value($column), DB::table('credit_notes')->where('id', $issued->id)->value($column), $column);
        }
    }

    // ═══════════════ العزل والثبات ═══════════════

    #[Test]
    public function tenants_have_independent_chains_and_activation_never_leaks(): void
    {
        $a = $this->scene('simplified', 'a');
        $b = $this->scene('simplified', 'b');
        $this->activate($a['tenant']);

        $noteA = $this->postNote($this->draft($a, 1));
        $noteB = $this->postNote($this->draft($b, 1));

        $this->assertSame('generated', DB::table('credit_notes')->where('id', $noteA->id)->value('zatca_status'));
        $this->assertNull(DB::table('credit_notes')->where('id', $noteB->id)->value('zatca_status'), 'مستأجر ب لم يُفعَّل');
        $this->assertSame($a['tenant'], DB::table('zatca_chain_entries')->where('credit_note_id', $noteA->id)->value('tenant_id'));
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $noteB->id)->count());
        $this->activate($b['tenant']);
        $noteB2 = $this->postNote($this->draft($b, 1));
        $this->assertSame(2, (int) DB::table('credit_notes')->where('id', $noteB2->id)->value('zatca_icv'), 'سلسلة ب مستقلة: فاتورته ICV 1 وإشعاره 2');
    }

    #[Test]
    public function the_issued_identity_is_immutable_and_a_second_post_is_refused(): void
    {
        $s = $this->scene('simplified');
        $this->activate($s['tenant']);
        $note = $this->postNote($this->draft($s, 1));
        $before = (array) DB::table('credit_notes')->where('id', $note->id)->first();
        $lastIcv = DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv');

        $this->assertInstanceOf(QueryException::class, $this->thrown(
            fn () => DB::transaction(fn () => CreditNote::findOrFail($note->id)->forceFill(['zatca_xml' => '<Invoice/>'])->save()), 'XML مجمَّد',
        ));
        $this->assertInstanceOf(QueryException::class, $this->thrown(
            fn () => DB::transaction(fn () => CreditNote::findOrFail($note->id)->forceFill(['zatca_status' => 'disabled'])->save()), 'الحالة مجمَّدة',
        ));
        $this->assertInstanceOf(RuntimeException::class, $this->thrown(fn () => app(CreditNoteService::class)->post(CreditNote::findOrFail($note->id)), 'ترحيل ثانٍ'));

        $this->assertSame($before, (array) DB::table('credit_notes')->where('id', $note->id)->first());
        $this->assertSame($lastIcv, DB::table('zatca_chains')->where('tenant_id', $s['tenant'])->value('last_icv'), 'الرأس لم يتقدّم');
    }

    #[Test]
    public function no_credit_note_is_issued_by_deployment_or_by_the_default_state(): void
    {
        $this->assertSame(0, DB::table('zatca_rollout_controls')->count());
        $s = $this->scene('simplified');
        $this->assertSame(0, DB::table('zatca_rollout_controls')->where('tenant_id', $s['tenant'])->count());
        $this->assertFalse(config('zatca.transport.dispatch_enabled'), 'قاطع الإرسال معطَّل افتراضياً');
    }

    // ═══════════════ مساعدات ═══════════════

    private function assertNothingIssuedAndNothingPosted(array $scene, CreditNote $draft): void
    {
        $row = DB::table('credit_notes')->where('id', $draft->id)->first();
        $this->assertSame('draft', $row->status);
        $this->assertNull($row->zatca_status);
        $this->assertNull($row->zatca_icv);
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $draft->id)->count(), 'لا قيد');
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $draft->id)->count(), 'لا مدخل');
        $invoiceEntries = DB::table('zatca_chain_entries')->where('tenant_id', $scene['tenant'])->count();
        $this->assertSame($invoiceEntries, (int) DB::table('zatca_chains')->where('tenant_id', $scene['tenant'])->value('last_icv'), 'الرأس لم يتقدّم عن مداخل الفواتير');
    }

    /** @return list<array{0: string, 1: int, 2: int}> */
    private function journal(string $noteId): array
    {
        return DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.source_type', CreditNote::class)->where('e.source_id', $noteId)
            ->orderBy('a.code')->orderBy('l.debit')->orderBy('l.credit')
            ->get(['a.code', 'l.debit', 'l.credit'])
            ->map(fn ($r) => [(string) $r->code, (int) $r->debit, (int) $r->credit])->all();
    }

    private function activate(string $tenant): void
    {
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');
    }

    private function postNote(CreditNote $draft): CreditNote
    {
        return app(CreditNoteService::class)->post(CreditNote::findOrFail($draft->id));
    }

    /** @return array{tenant: string, partner: string, product: string, invoice: string, class: string} */
    private function scene(string $class, string $tag = 'main'): array
    {
        $tenant = Tenant::create([
            'name' => 'Synthetic Seller Co', 'slug' => 'zatca-issue-'.$tag.'-'.Str::random(6), 'vat_number' => '300000000000003',
            'cr_number' => '2050000001', 'country' => 'SA', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        Settings::put('company', [
            'building_no' => '2322', 'street' => 'Synthetic Street', 'additional_no' => '1234',
            'district' => 'Synthetic District', 'city' => 'Dammam', 'postal_code' => '32241',
        ], $tenant);

        $partner = Partner::create($class === 'standard'
            ? ['name' => 'Synthetic Buyer', 'type' => 'customer', 'vat_number' => '300000000000113',
                'building_no' => '8228', 'street' => 'Buyer Street', 'district' => 'Buyer District', 'city' => 'Riyadh', 'postal_code' => '12345']
            : ['name' => 'Synthetic Buyer', 'type' => 'customer']);
        $product = Product::create(['name' => 'Synthetic item', 'track_inventory' => false]);

        $scene = ['tenant' => $tenant->id, 'partner' => $partner->id, 'product' => $product->id, 'class' => $class, 'invoice' => ''];
        $scene['invoice'] = $this->invoice($scene, 'INV-'.Str::upper(Str::random(6)));

        return $scene;
    }

    /** @param array{tenant: string, partner: string, product: string, class: string} $s */
    private function invoice(array $s, string $number): string
    {
        app(TenantContext::class)->set($s['tenant']);
        $invoices = app(InvoiceService::class);
        $invoice = $invoices->post($invoices->create([
            'partner_id' => $s['partner'], 'payment_type' => 'cash', 'number' => $number, 'tax_inclusive' => false,
            'zatca_document_type' => $s['class'],
        ], [['product_id' => $s['product'], 'description' => 'Service X', 'quantity' => 4, 'unit_price' => 50000, 'tax_rate' => 15]]));

        return $invoice->id;
    }

    /** @param array{tenant: string, partner: string, invoice: string} $s */
    private function draft(array $s, int $quantity, string $refund = 'cash'): CreditNote
    {
        app(TenantContext::class)->set($s['tenant']);
        $line = DB::table('invoice_lines')->where('invoice_id', $s['invoice'])->value('id');

        return app(CreditNoteService::class)->create([
            'partner_id' => $s['partner'], 'original_invoice_id' => $s['invoice'], 'refund_type' => $refund,
        ], [['source_line_id' => $line, 'quantity' => $quantity]]);
    }

    /** @param array{tenant: string, partner: string} $s */
    private function standaloneDraft(array $s): CreditNote
    {
        app(TenantContext::class)->set($s['tenant']);
        Settings::put('sales', ['allow_standalone_credit_notes' => true], Tenant::findOrFail($s['tenant']));

        return app(CreditNoteService::class)->create(
            ['partner_id' => $s['partner'], 'refund_type' => 'cash', 'type' => 'sales'],
            [['description' => 'مستقل', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
    }

    /** @param array{tenant: string} $s */
    private function purchaseDraft(array $s): CreditNote
    {
        app(TenantContext::class)->set($s['tenant']);
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $purchase = app(\App\Services\Accounting\PurchaseService::class);
        $doc = $purchase->post($purchase->create(
            ['partner_id' => $supplier->id],
            [['description' => 'بضاعة', 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        ));

        return app(CreditNoteService::class)->create(
            ['partner_id' => $supplier->id, 'original_purchase_id' => $doc->id, 'refund_type' => 'cash'],
            [['description' => 'مرتجع مشتريات', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
    }

    private function bypassDocumentTypeCheck(string $invoice): void
    {
        // التصنيف المخزَّن مقيَّد بقيمتين في الإنتاج؛ يُحاكى هنا صف قديم بقيمة غريبة بإسقاط القيد مؤقتاً داخل الاختبار.
        if (DB::connection()->getDriverName() === 'pgsql') {
            $constraint = DB::selectOne("SELECT conname FROM pg_constraint WHERE conrelid = 'invoices'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%zatca_document_type%'");
            if ($constraint !== null) {
                DB::statement('ALTER TABLE invoices DROP CONSTRAINT '.$constraint->conname);
            }
        }
        DB::table('invoices')->where('id', $invoice)->update(['zatca_document_type' => 'legacy']);
    }

    private function configureSigningCredential(): void
    {
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));
        $caKey = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $ca = openssl_csr_sign(openssl_csr_new(['commonName' => 'Synthetic Note CA'], $caKey, ['digest_alg' => 'sha256']), null, $caKey, 1, ['digest_alg' => 'sha256']);
        $leafKey = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $leaf = openssl_csr_sign(openssl_csr_new(['commonName' => 'Synthetic Note Device'], $leafKey, ['digest_alg' => 'sha256']), $ca, $caKey, 1, ['digest_alg' => 'sha256']);
        $privateKey = '';
        openssl_pkey_export($leafKey, $privateKey);
        $der = fn (\OpenSSLCertificate $c): string => (string) base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', (function () use ($c) {
            $pem = '';
            openssl_x509_export($c, $pem);

            return $pem;
        })()), true);

        ZatcaCredential::create([
            'environment' => 'developer', 'stage' => 'compliance', 'status' => 'configured',
            'credentials' => ['private_key' => $privateKey, 'certificate_chain' => [base64_encode($der($leaf)), base64_encode($der($ca))]],
            'certificate_fingerprint' => hash('sha256', $der($leaf)), 'configured_at' => now(), 'expires_at' => now()->addDay(),
        ]);
    }
}
