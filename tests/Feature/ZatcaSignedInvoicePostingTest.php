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
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class ZatcaSignedInvoicePostingTest extends TestCase
{
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
        $this->assertSame($posted->zatca_hash, base64_encode($qr[6]));
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($posted->zatca_xml), $posted->zatca_hash);
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

        try {
            app(InvoiceService::class)->post($invoice);
            $this->fail('كان يجب رفض الإصدار غير الموقّع بعد بدء تهيئة ZATCA.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('developer', $exception->getMessage());
        }

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

        try {
            app(InvoiceService::class)->post($invoice);
            $this->fail('كان يجب رفض الإصدار عند غياب سياسة توقيع ZATCA.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('السياسة', $exception->getMessage());
        }

        $this->assertSame('draft', $invoice->fresh()->status);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)
            ->where('source_id', $invoice->id)->count());
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
