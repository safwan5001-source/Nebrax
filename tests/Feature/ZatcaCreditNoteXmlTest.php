<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Support\ZatcaCreditNoteInput;
use App\Support\ZatcaCreditNoteInputFactory;
use App\Support\ZatcaCreditNoteLine;
use App\Support\ZatcaCreditNoteXml;
use Carbon\CarbonImmutable;
use DOMDocument;
use DOMXPath;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-18a — بانيّ XML إشعار الدائن (381): التحقق من المدخلات، البنية، عدم الاستنتاج، النقاء، وعدم الربط بمسار الترحيل.
 * لا قاعدة بيانات: النماذج تُبنى في الذاكرة فقط.
 */
class ZatcaCreditNoteXmlTest extends TestCase
{
    use ZatcaCreditNoteFixtureSpecs;

    private const STANDARD = 'awj-note-standard-refund-single-line';

    private const SIMPLIFIED = 'awj-note-simplified-refund-single-line';

    // ───────────────────────── البنية ─────────────────────────

    #[DataProvider('noteFixtureProvider')]
    public function test_the_document_is_a_ubl_invoice_message_of_type_381_with_the_mandatory_note_elements(string $name): void
    {
        $spec = self::noteFixtureSpecs()[$name];
        [$xml, $xp] = $this->parsed($name);

        $this->assertSame('Invoice', $xp->evaluate('local-name(/*)'));
        $this->assertSame('381', $xp->evaluate('string(/inv:Invoice/cbc:InvoiceTypeCode)'));
        $this->assertSame($spec['class'] === 'standard' ? '0100000' : '0200000', $xp->evaluate('string(/inv:Invoice/cbc:InvoiceTypeCode/@name)'));
        // BR-KSA-56 / BT-25: مرجع واحد إلى الفاتورة الأصلية، رقمها كما خُزِّن.
        $this->assertSame(1, (int) $xp->evaluate('count(/inv:Invoice/cac:BillingReference)'));
        $this->assertSame($spec['source']['number'], $xp->evaluate('string(/inv:Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID)'));
        // BR-KSA-17 / KSA-10: PaymentMeans واحد برمز نقدي وسبب من الكتالوج.
        $this->assertSame(1, (int) $xp->evaluate('count(/inv:Invoice/cac:PaymentMeans)'));
        $this->assertSame('10', $xp->evaluate('string(/inv:Invoice/cac:PaymentMeans/cbc:PaymentMeansCode)'));
        $this->assertNotSame('', $xp->evaluate('string(/inv:Invoice/cac:PaymentMeans/cbc:InstructionNote)'));
        $this->assertSame($spec['icv'], (int) $xp->evaluate("string(/inv:Invoice/cac:AdditionalDocumentReference[cbc:ID='ICV']/cbc:UUID)"));
        $this->assertSame(1, substr_count($xml, 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'));
        $this->assertStringNotContainsString('CreditNote', $xml);
        $this->assertStringNotContainsString('CreditedQuantity', $xml);
    }

    public function test_the_skeleton_matches_the_invoice_builder_envelope(): void
    {
        $xml = ZatcaCreditNoteXml::build(self::noteInputFromSpec(self::STANDARD));
        $order = ['ProfileID', 'ID', 'UUID', 'IssueDate', 'IssueTime', 'InvoiceTypeCode', 'DocumentCurrencyCode', 'TaxCurrencyCode',
            'BillingReference', 'AdditionalDocumentReference', 'Signature', 'AccountingSupplierParty', 'AccountingCustomerParty',
            'PaymentMeans', 'TaxTotal', 'LegalMonetaryTotal', 'InvoiceLine'];
        $doc = new DOMDocument();
        $doc->loadXML($xml);
        $seen = [];
        foreach ($doc->documentElement->childNodes as $node) {
            if ($node instanceof \DOMElement && ($seen === [] || end($seen) !== $node->localName)) {
                $seen[] = $node->localName;
            }
        }
        $this->assertSame($order, $seen, 'ترتيب UBL: المرجع بعد العملة وقبل مراجع ICV/PIH/QR، والدفع بعد الطرفين');
        $this->assertSame(1, substr_count($xml, ZatcaCreditNoteXml::QR_PLACEHOLDER));
    }

    public function test_amounts_are_the_stored_amounts_rendered_as_is(): void
    {
        [, $xp] = $this->parsed(self::STANDARD);
        $this->assertSame('500.00', $xp->evaluate('string(/inv:Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount)'));
        $this->assertSame('575.00', $xp->evaluate('string(/inv:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount)'));
        $this->assertSame('75.00', $xp->evaluate('string(/inv:Invoice/cac:TaxTotal[1]/cbc:TaxAmount)'));
        $this->assertSame('1', $xp->evaluate('string(/inv:Invoice/cac:InvoiceLine/cbc:InvoicedQuantity)'));
        // لا خصم ولا شحن على مستوى المستند، ولا مبلغ مدفوع مسبقاً.
        $this->assertSame(0, (int) $xp->evaluate('count(/inv:Invoice/cac:AllowanceCharge)'));
        $this->assertSame(0, (int) $xp->evaluate('count(/inv:Invoice//cbc:PrepaidAmount[. != "0.00"])'));
    }

    public function test_the_phase_one_qr_is_built_from_the_snapshot_and_stored_totals(): void
    {
        $input = self::noteInputFromSpec(self::STANDARD);
        $fields = $this->tlv(ZatcaCreditNoteXml::phaseOneQr($input));

        $this->assertSame('Synthetic Seller Co', $fields[1]);
        $this->assertSame('300000000000003', $fields[2]);
        $this->assertSame('575.00', $fields[4]);
        $this->assertSame('75.00', $fields[5]);
        $xml = ZatcaCreditNoteXml::withQr(ZatcaCreditNoteXml::build($input), ZatcaCreditNoteXml::phaseOneQr($input));
        $this->assertStringNotContainsString(ZatcaCreditNoteXml::QR_PLACEHOLDER, $xml);
        $this->assertSame(1, substr_count($xml, ZatcaCreditNoteXml::phaseOneQr($input)));
    }

    public function test_withQr_needs_exactly_one_placeholder_and_a_value(): void
    {
        $xml = ZatcaCreditNoteXml::build(self::noteInputFromSpec(self::STANDARD));
        foreach ([[$xml, ''], ['<x/>', 'QQ==']] as [$doc, $qr]) {
            try {
                ZatcaCreditNoteXml::withQr($doc, $qr);
                $this->fail('must reject');
            } catch (RuntimeException $e) {
                $this->rethrowAssertion($e);
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_the_build_is_deterministic(): void
    {
        $this->assertSame(
            ZatcaCreditNoteXml::build(self::noteInputFromSpec(self::SIMPLIFIED)),
            ZatcaCreditNoteXml::build(self::noteInputFromSpec(self::SIMPLIFIED)),
        );
    }

    public function test_issue_time_is_saudi_local_without_a_zone_suffix(): void
    {
        [, $xp] = $this->parsed(self::STANDARD);
        $this->assertSame('2026-02-10', $xp->evaluate('string(/inv:Invoice/cbc:IssueDate)'));
        $this->assertSame('11:15:30', $xp->evaluate('string(/inv:Invoice/cbc:IssueTime)'));
    }

    // ───────────────────────── عدم الاستنتاج ─────────────────────────

    public function test_non_standard_rate_lines_get_no_tax_category_and_no_tax_subtotal(): void
    {
        [, $xp] = $this->parsed('awj-note-standard-zero-rate');
        $this->assertSame(0, (int) $xp->evaluate('count(/inv:Invoice//cac:ClassifiedTaxCategory)'));
        $this->assertSame(0, (int) $xp->evaluate('count(/inv:Invoice//cac:TaxSubtotal)'));
    }

    public function test_standard_rate_lines_carry_category_s_at_fifteen(): void
    {
        [, $xp] = $this->parsed(self::STANDARD);
        $this->assertSame('S', $xp->evaluate('string(/inv:Invoice/cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:ID)'));
        $this->assertSame('15.00', $xp->evaluate('string(/inv:Invoice/cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent)'));
    }

    public function test_no_delivery_no_second_reason_no_second_reference(): void
    {
        $xml = ZatcaCreditNoteXml::build(self::noteInputFromSpec(self::STANDARD));
        $this->assertStringNotContainsString('<cac:Delivery>', $xml);
        $this->assertSame(1, substr_count($xml, '<cbc:InstructionNote>'));
        $this->assertSame(1, substr_count($xml, '<cac:InvoiceDocumentReference>'));
        $this->assertStringNotContainsString('PayeeFinancialAccount', $xml);
    }

    // ───────────────────────── التحقق من المدخلات ─────────────────────────

    public function test_invalid_inputs_are_rejected(): void
    {
        $good = $this->args();
        $cases = [
            'empty number' => ['number', ''],
            'padded number' => ['number', ' CN-1'],
            'control char number' => ['number', "CN\n1"],
            'number over 127' => ['number', str_repeat('9', 128)],
            'bad uuid' => ['uuid', 'not-a-uuid'],
            'icv zero' => ['icv', 0],
            'pih not base64' => ['previousHash', '***'],
            'pih wrong length' => ['previousHash', base64_encode('short')],
            'unknown class' => ['classification', 'Standard'],
            'empty class' => ['classification', ''],
            'empty original number' => ['originalInvoiceNumber', ''],
            'padded original number' => ['originalInvoiceNumber', 'INV-1 '],
            'unknown reason' => ['reasonCode', 'refund'],
            'free text reason' => ['reasonCode', 'In case of goods or services refund'],
            'credit refund has no documented code' => ['refundType', 'credit'],
            'unknown refund type' => ['refundType', 'card'],
            'missing snapshot' => ['partySnapshot', null],
            'corrupt snapshot' => ['partySnapshot', '{broken'],
            'subtotal mismatch' => ['subtotal', 50001],
            'tax mismatch' => ['taxAmount', 7501],
            'total mismatch' => ['total', 57501],
            'no lines' => ['lines', []],
        ];
        foreach ($cases as $label => [$key, $value]) {
            try {
                new ZatcaCreditNoteInput(...array_merge($good, [$key => $value]));
                $this->fail("must reject: {$label}");
            } catch (InvalidArgumentException|RuntimeException $e) {
                $this->rethrowAssertion($e);
                $this->addToAssertionCount(1); // لقطة غائبة/تالفة = RuntimeException بعقد ZatcaPartyXml القائم (REM-15a)
            }
        }
    }

    public function test_a_zero_total_note_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new ZatcaCreditNoteInput(...array_merge($this->args(), [
            'subtotal' => 0, 'taxAmount' => 0, 'total' => 0,
            'lines' => [new ZatcaCreditNoteLine('x', 1, 0, 15, 0, 0, 0, 0)],
        ]));
    }

    public function test_line_rejections(): void
    {
        $cases = [
            'zero quantity' => [0, 100, 15, 100, 0, 15, 115],
            'negative price' => [1, -1, 15, 100, 0, 15, 115],
            'rate over 100' => [1, 100, 101, 100, 0, 15, 115],
            'negative subtotal' => [1, 100, 15, -100, 0, 15, -85],
            'discount over subtotal' => [1, 100, 15, 100, 101, 0, 0],
            'inconsistent total' => [1, 100, 15, 100, 0, 15, 116],
        ];
        foreach ($cases as $label => $a) {
            try {
                new ZatcaCreditNoteLine('x', ...$a);
                $this->fail("must reject: {$label}");
            } catch (InvalidArgumentException|RuntimeException $e) {
                $this->rethrowAssertion($e);
                $this->addToAssertionCount(1); // لقطة غائبة/تالفة = RuntimeException بعقد ZatcaPartyXml القائم (REM-15a)
            }
        }
    }

    public function test_xml_unsafe_characters_never_reach_the_document_unescaped(): void
    {
        $args = $this->args();
        $args['number'] = 'CN-<&">';
        $xml = ZatcaCreditNoteXml::build(new ZatcaCreditNoteInput(...$args));
        $this->assertStringContainsString('<cbc:ID>CN-&lt;&amp;&quot;&gt;</cbc:ID>', $xml);
        $doc = new DOMDocument();
        $this->assertTrue($doc->loadXML($xml));
    }

    // ───────────────────────── المصنع ─────────────────────────

    public function test_factory_rejects_what_it_must_not_infer(): void
    {
        $spec = self::noteFixtureSpecs()[self::STANDARD];
        $mutate = [
            'purchase-side note' => fn (CreditNote $n, Invoice $i) => $n->forceFill(['type' => 'purchase']),
            'draft note' => fn (CreditNote $n, Invoice $i) => $n->forceFill(['status' => 'draft']),
            'no original invoice' => fn (CreditNote $n, Invoice $i) => $n->forceFill(['original_invoice_id' => null]),
            'different invoice' => fn (CreditNote $n, Invoice $i) => $n->forceFill(['original_invoice_id' => 'other']),
            'draft invoice' => fn (CreditNote $n, Invoice $i) => $i->forceFill(['status' => 'draft']),
            'different partner' => fn (CreditNote $n, Invoice $i) => $i->forceFill(['partner_id' => 'p2']),
            'different tenant' => fn (CreditNote $n, Invoice $i) => $i->forceFill(['tenant_id' => 't2']),
            'no snapshot' => fn (CreditNote $n, Invoice $i) => $i->forceFill(['party_snapshot' => null]),
            'unknown document type' => fn (CreditNote $n, Invoice $i) => $i->forceFill(['zatca_document_type' => null]),
            'line without net price' => fn (CreditNote $n, Invoice $i) => $n->lines->first()->forceFill(['unit_price_before_tax' => null]),
        ];
        foreach ($mutate as $label => $change) {
            [$note, $invoice] = $this->models($spec);
            $change($note, $invoice);
            try {
                ZatcaCreditNoteInputFactory::fromPostedNote($note, $invoice, $spec['uuid'], $spec['icv'], self::GENESIS_PIH, CarbonImmutable::parse(self::ISSUED_AT, 'UTC'), $spec['reason']);
                $this->fail("must reject: {$label}");
            } catch (InvalidArgumentException|RuntimeException $e) {
                $this->rethrowAssertion($e);
                $this->addToAssertionCount(1); // لقطة غائبة/تالفة = RuntimeException بعقد ZatcaPartyXml القائم (REM-15a)
            }
        }
    }

    public function test_factory_accepts_the_consistent_pair_and_reads_class_from_the_invoice(): void
    {
        $spec = self::noteFixtureSpecs()[self::SIMPLIFIED];
        [$note, $invoice] = $this->models($spec);
        $input = ZatcaCreditNoteInputFactory::fromPostedNote($note, $invoice, $spec['uuid'], $spec['icv'], self::GENESIS_PIH, CarbonImmutable::parse(self::ISSUED_AT, 'UTC'), $spec['reason']);
        $this->assertSame('simplified', $input->classification);
        $this->assertSame($spec['source']['number'], $input->originalInvoiceNumber);
    }

    // ───────────────────────── النقاء وعدم الربط ─────────────────────────

    public function test_the_builder_classes_are_pure(): void
    {
        $forbidden = '/\b(DB::|Schema::|Cache::|Http::|Storage::|Log::|config\(|app\(|now\(|today\(|time\(|date\(|rand\(|random_|uniqid|Str::uuid|file_get_contents|file_put_contents|fopen|curl_|->save\(|::create\(|->update\()/';
        foreach (['ZatcaCreditNoteXml', 'ZatcaCreditNoteInput', 'ZatcaCreditNoteLine', 'ZatcaNoteReason'] as $class) {
            $code = (string) file_get_contents(base_path("app/Support/{$class}.php"));
            $code = preg_replace('~/\*.*?\*/~s', '', $code);
            $code = preg_replace('~^\s*//.*$~m', '', (string) $code);
            $this->assertDoesNotMatchRegularExpression($forbidden, (string) $code, "{$class} must stay pure");
            $this->assertStringNotContainsString('journal_', (string) $code);
        }
        // المصنع قراءة فقط: لا حفظ ولا استعلام.
        $factory = (string) preg_replace('~/\*.*?\*/~s', '', (string) file_get_contents(base_path('app/Support/ZatcaCreditNoteInputFactory.php')));
        $this->assertDoesNotMatchRegularExpression('/(DB::|->save\(|::create\(|->update\(|->fresh\(|->load\(|::query\()/', $factory);
    }

    public function test_the_posting_paths_do_not_call_the_note_builder_yet(): void
    {
        $dirs = ['app/Services', 'app/Http', 'app/Models', 'app/Console', 'app/Jobs', 'app/Listeners'];
        $hits = [];
        foreach ($dirs as $dir) {
            $path = base_path($dir);
            if (! is_dir($path)) {
                continue;
            }
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                if ($file->isFile() && $file->getExtension() === 'php'
                    && preg_match('/ZatcaCreditNote(Xml|Input|InputFactory|Line)|ZatcaNoteReason/', (string) file_get_contents($file->getPathname())) === 1) {
                    $hits[] = $file->getPathname();
                }
            }
        }
        $this->assertSame([], $hits, 'REM-18a: لا مسار ترحيل ولا API يستدعي بانيّ الإشعار (التكامل في REM-18b).');
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{0:string,1:DOMXPath} */
    private function parsed(string $name): array
    {
        $input = self::noteInputFromSpec($name);
        $xml = ZatcaCreditNoteXml::withQr(ZatcaCreditNoteXml::build($input), ZatcaCreditNoteXml::phaseOneQr($input));
        $doc = new DOMDocument();
        $this->assertTrue($doc->loadXML($xml));
        $xp = new DOMXPath($doc);
        $xp->registerNamespace('inv', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
        $xp->registerNamespace('cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
        $xp->registerNamespace('cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');

        return [$xml, $xp];
    }

    /** @return array<string, mixed> */
    private function args(): array
    {
        $spec = self::noteFixtureSpecs()[self::STANDARD];
        $n = $spec['note'];
        $l = $n['lines'][0];

        return [
            'number' => $n['number'], 'uuid' => $spec['uuid'], 'icv' => $spec['icv'], 'previousHash' => self::GENESIS_PIH,
            'issuedAt' => CarbonImmutable::parse(self::ISSUED_AT, 'UTC'), 'classification' => 'standard',
            'partySnapshot' => self::noteSnapshot($spec['buyer']), 'originalInvoiceNumber' => $spec['source']['number'],
            'reasonCode' => $spec['reason'], 'refundType' => 'cash',
            'subtotal' => $n['subtotal'], 'taxAmount' => $n['tax_amount'], 'total' => $n['total'],
            'lines' => [new ZatcaCreditNoteLine($l['description'], $l['quantity'], $l['unit_price_before_tax'], $l['tax_rate'],
                $l['line_subtotal'], $l['line_discount'], $l['line_tax'], $l['line_total'])],
        ];
    }

    /**
     * @param array<string, mixed> $spec
     * @return array{0: CreditNote, 1: Invoice}
     */
    private function models(array $spec): array
    {
        $invoice = (new Invoice())->forceFill([
            'id' => 'inv-1', 'tenant_id' => 't1', 'partner_id' => 'p1', 'status' => 'posted', 'number' => $spec['source']['number'],
            'zatca_document_type' => $spec['class'], 'party_snapshot' => self::noteSnapshot($spec['buyer']),
        ]);
        $note = (new CreditNote())->forceFill([
            'id' => 'cn-1', 'tenant_id' => 't1', 'partner_id' => 'p1', 'type' => 'sales', 'status' => 'posted',
            'original_invoice_id' => 'inv-1', 'number' => $spec['note']['number'], 'refund_type' => 'cash',
            'subtotal' => $spec['note']['subtotal'], 'tax_amount' => $spec['note']['tax_amount'], 'total' => $spec['note']['total'],
        ]);
        $lines = collect($spec['note']['lines'])->map(fn (array $l) => (new \App\Models\CreditNoteLine())->forceFill($l));
        $note->setRelation('lines', $lines);

        return [$note, $invoice];
    }

    /** `fail()` يرمي AssertionFailedError وهو RuntimeException في PHPUnit؛ لا يُبتلع فينجح الاختبار بصمت. */
    private function rethrowAssertion(\Throwable $e): void
    {
        if ($e instanceof \PHPUnit\Framework\AssertionFailedError) {
            throw $e;
        }
    }

    /** @return array<int, string> */
    private function tlv(string $base64): array
    {
        $bytes = (string) base64_decode($base64, true);
        $out = [];
        for ($i = 0; $i < strlen($bytes);) {
            $tag = ord($bytes[$i++]);
            $len = ord($bytes[$i++]);
            $out[$tag] = substr($bytes, $i, $len);
            $i += $len;
        }

        return $out;
    }
}
