<?php

namespace Tests\Feature;

use App\Models\EmployeeAttachment;
use App\Models\Product;
use App\Models\ProductMedia;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * AWJ-UPLOAD-PHP-LIMITS-1 — كيف يتصرف التطبيق حين يفشل PHP نفسه في الرفع، وأن
 * حدود التحقق القائمة لم تتغيّر.
 *
 * `UploadedFile::fake()` يبني ملفاً صالحاً دائماً (UPLOAD_ERR_OK)، فلا يمكنه إثبات
 * أي شيء عن فشل PHP. هنا نبني ملفاً بالرمز الذي يسلّمه PHP فعلاً عند تجاوز
 * `upload_max_filesize` (path فارغ، حجم 0، error=UPLOAD_ERR_INI_SIZE) ونتحقق أن
 * الطلب يُرفض 422 دون أي كتابة (لا صف ولا ملف)، حتى لو سبقه ملف سليم في الدفعة.
 *
 * ما يُثبته هذا الملف هو السلوك الحالي عمداً (رسالة Laravel الافتراضية)؛ تحسين
 * الرسالة في الواجهة/الخادم مرحلة لاحقة منفصلة (AWJ-UPLOAD-RELIABILITY-1 §14، م2).
 *
 * تشغيل: php artisan test --filter=UploadFailureHandlingTest
 */
class UploadFailureHandlingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function fakeDocumentStorage(): void
    {
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('product_media.r2.enabled', false);
        Storage::fake('local');
    }

    private function product(string $token): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج رفع',
            'sku' => 'UPLOAD-001',
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 10000,
        ])->assertCreated()['data'];
    }

    /** ما يسلّمه PHP للتطبيق حين يرفض الملف قبل Laravel: لا مسار مؤقت ولا حجم. */
    private function phpRejected(int $error, string $name = 'IMG_0001.jpg', string $mime = 'image/jpeg'): UploadedFile
    {
        return new UploadedFile('', $name, $mime, $error, true);
    }

    /** @return array<string,array{int}> */
    public static function phpUploadErrors(): array
    {
        return [
            'upload_max_filesize exceeded (UPLOAD_ERR_INI_SIZE)' => [UPLOAD_ERR_INI_SIZE],
            'MAX_FILE_SIZE exceeded (UPLOAD_ERR_FORM_SIZE)' => [UPLOAD_ERR_FORM_SIZE],
            'connection dropped mid-upload (UPLOAD_ERR_PARTIAL)' => [UPLOAD_ERR_PARTIAL],
            'no temp directory (UPLOAD_ERR_NO_TMP_DIR)' => [UPLOAD_ERR_NO_TMP_DIR],
            'cannot write to disk (UPLOAD_ERR_CANT_WRITE)' => [UPLOAD_ERR_CANT_WRITE],
        ];
    }

    /**
     * @test
     *
     * @dataProvider phpUploadErrors
     */
    public function product_media_rejected_by_php_returns_422_and_writes_nothing(int $error): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $response = $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/media", ['media' => [$this->phpRejected($error)]]);

        $response->assertStatus(422)->assertJsonValidationErrors(['media.0']);
        $this->assertStringContainsString('media.0', $response->json('errors')['media.0'][0]);
        $this->assertSame(0, ProductMedia::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    /** @test */
    public function one_php_rejected_file_fails_the_whole_batch_and_the_valid_sibling_is_not_stored(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $response = $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/media", ['media' => [
                UploadedFile::fake()->image('small.jpg', 600, 600),
                $this->phpRejected(UPLOAD_ERR_INI_SIZE, 'big.jpg'),
            ]]);

        $response->assertStatus(422)->assertJsonValidationErrors(['media.1']);
        $this->assertArrayNotHasKey('media.0', $response->json('errors'));
        $this->assertSame(0, ProductMedia::query()->count(), 'a failed batch must not leave a partial gallery');
        $this->assertSame([], Storage::disk('local')->allFiles(), 'a failed batch must not leave orphan files');
    }

    /** @test */
    public function product_media_application_limits_are_unchanged(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $url = "/api/products/{$product['id']}/media";

        // 5120KB مقبول، 5121KB مرفوض — الحدّ لم يتحرّك مع رفع حدود PHP.
        $this->withToken($auth['token'])->postJson($url, ['media' => [UploadedFile::fake()->image('edge.jpg', 600, 600)->size(5120)]])
            ->assertCreated();
        $this->withToken($auth['token'])->postJson($url, ['media' => [UploadedFile::fake()->image('over.jpg', 600, 600)->size(5121)]])
            ->assertStatus(422)->assertJsonValidationErrors(['media.0']);

        // الصيغ لم تتوسّع: PDF وHEIC (صور iPhone غير المحوَّلة) ما زالا مرفوضين.
        $this->withToken($auth['token'])->postJson($url, ['media' => [UploadedFile::fake()->create('scan.pdf', 100, 'application/pdf')]])
            ->assertStatus(422)->assertJsonValidationErrors(['media.0']);
        $this->withToken($auth['token'])->postJson($url, ['media' => [UploadedFile::fake()->create('IMG_0001.heic', 100, 'image/heic')]])
            ->assertStatus(422)->assertJsonValidationErrors(['media.0']);

        $this->assertSame(1, ProductMedia::query()->where('product_id', $product['id'])->count());
    }

    /** @test */
    public function product_media_count_cap_of_eight_per_request_is_unchanged(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $nine = array_map(static fn (int $i) => UploadedFile::fake()->image("p{$i}.jpg", 400, 400), range(1, 9));

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", ['media' => $nine])
            ->assertStatus(422)->assertJsonValidationErrors(['media']);
        $this->assertSame(0, ProductMedia::query()->count());
    }

    /** @test */
    public function product_media_failure_does_not_touch_another_tenants_gallery(): void
    {
        $this->fakeDocumentStorage();
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $b = $this->registerTenant('globex', 'owner@globex.test');
        $productA = $this->product($a['token']);
        $productB = $this->withToken($b['token'])->postJson('/api/products', [
            'name' => 'منتج ب', 'sku' => 'UPLOAD-B', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000,
        ])->assertCreated()['data'];

        $this->withToken($b['token'])->postJson("/api/products/{$productB['id']}/media", ['media' => [UploadedFile::fake()->image('b.jpg', 600, 600)]])
            ->assertCreated();

        // مستأجر A يفشل رفعه عند PHP؛ ولا يستطيع الوصول لمنتج B أصلاً.
        $this->withToken($a['token'])->postJson("/api/products/{$productA['id']}/media", ['media' => [$this->phpRejected(UPLOAD_ERR_INI_SIZE)]])
            ->assertStatus(422);
        $this->withToken($a['token'])->postJson("/api/products/{$productB['id']}/media", ['media' => [UploadedFile::fake()->image('x.jpg', 600, 600)]])
            ->assertNotFound();

        $this->assertSame(1, ProductMedia::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, Product::query()->withoutGlobalScopes()->findOrFail($productB['id'])->media()->withoutGlobalScopes()->count());
    }

    /**
     * @test
     *
     * @dataProvider phpUploadErrors
     */
    public function employee_attachments_rejected_by_php_return_422_and_write_nothing(int $error): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $employee = $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف', 'basic_salary' => 500000,
        ])->assertCreated()['data'];

        $response = $this->withToken($auth['token'])->postJson("/api/employees/{$employee['id']}/attachments", [
            'attachments' => [
                UploadedFile::fake()->create('ok.pdf', 100, 'application/pdf'),
                $this->phpRejected($error, 'contract.pdf', 'application/pdf'),
            ],
        ]);

        $response->assertStatus(422)->assertJsonValidationErrors(['attachments.1']);
        $this->assertSame(0, EmployeeAttachment::query()->count(), 'a failed batch must not leave a partial attachment set');
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    /** @test */
    public function attachment_application_limits_are_unchanged(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $employee = $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف', 'basic_salary' => 500000,
        ])->assertCreated()['data'];
        $url = "/api/employees/{$employee['id']}/attachments";

        $this->withToken($auth['token'])->postJson($url, ['attachments' => [UploadedFile::fake()->create('edge.pdf', 10240, 'application/pdf')]])
            ->assertCreated();
        $this->withToken($auth['token'])->postJson($url, ['attachments' => [UploadedFile::fake()->create('over.pdf', 10241, 'application/pdf')]])
            ->assertStatus(422)->assertJsonValidationErrors(['attachments.0']);

        $eleven = array_map(static fn (int $i) => UploadedFile::fake()->create("f{$i}.pdf", 10, 'application/pdf'), range(1, 11));
        $this->withToken($auth['token'])->postJson($url, ['attachments' => $eleven])
            ->assertStatus(422)->assertJsonValidationErrors(['attachments']);

        $this->assertSame(1, EmployeeAttachment::query()->count());
    }
}
