<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Http\Middleware\EnsureImportFilesScanned;
use App\Models\Product;
use App\Support\DocumentScanStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use ReflectionMethod;
use ReflectionNamedType;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H1-S4 — فحص ملفات الاستيراد عند القبول.
 *
 * (١) السلوك: `off` لا يلمس الفاحص إطلاقاً؛ `on` يفحص كل ملف **قبل** أي تحليل بفشلٍ مغلق (مصاب 422 · فاحص غير متاح 503).
 * (٢) الثابت: كل مسار يقبل ملفاً **ويعمل في الاستيراد** يحمل `EnsureImportFilesScanned` — يُعدَّد من قواعد `FormRequest` ومن مصدر المتحكّم، فلا يتخطّاه
 *     مجالٌ جديد. مسارات رفع ملفات غير الاستيراد مدرجة صراحةً في `NOT_IMPORT` بسببها (وتُفحَص أن الإدراج ما زال صحيحاً).
 */
class ImportIntakeGuardTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** مسارات تقبل ملفاً وليست استيراد جداول/أرشيف استيراد (لها مسارات قبول وفحص خاصة بها أو ليست بيانات أعمال). المفتاح `METHOD uri`. */
    private const NOT_IMPORT = [
        'POST api/document-batches/{batch}/files' => 'مركز المستندات: له مسار قبول وفحص أمني خاص به (DocumentSafetyScanner).',
        'POST api/products/{id}/media' => 'صورة/وسائط منتج مفرد، لا بيانات استيراد.',
        'POST api/product-categories' => 'صورة تصنيف، لا استيراد.',
        'PUT api/product-categories/{id}' => 'صورة تصنيف، لا استيراد.',
        'POST api/expenses' => 'مرفق مصروف (مستند أعمال)، لا استيراد.',
        'PUT api/expenses/{id}' => 'مرفق مصروف (مستند أعمال)، لا استيراد.',
        'POST api/invoices/{id}/notes' => 'مرفق ملاحظة فاتورة، لا استيراد.',
        'POST api/commerce/workspace/storefront-media' => 'مكتبة وسائط المتجر؛ لها خط معالجة صور وبوابة خاصة.',
        'POST api/payments' => 'مرفق سند دفع، لا استيراد.',
        'PUT api/payments/{id}' => 'مرفق سند دفع، لا استيراد.',
        'POST api/purchases/{id}/attachments' => 'مرفق مشترى، لا استيراد.',
        'POST api/employees/{id}/photo' => 'صورة موظف، لا استيراد.',
        'POST api/payment-methods/{id}/logo' => 'شعار طريقة دفع (صورة PNG/JPEG/WebP ≤ 1MB بلا SVG)، لا استيراد.',
        'POST api/employees/{id}/attachments' => 'مرفق موظف، لا استيراد.',
    ];

    protected function tearDown(): void
    {
        config(['imports.intake_scan.mode' => 'off']);
        parent::tearDown();
    }

    private function fakeScanner(DocumentScanStatus|\Throwable $result): object
    {
        $scanner = new class($result) implements DocumentSafetyScanner {
            public int $calls = 0;

            public function __construct(private readonly DocumentScanStatus|\Throwable $result) {}

            public function scan($stream): DocumentScanStatus
            {
                $this->calls++;
                if ($this->result instanceof \Throwable) {
                    throw $this->result;
                }

                return $this->result;
            }

            public function ping(): bool
            {
                return true;
            }

            public function providerName(): string
            {
                return 'fake';
            }
        };
        $this->app->instance(DocumentSafetyScanner::class, $scanner);

        return $scanner;
    }

    private function csv(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('catalog.csv', "sku,name,type,sale_price\nIG-1,منتج,good,10.00\n");
    }

    // ── السلوك ─────────────────────────────────────────────────────────────

    /** @test */
    public function with_the_policy_off_the_scanner_is_never_consulted(): void
    {
        $auth = $this->registerTenant();
        $scanner = $this->fakeScanner(DocumentScanStatus::INFECTED);

        $this->withToken($auth['token'])->post('/api/products/import/inspect', ['file' => $this->csv()], ['Accept' => 'application/json'])->assertOk();
        $this->assertSame(0, $scanner->calls);
    }

    /** @test */
    public function the_policy_key_exists_in_config_and_defaults_off(): void
    {
        $this->assertSame('off', (require base_path('config/imports.php'))['intake_scan']['mode'] ?? null, 'المفتاح `imports.intake_scan.mode` غائب أو غير مغلق افتراضياً.');
        $this->assertFalse(app(\App\Services\SpreadsheetIntakeGuard::class)->enabled());
    }

    /** @test */
    public function an_unrecognised_mode_value_enables_the_scan_instead_of_silently_skipping_it(): void
    {
        foreach (['on', 'On', ' ON ', 'true', '1', 'enabled'] as $mode) {
            config(['imports.intake_scan.mode' => $mode]);
            $this->assertTrue(app(\App\Services\SpreadsheetIntakeGuard::class)->enabled(), "«{$mode}» يجب أن يفعّل الفحص (فشل مغلق).");
        }
        foreach (['off', 'OFF', '', null] as $mode) {
            config(['imports.intake_scan.mode' => $mode]);
            $this->assertFalse(app(\App\Services\SpreadsheetIntakeGuard::class)->enabled(), 'القيمة '.var_export($mode, true).' تعني off.');
        }
    }

    /** @test */
    public function with_the_policy_on_a_clean_file_proceeds_and_is_scanned_first(): void
    {
        $auth = $this->registerTenant();
        config(['imports.intake_scan.mode' => 'on']);
        $scanner = $this->fakeScanner(DocumentScanStatus::CLEAN);

        $this->withToken($auth['token'])->post('/api/products/import/inspect', ['file' => $this->csv()], ['Accept' => 'application/json'])->assertOk();
        $this->assertSame(1, $scanner->calls);
    }

    /** @test */
    public function an_infected_file_is_refused_before_any_parsing_on_every_import_entry(): void
    {
        $auth = $this->registerTenant();
        config(['imports.intake_scan.mode' => 'on']);
        $scanner = $this->fakeScanner(DocumentScanStatus::INFECTED);

        foreach (['/api/products/import/inspect', '/api/products/import/preview', '/api/products/workbook/inspect', '/api/inventory-openings/import/inspect'] as $uri) {
            $this->withToken($auth['token'])->post($uri, ['file' => $this->csv()], ['Accept' => 'application/json'])->assertStatus(422);
        }
        $this->withToken($auth['token'])->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csv()], ['Accept' => 'application/json'])
            ->assertStatus(422);

        $this->assertGreaterThanOrEqual(5, $scanner->calls);
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, \App\Models\ImportJob::query()->count(), 'لا تشغيلة ولا ملف مخزَّن لملفٍ مصاب.');
    }

    /** @test */
    public function an_unavailable_or_unconfigured_scanner_fails_closed(): void
    {
        $auth = $this->registerTenant();
        config(['imports.intake_scan.mode' => 'on']);
        $this->fakeScanner(new RuntimeException('Malware scanner is not configured.'));

        $response = $this->withToken($auth['token'])->post('/api/products/import/inspect', ['file' => $this->csv()], ['Accept' => 'application/json'])->assertStatus(503);
        $this->assertStringNotContainsString('Malware', (string) $response->getContent(), 'لا تسريب لتفاصيل الفاحص.');
    }

    /** @test */
    public function a_non_clean_status_other_than_infected_is_also_refused(): void
    {
        $auth = $this->registerTenant();
        config(['imports.intake_scan.mode' => 'on']);
        $this->fakeScanner(DocumentScanStatus::FAILED);

        $this->withToken($auth['token'])->post('/api/products/import/inspect', ['file' => $this->csv()], ['Accept' => 'application/json'])->assertStatus(503);
    }

    /** @test */
    public function every_uploaded_file_in_the_request_is_scanned_including_the_image_archive(): void
    {
        $auth = $this->registerTenant();
        config(['imports.intake_scan.mode' => 'on']);
        $scanner = $this->fakeScanner(DocumentScanStatus::CLEAN);

        $this->withToken($auth['token'])->post('/api/products/import/inspect', [
            'file' => $this->csv(),
            'media_archive' => UploadedFile::fake()->createWithContent('images.zip', 'PK'),
        ], ['Accept' => 'application/json']);

        $this->assertSame(2, $scanner->calls, 'الملف وأرشيف الصور كلاهما يُفحَص (حتى لو رُفض التحقق لاحقاً).');
    }

    // ── الثابت ─────────────────────────────────────────────────────────────

    /** @test */
    public function every_import_route_that_accepts_a_file_carries_the_intake_guard(): void
    {
        $missing = [];
        $seenExclusions = [];
        $guarded = 0;

        foreach (Route::getRoutes() as $route) {
            /** @var RoutingRoute $route */
            if (! array_intersect($route->methods(), ['POST', 'PUT', 'PATCH'])) {
                continue;
            }
            if (! $this->acceptsAFile($route)) {
                continue;
            }
            $key = $route->methods()[0].' '.$route->uri();
            $isGuarded = in_array(EnsureImportFilesScanned::class, $route->gatherMiddleware(), true);
            if (array_key_exists($key, self::NOT_IMPORT)) {
                $seenExclusions[] = $key;
                $this->assertFalse($isGuarded, "{$key} مدرجٌ كغير-استيراد لكنه محروس — أزل الإدراج.");

                continue;
            }
            if ($isGuarded) {
                $guarded++;

                continue;
            }
            $missing[] = $key;
        }

        $this->assertSame([], $missing, "مسارات تقبل ملفاً بلا `EnsureImportFilesScanned` (أضفه، أو أدرجها في NOT_IMPORT بسببها):\n".implode("\n", $missing));
        $this->assertSame([], array_values(array_diff(array_keys(self::NOT_IMPORT), $seenExclusions)), 'إدراجٌ قديم في NOT_IMPORT لمسارٍ لم يعد يقبل ملفاً أو لم يعد موجوداً.');
        $this->assertGreaterThanOrEqual(11, $guarded, 'عدد مسارات الاستيراد المحروسة أقل من المتوقع.');
    }

    private function acceptsAFile(RoutingRoute $route): bool
    {
        $action = $route->getActionName();
        if ($action === 'Closure' || ! str_contains($action, '@')) {
            return false;
        }
        [$class, $method] = explode('@', $action);
        if (! class_exists($class) || ! method_exists($class, $method)) {
            return false;
        }
        $reflection = new ReflectionMethod($class, $method);

        foreach ($reflection->getParameters() as $parameter) {
            $type = $parameter->getType();
            if (! $type instanceof ReflectionNamedType || $type->isBuiltin()) {
                continue;
            }
            $requestClass = $type->getName();
            if (is_subclass_of($requestClass, FormRequest::class) && $this->rulesDeclareAFile($requestClass)) {
                return true;
            }
        }

        // متحكّمٌ يقرأ الملف من `Request` عاديّ بلا FormRequest.
        $source = implode('', array_slice(file((string) $reflection->getFileName()) ?: [], $reflection->getStartLine() - 1, $reflection->getEndLine() - $reflection->getStartLine() + 1));

        return (bool) preg_match('/->(file|hasFile|allFiles)\(/', $source);
    }

    private function rulesDeclareAFile(string $requestClass): bool
    {
        try {
            $rules = (new $requestClass)->rules();
        } catch (\Throwable $e) {
            // `rules()` يحتاج سياق طلبٍ/مستأجر (مثل `StoreProductRequest`): لا نُسقط المسار بصمت ولا نفشل، بل نفحص **مصدر الصنف** استاتيكياً.
            $source = (string) file_get_contents((new \ReflectionClass($requestClass))->getFileName());

            return (bool) preg_match("/['\"](file|image|mimes:[^'\"]*|mimetypes:[^'\"]*)['\"]/", $source);
        }

        foreach ($rules as $rule) {
            foreach ((array) $rule as $part) {
                if (is_string($part) && preg_match('/^(file|image|mimes:|mimetypes:)/', $part)) {
                    return true;
                }
            }
        }

        return false;
    }
}
