<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\ProcurementDocument;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\ProcurementService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  دورة الشراء — طلب · طلب عروض · عرض مورّد · أمر شراء
 * ═══════════════════════════════════════════════════════════════
 *  **الضمان الأول والأهم:** لا واحد من الأربعة يولّد قيداً محاسبياً ولا
 *  حركة مخزون. الأثر يبدأ عند ترحيل الفاتورة الناتجة عن أمر الشراء.
 *  اختبار صريح أدناه يحرس ذلك عبر السلسلة كاملةً.
 *
 *  تشغيل: php artisan test --filter=ProcurementTest
 */
class ProcurementTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected Product $product;
    protected ProcurementService $procurement;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->product  = Product::create([
            'name' => 'إسمنت', 'sku' => 'CEM-1', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 15000, 'track_inventory' => true,
        ]);

        $this->procurement = app(ProcurementService::class);
    }

    /** طلب شراء مُعتمد بسطر واحد — نقطة البداية لأغلب الاختبارات. */
    private function approvedRequest(): ProcurementDocument
    {
        $doc = $this->procurement->create(
            ['type' => 'request', 'requested_by' => 'إدارة المشاريع'],
            [['product_id' => $this->product->id, 'quantity' => 10, 'unit_price' => 15000, 'tax_rate' => 15]]
        );

        $this->procurement->transition($doc, 'submitted');

        return $this->procurement->transition($doc->fresh(), 'approved');
    }

    /** @test */
    public function a_purchase_request_derives_its_totals_from_its_lines(): void
    {
        $doc = $this->procurement->create(
            ['type' => 'request'],
            [
                ['description' => 'إسمنت', 'quantity' => 10, 'unit_price' => 15000, 'tax_rate' => 15],
                ['description' => 'حديد',  'quantity' => 2,  'unit_price' => 50000, 'tax_rate' => 15],
            ]
        );

        $this->assertSame(250000, $doc->subtotal);           // 150000 + 100000
        $this->assertSame(37500, $doc->tax_amount);          // 15%
        $this->assertSame(287500, $doc->total);
        $this->assertSame('draft', $doc->status);
        $this->assertStringStartsWith('PR-', $doc->number);
    }

    /** طلب الشراء وطلب العروض يحدّدان المطلوب لا ثمنه — فالسعر صفرٌ مقبول. */
    /** @test */
    public function a_request_may_be_created_without_prices(): void
    {
        $doc = $this->procurement->create(
            ['type' => 'request'],
            [['description' => 'إسمنت', 'quantity' => 10, 'unit_price' => 0]]
        );

        $this->assertSame(0, $doc->total);
        $this->assertCount(1, $doc->lines);
    }

    /** لكل نوع تسلسله المستقلّ — فلا يتزاحم الطلب مع الأمر على رقم واحد. */
    /** @test */
    public function each_document_type_has_its_own_number_sequence(): void
    {
        $request = $this->approvedRequest();
        $order   = $this->procurement->convert($request, 'order', ['partner_id' => $this->supplier->id]);

        $this->assertStringStartsWith('PR-', $request->number);
        $this->assertStringStartsWith('PO-', $order->number);
        $this->assertStringEndsWith('-00001', $request->number);
        $this->assertStringEndsWith('-00001', $order->number);
    }

    /**
     * **جوهر الوحدة.** السلسلة كاملةً: طلب → طلب عروض → عرض مورّد → أمر شراء،
     * وكل حلقة موسومة بمصدرها فيُتتبَّع الأمرُ رجوعاً إلى الطلب الأول.
     *
     * @test
     */
    public function the_full_chain_links_each_document_to_its_source(): void
    {
        $request = $this->approvedRequest();

        $rfq = $this->procurement->convert($request, 'rfq');
        $this->assertSame($request->id, $rfq->source_document_id);
        $this->assertSame('converted', $request->fresh()->status);

        $this->procurement->transition($rfq, 'submitted');
        $rfq = $this->procurement->transition($rfq->fresh(), 'approved');

        $quotation = $this->procurement->convert($rfq, 'quotation', ['partner_id' => $this->supplier->id]);
        $this->assertSame($rfq->id, $quotation->source_document_id);
        $this->assertSame($this->supplier->id, $quotation->partner_id);

        $this->procurement->transition($quotation, 'submitted');
        $quotation = $this->procurement->transition($quotation->fresh(), 'approved');

        $order = $this->procurement->convert($quotation, 'order');
        $this->assertSame($quotation->id, $order->source_document_id);
        $this->assertSame('PO', substr($order->number, 0, 2));

        // السلسلة قابلة للصعود من الأمر إلى الطلب الأول
        $this->assertSame($rfq->id, $order->sourceDocument->sourceDocument->id);
        $this->assertSame($request->id, $order->sourceDocument->sourceDocument->sourceDocument->id);
    }

    /**
     * **الضمان الحاسم:** لا شيء في دورة الشراء يمسّ الدفتر العام ولا المخزون.
     * الأثر المحاسبي حكرٌ على ترحيل الفاتورة.
     *
     * @test
     */
    public function the_whole_chain_creates_no_journal_entries_and_no_stock(): void
    {
        $entriesBefore = JournalEntry::count();

        $request   = $this->approvedRequest();
        $rfq       = $this->procurement->convert($request, 'rfq');
        $this->procurement->transition($rfq, 'submitted');
        $rfq       = $this->procurement->transition($rfq->fresh(), 'approved');
        $quotation = $this->procurement->convert($rfq, 'quotation', ['partner_id' => $this->supplier->id]);
        $this->procurement->transition($quotation, 'submitted');
        $quotation = $this->procurement->transition($quotation->fresh(), 'approved');
        $order     = $this->procurement->convert($quotation, 'order');

        $this->assertSame($entriesBefore, JournalEntry::count(), 'دورة الشراء لا تولّد قيوداً.');
        $this->assertSame(0, StockMovement::count(), 'ولا حركة مخزون.');

        // وحتى الفاتورة المولَّدة تبقى مسوّدة بلا قيد حتى يرحّلها المستخدم.
        $this->procurement->transition($order, 'submitted');
        $order    = $this->procurement->transition($order->fresh(), 'approved');
        $purchase = $this->procurement->convertToPurchase($order);

        $this->assertSame('draft', $purchase->status);
        $this->assertNull($purchase->journal_entry_id);
        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame(0, StockMovement::count());
    }

    /** أمر الشراء يولّد فاتورة مشتريات مسوّدة بنفس السطور والإجماليات. */
    /** @test */
    public function an_order_converts_into_a_draft_purchase_invoice(): void
    {
        $request = $this->approvedRequest();
        $order   = $this->procurement->convert($request, 'order', ['partner_id' => $this->supplier->id]);
        $this->procurement->transition($order, 'submitted');
        $order = $this->procurement->transition($order->fresh(), 'approved');

        $purchase = $this->procurement->convertToPurchase($order);

        $this->assertInstanceOf(Purchase::class, $purchase);
        $this->assertSame($this->supplier->id, $purchase->partner_id);
        $this->assertSame($order->subtotal, $purchase->subtotal);
        $this->assertSame($order->total, $purchase->total);
        $this->assertCount(1, $purchase->lines);

        $order = $order->fresh();
        $this->assertSame('converted', $order->status);
        $this->assertSame($purchase->id, $order->converted_purchase_id);
    }

    /** التحويل يلزمه اعتماد — لا يُلتزَم بمسوّدة لم يراجعها أحد. */
    /** @test */
    public function a_draft_document_cannot_be_converted(): void
    {
        $doc = $this->procurement->create(
            ['type' => 'request'],
            [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 1000]]
        );

        $this->expectException(RuntimeException::class);
        $this->procurement->convert($doc, 'order', ['partner_id' => $this->supplier->id]);
    }

    /** السلسلة اتجاهها واحد: أمر الشراء لا يعود طلباً. */
    /** @test */
    public function the_chain_only_moves_forward(): void
    {
        $request = $this->approvedRequest();
        $order   = $this->procurement->convert($request, 'order', ['partner_id' => $this->supplier->id]);
        $this->procurement->transition($order, 'submitted');
        $order = $this->procurement->transition($order->fresh(), 'approved');

        $this->expectExceptionMessage('لا يمكن تحويل «order» إلى «request».');
        $this->procurement->convert($order, 'request');
    }

    /** العرض والأمر يلزمهما مورّد؛ الطلب وطلب العروض لا. */
    /** @test */
    public function a_quotation_requires_a_supplier(): void
    {
        $this->expectExceptionMessage('هذا المستند يلزمه مورّد محدَّد.');
        $this->procurement->create(
            ['type' => 'quotation'],
            [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 1000]]
        );
    }

    /** المستند المُحوَّل حجّة على ما تلاه — لا يُعدَّل بعدها. */
    /** @test */
    public function a_converted_document_cannot_be_edited(): void
    {
        $request = $this->approvedRequest();
        $this->procurement->convert($request, 'order', ['partner_id' => $this->supplier->id]);

        $this->expectExceptionMessage('لا يمكن تعديل مستند مُحوَّل أو ملغى.');
        $this->procurement->update($request->fresh(), ['notes' => 'تعديل متأخر'], null);
    }

    /** الدعوات تخصّ طلب العروض وحده. */
    /** @test */
    public function rfq_invitations_record_the_invited_suppliers(): void
    {
        $second = Partner::create(['name' => 'مورد ثانٍ', 'type' => 'supplier']);

        $rfq = $this->procurement->create(
            ['type' => 'rfq', 'supplier_ids' => [$this->supplier->id, $second->id]],
            [['description' => 'إسمنت', 'quantity' => 10, 'unit_price' => 0]]
        );

        $this->assertCount(2, $rfq->invitations);
        $this->assertEqualsCanonicalizing(
            [$this->supplier->id, $second->id],
            $rfq->invitations->pluck('partner_id')->all()
        );
    }

    /** @test */
    public function inviting_suppliers_to_a_non_rfq_document_is_rejected(): void
    {
        $this->expectExceptionMessage('دعوة الموردين تخصّ طلب عروض الأسعار فقط.');
        $this->procurement->create(
            ['type' => 'request', 'supplier_ids' => [$this->supplier->id]],
            [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 1000]]
        );
    }

    /** الانتقال غير المسموح يُرفض — لا اعتماد لمسوّدة لم تُرسَل. */
    /** @test */
    public function an_illegal_status_transition_is_rejected(): void
    {
        $doc = $this->procurement->create(
            ['type' => 'request'],
            [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 1000]]
        );

        $this->expectExceptionMessage('لا يمكن نقل المستند من «draft» إلى «approved».');
        $this->procurement->transition($doc, 'approved');
    }

    /** حالة «مُحوَّل» لا تُزوَّر يدوياً — التحويل وحده يضعها مع ربط المصدر. */
    /** @test */
    public function converted_status_cannot_be_set_by_hand(): void
    {
        $doc = $this->approvedRequest();

        $this->expectExceptionMessage('حالة «مُحوَّل» تُضبط بالتحويل لا يدوياً.');
        $this->procurement->transition($doc, 'converted');
    }
}
