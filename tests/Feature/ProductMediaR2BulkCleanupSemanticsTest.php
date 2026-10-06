<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\Tenant;
use App\Services\ProductMediaService;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Response;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-4 (مراجعة ما قبل الدمج) — يوثّق ويثبت الفرق المتعمَّد القائم أصلاً
 * (لا شيء غيّره هذا العقد) بين مساري الحذف:
 *
 *  - `ProductMediaService::delete()` (حذفٌ مباشر أحادي): التخزين يُحذف
 *    **قبل** صفّ `ProductMedia`، وفشل التخزين **يرمي** فيبقى الصفّ.
 *  - `collectAndQueueDeletion()` + `deleteFiles()` (تنظيف دُفعي بعد الالتزام،
 *    يستعمله `ProductVariantService` عند حذف خيار/قيمة/متغيّر — بنفس نمط
 *    `ProductLifecycleService::delete()` القائم): صفوف `ProductMedia` تُحذف
 *    **داخل معاملة المستدعي** أولاً، والتخزين يُنظَّف **بعد الالتزام** على
 *    أساس أفضل جهدٍ ممكن — فشل التخزين هنا **لا يرمي**، بل يُبلَّغ عنه
 *    (`report()`) ولا يُعيد الصفّ ولا يمنع حذف الوالد (الخيار/القيمة/المتغيّر)
 *    الذي التزم فعلاً. هذا ليس ضعفاً أُدخل عبر AWJ-R2-4 — فرع `r2` الجديد في
 *    `deleteFiles()` يطابق فرعَي `document` والقرص القديم الموجودين مسبقاً
 *    حرفياً؛ هذا الاختبار يوثّق تلك الحقيقة القائمة، لا يغيّرها.
 */
class ProductMediaR2BulkCleanupSemanticsTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function mockR2(): MockInterface
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key', 'secret' => 'placeholder-secret',
            'bucket' => 'awj-product-media-test', 'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto', 'use_path_style_endpoint' => false,
        ]);

        $client = Mockery::mock(S3ClientInterface::class);
        $this->app->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $client));

        return $client;
    }

    /** @return array{tenant: Tenant, product: Product, media: ProductMedia} */
    private function seedR2Media(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "شركة {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);

        $key = "tenant/{$tenant->id}/product-media/{$product->id}/target.webp";
        $media = ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'r2', 'path' => $key,
            'original_name' => 'target.webp', 'mime_type' => 'image/webp', 'size' => 1, 'sort_order' => 0,
        ]);

        app(TenantContext::class)->forget();

        return ['tenant' => $tenant, 'product' => $product, 'media' => $media];
    }

    /** @test */
    public function collect_and_queue_deletion_removes_the_db_row_immediately_before_any_storage_call(): void
    {
        $this->mockR2();
        $seed = $this->seedR2Media('bulk-collect');

        app(TenantContext::class)->set($seed['tenant']->id);
        $files = app(ProductMediaService::class)->collectAndQueueDeletion(
            ProductMedia::where('id', $seed['media']->id)
        );
        app(TenantContext::class)->forget();

        // الصفّ زال من القاعدة فور collectAndQueueDeletion() — قبل أي استدعاء تخزينٍ إطلاقاً.
        $this->assertNull(ProductMedia::find($seed['media']->id));
        $this->assertSame([[
            'id' => $seed['media']->id,
            'disk' => 'r2',
            'path' => $seed['media']->path,
            'mime_type' => 'image/webp',
            'product_id' => $seed['product']->id,
        ]], $files);
    }

    /** @test */
    public function an_r2_storage_failure_during_bulk_cleanup_is_reported_but_never_thrown_and_never_blocks_the_already_committed_parent_deletion(): void
    {
        $client = $this->mockR2();
        $seed = $this->seedR2Media('bulk-fail');

        $expectedKey = "tenant/{$seed['tenant']->id}/product-media/{$seed['product']->id}/{$seed['media']->id}-thumbnail.webp";
        $client->shouldReceive('deleteObject')->once()
            ->with(['Bucket' => 'awj-product-media-test', 'Key' => $expectedKey])
            ->andThrow(new AwsException(
                'network failure', Mockery::mock('Aws\\CommandInterface'),
                ['code' => 'InternalError', 'response' => new Response(500)],
            ));
        // فشل الحذف يُبلَّغ عنه فعلاً — لا يُبتلع صامتاً — دون أن يمسّ حالة النجاح المُعادة.
        $this->mock(ExceptionHandler::class, function ($mock) {
            $mock->shouldReceive('report')->once()->withArgs(fn ($e) => $e instanceof AwsException);
        });

        // السياق يبقى مضبوطاً عبر النداءين معاً — يطابق الاستعمال الحقيقي
        // (`ProductVariantService` يستدعي كليهما ضمن نفس الطلب/الأمر الذي
        // يضبط `TenantContext` لعمره كله، لا يُنسى بينهما).
        app(TenantContext::class)->set($seed['tenant']->id);
        $files = app(ProductMediaService::class)->collectAndQueueDeletion(
            ProductMedia::where('id', $seed['media']->id)
        );

        // الصفّ محذوفٌ فعلاً (بمعاملة المستدعي المُلتَزمة ضمنياً هنا) بصرف
        // النظر عمّا سيحدث للتخزين — هذا هو "الوالد" الذي لا يُمس بفشل التخزين.
        $this->assertNull(ProductMedia::find($seed['media']->id));

        // deleteFiles() لا يرمي أبداً رغم فشل R2 — أفضل جهدٍ ممكن فقط، بخلاف delete() المباشر.
        app(ProductMediaService::class)->deleteFiles($files);
        app(TenantContext::class)->forget();

        $this->assertTrue(true, 'deleteFiles() completed without throwing despite the R2 failure above.');
    }

    /** @test */
    public function by_contrast_the_direct_single_delete_path_throws_on_storage_failure_and_keeps_the_row(): void
    {
        $client = $this->mockR2();
        $seed = $this->seedR2Media('direct-fail');

        $client->shouldReceive('deleteObject')->once()->andThrow(new AwsException(
            'network failure', Mockery::mock('Aws\\CommandInterface'),
            ['code' => 'InternalError', 'response' => new Response(500)],
        ));

        app(TenantContext::class)->set($seed['tenant']->id);
        try {
            app(ProductMediaService::class)->delete($seed['media']->fresh());
            $this->fail('Expected delete() to throw on a storage failure.');
        } catch (\RuntimeException) {
            // متوقَّع.
        }
        app(TenantContext::class)->forget();

        // بخلاف deleteFiles()، delete() المباشر يحمي الصفّ عند فشل التخزين.
        $this->assertNotNull(ProductMedia::find($seed['media']->id));
    }
}
