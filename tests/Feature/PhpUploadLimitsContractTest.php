<?php

namespace Tests\Feature;

use App\Http\Requests\StoreDocumentFileRequest;
use App\Http\Requests\StoreEmployeeAttachmentsRequest;
use App\Http\Requests\StoreExpenseRequest;
use App\Http\Requests\StoreImportJobRequest;
use App\Http\Requests\StoreInvoiceNoteRequest;
use App\Http\Requests\StorePaymentRequest;
use App\Http\Requests\StoreProductCategoryRequest;
use App\Http\Requests\StoreProductMediaRequest;
use App\Http\Requests\StorePurchaseAttachmentsRequest;
use App\Http\Requests\UploadEmployeePhotoRequest;
use Tests\TestCase;

/**
 * AWJ-UPLOAD-PHP-LIMITS-1 — حارس الانحراف بين حدود PHP وحدود التطبيق.
 *
 * الصورة الإنتاجية بلا php.ini، فكان الافتراضي 2M/8M يرفض ما يسمح به التطبيق
 * قبل أن يصل Laravel («The media.0 failed to upload.»). هذا الاختبار يشتق
 * الحدّ المطلوب من القواعد الفعلية (FormRequests + config) ويقارنه بملف
 * `deploy/php/awj-uploads.ini` المنسوخ إلى الصورة، في الاتجاهين:
 *   - الأدنى: لا يرفض PHP ملفاً/طلباً يقبله التطبيق.
 *   - الأعلى: لا تُرفع الحدود فوق المبرَّر (سقف مرن 25% / 50%).
 * فأي تعديل لاحق على حدّ وحدةٍ ما يفشل هنا حتى يُراجَع ملف الـini معه.
 *
 * هذا الاختبار لا يثبت سلوك PHP نفسه — ذلك في PhpUploadRuntimeTest (محرك PHP
 * حقيقي) وفي runtime-smoke (Apache/mod_php داخل الصورة).
 *
 * تشغيل: php artisan test --filter=PhpUploadLimitsContractTest
 */
class PhpUploadLimitsContractTest extends TestCase
{
    private const INI_PATH = 'deploy/php/awj-uploads.ini';

    /** @return array<string,string> */
    private function ini(): array
    {
        $path = base_path(self::INI_PATH);
        $this->assertFileExists($path, 'deploy/php/awj-uploads.ini must be assembled next to the app (ci.yml / setup.sh copy list).');
        $parsed = parse_ini_file($path, false, INI_SCANNER_RAW);
        $this->assertIsArray($parsed);

        return array_map(static fn ($v) => trim((string) $v), $parsed);
    }

    private function bytes(string $shorthand): int
    {
        $this->assertMatchesRegularExpression('/^\d+[KMG]?$/i', $shorthand, "unparseable ini size: {$shorthand}");
        $n = (int) $shorthand;

        return match (strtoupper(substr($shorthand, -1))) {
            'G' => $n * 1024 ** 3,
            'M' => $n * 1024 ** 2,
            'K' => $n * 1024,
            default => $n,
        };
    }

    /** @param list<mixed> $rules */
    private function maxOf(array $rules): ?int
    {
        foreach ($rules as $rule) {
            if (is_string($rule) && preg_match('/^max:(\d+)$/', $rule, $m) === 1) {
                return (int) $m[1];
            }
        }

        return null;
    }

    /**
     * @return array<string,array{perFileBytes:int,files:int}>
     */
    private function requirements(): array
    {
        // [FormRequest, حقل الملف (قاعدة max بالكيلوبايت), حقل المصفوفة (قاعدة max بالعدد) أو null]
        $descriptors = [
            'product media' => [StoreProductMediaRequest::class, 'media.*', 'media'],
            'category image' => [StoreProductCategoryRequest::class, 'image', null],
            'employee photo' => [UploadEmployeePhotoRequest::class, 'photo', null],
            'employee attachments' => [StoreEmployeeAttachmentsRequest::class, 'attachments.*', 'attachments'],
            'expense attachments' => [StoreExpenseRequest::class, 'attachments.*', 'attachments'],
            'payment attachments' => [StorePaymentRequest::class, 'attachments.*', 'attachments'],
            'purchase attachments' => [StorePurchaseAttachmentsRequest::class, 'attachments.*', 'attachments'],
            'invoice note attachments' => [StoreInvoiceNoteRequest::class, 'attachments.*', 'attachments'],
            'document center file' => [StoreDocumentFileRequest::class, 'file', null],
            'import job file' => [StoreImportJobRequest::class, 'file', null],
        ];

        $out = [];
        foreach ($descriptors as $label => [$class, $fileKey, $countKey]) {
            $rules = (new $class)->rules();
            $this->assertArrayHasKey($fileKey, $rules, "{$label}: rule {$fileKey} missing");
            $kb = $this->maxOf($rules[$fileKey]);
            $this->assertNotNull($kb, "{$label}: no max: rule on {$fileKey} — PHP limit cannot be derived");

            $files = 1;
            if ($countKey !== null) {
                $files = $this->maxOf($rules[$countKey]);
                $this->assertNotNull($files, "{$label}: no max: count rule on {$countKey}");
            }

            $out[$label] = ['perFileBytes' => $kb * 1024, 'files' => $files];
        }

        // مكتبة المتجر: القيود في config لا في FormRequest.
        $out['storefront media'] = [
            'perFileBytes' => (int) config('storefront_media.max_bytes'),
            'files' => (int) config('storefront_media.max_files_per_request'),
        ];

        return $out;
    }

