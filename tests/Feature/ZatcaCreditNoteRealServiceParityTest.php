<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Support\Settings;
use App\Support\ZatcaCreditNoteInputFactory;
use App\Support\ZatcaCreditNoteXml;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * REM-18a — يثبت أن مواصفات الـfixtures **قيم خزّنتها الخدمات الحقيقية**، وأن المدخل المبني من الإشعار المرحَّل (عبر
 * `ZatcaCreditNoteInputFactory`) يُنتج XML مطابقاً بايتاً ببايت لما يُنتجه المدخل الصريح من المواصفة (وهو ما تثبّته بصمات
 * `ZatcaCreditNoteFixtureDriftTest` وملفات الـfixtures). كما يثبت أن البناء قراءة فقط: صفر استعلام، والفاتورة الأصلية
 * وصفّ الإشعار لا يتغيّران بعده.
 */
class ZatcaCreditNoteRealServiceParityTest extends TestCase
{
    use RefreshDatabase;
    use ZatcaCreditNoteFixtureSpecs;

    #[DataProvider('noteFixtureProvider')]
    public function test_real_services_store_exactly_the_spec_and_build_the_same_xml(string $name): void
    {
        $spec = self::noteFixtureSpecs()[$name];
        [$invoice, $note] = $this->postThroughRealServices($spec);

        // 1) ما خزّنته الخدمتان = مواصفة الـfixture (لا مبلغ كُتب بيد).
        $this->assertSame(
            [$spec['note']['number'], $spec['note']['subtotal'], $spec['note']['tax_amount'], $spec['note']['total']],
            [$note->number, (int) $note->subtotal, (int) $note->tax_amount, (int) $note->total],
        );
        $stored = $note->lines->map(fn ($l) => [
            'description' => $l->description, 'quantity' => (int) $l->quantity, 'unit_price' => (int) $l->unit_price,
            'unit_price_before_tax' => (int) $l->unit_price_before_tax, 'tax_rate' => (int) $l->tax_rate,
            'line_subtotal' => (int) $l->line_subtotal, 'line_discount' => (int) $l->line_discount,
            'line_tax' => (int) $l->line_tax, 'line_total' => (int) $l->line_total,
        ])->all();
        $this->assertSame($spec['note']['lines'], $stored);

        // 2) البناء من النماذج المرحَّلة = البناء من المواصفة، وبلا أي استعلام ولا كتابة.
        $invoiceBefore = (array) DB::table('invoices')->where('id', $invoice->id)->first();
        $noteBefore = (array) DB::table('credit_notes')->where('id', $note->id)->first();
        $queries = 0;
        DB::listen(function () use (&$queries): void {
            $queries++;
        });

        $input = ZatcaCreditNoteInputFactory::fromPostedNote(
            $note, $invoice, $spec['uuid'], $spec['icv'], self::GENESIS_PIH,
            CarbonImmutable::parse(self::ISSUED_AT, 'UTC'), $spec['reason'],
        );
        $fromServices = ZatcaCreditNoteXml::withQr(ZatcaCreditNoteXml::build($input), ZatcaCreditNoteXml::phaseOneQr($input));

        $this->assertSame(0, $queries, 'البانيّ والمصنع قراءة فقط بلا استعلام');
        $spec_input = self::noteInputFromSpec($name);
        $fromSpec = ZatcaCreditNoteXml::withQr(ZatcaCreditNoteXml::build($spec_input), ZatcaCreditNoteXml::phaseOneQr($spec_input));
        $this->assertSame($fromSpec, $fromServices, "XML المبني من الخدمات الحقيقية يطابق fixture {$name} بايتاً ببايت");

        // 3) الفاتورة الأصلية والإشعار كما هما بعد البناء.
        $this->assertSame($invoiceBefore, (array) DB::table('invoices')->where('id', $invoice->id)->first());
        $this->assertSame($noteBefore, (array) DB::table('credit_notes')->where('id', $note->id)->first());
    }

    public function test_the_reference_is_the_stored_number_of_the_original_invoice_and_the_class_follows_its_stored_type(): void
    {
        foreach (self::noteFixtureSpecs() as $name => $spec) {
            DB::beginTransaction();
            try {
                [$invoice, $note] = $this->postThroughRealServices($spec);
                $xml = ZatcaCreditNoteXml::build(ZatcaCreditNoteInputFactory::fromPostedNote(
                    $note, $invoice, $spec['uuid'], $spec['icv'], self::GENESIS_PIH,
                    CarbonImmutable::parse(self::ISSUED_AT, 'UTC'), $spec['reason'],
                ));
                $this->assertStringContainsString('<cbc:ID>'.$invoice->number.'</cbc:ID>', $xml, $name);
                $code = $invoice->zatca_document_type === 'standard' ? '0100000' : '0200000';
                $this->assertStringContainsString('<cbc:InvoiceTypeCode name="'.$code.'">381</cbc:InvoiceTypeCode>', $xml, $name);
            } finally {
                DB::rollBack();
            }
        }
    }

    /**
     * @param array<string, mixed> $spec
     * @return array{0: \App\Models\Invoice, 1: \App\Models\CreditNote}
     */
    private function postThroughRealServices(array $spec): array
    {
        $tenant = Tenant::firstOrCreate(['slug' => 'awj-note-parity'], [
            'name' => 'Synthetic Seller Co', 'vat_number' => '300000000000003', 'cr_number' => '2050000001',
            'country' => 'SA', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        if (\App\Models\Account::query()->doesntExist()) {
            app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        }
        Settings::put('company', [
            'building_no' => '2322', 'street' => 'Synthetic Street', 'additional_no' => '1234',
            'district' => 'Synthetic District', 'city' => 'Dammam', 'postal_code' => '32241',
        ], $tenant);

        $buyer = $spec['buyer'];
        $partner = Partner::create([
            'name' => $buyer['name'], 'type' => 'customer',
            'vat_number' => $buyer['vat_number'] ?? null,
        ] + (array) ($buyer['address'] ?? []));
        $product = Product::create(['name' => 'Synthetic item', 'track_inventory' => false]);

        $invoices = app(InvoiceService::class);
        $items = array_map(fn (array $i) => $i + ['product_id' => $product->id], $spec['source']['items']);
        $invoice = $invoices->post($invoices->create([
            'partner_id' => $partner->id, 'payment_type' => 'cash', 'number' => $spec['source']['number'],
            'zatca_document_type' => $spec['class'],
        ] + $spec['source']['head'], $items));
        $invoice->load('lines');

        $notes = app(CreditNoteService::class);
        $picks = array_map(fn (array $p) => array_filter([
            'source_line_id' => $invoice->lines[$p[0]]->id, 'quantity' => $p[1], 'unit_price' => $p[2] ?? null,
        ], fn ($v) => $v !== null), $spec['picks']);
        $note = $notes->post($notes->create([
            'partner_id' => $partner->id, 'original_invoice_id' => $invoice->id, 'refund_type' => 'cash',
            'number' => $spec['note']['number'],
        ], $picks));

        // `credit_note_lines` لا يحمل عمود ترتيب (معرّفات UUID) فترتيب القراءة غير مضمون على PostgreSQL؛ نثبّته هنا بترتيب
        // المواصفة حتى يكون المقارَن بايتاً ببايت. ترتيب سطور الإشعار الحتمي مسألة تكامل REM-18b (مدوَّنة في التقرير).
        $order = array_flip(array_column($spec['note']['lines'], 'description'));
        $note->load('lines');
        $note->setRelation('lines', $note->lines->sortBy(fn ($l) => $order[$l->description])->values());

        return [$invoice->fresh(), $note];
    }
}
