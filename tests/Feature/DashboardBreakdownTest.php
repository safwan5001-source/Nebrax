<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تفصيل مبيعات لوحة التحكم — تجميع **قراءة فقط**
 * ═══════════════════════════════════════════════════════════════
 *  يغذّي تبويبات رسم المبيعات. لا يمسّ قيداً ولا رصيداً — اختبار صريح يحرس ذلك.
 *
 *  المصدر الفواتير لا الدفتر عمداً: السؤال «أي صنف/بائع باع أكثر؟» بُعدٌ لا
 *  يحمله سطر القيد. والأرقام المحاسبية الرسمية تبقى من `ReportService`.
 *
 *  تشغيل: php artisan test --filter=DashboardBreakdownTest
 */
class DashboardBreakdownTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $partnerId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->partnerId = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
    }

    private function product(string $name, string $sku, ?string $category = null): string
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => $name, 'sku' => $sku, 'type' => 'good', 'category' => $category,
            'purchase_price' => 10000, 'sale_price' => 20000, 'track_inventory' => false,
        ])->assertCreated()['data']['id'];
    }

    /** فاتورة مرحّلة بسطر واحد بقيمة `unitPrice` (بلا ضريبة لتبقى الأرقام صريحة). */
    private function postedInvoice(string $productId, int $unitPrice, string $date): array
    {
        $invoice = $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->partnerId, 'payment_type' => 'cash', 'invoice_date' => $date,
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 0]],
        ])->assertCreated()['data'];

        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        return $invoice;
    }

    private function breakdown(string $by, string $query = ''): array
    {
        return $this->withToken($this->token)
            ->getJson("/api/dashboard/sales-breakdown?by={$by}{$query}")->assertOk()['data'];
    }

    /** @test */
    public function it_groups_sales_by_day_in_chronological_order(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');
        $this->postedInvoice($p, 100000, '2026-01-03');
        $this->postedInvoice($p, 200000, '2026-01-01');
        $this->postedInvoice($p, 50000, '2026-01-01');

        $rows = $this->breakdown('day');

        $this->assertCount(2, $rows);
        $this->assertSame('2026-01-01', $rows[0]['label']);
        $this->assertSame('2500.00', $rows[0]['amount']);   // ٢٠٠٠ + ٥٠٠
        $this->assertSame('1000.00', $rows[1]['amount']);
    }

    /**
     * **الفارق الجوهري:** المنتج بُعدٌ على مستوى **السطر**. الفاتورة الواحدة
     * تحمل أصنافاً شتّى، فجمعُها بإجمالي الرأس ينسب كاملها إلى صنف واحد.
     *
     * @test
     */
    public function product_breakdown_splits_a_multi_item_invoice_across_its_items(): void
    {
        $cement = $this->product('إسمنت', 'CEM-1');
        $steel  = $this->product('حديد', 'STL-1');

        $invoice = $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->partnerId, 'payment_type' => 'cash',
            'items' => [
                ['product_id' => $cement, 'quantity' => 1, 'unit_price' => 300000, 'tax_rate' => 0],
                ['product_id' => $steel, 'quantity' => 1, 'unit_price' => 700000, 'tax_rate' => 0],
            ],
        ])->assertCreated()['data'];
        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $rows = $this->breakdown('product');

        $this->assertCount(2, $rows);
        $this->assertSame('حديد', $rows[0]['label']);       // مرتّب تنازلياً
        $this->assertSame('7000.00', $rows[0]['amount']);
        $this->assertSame('3000.00', $rows[1]['amount']);
    }

    /** @test */
    public function it_groups_by_category_and_labels_the_uncategorised(): void
    {
        $withCat = $this->product('إسمنت', 'CEM-1', 'مواد بناء');
        $without = $this->product('قلم', 'PEN-1');

        $this->postedInvoice($withCat, 400000, '2026-01-01');
        $this->postedInvoice($without, 100000, '2026-01-01');

        $rows = $this->breakdown('category');
        $labels = array_column($rows, 'label');

        $this->assertContains('مواد بناء', $labels);
        // بلا فئة ⇒ «غير محدّد» لا فراغ، ولا يُسقَط فيختلّ المجموع
        $this->assertContains('غير محدّد', $labels);
        $this->assertSame('1000.00', $rows[array_search('غير محدّد', $labels, true)]['amount']);
    }

    /** البائع **موظّف** لا مستخدم — كما يفرضه `InvoiceController` عند التحقق. */
    /** @test */
    public function it_groups_by_salesperson(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');
        $employee = $this->withToken($this->token)->postJson('/api/employees', [
            'name' => 'سارة إبراهيم', 'national_id' => '1234567890',
            'hire_date' => '2026-01-01', 'basic_salary' => 800000,
        ])->assertCreated()['data'];

        $invoice = $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->partnerId, 'payment_type' => 'cash', 'salesperson_id' => $employee['id'],
            'items' => [['product_id' => $p, 'quantity' => 1, 'unit_price' => 500000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];
        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $rows = $this->breakdown('salesperson');

        $this->assertCount(1, $rows);
        $this->assertSame('سارة إبراهيم', $rows[0]['label']);
        $this->assertSame('5000.00', $rows[0]['amount']);
    }

    /**
     * **المسوّدة ليست بيعاً.** إدراجها يجعل الرسم يسبق الدفتر، فيقرأ المستخدم
     * مبيعاتٍ لا قيد لها.
     *
     * @test
     */
    public function draft_invoices_are_excluded(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');

        $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->partnerId, 'payment_type' => 'cash',
            'items' => [['product_id' => $p, 'quantity' => 1, 'unit_price' => 900000, 'tax_rate' => 0]],
        ])->assertCreated();

        $this->assertSame([], $this->breakdown('day'));
    }

    /** المدى التاريخي يُصفّي فعلاً. */
    /** @test */
    public function the_date_range_filters_the_result(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');
        $this->postedInvoice($p, 100000, '2026-01-01');
        $this->postedInvoice($p, 200000, '2026-02-15');

        $rows = $this->breakdown('day', '&from=2026-02-01&to=2026-02-28');

        $this->assertCount(1, $rows);
        $this->assertSame('2000.00', $rows[0]['amount']);
    }

    /** بُعد غير معروف يُرفض — لا يُمرَّر اسم عمود من العميل. */
    /** @test */
    public function an_unknown_dimension_is_rejected(): void
    {
        $this->withToken($this->token)
            ->getJson('/api/dashboard/sales-breakdown?by=id;DROP')
            ->assertStatus(422);
    }

    /** **الضمان:** التجميع قراءة خالصة — لا قيد ولا حركة مخزون. */
    /** @test */
    public function the_breakdown_writes_nothing(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');
        $this->postedInvoice($p, 100000, '2026-01-01');

        $entries   = \App\Models\JournalEntry::count();
        $movements = \App\Models\StockMovement::count();

        foreach (\App\Services\Reporting\DashboardService::DIMENSIONS as $by) {
            $this->breakdown($by);
        }

        $this->assertSame($entries, \App\Models\JournalEntry::count());
        $this->assertSame($movements, \App\Models\StockMovement::count());
    }

    /** العزل: مبيعات مستأجرٍ آخر لا تظهر. */
    /** @test */
    public function another_tenants_sales_are_invisible(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');
        $this->postedInvoice($p, 100000, '2026-01-01');

        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->assertSame([], $this->withToken($other['token'])
            ->getJson('/api/dashboard/sales-breakdown?by=day')->assertOk()['data']);
    }

    /** تغذية النشاطات: أحدث ما جرى عبر كل المستندات، لا مستنداً واحداً. */
    /** @test */
    public function the_activity_feed_spans_documents(): void
    {
        $p = $this->product('إسمنت', 'CEM-1');
        $invoice = $this->postedInvoice($p, 100000, '2026-01-01');

        $this->withToken($this->token)->postJson('/api/quotes', [
            'partner_id' => $this->partnerId,
            'items' => [['description' => 'عرض', 'quantity' => 1, 'unit_price' => 50000]],
        ])->assertCreated();

        $feed = $this->withToken($this->token)->getJson('/api/revisions?limit=10')->assertOk()['data'];

        $types = array_column($feed, 'document_type');
        $this->assertContains('invoice', $types);
        $this->assertContains('quote', $types);

        // ورقمُ المستند حاضر — فتُقرأ جملةٌ مفهومة بدل معرّف خام
        $invoiceRow = collect($feed)->firstWhere('document_type', 'invoice');
        $this->assertSame($invoice['number'], $invoiceRow['document_number']);
    }

    /** الجرد والإذن المخزني كانا يُسجَّلان ولا يُقرآن — القائمة البيضاء أُكملت. */
    /** @test */
    public function stocktakes_and_stock_permits_are_now_readable(): void
    {
        $keys = array_keys(\App\Models\DocumentRevision::TYPES);

        $this->assertContains('stocktake', $keys);
        $this->assertContains('stock_permit', $keys);
    }
}