    /** @test */
    public function the_ini_declares_every_upload_directive_the_runtime_depends_on(): void
    {
        $ini = $this->ini();

        foreach (['file_uploads', 'upload_max_filesize', 'post_max_size', 'max_file_uploads', 'memory_limit'] as $key) {
            $this->assertArrayHasKey($key, $ini, "{$key} must be set explicitly in awj-uploads.ini");
        }
        $this->assertSame('On', $ini['file_uploads']);
    }

    /** @test */
    public function upload_max_filesize_covers_the_largest_single_file_any_module_accepts_and_no_more(): void
    {
        $largest = max(array_column($this->requirements(), 'perFileBytes'));
        $limit = $this->bytes($this->ini()['upload_max_filesize']);

        $this->assertGreaterThanOrEqual($largest, $limit, 'PHP would reject a file the application accepts (UPLOAD_ERR_INI_SIZE).');
        $this->assertLessThanOrEqual((int) ($largest * 1.25), $limit, 'upload_max_filesize raised beyond what any module needs.');
    }

    /** @test */
    public function post_max_size_covers_the_largest_multi_file_request_with_multipart_headroom_and_no_more(): void
    {
        $requirements = $this->requirements();
        $largestRequest = max(array_map(static fn (array $r) => $r['perFileBytes'] * $r['files'], $requirements));
        $limit = $this->bytes($this->ini()['post_max_size']);

        $this->assertGreaterThanOrEqual((int) ceil($largestRequest * 1.05), $limit, 'PHP would drop the whole body (empty $_FILES) of a request the application accepts.');
        $this->assertLessThanOrEqual((int) ($largestRequest * 1.5), $limit, 'post_max_size raised beyond what any module needs.');
        $this->assertGreaterThanOrEqual($this->bytes($this->ini()['upload_max_filesize']), $limit);
    }

    /** @test */
    public function max_file_uploads_covers_the_largest_file_count_per_request_and_no_more(): void
    {
        $most = max(array_column($this->requirements(), 'files'));
        $limit = (int) $this->ini()['max_file_uploads'];

        $this->assertGreaterThanOrEqual($most, $limit);
        $this->assertLessThanOrEqual($most * 2, $limit);
    }

    /** @test */
    public function memory_limit_is_the_agreed_ceiling(): void
    {
        $limit = $this->bytes($this->ini()['memory_limit']);

        // 256M مطلوب (فكّ صورتين كاملتين لكل مشتق + مرفقات)؛ سقف 512M كي لا يُرفع بلا مبرّر.
        $this->assertGreaterThanOrEqual(256 * 1024 ** 2, $limit);
        $this->assertLessThanOrEqual(512 * 1024 ** 2, $limit);
    }

    /** @test */
    public function the_application_limits_themselves_are_unchanged(): void
    {
        // «حافظ على حدود التحقق» — تثبيت صريح لحدود هذه الحزمة كي لا يُوسَّع أي منها
        // سهواً عبر رفع الـini.
        $r = $this->requirements();

        $this->assertSame(5120 * 1024, $r['product media']['perFileBytes']);
        $this->assertSame(8, $r['product media']['files']);
        $this->assertSame(5120 * 1024, $r['category image']['perFileBytes']);
        $this->assertSame(5120 * 1024, $r['employee photo']['perFileBytes']);
        foreach (['employee attachments', 'expense attachments', 'payment attachments', 'purchase attachments', 'invoice note attachments'] as $label) {
            $this->assertSame(10240 * 1024, $r[$label]['perFileBytes'], $label);
            $this->assertSame(10, $r[$label]['files'], $label);
        }
        $this->assertSame(20480 * 1024, $r['document center file']['perFileBytes']);
        $this->assertSame(5120 * 1024, $r['import job file']['perFileBytes']);
        $this->assertSame(5 * 1024 * 1024, $r['storefront media']['perFileBytes']);
    }
}
