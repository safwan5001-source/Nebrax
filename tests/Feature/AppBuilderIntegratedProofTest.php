<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Services\AppBuilder\DataResourceRegistry;
use App\Services\AppBuilder\RuntimeCapabilities;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * APP-BUILDER-11 — إثبات رأسي متكامل على العقد الحقيقي المقبول اليوم فقط.
 *
 * أعاد المالك تعريف نطاق هذه المهمة صراحةً (قرار 2026-09-24، الخيار 2):
 * إثبات إنشاء → تحرير → مزامنة تصميم المتجر → صفحات/تنقّل/قوالب → فحص →
 * نشر → نسخة منشورة ثابتة → استرجاع لمسودة → إعادة فحص → نشر مجدَّداً،
 * باستخدام السلوك الحقيقي المبني فعلاً حصراً. **لا** يثبت هذا الاختبار
 * ربط مورد Commerce حيّ ولا تنفيذ إجراء تجاري فعلي على وقت التشغيل —
 * ذلك مؤجَّل صراحةً مع APP-BUILDER-7 (انظر التقرير والـTASK-QUEUE).
 *
 * تشغيل: php artisan test --filter=AppBuilderIntegratedProofTest
 */
class AppBuilderIntegratedProofTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /**
     * مطابق حرفياً لقالب "Catalog" الحقيقي المشحون
     * (`web/src/modules/app-builder/templates.ts`) — صفحتان، مكوّنات
     * حقيقية فقط (`Section`/`Text`/`ProductList`/`ProductCard`/`Button`/
     * `CartList`/`CartSummary`)، وإجراء `navigate` حقيقي بين الصفحتين.
     *
     * @return array<string, mixed>
     */
    private function catalogTemplateSchema(): array
    {
        return [
            'schemaVersion' => '1.0.0',
            'minRuntimeVersion' => '1.0.0',
            'navigation' => ['initialPageId' => 'home'],
            'theme' => ['tokens' => []],
            'pages' => [
                'home' => [
                    'type' => 'Page',
                    'id' => 'home-root',
                    'children' => [
                        [
                            'type' => 'Section',
                            'id' => 'sec-featured',
                            'props' => ['title' => 'Featured products'],
                            'children' => [
                                [
                                    'type' => 'ProductList',
                                    'id' => 'list-featured',
                                    'children' => [
                                        ['type' => 'ProductCard', 'id' => 'pc-1', 'props' => ['title' => 'Product 1', 'amountMinor' => 9900]],
                                        ['type' => 'ProductCard', 'id' => 'pc-2', 'props' => ['title' => 'Product 2', 'amountMinor' => 14900]],
                                    ],
                                ],
                            ],
                        ],
                        [
                            'type' => 'Button',
                            'id' => 'btn-cart',
                            'props' => ['label' => 'View cart', 'style' => 'secondary'],
                            'action' => ['type' => 'navigate', 'params' => ['pageId' => 'cart']],
                        ],
                    ],
                ],
                'cart' => [
                    'type' => 'Page',
                    'id' => 'cart-root',
                    'children' => [
                        [
                            'type' => 'CartList',
                            'id' => 'cart-list',
                            'children' => [['type' => 'CartSummary', 'id' => 'cart-summary']],
                        ],
                    ],
                ],
            ],
        ];
    }

    /** أقلّ إعداد متجر حقيقي كافٍ لمسار «استخدام تصميم متجري» — نفس نمط StorefrontPresentationDraftApiTest، بلا نطاق. */
    private function seedWebStorefront(string $tenantId): string
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id,
            'is_active' => true, 'default_locale' => 'ar',
        ]);

        app(TenantContext::class)->forget();

        return $storefront->id;
    }

    /** @test */
    public function full_lifecycle_create_edit_theme_sync_pages_validate_publish_restore_revalidate_publish_again(): void
    {
        $auth = $this->registerTenant('appb11-lifecycle', 'owner@appb11-lifecycle.test');
        $storefrontId = $this->seedWebStorefront($auth['tenant_id']);

        // 1) إنشاء — مسار "قالب" ينتج غلافاً آمناً أدنى (مطابق لسلوك APP-BUILDER-1/4 الحقيقي).
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'متجري', 'name_en' => 'My Store', 'creation_source' => 'template',
        ])->assertCreated()->json('data.id');

        // 2) تحرير — تطبيق مخطط القالب الحقيقي (صفحتان + إجراء navigate حقيقي).
        $draft = $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $this->catalogTemplateSchema()])
            ->assertOk();
        $draft->assertJsonPath('data.revision', 1);
        $draft->assertJsonPath('data.schema.pages.cart.type', 'Page');

        // 3) "استخدام تصميم متجري" — اكتشاف حقيقي من مساحة عمل Commerce الحقيقية.
        $stores = $this->withToken($auth['token'])->getJson('/api/commerce/workspace/storefronts')->assertOk();
        $this->assertContains($storefrontId, array_column($stores->json('data.stores'), 'id'));

        $presentation = $this->withToken($auth['token'])
            ->getJson("/api/commerce/workspace/storefronts/{$storefrontId}/presentation")
            ->assertOk();
        $presentation->assertJsonPath('data.draft.primaryColor', '#12372a');

        $schemaWithTheme = $this->catalogTemplateSchema();
        $schemaWithTheme['theme']['tokens'] = [
            'primaryColor' => $presentation->json('data.draft.primaryColor'),
            'radius' => $presentation->json('data.draft.radius'),
            'density' => $presentation->json('data.draft.density'),
            'themePreset' => $presentation->json('data.draft.themePreset'),
        ];
        $draft = $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schemaWithTheme])
            ->assertOk();
        $draft->assertJsonPath('data.revision', 2);
        $draft->assertJsonPath('data.schema.theme.tokens.primaryColor', '#12372a');

        // 4) صفحات/تنقّل — إضافة صفحة ثالثة وتحويل الصفحة الرئيسية إليها ثم إعادتها،
        //    مثبتاً أن كلا الاتجاهين يمرّان عبر نفس محرّك التحقق (AppSchemaParser).
        $schemaWithThirdPage = $schemaWithTheme;
        $schemaWithThirdPage['pages']['about'] = [
            'type' => 'Page', 'id' => 'about-root',
            'children' => [['type' => 'Text', 'id' => 'about-text', 'props' => ['text' => 'من نحن']]],
        ];
        $schemaWithThirdPage['navigation']['initialPageId'] = 'about';
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schemaWithThirdPage])
            ->assertOk()
            ->assertJsonPath('data.schema.navigation.initialPageId', 'about');

        $schemaBackToHome = $schemaWithThirdPage;
        $schemaBackToHome['navigation']['initialPageId'] = 'home';
        $draft = $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schemaBackToHome])
            ->assertOk();
        $draft->assertJsonPath('data.revision', 4);
        $draft->assertJsonPath('data.schema.navigation.initialPageId', 'home');
        $finalDraftSchema = $draft->json('data.schema');

        // 5) فحص صريح بلا نشر.
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/validate")
            ->assertOk()->assertJsonPath('data.valid', true);
        $this->assertDatabaseCount('builder_published_experience_versions', 0);

        // 6) نشر — نسخة أولى ثابتة.
        $v1 = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['note' => 'الإطلاق الأول'])
            ->assertCreated();
        $v1->assertJsonPath('data.version', 1);
        $v1->assertJsonPath('data.published_by_name', 'المالك');
        $v1Schema = $v1->json('data.schema');
        $this->assertSame($finalDraftSchema, $v1Schema);

        // 7) تحرير إضافي بعد النشر ثم نشر ثانٍ — يثبت أن التحرير لا يمسّ النسخة الثابتة.
        $schemaEdited = $schemaBackToHome;
        $schemaEdited['pages']['home']['children'][1]['props']['label'] = 'عرض السلة';
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schemaEdited])
            ->assertOk();

        $v2 = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertCreated();
        $v2->assertJsonPath('data.version', 2);

        $v1AfterV2 = $this->withToken($auth['token'])
            ->getJson("/api/app-builder/apps/{$appId}/versions/1")->assertOk();
        $this->assertSame($v1Schema, $v1AfterV2->json('data.schema'), 'نشر نسخة جديدة يجب ألا يغيّر النسخة الأولى الثابتة.');
        $v1AfterV2->assertJsonPath('data.schema.pages.home.children.1.props.label', 'View cart');

        // 8) استرجاع (Rollback) — كتابة مخطط النسخة الأولى التاريخي إلى المسودة، بلا نشر تلقائي.
        $restoreResponse = $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $v1Schema])
            ->assertOk();
        $restoreResponse->assertJsonPath('data.schema.pages.home.children.1.props.label', 'View cart');
        // الاسترجاع كتابةٌ على المسودة فقط — لا يُنشئ نسخة جديدة من تلقاء نفسه.
        $this->assertDatabaseCount('builder_published_experience_versions', 2);

        // 9) إعادة فحص بعد الاسترجاع، ثم نشر — نسخة ثالثة، مطابقة تماماً للمسترجَعة.
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/validate")
            ->assertOk()->assertJsonPath('data.valid', true);

        $v3 = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['note' => 'استرجاع مُعاد نشره'])
            ->assertCreated();
        $v3->assertJsonPath('data.version', 3);
        $this->assertSame($v1Schema, $v3->json('data.schema'));

        $list = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/versions")->assertOk();
        $list->assertJsonCount(3, 'data');
    }

    /** @test */
    public function full_lifecycle_denies_every_step_across_tenants(): void
    {
        $tenantA = $this->registerTenant('appb11-tenant-a', 'owner@appb11-tenant-a.test');
        $tenantB = $this->registerTenant('appb11-tenant-b', 'owner@appb11-tenant-b.test');

        $appId = $this->withToken($tenantA['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق أ', 'creation_source' => 'scratch',
        ])->json('data.id');
        $this->withToken($tenantA['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['note' => 'v1'])
            ->assertCreated();

        $bToken = $tenantB['token'];
        $this->withToken($bToken)->getJson("/api/app-builder/apps/{$appId}")->assertStatus(404);
        $this->withToken($bToken)->getJson("/api/app-builder/apps/{$appId}/draft")->assertStatus(404);
        $this->withToken($bToken)->putJson("/api/app-builder/apps/{$appId}/draft", [
            'schema' => \App\Models\BuilderDraftExperience::minimalSafeSchema(),
        ])->assertStatus(404);
        $this->withToken($bToken)->postJson("/api/app-builder/apps/{$appId}/validate")->assertStatus(404);
        $this->withToken($bToken)->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(404);
        $this->withToken($bToken)->getJson("/api/app-builder/apps/{$appId}/versions")->assertStatus(404);
        $this->withToken($bToken)->getJson("/api/app-builder/apps/{$appId}/versions/1")->assertStatus(404);
    }

    /** @test */
    public function full_lifecycle_denies_every_mutating_step_to_a_role_without_app_builder_permissions(): void
    {
        $auth = $this->registerTenant('appb11-rbac', 'owner@appb11-rbac.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();

        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@appb11-rbac.test');

        $this->withToken($staffToken)->postJson('/api/app-builder/apps', ['name' => 'x', 'creation_source' => 'scratch'])
            ->assertForbidden();
        $this->withToken($staffToken)->putJson("/api/app-builder/apps/{$appId}/draft", [
            'schema' => \App\Models\BuilderDraftExperience::minimalSafeSchema(),
        ])->assertForbidden();
        $this->withToken($staffToken)->postJson("/api/app-builder/apps/{$appId}/validate")->assertForbidden();
        $this->withToken($staffToken)->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertForbidden();

        // القراءة أيضاً محظورة على staff (لا يملك apps_builder.view) — لا فقط التحرير.
        $this->withToken($staffToken)->getJson("/api/app-builder/apps/{$appId}")->assertForbidden();
        $this->withToken($staffToken)->getJson("/api/app-builder/apps/{$appId}/versions")->assertForbidden();
    }

    /**
     * الحدّ المعماري، مُحدَّثٌ بعد `ADR-01` (Commerce Data & Dynamic Runtime V1)
     * وتفعيل الخادم الفعلي (`APP-BUILDER-17` slice 3c، بعد إثبات تشغيل الجوال
     * الحقيقي وشحنه — PR #1006): هذا الإثبات الرأسي المتكامل **يعبر الآن**
     * فعلياً إلى حفظ (Draft) وفحص (Validate) ونشرٍ فعلي حقيقي
     * (`POST .../versions`) لربطٍ بمورد يستهلكه بناء الجوال المُثبَت فعلياً —
     * `commerce.products`. **هذا قبولٌ بنيويٌّ وتخزينٌ فقط، لا إثباتَ تشغيلٍ
     * حقيقي على أي جهاز**: لا يستدعي هذا الاختبار `CompatibilityResolver`،
     * ولا يشغّل زمن تشغيل Dart، ولا يثبت أي عرض (rendering). مفتاح `bindings`
     * (بالجمع، خطأ إملائي) يبقى مرفوضاً بنيوياً دوماً — فقط `binding`
     * (بالإفراد) هو المفتاح الحقيقي.
     *
     * تصحيحٌ (RUNTIME-CORRECTNESS-1/2، 2026-09-26): `itemProps` في هذا
     * المخطط غير مُستهلَكة أصلاً على زمن التشغيل الحقيقي لهذا الشكل —
     * `binding_resolution.dart` يعامل مورداً شكله السلكي مصفوفة أصلاً (مثل
     * `commerce.products`) عبر مسار "تكرار قالب" (`_repeatTemplate`)، فيتجاهل
     * `itemProps` كلياً؛ ولأن هذا المخطط لا يُصرّح بأي طفل-قالب (`children`)
     * لهذا العنصر، لكان سيعرض صفراً من العناصر لو وصل فعلاً إلى جهاز حقيقي.
     * الإثبات الحقيقي لتكرار `ProductList`/`CartList` على زمن التشغيل موجود
     * في `mobile/test/app/awj_runtime_shell_startup_test.dart` (المجموعة E)،
     * على العقد الحقيقي (`binding.resource` فقط، بلا `itemProps`، مع طفل-قالب
     * مُصرَّح).
     *
     * @test
     */
    public function integrated_proof_accepts_binding_structurally_and_now_publishes_a_shipped_resource_binding(): void
    {
        $auth = $this->registerTenant('appb11-boundary', 'owner@appb11-boundary.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        // مفتاح `bindings` (بالجمع) خطأ إملائي مرفوض بنيوياً دوماً.
        $misspelledSchema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $misspelledSchema['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'bound-text', 'bindings' => ['text' => 'commerce.products.0.title']],
        ];
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $misspelledSchema])
            ->assertStatus(422);

        // مفتاح `binding` (بالإفراد) الصحيح على مكوّن قابل للربط (`ProductList`)
        // بمورد يستهلكه بناء الجوال المُثبَت فعلياً (`commerce.products`) —
        // الحفظ (Draft)، الفحص (Validate)، والنشر الفعلي كلها تنجح الآن.
        $boundSchema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $boundSchema['pages']['home']['children'] = [
            ['type' => 'ProductList', 'id' => 'bound-list', 'binding' => [
                'resource' => 'commerce.products',
                'itemProps' => ['title' => 'name'],
            ]],
        ];
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $boundSchema])
            ->assertOk();
        $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/validate")
            ->assertOk()->assertJsonPath('data.valid', true);
        $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertCreated()
            ->assertJsonPath('data.schema.pages.home.children.0.binding.resource', 'commerce.products');

        // ADR-01 (APP-BUILDER-13): السجلّ يحمل نطاق V1 المُقفَل صراحةً —
        // ثلاثة موارد معروفة بنيوياً للخادم.
        $this->assertSame(
            ['commerce.categories', 'commerce.products', 'commerce.cart'],
            array_keys(DataResourceRegistry::RESOURCES),
        );

        // ADR-01 (APP-BUILDER-17 slice 3c): التشغيل المُثبَت فعلياً يستهلك
        // فقط ما أثبته — `commerce.products`/`commerce.cart` — لا
        // `commerce.categories`، رغم معرفة السجلّ به بنيوياً.
        $this->assertSame(
            ['commerce.products' => 1, 'commerce.cart' => 1],
            RuntimeCapabilities::DATA_RESOURCES,
        );
    }
}
