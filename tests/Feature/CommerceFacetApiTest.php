<?php

namespace Tests\Feature;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceProductFacetValue;
use App\Models\Product;
use App\Services\Commerce\CommerceFacetService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H2 / ADR-14 — الأبعاد الوصفية للكتالوج: CRUD، القيم، الإسناد المتعدد،
 * العزل بين المستأجرين، RBAC، حدود النمو، وعدم فقد الإسنادات عند التعطيل.
 *
 * تشغيل: php artisan test --filter=CommerceFacetApiTest
 */
class CommerceFacetApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/commerce/workspace/facets';

    private function makeProduct(string $tenantId, string $name = 'باقة ورد'): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => $name, 'type' => 'good', 'unit' => 'piece']);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function createFacet(string $token, array $over = []): array
    {
        return $this->withToken($token)->postJson(self::BASE, array_merge([
            'key' => 'occasion', 'system_key' => 'occasion', 'name' => 'المناسبة', 'name_en' => 'Occasion',
        ], $over))->assertCreated()->json('data.facet');
    }

    private function createValue(string $token, string $facetId, array $over = []): array
    {
        return $this->withToken($token)->postJson(self::BASE."/{$facetId}/values", array_merge([
            'name' => 'عيد ميلاد', 'name_en' => 'Birthday',
        ], $over))->assertCreated()->json('data.value');
    }

    /** @test */
    public function an_owner_can_create_a_system_facet_and_values_and_list_them_with_counts(): void
    {
        $auth = $this->registerTenant('fx-crud', 'owner@fx-crud.test');
        $facet = $this->createFacet($auth['token']);
        $value = $this->createValue($auth['token'], $facet['id']);

        $this->assertSame('occasion', $facet['system_key']);
        $this->assertSame('birthday', $value['slug']); // مشتق من name_en
        $this->assertSame(0, $value['product_count']);

        $list = $this->withToken($auth['token'])->getJson(self::BASE)->assertOk();
        $this->assertSame('occasion', $list->json('data.facets.0.key'));
        $this->assertSame('birthday', $list->json('data.facets.0.values.0.slug'));
    }

    /** @test */
    public function keys_and_system_keys_are_unique_per_tenant_and_validated(): void
    {
        $auth = $this->registerTenant('fx-uniq', 'owner@fx-uniq.test');
        $this->createFacet($auth['token']);

        $this->withToken($auth['token'])->postJson(self::BASE, ['key' => 'occasion', 'name' => 'مكرر'])->assertStatus(409);
        $this->withToken($auth['token'])->postJson(self::BASE, ['key' => 'other', 'system_key' => 'occasion', 'name' => 'مكرر'])->assertStatus(409);

        foreach ([
            ['key' => 'Bad Key', 'name' => 'x'],
            ['key' => 'ok', 'name' => '   '],
            ['key' => 'ok', 'name' => 'x', 'system_key' => 'brand'],
            ['key' => 'ok', 'name' => 'x', 'sort_order' => -1],
        ] as $payload) {
            $this->withToken($auth['token'])->postJson(self::BASE, $payload)->assertStatus(422);
        }
    }

    /** @test */
    public function the_same_key_can_exist_in_two_tenants(): void
    {
        $a = $this->registerTenant('fx-two-a', 'owner@fx-two-a.test');
        $b = $this->registerTenant('fx-two-b', 'owner@fx-two-b.test');

        $this->createFacet($a['token']);
        $this->createFacet($b['token']);

        $this->assertCount(1, $this->withToken($b['token'])->getJson(self::BASE)->json('data.facets'));
    }

    /** @test */
    public function duplicate_value_names_and_slugs_are_rejected_within_a_facet(): void
    {
        $auth = $this->registerTenant('fx-dup', 'owner@fx-dup.test');
        $facet = $this->createFacet($auth['token']);
        $this->createValue($auth['token'], $facet['id']);

        // الاسم نفسه بتطبيع مسافات/حالة أحرف
        $this->withToken($auth['token'])->postJson(self::BASE."/{$facet['id']}/values", ['name' => '  BIRTHDAY '])->assertStatus(409);
        $this->withToken($auth['token'])->postJson(self::BASE."/{$facet['id']}/values", ['name' => 'عيد ميلاد'])->assertStatus(409);
        // slug صريح مكرر
        $this->withToken($auth['token'])->postJson(self::BASE."/{$facet['id']}/values", ['name' => 'مختلف', 'slug' => 'birthday'])->assertStatus(409);
        // slug مشتق مصطدم يأخذ لاحقة
        $second = $this->createValue($auth['token'], $facet['id'], ['name' => 'حفلة', 'name_en' => 'Birthday!']);
        $this->assertSame('birthday-2', $second['slug']);
    }

    /** @test */
    public function an_arabic_only_value_gets_a_valid_ascii_slug(): void
    {
        $auth = $this->registerTenant('fx-ar', 'owner@fx-ar.test');
        $facet = $this->createFacet($auth['token']);

        $value = $this->withToken($auth['token'])->postJson(self::BASE."/{$facet['id']}/values", ['name' => 'تخرج'])->assertCreated()->json('data.value');

        // Str::slug يحوّل الحروف العربية صوتياً إلى ASCII؛ المهم أن النتيجة معرّف صالح غير فارغ.
        $this->assertMatchesRegularExpression('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $value['slug']);
    }

    /** @test */
    public function a_product_can_hold_several_values_across_facets_and_replace_is_idempotent(): void
    {
        $auth = $this->registerTenant('fx-assign', 'owner@fx-assign.test');
        $occasion = $this->createFacet($auth['token']);
        $recipient = $this->createFacet($auth['token'], ['key' => 'recipient', 'system_key' => 'recipient', 'name' => 'المُهدى إليه', 'name_en' => 'Recipient']);
        $birthday = $this->createValue($auth['token'], $occasion['id']);
        $graduation = $this->createValue($auth['token'], $occasion['id'], ['name' => 'تخرج', 'name_en' => 'Graduation']);
        $her = $this->createValue($auth['token'], $recipient['id'], ['name' => 'لها', 'name_en' => 'For her']);
        $product = $this->makeProduct($auth['tenant_id']);
        $url = "/api/commerce/workspace/products/{$product->id}/facets";

        $ids = [$birthday['id'], $graduation['id'], $her['id']];
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => $ids])->assertOk();
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => $ids])->assertOk();

        $got = $this->withToken($auth['token'])->getJson($url)->assertOk()->json('data.value_ids');
        $this->assertEqualsCanonicalizing($ids, $got);

        // الاستبدال يزيل ما غاب
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => [$her['id']]])->assertOk();
        $this->assertSame([$her['id']], $this->withToken($auth['token'])->getJson($url)->json('data.value_ids'));

        $list = $this->withToken($auth['token'])->getJson(self::BASE)->json('data.facets');
        $counts = collect($list)->flatMap(fn ($f) => $f['values'])->pluck('product_count', 'id');
        $this->assertSame(1, $counts[$her['id']]);
        $this->assertSame(0, $counts[$birthday['id']]);
    }

    /** @test */
    public function a_foreign_tenant_value_or_product_is_rejected_and_writes_nothing(): void
    {
        $a = $this->registerTenant('fx-iso-a', 'owner@fx-iso-a.test');
        $b = $this->registerTenant('fx-iso-b', 'owner@fx-iso-b.test');
        $facetB = $this->createFacet($b['token']);
        $valueB = $this->createValue($b['token'], $facetB['id']);
        $productA = $this->makeProduct($a['tenant_id']);
        $productB = $this->makeProduct($b['tenant_id'], 'منتج باء');

        // قيمة مستأجر آخر على منتجي
        $this->withToken($a['token'])->putJson("/api/commerce/workspace/products/{$productA->id}/facets", ['value_ids' => [$valueB['id']]])
            ->assertStatus(422);
        // منتج مستأجر آخر
        $this->withToken($a['token'])->putJson("/api/commerce/workspace/products/{$productB->id}/facets", ['value_ids' => []])
            ->assertNotFound();
        $this->withToken($a['token'])->getJson("/api/commerce/workspace/products/{$productB->id}/facets")->assertNotFound();
        // إدارة بُعد مستأجر آخر: 404 غير كاشف
        $this->withToken($a['token'])->putJson(self::BASE."/{$facetB['id']}", ['name' => 'استيلاء'])->assertNotFound();
        $this->withToken($a['token'])->deleteJson(self::BASE."/{$facetB['id']}")->assertNotFound();
        $this->withToken($a['token'])->postJson(self::BASE."/{$facetB['id']}/values", ['name' => 'x'])->assertNotFound();
        $this->withToken($a['token'])->putJson(self::BASE."/{$facetB['id']}/values/{$valueB['id']}", ['name' => 'x'])->assertNotFound();
        $this->withToken($a['token'])->deleteJson(self::BASE."/{$facetB['id']}/values/{$valueB['id']}")->assertNotFound();

        $this->assertSame(0, CommerceProductFacetValue::withoutGlobalScopes()->count());
        $this->assertSame('المناسبة', CommerceFacet::withoutGlobalScopes()->find($facetB['id'])->name);
    }

    /** @test */
    public function models_reject_cross_tenant_links_structurally(): void
    {
        $a = $this->registerTenant('fx-mod-a', 'owner@fx-mod-a.test');
        $b = $this->registerTenant('fx-mod-b', 'owner@fx-mod-b.test');
        $facetB = $this->createFacet($b['token']);
        $valueB = $this->createValue($b['token'], $facetB['id']);
        $productA = $this->makeProduct($a['tenant_id']);

        app(TenantContext::class)->set($a['tenant_id']);
        try {
            CommerceFacetValue::create(['commerce_facet_id' => $facetB['id'], 'slug' => 'x', 'name' => 'x']);
            $this->fail('value on a foreign facet was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        try {
            CommerceProductFacetValue::create(['product_id' => $productA->id, 'commerce_facet_value_id' => $valueB['id']]);
            $this->fail('assignment to a foreign value was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
    }

    /** @test */
    public function deactivating_keeps_assignments_and_blocks_new_ones_while_delete_is_refused_when_used(): void
    {
        $auth = $this->registerTenant('fx-deact', 'owner@fx-deact.test');
        $facet = $this->createFacet($auth['token']);
        $value = $this->createValue($auth['token'], $facet['id']);
        $other = $this->createValue($auth['token'], $facet['id'], ['name' => 'تخرج', 'name_en' => 'Graduation']);
        $product = $this->makeProduct($auth['tenant_id']);
        $url = "/api/commerce/workspace/products/{$product->id}/facets";
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => [$value['id']]])->assertOk();

        $this->withToken($auth['token'])->putJson(self::BASE."/{$facet['id']}/values/{$value['id']}", ['is_active' => false])->assertOk();
        $this->withToken($auth['token'])->putJson(self::BASE."/{$facet['id']}/values/{$other['id']}", ['is_active' => false])->assertOk();

        // الإسناد القائم باقٍ، والإبقاء عليه مسموح؛ إضافة معطَّل مرفوضة
        $this->assertSame([$value['id']], $this->withToken($auth['token'])->getJson($url)->json('data.value_ids'));
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => [$value['id']]])->assertOk();
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => [$value['id'], $other['id']]])->assertStatus(422);

        // الحذف مرفوض لقيمة/بُعد مستخدم، ومسموح لغير المستخدم
        $this->withToken($auth['token'])->deleteJson(self::BASE."/{$facet['id']}/values/{$value['id']}")->assertStatus(409);
        $this->withToken($auth['token'])->deleteJson(self::BASE."/{$facet['id']}")->assertStatus(409);
        $this->withToken($auth['token'])->deleteJson(self::BASE."/{$facet['id']}/values/{$other['id']}")->assertOk();

        // بُعد معطَّل لا تُسنَد قيمه الجديدة
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => []])->assertOk();
        $this->withToken($auth['token'])->putJson(self::BASE."/{$facet['id']}", ['is_active' => false])->assertOk();
        $this->withToken($auth['token'])->putJson(self::BASE."/{$facet['id']}/values/{$value['id']}", ['is_active' => true])->assertOk();
        $this->withToken($auth['token'])->putJson($url, ['value_ids' => [$value['id']]])->assertStatus(422);

        // بُعد غير مستخدم يُحذف مع قيمه
        $this->withToken($auth['token'])->deleteJson(self::BASE."/{$facet['id']}")->assertOk();
        $this->assertSame([], $this->withToken($auth['token'])->getJson(self::BASE)->json('data.facets'));
    }

    /** @test */
    public function system_key_and_key_are_immutable_on_update(): void
    {
        $auth = $this->registerTenant('fx-immut', 'owner@fx-immut.test');
        $facet = $this->createFacet($auth['token']);

        $res = $this->withToken($auth['token'])->putJson(self::BASE."/{$facet['id']}", [
            'name' => 'مناسبات', 'key' => 'hijack', 'system_key' => 'recipient', 'tenant_id' => 'x',
        ])->assertOk();

        $this->assertSame('مناسبات', $res->json('data.facet.name'));
        $this->assertSame('occasion', $res->json('data.facet.key'));
        $this->assertSame('occasion', $res->json('data.facet.system_key'));
    }

    /** @test */
    public function growth_limits_are_enforced(): void
    {
        $auth = $this->registerTenant('fx-limit', 'owner@fx-limit.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        for ($i = 0; $i < CommerceFacetService::MAX_FACETS; $i++) {
            CommerceFacet::create(['key' => "f{$i}", 'name' => "بُعد {$i}"]);
        }
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->postJson(self::BASE, ['key' => 'one-more', 'name' => 'زائد'])->assertStatus(409);
    }

    /** @test */
    public function rbac_staff_can_read_but_not_write_and_self_service_and_guests_are_denied(): void
    {
        $auth = $this->registerTenant('fx-rbac', 'owner@fx-rbac.test');
        $facet = $this->createFacet($auth['token']);
        $product = $this->makeProduct($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@fx-rbac.test');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@fx-rbac.test');

        $this->withToken($staff)->getJson(self::BASE)->assertOk();
        $this->withToken($staff)->postJson(self::BASE, ['key' => 'x', 'name' => 'x'])->assertForbidden();
        $this->withToken($staff)->putJson(self::BASE."/{$facet['id']}", ['name' => 'x'])->assertForbidden();
        $this->withToken($staff)->putJson("/api/commerce/workspace/products/{$product->id}/facets", ['value_ids' => []])->assertForbidden();

        $this->withToken($ss)->getJson(self::BASE)->assertForbidden();
        $this->withToken($ss)->postJson(self::BASE, ['key' => 'x', 'name' => 'x'])->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson(self::BASE)->assertUnauthorized();
        $this->postJson(self::BASE, ['key' => 'x', 'name' => 'x'])->assertUnauthorized();
    }

    /** @test */
    public function a_generic_tenant_with_no_facets_sees_an_empty_list(): void
    {
        $auth = $this->registerTenant('fx-empty', 'owner@fx-empty.test');

        $this->assertSame([], $this->withToken($auth['token'])->getJson(self::BASE)->assertOk()->json('data.facets'));
    }
}
