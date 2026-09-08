<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * يثبت أن الفئات الأربع الأساسية في AWJ Global Search (فواتير المبيعات،
 * المشتريات، المنتجات، القيود اليومية) تعمل فعلياً بنفس معاملات `per_page`
 * التي يرسلها المكوّن (`4`→`10` للكل، `8`→`20` للفئة الواحدة بعد الإصلاح)،
 * لا بأي قيمة اعتباطية.
 *
 * السبب الجذري الذي يثبته هذا الملف: `/invoices`، `/purchases`، `/products`،
 * و`/journal-entries` تفرض كل واحدة منها `per_page >= 10` — قيد كان موجوداً
 * في هذه النقاط قبل AWJ Global Search بفترة طويلة، بلا علاقة به. القيمتان
 * القديمتان في المكوّن (٤ للكل، ٨ للفئة الواحدة) كانتا تحت هذا الحدّ فيرفضهما
 * الخادم بخطأ ٤٢٢ في كل عملية بحث، ومعالجة الأخطاء الحالية في الواجهة تُسقط أي
 * خطأ غير ٤٠٣ بصمت كـ«لا نتائج» — فبدت هذه الفئات الأربع «معطّلة» بينما
 * `/partners` (min:1) يعمل. تشغيل: php artisan test --filter=GlobalSearchCoreCategoriesApiTest
 */
class GlobalSearchCoreCategoriesApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function customer(string $token, string $suffix): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => "عميل بحث {$suffix}", 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    private function supplier(string $token, string $suffix): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => "مورد بحث {$suffix}", 'type' => 'supplier',
        ])->assertCreated()['data']['id'];
    }

    // ── فواتير المبيعات ──────────────────────────────────────────────────

    /** @test */
    public function invoice_search_matches_a_partial_document_number_at_the_per_page_awj_search_actually_sends(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        $customerId = $this->customer($token, 'inv');

        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $partial = substr($invoice['number'], -5); // مثل "00001" من "INV-2026-00001"

        // per_page=10: قيمة PER_PAGE_ALL بعد الإصلاح (وضع «الكل»).
        $all = $this->withToken($token)
            ->getJson("/api/invoices?search={$partial}&per_page=10")
            ->assertOk()->json('data');
        $this->assertCount(1, $all);
        $this->assertSame($invoice['number'], $all[0]['number']);

        // per_page=20: قيمة PER_PAGE_SINGLE بعد الإصلاح (فئة واحدة مختارة).
        $single = $this->withToken($token)
            ->getJson("/api/invoices?search={$partial}&per_page=20")
            ->assertOk()->json('data');
        $this->assertCount(1, $single);

        // القيمتان القديمتان (٤ و٨) كانتا تُرفَض — هذا الاختبار يحرس ضد رجوعهما.
        $this->withToken($token)->getJson("/api/invoices?search={$partial}&per_page=4")
            ->assertStatus(422);
        $this->withToken($token)->getJson("/api/invoices?search={$partial}&per_page=8")
            ->assertStatus(422);
    }

    /** @test */
    public function invoice_search_never_surfaces_another_tenants_invoice(): void
    {
        $a = $this->registerTenant('alpha-inv', 'a@alpha-inv.test');
        $b = $this->registerTenant('beta-inv', 'b@beta-inv.test');

        $customerA = $this->customer($a['token'], 'a');
        $invoiceA = $this->withToken($a['token'])->postJson('/api/invoices', [
            'partner_id' => $customerA,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $partial = substr($invoiceA['number'], -5);

        $resultsForB = $this->withToken($b['token'])
            ->getJson("/api/invoices?search={$partial}&per_page=10")
            ->assertOk()->json('data');

        $this->assertCount(0, $resultsForB);
    }

    // ── فواتير المشتريات ─────────────────────────────────────────────────

    private function purchasableProduct(string $token, string $suffix): string
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => "صنف شراء {$suffix}", 'sku' => "PUR-{$suffix}",
            'type' => 'good', 'sale_price' => 20000, 'purchase_price' => 10000,
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function purchase_search_matches_a_partial_document_number_at_the_per_page_awj_search_actually_sends(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        $supplierId = $this->supplier($token, 'pur');
        $productId = $this->purchasableProduct($token, 'pur');

        $purchase = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'supplier_invoice_no' => 'SUP-INV-9921',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $partial = substr($purchase['number'], -5);

        $byNumber = $this->withToken($token)
            ->getJson("/api/purchases?search={$partial}&per_page=10")
            ->assertOk()->json('data');
        $this->assertCount(1, $byNumber);

        $bySupplierInvoice = $this->withToken($token)
            ->getJson('/api/purchases?search=9921&per_page=20')
            ->assertOk()->json('data');
        $this->assertCount(1, $bySupplierInvoice);
        $this->assertSame($purchase['id'], $bySupplierInvoice[0]['id']);
    }

    /** @test */
    public function purchase_search_never_surfaces_another_tenants_purchase(): void
    {
        $a = $this->registerTenant('alpha-pur', 'a@alpha-pur.test');
        $b = $this->registerTenant('beta-pur', 'b@beta-pur.test');

        $supplierA = $this->supplier($a['token'], 'a');
        $productA = $this->purchasableProduct($a['token'], 'a');
        $purchaseA = $this->withToken($a['token'])->postJson('/api/purchases', [
            'partner_id' => $supplierA,
            'supplier_invoice_no' => 'SUP-UNIQUE-7788',
            'items' => [['product_id' => $productA, 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $resultsForB = $this->withToken($b['token'])
            ->getJson('/api/purchases?search=UNIQUE-7788&per_page=10')
            ->assertOk()->json('data');

        $this->assertCount(0, $resultsForB);
    }

    // ── المنتجات ─────────────────────────────────────────────────────────

    /** @test */
    public function product_search_matches_partial_name_sku_and_barcode_at_the_per_page_awj_search_actually_sends(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $product = $this->withToken($token)->postJson('/api/products', [
            'name' => 'مضخة وقود ديزل XJ-500', 'sku' => 'PUMP-XJ500', 'barcode' => '6291000112233',
            'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated()['data'];

        foreach (['XJ-500' => 'الاسم', 'XJ500' => 'SKU', '0001122' => 'الباركود'] as $term => $label) {
            $result = $this->withToken($token)
                ->getJson("/api/products?search={$term}&per_page=10")
                ->assertOk()->json('data');
            $this->assertCount(1, $result, "فشل البحث الجزئي بـ{$label} ({$term})");
            $this->assertSame($product['id'], $result[0]['id']);
        }
    }

    /** @test */
    public function product_search_never_surfaces_another_tenants_product(): void
    {
        $a = $this->registerTenant('alpha-prod', 'a@alpha-prod.test');
        $b = $this->registerTenant('beta-prod', 'b@beta-prod.test');

        $this->withToken($a['token'])->postJson('/api/products', [
            'name' => 'منتج فريد ألفا ZZQ', 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated();

        $resultsForB = $this->withToken($b['token'])
            ->getJson('/api/products?search=ZZQ&per_page=10')
            ->assertOk()->json('data');

        $this->assertCount(0, $resultsForB);
    }

    // ── القيود اليومية ───────────────────────────────────────────────────

    /** @test */
    public function journal_entry_search_matches_a_partial_number_at_the_per_page_awj_search_actually_sends(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        $customerId = $this->customer($token, 'je');

        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        // القيد يُولَّد فقط عند الترحيل — لا عند الإنشاء.
        $this->withToken($token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $entries = $this->withToken($token)
            ->getJson('/api/journal-entries?per_page=10')
            ->assertOk()->json('data');
        $this->assertNotEmpty($entries, 'لم يُولَّد أي قيد بعد الترحيل — تحقّق من الإعداد قبل تفسير عطل البحث');

        $entryNumber = $entries[0]['number'];
        $partial = substr($entryNumber, -4);

        $found = $this->withToken($token)
            ->getJson("/api/journal-entries?search={$partial}&per_page=10")
            ->assertOk()->json('data');
        $this->assertGreaterThanOrEqual(1, count($found));
        $this->assertTrue(collect($found)->contains('number', $entryNumber));

        // القيمتان القديمتان (٤ و٨) كانتا تُرفَض هنا أيضاً.
        $this->withToken($token)->getJson("/api/journal-entries?search={$partial}&per_page=4")
            ->assertStatus(422);
    }

    /** @test */
    public function journal_entry_search_never_surfaces_another_tenants_posting(): void
    {
        $a = $this->registerTenant('alpha-je', 'a@alpha-je.test');
        $b = $this->registerTenant('beta-je', 'b@beta-je.test');

        $customerA = $this->customer($a['token'], 'a');
        $invoiceA = $this->withToken($a['token'])->postJson('/api/invoices', [
            'partner_id' => $customerA,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->withToken($a['token'])->postJson("/api/invoices/{$invoiceA['id']}/post")->assertOk();

        $entriesA = $this->withToken($a['token'])
            ->getJson('/api/journal-entries?per_page=10')
            ->assertOk()->json('data');
        $this->assertNotEmpty($entriesA);
        $partial = substr($entriesA[0]['number'], -4);

        // مستأجر B يبحث بمصطلح مطابق تماماً لقيد مستأجر A → صفر نتائج، ولا حتى
        // تسريب من خلال عدّ إجمالي (`meta.total`) يفضح وجود القيد ضمنياً.
        $response = $this->withToken($b['token'])
            ->getJson("/api/journal-entries?search={$partial}&per_page=10")
            ->assertOk();

        $this->assertCount(0, $response->json('data'));
        $this->assertSame(0, $response->json('meta.total'));
    }

    /** @test */
    public function journal_entry_search_still_requires_accounts_view_permission(): void
    {
        $auth = $this->registerTenant();
        $restricted = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@je-perm.test');

        $this->withToken($restricted)->getJson('/api/journal-entries?search=1&per_page=10')
            ->assertForbidden();
    }
}
