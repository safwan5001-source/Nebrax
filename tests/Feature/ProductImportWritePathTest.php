<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\StockMovement;
use App\Services\ProductService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-H2-S1 — الإنشاء في استيراد المنتجات يمرّ بـ`ProductService::create(…, generateSku: false)` نفسها (بطاقة المنتج ومسار AI Actions)،
 * وسلوك V2 حرفي: حدث دورة حياة واحد لكل منتج، رمز الصنف الفارغ من العدّاد نفسه، وبلا أي أثر مخزني أو محاسبي.
 */
class ProductImportWritePathTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function csv(array $headers, array $rows): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('p.csv', SpreadsheetWriter::csv($headers, $rows));
    }

    /** @test */
    public function an_import_create_writes_one_created_event_per_product_with_no_stock_or_ledger_effect(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'purchase_price'], [
            ['WP-1', 'منتج 1', 'good', '10.00', '4.00'],
            ['WP-2', 'منتج 2', 'good', '20.00', '8.00'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(2, Product::count());
        $this->assertSame(0, StockMovement::count(), 'الاستيراد لا يحرّك مخزوناً.');
        $this->assertSame(0, JournalEntry::count(), 'ولا يولّد قيداً.');
        foreach (Product::all() as $product) {
            $events = ProductActivity::where('product_id', $product->id)->get();
            $this->assertCount(1, $events);
            $this->assertSame('created', $events->first()->action);
        }
    }

    /** @test */
    public function a_blank_sku_is_filled_from_the_product_counter_exactly_once(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['name', 'type', 'sale_price'], [['بلا رمز', 'good', '5.00'], ['بلا رمز ثان', 'good', '6.00']]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $skus = Product::orderBy('created_at')->pluck('sku')->all();
        $this->assertCount(2, array_unique($skus));
        foreach ($skus as $sku) {
            $this->assertNotSame('', trim((string) $sku));
        }
    }

    /** @test */
    public function the_event_written_by_import_matches_the_one_written_by_the_product_service(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $this->csv(['sku', 'name', 'type', 'sale_price'], [['WP-IMP', 'عبر الاستيراد', 'good', '10.00']]),
            'mode' => 'create',
        ])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $direct = app(ProductService::class)->create(['name' => 'عبر الخدمة', 'sku' => 'WP-DIR', 'type' => 'good', 'sale_price' => 1000, 'purchase_price' => 0], null, generateSku: false);

        $imported = ProductActivity::where('product_id', Product::where('sku', 'WP-IMP')->value('id'))->firstOrFail();
        $service = ProductActivity::where('product_id', $direct->id)->firstOrFail();
        $this->assertSame($service->action, $imported->action);
        $this->assertSame(array_keys((array) $service->diff), array_keys((array) $imported->diff), 'نفس بنية الحدث لأن المسار واحد.');
    }
}
