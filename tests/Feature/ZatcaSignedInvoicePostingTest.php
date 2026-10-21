<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\ZatcaCredential;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaService;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class ZatcaSignedInvoicePostingTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private Tenant $tenant;
    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create([
            'name' => 'شركة أوج',
            'slug' => 'awj-zatca-signed-posting',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->customer = Partner::create(['name' => 'عميل نقدي', 'type' => 'customer']);
    }

    /** @test */
    public function posting_uses_the_signed_xml_hash_and_phase_two_qr_after_credentials_are_configured(): void
    {
        $this->configureCredential('developer');
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));

        $posted = app(InvoiceService::class)->post($this->draft());
        $qr = $this->decodeQr($posted->zatca_qr);

        $this->assertSame('posted', $posted->status);
        $this->assertStringContainsString('<ds:Signature', $posted->zatca_xml);
        $this->assertSame(range(1, 9), array_keys($qr));
        $this->assertSame('شركة أوج', $qr[1]);
        $this->assertSame('300000000000003', $qr[2]);
        // REM-17: الوسم 6 = نصّ Base64 للهاش المخزَّن نفسه، والوسم 7 = SignatureValue كما في XML.
        $this->assertSame($posted->zatca_hash, $qr[6]);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($posted->zatca_xml), $posted->zatca_hash);
        $this->assertStringContainsString('<ds:SignatureValue>'.$qr[7].'</ds:SignatureValue>', $posted->zatca_xml);
        $this->assertSignatureVerifiesIndependently($posted->zatca_xml, $posted->zatca_hash);
        $this->assertSame(1, substr_count($posted->zatca_xml, $posted->zatca_qr));
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)
            ->where('source_id', $posted->id)->count());
    }

    /** @test */
    public function posting_fails_closed_and_rolls_back_financial_effects_when_the_active_environment_has_no_credential(): void
    {
        $this->configureCredential('production');
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));
        $invoice = $this->draft();

        $exception = $this->thrown(fn () => app(InvoiceService::class)->post($invoice), 'كان يجب رفض الإصدار غير الموقّع بعد بدء تهيئة ZATCA.');
        $this->assertStringContainsString('developer', $exception->getMessage());

        $invoice = $invoice->fresh();
        $this->assertSame('draft', $invoice->status);
        $this->assertNull($invoice->journal_entry_id);
        $this->assertNull($invoice->zatca_icv);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)
            ->where('source_id', $invoice->id)->count());
    }

    /** @test */
    public function posting_fails_closed_when_the_signature_policy_is_missing(): void
    {
        $this->configureCredential('developer');
        config()->set('zatca.signature_policy.identifier', null);
        config()->set('zatca.signature_policy.digest', null);
        $invoice = $this->draft();

        $exception = $this->thrown(fn () => app(InvoiceService::class)->post($invoice), 'كان يجب رفض الإصدار عند غياب سياسة توقيع ZATCA.');
        $this->assertStringContainsString('سياسة توقيع ZATCA', $exception->getMessage());

        $this->assertSame('draft', $invoice->fresh()->status);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)
            ->where('source_id', $invoice->id)->count());
    }

    /** @test */
    public function phase_two_qr_tag_three_and_xml_use_the_stored_issue_instant_while_signing_time_stays_independent(): void
    {
        $this->configureCredential('developer');
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));

        // REM-13a: لحظة الإصدار المخزَّنة 07:30:00Z، بينما التوقيع يجري "الآن" 08:45:10Z — لحظتان مختلفتان قانونياً.
        $invoice = $this->draft();
        $invoice->forceFill([
            'zatca_document_type' => 'simplified',
            'issued_at' => \Carbon\CarbonImmutable::parse('2026-01-15 07:30:00', 'UTC'),
            // REM-15a: بناء XML/QR يتطلب لقطة الطرفين التي يلتقطها InvoiceService::post() قبل buildFor.
            'party_snapshot' => \App\Support\InvoicePartySnapshot::capture($invoice),
        ]);
        $this->travelTo(\Carbon\CarbonImmutable::parse('2026-01-15 08:45:10', 'UTC'));

        $built = app(\App\Services\Accounting\ZatcaService::class)->buildFor($invoice);

        // XML: توقيت السعودية بلا Z (07:30Z = 10:30 AST).
        $this->assertStringContainsString('<cbc:IssueDate>2026-01-15</cbc:IssueDate>', $built['xml']);
        $this->assertStringContainsString('<cbc:IssueTime>10:30:00</cbc:IssueTime>', $built['xml']);
        // QR المرحلة الثانية: وسم 3 بصيغته الحرفية القائمة (UTC بـZ) من اللحظة المخزَّنة لا من لحظة التوقيع.
        $qr = $this->decodeQr($built['qr']);
        $this->assertSame('2026-01-15T07:30:00Z', $qr[3]);
        // التوقيع: لحظة مستقلة ('الآن' عند التوقيع)، ليست لحظة الإصدار.
        $this->assertSame(1, preg_match('#<xades:SigningTime>([^<]+)</xades:SigningTime>#', $built['xml'], $m));
        $this->assertSame('2026-01-15T08:45:10Z', $m[1]);
        $this->assertNotSame($qr[3], $m[1]);
        // اللحظة نفسها في XML (AST) وQR (UTC).
        $this->assertTrue(
            \Carbon\CarbonImmutable::parse('2026-01-15 10:30:00', 'Asia/Riyadh')
                ->equalTo(\Carbon\CarbonImmutable::parse($qr[3]))
        );
    }

    /** @test */
    public function a_signed_posting_stores_the_instant_and_signs_after_it_without_changing_the_journal(): void
    {
        $this->configureCredential('developer');
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));

        $draft = $this->draft();
        $this->travelTo(\Carbon\CarbonImmutable::parse('2026-10-15 21:30:00', 'UTC'));
        $posted = app(InvoiceService::class)->post($draft);

        $this->assertSame('2026-10-15 21:30:00', \Illuminate\Support\Facades\DB::table('invoices')->where('id', $posted->id)->value('issued_at'));
        $this->assertStringContainsString('<cbc:IssueDate>2026-10-16</cbc:IssueDate>', $posted->zatca_xml);
        $this->assertStringContainsString('<cbc:IssueTime>00:30:00</cbc:IssueTime>', $posted->zatca_xml);
        $this->assertSame('2026-10-15T21:30:00Z', $this->decodeQr($posted->zatca_qr)[3]);
        $this->assertSame(1, preg_match('#<xades:SigningTime>([^<]+)</xades:SigningTime>#', $posted->zatca_xml, $m));
        $this->assertGreaterThanOrEqual('2026-10-15T21:30:00Z', $m[1]);
        // الهاش المخزَّن = هاش XML الموقَّع المخزَّن (لا إعادة توليد).
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($posted->zatca_xml), $posted->zatca_hash);
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $posted->id)->count());
    }

    /** @test */
    public function a_new_signed_sequence_starts_at_the_official_genesis_and_links_each_invoice_to_the_stored_previous_hash(): void
    {
        $this->enableSigning();

        $first = app(InvoiceService::class)->post($this->draft());
        $second = app(InvoiceService::class)->post($this->draft());
        $third = app(InvoiceService::class)->post($this->draft());

        $this->assertSame([1, 2, 3], [$first->zatca_icv, $second->zatca_icv, $third->zatca_icv]);
        // BR-KSA-26: أول فاتورة = Base64 لنصّ SHA-256("0") الست عشري.
        $this->assertSame(self::GENESIS, $first->zatca_previous_hash);
        $this->assertSame(self::GENESIS, $this->pihOf($first->zatca_xml));
        $this->assertSame($first->zatca_hash, $second->zatca_previous_hash);
        $this->assertSame($first->zatca_hash, $this->pihOf($second->zatca_xml));
        $this->assertSame($second->zatca_hash, $third->zatca_previous_hash);
        $this->assertSame($second->zatca_hash, $this->pihOf($third->zatca_xml));
        foreach ([$first, $second, $third] as $invoice) {
            $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($invoice->zatca_xml), $invoice->zatca_hash);
            $this->assertSignatureVerifiesIndependently($invoice->zatca_xml, $invoice->zatca_hash);
            app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invoice->zatca_xml);
        }
    }

    /** @test */
    public function a_chain_started_with_the_pre_rem17_genesis_continues_from_its_stored_xml_and_history_is_untouched(): void
    {
        $this->assertSame(base64_encode(hash('sha256', '0', true)), ZatcaService::LEGACY_GENESIS_HASH);

        // حالة ما قبل REM-17: أول فاتورة مرحَّلة بالـ genesis القديم. تُحاكى بصفّ تاريخي كما كتبه الإصدار السابق: ICV مباشرةً
        // على `invoices` بلا مدخل سلسلة (REM-18b-2)، ومُدرَج قبل أن يملك المستأجر رأس سلسلة — وهو ما يسمح به السياج F1 وحده.
        // XML الصفّ مأخوذ من فاتورة حقيقية رُحّلت في مستأجر آخر ثم استُبدل فيها genesis بالقيمة القديمة.
        $legacyXml = str_replace('>'.self::GENESIS.'<', '>'.ZatcaService::LEGACY_GENESIS_HASH.'<', $this->xmlPostedInAnotherTenant());
        $this->assertStringContainsString('>'.ZatcaService::LEGACY_GENESIS_HASH.'<', $legacyXml);
        $legacyId = (string) \Illuminate\Support\Str::uuid();
        DB::table('invoices')->insert([
            'id' => $legacyId, 'tenant_id' => $this->tenant->id, 'number' => 'INV-LEGACY-1', 'partner_id' => $this->customer->id,
            'invoice_date' => now()->toDateString(), 'status' => 'posted', 'zatca_document_type' => 'standard',
            'zatca_icv' => 1, 'zatca_uuid' => (string) \Illuminate\Support\Str::uuid(), 'zatca_xml' => $legacyXml,
            'zatca_previous_hash' => ZatcaService::LEGACY_GENESIS_HASH,
            'zatca_hash' => app(ZatcaInvoiceHasher::class)->hash($legacyXml),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $before = (array) DB::table('invoices')->where('id', $legacyId)->first();

        $this->enableSigning();
        $next = app(InvoiceService::class)->post($this->draft());

        // استمرار السلسلة: الهاش السابق = هاش XML المحفوظ، لا genesis جديد ولا إعادة بدء.
        $this->assertSame(2, $next->zatca_icv);
        $this->assertSame($before['zatca_hash'], $next->zatca_previous_hash);
        $this->assertNotSame(self::GENESIS, $next->zatca_previous_hash);
        $this->assertStringContainsString('<ds:Signature', $next->zatca_xml);
        // التاريخ لا يُمسّ: XML وQR والهاش وPIH للفاتورة السابقة كما هي بايتاً ببايت (لا إصلاح صامت — REM-25).
        $this->assertSame($before, (array) DB::table('invoices')->where('id', $legacyId)->first());
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('seed_icv'), 'بذرة السلسلة = آخر ICV قديم');
    }

    /** @test */
    public function tenants_keep_separate_chains_and_credentials(): void
    {
        $this->enableSigning();
        $signed = app(InvoiceService::class)->post($this->draft());

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'awj-zatca-other', 'vat_number' => '311111111111113', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $unsigned = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ));

        // سلسلة جديدة حقاً للمستأجر الآخر، وبلا اعتماده هو: المرحلة 1 (لا يستعير اعتماد مستأجر آخر).
        $this->assertSame(1, $unsigned->zatca_icv);
        $this->assertSame(self::GENESIS, $unsigned->zatca_previous_hash);
        $this->assertStringNotContainsString('<ds:Signature', $unsigned->zatca_xml);
        $this->assertSame(range(1, 5), array_keys($this->decodeQr($unsigned->zatca_qr)));

        app(TenantContext::class)->set($this->tenant->id);
        $next = app(InvoiceService::class)->post($this->draft());
        $this->assertSame(2, $next->zatca_icv);
        $this->assertSame($signed->zatca_hash, $next->zatca_previous_hash);
    }

    /** @test */
    public function re_posting_a_signed_invoice_is_rejected_and_never_rewrites_its_signed_artifacts(): void
    {
        $this->enableSigning();
        $posted = app(InvoiceService::class)->post($this->draft());
        $before = (array) DB::table('invoices')->where('id', $posted->id)->first();

        $this->thrown(fn () => app(InvoiceService::class)->post($posted), 'كان يجب رفض إعادة ترحيل فاتورة مرحَّلة.');

        $this->assertSame($before, (array) DB::table('invoices')->where('id', $posted->id)->first());
        $this->assertSame(1, Invoice::whereNotNull('zatca_hash')->count());
    }

    /** @test */
    public function a_phase_one_qr_value_over_255_bytes_fails_closed_instead_of_being_truncated(): void
    {
        $this->tenant->forceFill(['name' => str_repeat('س', 130)])->save(); // 260 بايت UTF-8
        $invoice = $this->draft();

        $exception = $this->thrown(fn () => app(InvoiceService::class)->post($invoice), 'كان يجب رفض اسم بائع يتجاوز حدّ طول TLV.');
        $this->assertStringContainsString('255', $exception->getMessage());

        $this->assertSame('draft', $invoice->fresh()->status);
        $this->assertNull($invoice->fresh()->zatca_icv);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count());
    }

    private const GENESIS = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

    private function enableSigning(): void
    {
        $this->configureCredential('developer');
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));
    }

    private function pihOf(string $xml): string
    {
        $this->assertSame(1, preg_match('#<cbc:ID>PIH</cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<#', $xml, $match));

        return $match[1];
    }

    /** تحقق بـ openssl_verify مباشرةً: SignatureValue (DER) على بايتات الهاش الخام بمفتاح شهادة leaf المضمّنة. */
    private function assertSignatureVerifiesIndependently(string $xml, string $hash): void
    {
        $this->assertSame(1, preg_match('#<ds:SignatureValue>([^<]+)</ds:SignatureValue>#', $xml, $signature));
        $this->assertSame(1, preg_match('#<ds:X509Certificate>([^<]+)</ds:X509Certificate>#', $xml, $certificate));
        $key = openssl_pkey_get_public("-----BEGIN CERTIFICATE-----\n".chunk_split($certificate[1], 64, "\n")."-----END CERTIFICATE-----\n");
        $this->assertNotFalse($key);
        $this->assertSame(1, openssl_verify((string) base64_decode($hash, true), (string) base64_decode($signature[1], true), $key, OPENSSL_ALGO_SHA256));
    }

    /** XML فاتورة رُحّلت فعلاً (بلا توقيع) في مستأجر منفصل؛ يعود السياق إلى مستأجر الاختبار. */
    private function xmlPostedInAnotherTenant(): string
    {
        $source = Tenant::create(['name' => 'مصدر XML', 'slug' => 'awj-zatca-legacy-source', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($source->id);
        app(ChartOfAccountsSeeder::class)->seed($source->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $xml = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ))->zatca_xml;
        app(TenantContext::class)->set($this->tenant->id);

        return $xml;
    }

    private function draft(): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
    }

    private function configureCredential(string $environment): void
    {
        [$caKey, $caCertificate] = $this->certificateAuthority();
        [$privateKey, $leafDer] = $this->leafCertificate($caKey, $caCertificate);
        ZatcaCredential::create([
            'environment' => $environment,
            'stage' => $environment === 'production' ? 'production' : 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $privateKey,
                'certificate_chain' => [base64_encode($leafDer), base64_encode($this->certificateDer($caCertificate))],
            ],
            'certificate_fingerprint' => hash('sha256', $leafDer),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
    }

    /** @return array<int,string> */
    private function decodeQr(string $encoded): array
    {
        $payload = base64_decode($encoded, true);
        $this->assertIsString($payload);
        $fields = [];
        for ($offset = 0, $size = strlen($payload); $offset < $size;) {
            $tag = ord($payload[$offset++]);
            $length = ord($payload[$offset++]);
            $fields[$tag] = substr($payload, $offset, $length);
            $offset += $length;
        }

        return $fields;
    }

    /** @return array{\OpenSSLAsymmetricKey,\OpenSSLCertificate} */
    private function certificateAuthority(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'ZATCA Posting CA'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);

        return [$key, $certificate];
    }

    /** @return array{string,string} */
    private function leafCertificate(\OpenSSLAsymmetricKey $caKey, \OpenSSLCertificate $caCertificate): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'ZATCA Posting Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, $caCertificate, $caKey, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));

        return [$privateKey, $this->certificateDer($certificate)];
    }

    private function certificateDer(\OpenSSLCertificate $certificate): string
    {
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return $der;
    }
}
