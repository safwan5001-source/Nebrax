<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات ZATCA المرحلة 2 (الربط) — تثبت UUID، عدّاد ICV التسلسلي،
 * سلسلة الهاش (PIH)، ومستند UBL وهاشه.
 * تشغيل:  php artisan test --filter=ZatcaPhase2Test
 */
class ZatcaPhase2Test extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
    }

    private function postInvoice(int $unitPrice = 100000): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['description' => 'منتج', 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );
        return app(InvoiceService::class)->post($invoice);
    }

    /** @test */
    public function each_invoice_gets_a_uuid_and_xml(): void
    {
        $invoice = $this->postInvoice();

        $this->assertNotNull($invoice->zatca_uuid);
        // UUID v4 صالح
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $invoice->zatca_uuid
        );
        $this->assertStringContainsString('<Invoice', $invoice->zatca_xml);
        $this->assertStringContainsString($invoice->number, $invoice->zatca_xml);
        $this->assertStringContainsString($invoice->zatca_uuid, $invoice->zatca_xml);
        $this->assertStringContainsString('300000000000003', $invoice->zatca_xml); // الرقم الضريبي
        $this->assertStringContainsString(
            '<cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>',
            $invoice->zatca_xml
        );
        $this->assertStringContainsString(
            '<cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>',
            $invoice->zatca_xml
        );
        $this->assertStringContainsString('<cbc:ID>QR</cbc:ID>', $invoice->zatca_xml);
        $this->assertStringContainsString($invoice->zatca_qr, $invoice->zatca_xml);
        $this->assertStringNotContainsString('__NEBRAX_ZATCA_QR__', $invoice->zatca_xml);
    }

    /** @test */
    public function icv_counter_increments_per_invoice(): void
    {
        $first  = $this->postInvoice();
        $second = $this->postInvoice();
        $third  = $this->postInvoice();

        $this->assertSame(1, $first->zatca_icv);
        $this->assertSame(2, $second->zatca_icv);
        $this->assertSame(3, $third->zatca_icv);
    }

    /** @test */
    public function first_invoice_uses_the_genesis_previous_hash(): void
    {
        $first = $this->postInvoice();

        $genesis = base64_encode(hash('sha256', '0', true));
        $this->assertSame($genesis, $first->zatca_previous_hash);
    }

    /** @test */
    public function each_invoice_chains_to_the_previous_hash(): void
    {
        $first  = $this->postInvoice();
        $second = $this->postInvoice();
        $third  = $this->postInvoice();

        // PIH لكل فاتورة = هاش الفاتورة السابقة (سلسلة غير قابلة للكسر)
        $this->assertSame($first->zatca_hash,  $second->zatca_previous_hash);
        $this->assertSame($second->zatca_hash, $third->zatca_previous_hash);
    }

    /** @test */
    public function legacy_raw_hash_is_recanonicalized_at_the_chain_boundary(): void
    {
        $legacy = $this->postInvoice();
        $legacyRawHash = base64_encode(hash('sha256', $legacy->zatca_xml, true));

        // يحاكي آخر فاتورة أنشأها الإصدار السابق الذي خزّن Hash النص الخام.
        $legacy->update(['zatca_hash' => $legacyRawHash]);

        $next = $this->postInvoice();
        $canonicalLegacyHash = app(ZatcaInvoiceHasher::class)->hash($legacy->zatca_xml);

        $this->assertNotSame($legacyRawHash, $canonicalLegacyHash);
        $this->assertSame($canonicalLegacyHash, $next->zatca_previous_hash);
        $this->assertStringContainsString(
            $canonicalLegacyHash,
            $next->zatca_xml
        );
    }

    /** @test */
    public function document_hash_uses_the_official_zatca_c14n11_transform(): void
    {
        $invoice = $this->postInvoice();

        $this->assertSame(
            app(ZatcaInvoiceHasher::class)->hash($invoice->zatca_xml),
            $invoice->zatca_hash
        );
        $this->assertNotSame(
            base64_encode(hash('sha256', $invoice->zatca_xml, true)),
            $invoice->zatca_hash
        );
    }

    /** @test */
    public function genesis_hash_helper_is_sha256_of_zero(): void
    {
        $this->assertSame(
            base64_encode(hash('sha256', '0', true)),
            app(ZatcaService::class)->genesisHash()
        );
    }
}
