<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات ZATCA (المرحلة 1) — تثبت أن رمز QR متوافق:
 * Base64 لحقول TLV الخمسة بالقيم الصحيحة، وأن الفاتورة تخزّنه عند الترحيل.
 * تشغيل:  php artisan test --filter=ZatcaTest
 */
class ZatcaTest extends TestCase
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

    /** تفكيك TLV من سلسلة بايتات إلى [tag => value]. */
    private function parseTlv(string $bytes): array
    {
        $fields = [];
        $i = 0;
        $len = strlen($bytes);
        while ($i + 2 <= $len) {
            $tag    = ord($bytes[$i]);
            $length = ord($bytes[$i + 1]);
            $fields[$tag] = substr($bytes, $i + 2, $length);
            $i += 2 + $length;
        }
        return $fields;
    }

    private function postInvoice(): \App\Models\Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150 إجمالاً، ضريبة 150
        );
        return app(InvoiceService::class)->post($invoice);
    }

    /** @test */
    public function amount_is_formatted_from_minor_units_without_float(): void
    {
        $zatca = app(ZatcaService::class);
        $this->assertSame('1150.00', $zatca->formatAmount(115000));
        $this->assertSame('150.00',  $zatca->formatAmount(15000));
        $this->assertSame('100.50',  $zatca->formatAmount(10050));
        $this->assertSame('0.05',    $zatca->formatAmount(5));
    }

    /** @test */
    public function tlv_encodes_tag_length_and_value(): void
    {
        $zatca = app(ZatcaService::class);
        $tlv = $zatca->tlv(4, '1150.00');

        $this->assertSame(4, ord($tlv[0]));              // الوسم
        $this->assertSame(7, ord($tlv[1]));              // طول "1150.00" = 7
        $this->assertSame('1150.00', substr($tlv, 2));   // القيمة
    }

    /** @test */
    public function posting_an_invoice_populates_qr_and_hash(): void
    {
        $posted = $this->postInvoice();

        $this->assertNotNull($posted->zatca_qr);
        $this->assertNotNull($posted->zatca_hash);
        // Base64 صالح
        $this->assertNotFalse(base64_decode($posted->zatca_qr, true));
    }

    /** @test */
    public function qr_decodes_to_the_five_mandatory_tlv_fields(): void
    {
        $posted = $this->postInvoice();

        $fields = $this->parseTlv(base64_decode($posted->zatca_qr));

        // الحقول الخمسة موجودة
        $this->assertArrayHasKey(1, $fields);
        $this->assertArrayHasKey(2, $fields);
        $this->assertArrayHasKey(3, $fields);
        $this->assertArrayHasKey(4, $fields);
        $this->assertArrayHasKey(5, $fields);

        // القيم الصحيحة
        $this->assertSame('نبراس الطموح', $fields[1]);        // اسم البائع
        $this->assertSame('300000000000003', $fields[2]);     // الرقم الضريبي
        $this->assertStringContainsString('T', $fields[3]);   // وقت ISO 8601
        $this->assertSame('1150.00', $fields[4]);             // الإجمالي شامل الضريبة
        $this->assertSame('150.00', $fields[5]);              // مبلغ الضريبة
    }

    /** @test */
    public function stored_hash_is_the_sha256_of_the_stored_xml(): void
    {
        $posted = $this->postInvoice();

        // الهاش المخزَّن = Base64 لـ SHA-256 لمستند UBL المخزَّن
        $expected = base64_encode(hash('sha256', $posted->zatca_xml, true));
        $this->assertSame($expected, $posted->zatca_hash);
        $this->assertSame(44, strlen($posted->zatca_hash)); // SHA-256 Base64
    }
}
