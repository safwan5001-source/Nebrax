<?php

namespace Tests\Feature;

use App\Http\Requests\PublicStoreInvoiceRequest;
use App\Http\Requests\PublicStorePartnerRequest;
use App\Http\Requests\PublicStoreProductRequest;
use App\Models\Branch;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiIdempotency;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Symfony\Component\Yaml\Yaml;
use Tests\TestCase;

/**
 * PR-6 (حرِج للدمج): اختبار مطابقة عقد OpenAPI 3.1 للـ Public API (v1).
 *
 * توثيقٌ فقط — لا يغيّر سلوكًا. يحرس أن ملف العقد
 * `docs/openapi/public-api-v1.yaml` **يطابق السطح الفعلي** (المسارات، الرموز،
 * الحقول، الـ scopes، idempotency) فلا ينحرف التوثيق عن الكود:
 *
 *  (أ) تحقّق بنيوي للـ OpenAPI (يُحلَّل، 3.1، كل `$ref` يُحَل، operationId فريد).
 *  (ب) **مطابقة المسارات/العقد (حرِجة للدمج):** كل مسار Public فعلي موثَّق،
 *      وكل عملية موثَّقة موجودة كمسار فعلي — بالطريقة نفسها والـ scope نفسه.
 *  (ج) حماية انحراف المخطّط: مفاتيح موارد القراءة تطابق مخطّطات القراءة،
 *      وحقول عقود الإنشاء تطابق مخطّطات الإنشاء، وكل POST يتطلّب Idempotency-Key.
 *  (د) تثبيتات عقدية موجّهة: رموز الأخطاء، حدود مفتاح idempotency، ومثال الصحّة
 *      مربوطة بالكود المصدر لا بأرقام مكتوبة يدويًا.
 *
 * تشغيل: php artisan test --filter=PublicApiOpenApiContractTest
 */
class PublicApiOpenApiContractTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const SPEC_PATH = 'docs/openapi/public-api-v1.yaml';

    /** @var array<string,mixed>|null العقد المُحلَّل (يُحمَّل مرّة). */
    private static ?array $spec = null;

    /** يُحمِّل ويحفظ العقد المُحلَّل. */
    private function spec(): array
    {
        if (self::$spec === null) {
            $this->assertTrue(
                class_exists(Yaml::class),
                'Symfony\Component\Yaml\Yaml مطلوب لتحقّق عقد OpenAPI (متاح في بيئة الاختبار عبر skeleton Laravel).',
            );

            $path = base_path(self::SPEC_PATH);
            $this->assertFileExists($path, "ملف عقد OpenAPI مفقود: {$path} — تأكّد من نسخه في سكربتات التجميع.");

            self::$spec = Yaml::parseFile($path);
        }

        return self::$spec;
    }

    // ── (أ) تحقّق بنيوي للـ OpenAPI ────────────────────────────────────

    /** @test */
    public function the_spec_is_a_well_formed_openapi_3_1_document(): void
    {
        $spec = $this->spec();

        $this->assertIsArray($spec, 'العقد يجب أن يُحلَّل إلى خريطة.');
        foreach (['openapi', 'info', 'paths', 'components'] as $key) {
            $this->assertArrayHasKey($key, $spec, "مفتاح المستوى الأعلى «{$key}» مفقود.");
        }

        $this->assertStringStartsWith('3.1', (string) $spec['openapi'], 'الإصدار يجب أن يكون OpenAPI 3.1.x.');
        $this->assertArrayHasKey('title', $spec['info']);
        $this->assertArrayHasKey('version', $spec['info']);
        $this->assertSame('v1', $spec['info']['version']);
    }

    /** @test */
    public function every_operation_has_a_unique_operation_id(): void
    {
        $ids = [];
        foreach ($this->operations() as $op) {
            $this->assertArrayHasKey('operationId', $op['operation'], "عملية {$op['method']} {$op['path']} بلا operationId.");
            $ids[] = $op['operation']['operationId'];
        }

        $this->assertNotEmpty($ids);
        $this->assertSame(array_values(array_unique($ids)), $ids, 'operationId مكرّر في العقد.');
    }

    /** @test */
    public function every_internal_ref_resolves(): void
    {
        $spec = $this->spec();
        $refs = [];
        $this->collectRefs($spec, $refs);

        $this->assertNotEmpty($refs, 'يُتوقَّع وجود مراجع $ref داخلية.');
        foreach (array_unique($refs) as $ref) {
            $this->assertStringStartsWith('#/', $ref, "مرجع خارجي غير مسموح في عقد مكتفٍ ذاتيًا: {$ref}");
            $this->assertNotNull($this->resolvePointer($spec, $ref), "مرجع $ref لا يُحَل: {$ref}");
        }
    }

    /** @test */
    public function the_server_url_is_templated_with_no_hardcoded_production_host(): void
    {
        $spec = $this->spec();
        $this->assertArrayHasKey('servers', $spec);
        $this->assertNotEmpty($spec['servers']);

        foreach ($spec['servers'] as $server) {
            $this->assertStringContainsString('{baseUrl}', $server['url'], 'عنوان الخادم يجب أن يكون قالبًا لا مضيفًا ثابتًا.');
        }
    }

    // ── (ب) مطابقة المسارات/العقد — حرِجة للدمج ─────────────────────────

    /**
     * @test
     *
     * كل مسار Public فعلي (GET/POST تحت `api/v1`) موثَّق في العقد، وكل عملية
     * موثَّقة موجودة كمسار فعلي — بالطريقة نفسها. لا مسار غير موثَّق (يتسرّب للعامة
     * بلا عقد)، ولا عملية موثَّقة وهميّة (توثيق يَعِد بما لا يوجد).
     */
    public function documented_paths_match_the_actual_public_route_surface_exactly(): void
    {
        $routeSurface = $this->publicRouteSurface();
        $specSurface = $this->specSurface();

        // لا مسار داخلي (`api/…` بلا `v1`) في مجموعة السطح — بناءً بنيويًّا:
        // السطح مقصورٌ على `api/v1/*`، وجزء المسار مجذورٌ بـ `/`.
        foreach (array_keys($routeSurface) as $combo) {
            [, $path] = explode(' ', $combo, 2);
            $this->assertStringStartsWith('/', $path, "سطح مسار غير متوقّع: {$combo}");
        }

        $missingFromSpec = array_diff(array_keys($routeSurface), array_keys($specSurface));
        $this->assertSame([], array_values($missingFromSpec), 'مسارات Public فعلية غير موثَّقة في العقد: ' . implode(', ', $missingFromSpec));

        $missingFromRoutes = array_diff(array_keys($specSurface), array_keys($routeSurface));
        $this->assertSame([], array_values($missingFromRoutes), 'عمليات موثَّقة بلا مسار فعلي مقابل: ' . implode(', ', $missingFromRoutes));
    }

    /**
     * @test
     *
     * الـ scope المُعلَن في العقد (`x-required-scope`) يطابق الـ scope المفروض
     * فعلًا عبر وسيط `EnsureApiScope` على المسار — فلا يَعِد التوثيق صلاحيةً غير
     * التي تُفرض. الصحّة العامة بلا scope في الطرفين.
     */
    public function documented_required_scope_matches_the_enforced_scope(): void
    {
        $routeSurface = $this->publicRouteSurface();
        $specSurface = $this->specSurface();

        foreach ($specSurface as $combo => $op) {
            $this->assertArrayHasKey($combo, $routeSurface, "لا مسار مقابل لـ {$combo}.");
            $this->assertSame(
                $routeSurface[$combo]['scope'],
                $op['scope'],
                "scope العقد لـ {$combo} لا يطابق الـ scope المفروض على المسار.",
            );
        }
    }

    /** @test */
    public function every_documented_write_operation_requires_an_idempotency_key(): void
    {
        $spec = $this->spec();
        $writes = 0;

        foreach ($this->operations() as $op) {
            if ($op['method'] !== 'POST') {
                continue;
            }
            $writes++;

            $names = [];
            foreach ($op['operation']['parameters'] ?? [] as $param) {
                $resolved = isset($param['$ref']) ? $this->resolvePointer($spec, $param['$ref']) : $param;
                if (($resolved['in'] ?? null) === 'header') {
                    $names[$resolved['name']] = (bool) ($resolved['required'] ?? false);
                }
            }

            $this->assertArrayHasKey('Idempotency-Key', $names, "عملية الكتابة {$op['path']} لا توثّق ترويسة Idempotency-Key.");
            $this->assertTrue($names['Idempotency-Key'], "ترويسة Idempotency-Key يجب أن تكون إلزامية في {$op['path']}.");
        }

        $this->assertSame(3, $writes, 'يُتوقَّع ثلاث عمليات كتابة (طرف/منتج/مسودّة فاتورة).');
    }

    // ── (ج) حماية انحراف المخطّط — القراءة (حيّة) ───────────────────────

    /** @test */
    public function partner_read_representation_matches_the_documented_schema(): void
    {
        $ctx = $this->seedReadContext(['partners:read']);

        $data = $this->withToken($ctx['token'])
            ->getJson("/api/v1/partners/{$ctx['partner']->id}")
            ->assertOk()
            ->json('data');

        $this->assertSameKeys($this->schemaProps('Partner'), $data, 'Partner');
        $this->assertSameKeys($this->schemaProps('PartnerAddress'), $data['address'], 'PartnerAddress');
    }

    /** @test */
    public function product_read_representation_matches_the_documented_schema(): void
    {
        $ctx = $this->seedReadContext(['products:read']);

        $data = $this->withToken($ctx['token'])
            ->getJson("/api/v1/products/{$ctx['product']->id}")
            ->assertOk()
            ->json('data');

        $this->assertSameKeys($this->schemaProps('Product'), $data, 'Product');
    }

    /** @test */
    public function invoice_summary_and_detail_representations_match_the_documented_schemas(): void
    {
        $ctx = $this->seedReadContext(['invoices:read', 'invoices:write']);
        $id = $this->createDraftInvoice($ctx);

        // ملخّص (القائمة تُحمِّل الطرف، فيظهر مفتاح partner كاملًا).
        $list = $this->withToken($ctx['token'])->getJson('/api/v1/invoices')->assertOk()->json('data');
        $this->assertNotEmpty($list, 'يُتوقَّع فاتورة واحدة على الأقل في القائمة.');
        $this->assertSameKeys($this->schemaProps('InvoiceSummary'), $list[0], 'InvoiceSummary');

        // تفاصيل = الملخّص + السطور.
        $detail = $this->withToken($ctx['token'])->getJson("/api/v1/invoices/{$id}")->assertOk()->json('data');
        $expectedDetailKeys = array_merge($this->schemaProps('InvoiceSummary'), ['lines']);
        $this->assertSameKeys($expectedDetailKeys, $detail, 'InvoiceDetail');

        $this->assertNotEmpty($detail['lines'], 'يُتوقَّع سطر واحد على الأقل.');
        $this->assertSameKeys($this->schemaProps('InvoiceLine'), $detail['lines'][0], 'InvoiceLine');
    }

    // ── (ج) حماية انحراف المخطّط — الإنشاء (ساكن) ───────────────────────

    /** @test */
    public function partner_create_schema_matches_the_request_allow_list(): void
    {
        [$fields, $required] = $this->requestFields((new PublicStorePartnerRequest())->rules());

        $this->assertSameKeys($this->schemaProps('PartnerCreate'), array_flip($fields), 'PartnerCreate');
        $this->assertSameSet($this->schemaRequired('PartnerCreate'), $required, 'PartnerCreate.required');
        $this->assertFalse($this->schemaAllowsAdditional('PartnerCreate'), 'PartnerCreate يجب أن يمنع الحقول الإضافية.');
    }

    /** @test */
    public function product_create_schema_matches_the_request_allow_list(): void
    {
        [$fields, $required] = $this->requestFields((new PublicStoreProductRequest())->rules());

        $this->assertSameKeys($this->schemaProps('ProductCreate'), array_flip($fields), 'ProductCreate');
        $this->assertSameSet($this->schemaRequired('ProductCreate'), $required, 'ProductCreate.required');
        $this->assertFalse($this->schemaAllowsAdditional('ProductCreate'), 'ProductCreate يجب أن يمنع الحقول الإضافية.');
    }

    /** @test */
    public function invoice_create_schema_matches_the_request_allow_list(): void
    {
        $rules = (new PublicStoreInvoiceRequest())->rules();

        // فصل حقول المستوى الأعلى عن حقول السطر (items.*.X).
        $top = [];
        $topRequired = [];
        $line = [];
        $lineRequired = [];

        foreach ($rules as $key => $rule) {
            $isRequired = in_array('required', $this->ruleTokens($rule), true);
            if (str_starts_with($key, 'items.*.')) {
                $field = substr($key, strlen('items.*.'));
                $line[] = $field;
                if ($isRequired) {
                    $lineRequired[] = $field;
                }
            } elseif (! str_contains($key, '.')) {
                $top[] = $key;
                if ($isRequired) {
                    $topRequired[] = $key;
                }
            }
        }

        $this->assertSameKeys($this->schemaProps('InvoiceCreate'), array_flip($top), 'InvoiceCreate');
        $this->assertSameSet($this->schemaRequired('InvoiceCreate'), $topRequired, 'InvoiceCreate.required');
        $this->assertFalse($this->schemaAllowsAdditional('InvoiceCreate'), 'InvoiceCreate يجب أن يمنع الحقول الإضافية.');

        $this->assertSameKeys($this->schemaProps('InvoiceLineCreate'), array_flip($line), 'InvoiceLineCreate');
        $this->assertSameSet($this->schemaRequired('InvoiceLineCreate'), $lineRequired, 'InvoiceLineCreate.required');
        $this->assertFalse($this->schemaAllowsAdditional('InvoiceLineCreate'), 'InvoiceLineCreate يجب أن يمنع الحقول الإضافية.');
    }

    // ── (د) تثبيتات عقدية موجّهة — العقد مربوط بالكود ───────────────────

    /** @test */
    public function the_documented_error_codes_match_the_error_code_enum(): void
    {
        $documented = $this->spec()['components']['schemas']['Error']['properties']['code']['enum'];
        $actual = array_map(fn (PublicApiErrorCode $c): string => $c->value, PublicApiErrorCode::cases());

        $this->assertSameSet($actual, $documented, 'رموز الأخطاء الموثَّقة يجب أن تطابق PublicApiErrorCode حرفيًّا.');
    }

    /** @test */
    public function the_documented_idempotency_key_bounds_match_the_source_constants(): void
    {
        $schema = $this->spec()['components']['parameters']['IdempotencyKey']['schema'];

        $this->assertSame(PublicApiIdempotency::KEY_MIN, $schema['minLength'], 'حدّ الطول الأدنى للمفتاح يجب أن يطابق KEY_MIN.');
        $this->assertSame(PublicApiIdempotency::KEY_MAX, $schema['maxLength'], 'حدّ الطول الأقصى للمفتاح يجب أن يطابق KEY_MAX.');

        // تثبيت سلوكي عند الحدود الموثَّقة.
        $this->assertTrue(PublicApiIdempotency::isValidKey(str_repeat('a', PublicApiIdempotency::KEY_MIN)));
        $this->assertFalse(PublicApiIdempotency::isValidKey(str_repeat('a', PublicApiIdempotency::KEY_MIN - 1)));
    }

    /** @test */
    public function the_health_example_matches_the_live_health_response(): void
    {
        $example = $this->spec()['paths']['/health']['get']['responses']['200']['content']['application/json']['example'];

        $live = $this->getJson('/api/v1/health')->assertOk()->json();

        $this->assertSame($example['data'], $live['data'], 'مثال الصحّة في العقد يجب أن يطابق الاستجابة الحيّة.');
    }

    // ══ مساعدات ═════════════════════════════════════════════════════════

    /**
     * السطح الفعلي للمسارات العامة: خريطة "METHOD /path" ⇒ ['scope' => ?string].
     * يقتصر على `api/v1/*` وأفعال HTTP الحقيقية (بلا HEAD/OPTIONS).
     *
     * @return array<string, array{scope: ?string}>
     */
    private function publicRouteSurface(): array
    {
        $surface = [];
        $verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/v1/') && $uri !== 'api/v1') {
                continue;
            }

            $path = substr($uri, strlen('api/v1')); // ⇒ /health · /partners · /partners/{id}
            $scope = $this->scopeFromMiddleware($route->gatherMiddleware());

            foreach (array_intersect($route->methods(), $verbs) as $method) {
                $surface["{$method} {$path}"] = ['scope' => $scope];
            }
        }

        return $surface;
    }

    /**
     * السطح الموثَّق: خريطة "METHOD /path" ⇒ ['scope' => ?string] من العقد.
     *
     * @return array<string, array{scope: ?string}>
     */
    private function specSurface(): array
    {
        $surface = [];
        foreach ($this->operations() as $op) {
            $surface["{$op['method']} {$op['path']}"] = [
                'scope' => $op['operation']['x-required-scope'] ?? null,
            ];
        }

        return $surface;
    }

    /** يستخرج وسيط `EnsureApiScope:{scope}` من قائمة وسائط المسار. */
    private function scopeFromMiddleware(array $middleware): ?string
    {
        foreach ($middleware as $m) {
            if (is_string($m) && preg_match('/EnsureApiScope:(.+)$/', $m, $matches) === 1) {
                return $matches[1];
            }
        }

        return null;
    }

    /**
     * يعدّد عمليات العقد (method كبيرة + path + جسم العملية).
     *
     * @return list<array{method: string, path: string, operation: array<string,mixed>}>
     */
    private function operations(): array
    {
        $methods = ['get', 'post', 'put', 'patch', 'delete'];
        $ops = [];

        foreach ($this->spec()['paths'] as $path => $item) {
            foreach ($methods as $method) {
                if (isset($item[$method])) {
                    $ops[] = ['method' => strtoupper($method), 'path' => $path, 'operation' => $item[$method]];
                }
            }
        }

        return $ops;
    }

    /** مفاتيح خصائص مخطّط مُسمّى تحت components.schemas. */
    private function schemaProps(string $name): array
    {
        $schema = $this->spec()['components']['schemas'][$name] ?? null;
        $this->assertNotNull($schema, "المخطّط «{$name}» مفقود من العقد.");
        $this->assertArrayHasKey('properties', $schema, "المخطّط «{$name}» بلا properties.");

        return array_keys($schema['properties']);
    }

    /** قائمة `required` لمخطّط مُسمّى (مصفوفة فارغة إن غابت). */
    private function schemaRequired(string $name): array
    {
        return $this->spec()['components']['schemas'][$name]['required'] ?? [];
    }

    /** هل يسمح المخطّط بحقول إضافية؟ (additionalProperties غير false). */
    private function schemaAllowsAdditional(string $name): bool
    {
        return ($this->spec()['components']['schemas'][$name]['additionalProperties'] ?? true) !== false;
    }

    /**
     * يفصل قواعد FormRequest إلى [كل الحقول، الحقول الإلزامية] لمفاتيح المستوى
     * الأعلى فقط (لا مفاتيح منقّطة).
     *
     * @return array{0: list<string>, 1: list<string>}
     */
    private function requestFields(array $rules): array
    {
        $fields = [];
        $required = [];
        foreach ($rules as $key => $rule) {
            if (str_contains($key, '.')) {
                continue;
            }
            $fields[] = $key;
            if (in_array('required', $this->ruleTokens($rule), true)) {
                $required[] = $key;
            }
        }

        return [$fields, $required];
    }

    /** يطبّع قاعدة (سلسلة أو مصفوفة) إلى قائمة رموز نصّية. */
    private function ruleTokens(mixed $rule): array
    {
        if (is_string($rule)) {
            return explode('|', $rule);
        }
        if (is_array($rule)) {
            return array_values(array_filter($rule, 'is_string'));
        }

        return [];
    }

    /** يجمع كل قيم `$ref` في الشجرة. */
    private function collectRefs(mixed $node, array &$refs): void
    {
        if (! is_array($node)) {
            return;
        }
        foreach ($node as $key => $value) {
            if ($key === '$ref' && is_string($value)) {
                $refs[] = $value;
            } else {
                $this->collectRefs($value, $refs);
            }
        }
    }

    /** يَحلّ مؤشّر JSON محلّي (`#/a/b/c`) إلى العقدة أو null. */
    private function resolvePointer(array $spec, string $ref): mixed
    {
        if (! str_starts_with($ref, '#/')) {
            return null;
        }
        $node = $spec;
        foreach (explode('/', substr($ref, 2)) as $segment) {
            $segment = str_replace(['~1', '~0'], ['/', '~'], $segment);
            if (! is_array($node) || ! array_key_exists($segment, $node)) {
                return null;
            }
            $node = $node[$segment];
        }

        return $node;
    }

    /** يؤكّد تطابق مجموعة المفاتيح (بلا اعتبار للترتيب) بين مخطّط ومصفوفة فعلية. */
    private function assertSameKeys(array $expectedKeys, array $actual, string $label): void
    {
        $this->assertSameSet($expectedKeys, array_keys($actual), "{$label}: مفاتيح");
    }

    /** يؤكّد تطابق مجموعتين بلا اعتبار للترتيب، مع تقرير الفروق. */
    private function assertSameSet(array $expected, array $actual, string $label): void
    {
        $missing = array_values(array_diff($expected, $actual));
        $extra = array_values(array_diff($actual, $expected));

        $this->assertSame([], $missing, "{$label}: عناصر موثَّقة/متوقّعة غائبة فعليًّا: " . implode(', ', $missing));
        $this->assertSame([], $extra, "{$label}: عناصر فعلية غير موثَّقة/غير متوقّعة: " . implode(', ', $extra));
    }

    /**
     * يهيّئ سياق قراءة: مستأجر + طرف + منتج + فرع رئيسي، ومفتاح API بالـ scopes.
     *
     * @return array{tenant: Tenant, token: string, partner: Partner, product: Product}
     */
    private function seedReadContext(array $scopes): array
    {
        $tenant = Tenant::create(['name' => 'acme', 'slug' => 'acme-' . Str::random(6)]);
        app(TenantContext::class)->set($tenant->id);
        $partner = Partner::create([
            'code' => 'C-' . Str::random(5), 'type' => 'customer', 'entity_type' => 'commercial',
            'name' => 'عميل المطابقة', 'is_active' => true,
        ]);
        $product = Product::create([
            'sku' => 'SKU-' . Str::random(6), 'name' => 'منتج المطابقة', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        Branch::create(['tenant_id' => $tenant->id, 'code' => 'MAIN', 'name' => 'الرئيسي', 'is_main' => true]);
        app(TenantContext::class)->forget();

        $service = app(ApiClientKeyService::class);
        $token = $service->issueKey($service->createClient($tenant, 'x'), 'k', $scopes)->plainTextToken;

        return compact('tenant', 'token', 'partner', 'product');
    }

    /** يُنشئ مسودّة فاتورة عبر المسار العام ويعيد معرّفها. */
    private function createDraftInvoice(array $ctx): string
    {
        return $this->withToken($ctx['token'])->postJson('/api/v1/invoices', [
            'partner_id' => $ctx['partner']->id,
            'items'      => [[
                'product_id'       => $ctx['product']->id,
                'quantity'         => 2,
                'unit_price_minor' => 10000,
                'tax_rate'         => 15,
            ]],
        ], ['Idempotency-Key' => 'contract-invoice-1'])->assertStatus(201)->json('data.id');
    }
}
