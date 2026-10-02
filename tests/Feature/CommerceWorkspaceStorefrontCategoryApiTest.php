<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-H2-4 — Workspace Category read API (قائمة/تفصيل) لمنتقي "معاينة
 * تصنيف" في مُخصِّص صفحة التصنيف. نسخة طبق الأصل من
 * `CommerceWorkspaceStorefrontProductApiTest` (CUST-H2-3) لنفس سيناريوهات
 * العزل، زائداً سلامة التسلسل الهرمي (أب/أبناء أجنبيين لا يتسرّبان).
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontCategoryApiTest
 */
class CommerceWorkspaceStorefrontCategoryApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function listPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/categories';
    }

    private function itemPath(string $id, string $categoryId): string
    {
        return $this->listPath($id).'/'.$categoryId;
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::create([
            'slug' => $overrides['channel_slug'] ?? 'web',
            'name' => 'ويب',
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function seedCategory(string $tenantId, SalesChannel $channel, array $attrs = [], bool $published = true): ProductCategory
    {
        app(TenantContext::class)->set($tenantId);
        $category = ProductCategory::create(array_merge([
            'name' => 'تصنيف منشور',
            'description' => 'وصف داخلي — لا يظهر إلا للمعاينة',
            'is_active' => true,
        ], $attrs));

        if ($published) {
            CommerceCategoryListing::create([
                'tenant_id' => $tenantId,
                'category_id' => $category->id,
                'sales_channel_id' => $channel->id,
                'is_published' => true,
            ]);
        }
        app(TenantContext::class)->forget();

        return $category->fresh();
    }

    // ───────────────────────── 1. Tenant isolation — list ─────────────────────────

    /** @test */
    public function tenant_a_lists_only_tenant_a_eligible_categories(): void
    {
        $a = $this->registerTenant('cat-list-a', 'owner@cat-list-a.test');
        $b = $this->registerTenant('cat-list-b', 'owner@cat-list-b.test');

        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->seedCategory($a['tenant_id'], $seededA['channel'], ['name' => 'تصنيف أ']);
        $this->seedCategory($b['tenant_id'], $seededB['channel'], ['name' => 'تصنيف ب']);

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id))
            ->assertOk();

        $names = array_column($res->json('data'), 'name');
        $this->assertSame(['تصنيف أ'], $names);
    }

    // ───────────────────────── 2/3. Foreign storefront/category → 404 ─────────────────────────

    /** @test */
    public function tenant_a_cannot_list_categories_of_a_foreign_storefront(): void
    {
        $a = $this->registerTenant('cat-foreign-sf-a', 'owner@cat-foreign-sf-a.test');
        $b = $this->registerTenant('cat-foreign-sf-b', 'owner@cat-foreign-sf-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->withToken($a['token'])
            ->getJson($this->listPath($seededB['storefront']->id))
            ->assertNotFound();
    }

    /** @test */
    public function a_foreign_category_id_returns_a_non_leaking_404(): void
    {
        $a = $this->registerTenant('cat-foreign-a', 'owner@cat-foreign-a.test');
        $b = $this->registerTenant('cat-foreign-b', 'owner@cat-foreign-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $foreignCategory = $this->seedCategory($b['tenant_id'], $seededB['channel'], ['name' => 'تصنيف أجنبي']);

        $res = $this->withToken($a['token'])
            ->getJson($this->itemPath($seededA['storefront']->id, $foreignCategory->id))
            ->assertNotFound();

        $this->assertStringNotContainsString('تصنيف أجنبي', $res->getContent());
    }

    // ───────────────────────── 4. Same-tenant ineligible category ─────────────────────────

    /** @test */
    public function an_inactive_category_is_excluded_and_returns_404_on_detail(): void
    {
        $auth = $this->registerTenant('cat-inactive', 'owner@cat-inactive.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $inactive = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['is_active' => false]);

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertSame([], $list->json('data'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $inactive->id))
            ->assertNotFound();
    }

    /** @test */
    public function an_unpublished_category_is_excluded_and_returns_404_on_detail(): void
    {
        $auth = $this->registerTenant('cat-unpub', 'owner@cat-unpub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $unpublished = $this->seedCategory($auth['tenant_id'], $seeded['channel'], [], published: false);

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertSame([], $list->json('data'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $unpublished->id))
            ->assertNotFound();
    }

    /** @test */
    public function a_category_published_only_on_a_different_channel_of_the_same_tenant_is_excluded(): void
    {
        $auth = $this->registerTenant('cat-other-channel', 'owner@cat-other-channel.test');
        $seededWeb = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'web-store']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();
        $mobileOnlyCategory = $this->seedCategory($auth['tenant_id'], $mobileChannel);

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seededWeb['storefront']->id))
            ->assertOk();
        $this->assertSame([], $list->json('data'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seededWeb['storefront']->id, $mobileOnlyCategory->id))
            ->assertNotFound();
    }

    // ───────────────────────── 5. Cannot inject tenant authority ─────────────────────────

    /** @test */
    public function a_tenant_id_query_or_body_parameter_cannot_widen_the_result(): void
    {
        $a = $this->registerTenant('cat-inject-a', 'owner@cat-inject-a.test');
        $b = $this->registerTenant('cat-inject-b', 'owner@cat-inject-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->seedCategory($b['tenant_id'], $seededB['channel'], ['name' => 'تصنيف ب المحقون']);

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id).'?tenant_id='.$seededB['storefront']->tenant_id.'&company_id='.$b['tenant_id'])
            ->assertOk();

        $this->assertSame([], $res->json('data'));
    }

    // ───────────────────────── 6/7/8. Auth/permission/subscription gates ─────────────────────────

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('cat-guest', 'owner@cat-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->getJson($this->listPath($seeded['storefront']->id))->assertUnauthorized();
    }

    /** @test */
    public function self_service_users_are_forbidden(): void
    {
        $auth = $this->registerTenant('cat-ss', 'owner@cat-ss.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@cat-ss.test');

        $this->withToken($token)->getJson($this->listPath($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function staff_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('cat-staff', 'owner@cat-staff.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@cat-staff.test');

        $this->withToken($token)->getJson($this->listPath($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function an_inactive_subscription_is_denied(): void
    {
        $auth = $this->registerTenant('cat-expired', 'owner@cat-expired.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        Tenant::query()->where('id', $auth['tenant_id'])->update(['trial_ends_at' => now()->subDay()]);

        $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertStatus(403);
    }

    // ───────────────────────── Payload minimization / safety ─────────────────────────

    /** @test */
    public function list_payload_is_minimal_and_never_leaks_internal_fields(): void
    {
        $auth = $this->registerTenant('cat-safety', 'owner@cat-safety.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->seedCategory($auth['tenant_id'], $seeded['channel'], [
            'description' => 'سرّي جداً لا يظهر في القائمة',
        ]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        $content = $res->getContent();
        $this->assertStringNotContainsString('سرّي جداً', $content);

        $row = $res->json('data.0');
        $this->assertEqualsCanonicalizing(['id', 'name', 'parent_id', 'parent_name'], array_keys($row));
    }

    /** @test */
    public function detail_payload_omits_internal_fields_and_the_image_projection(): void
    {
        $auth = $this->registerTenant('cat-safety-detail', 'owner@cat-safety-detail.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $category = $this->seedCategory($auth['tenant_id'], $seeded['channel'], [
            'description' => 'وصف عام يظهر في المعاينة',
        ]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $category->id))
            ->assertOk()
            ->assertJsonPath('data.id', $category->id)
            ->assertJsonPath('data.description', 'وصف عام يظهر في المعاينة');

        // مسار مساحة العمل ليس `storefront.v1.*` — لا حقل `image` (صورة غلاف
        // التصنيف مؤجَّلة صراحةً، راجع تعليق `StorefrontCategoryResource`).
        $this->assertArrayNotHasKey('image', $res->json('data'));
    }

    // ───────────────────────── Search / pagination / ordering ─────────────────────────

    /** @test */
    public function list_supports_search_pagination_and_deterministic_ordering(): void
    {
        $auth = $this->registerTenant('cat-search', 'owner@cat-search.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'زيوت']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'أرز']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'زبدة']);

        $ordered = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertSame(['أرز', 'زبدة', 'زيوت'], array_column($ordered->json('data'), 'name'));

        $searched = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?search=زبدة')
            ->assertOk();
        $this->assertSame(['زبدة'], array_column($searched->json('data'), 'name'));

        $paged = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?per_page=1&page=2')
            ->assertOk();
        $this->assertCount(1, $paged->json('data'));
        $this->assertSame(2, $paged->json('meta.pagination.page'));
        $this->assertSame(3, $paged->json('meta.pagination.total'));
        $this->assertTrue($paged->json('meta.pagination.has_more'));
    }

    // ───────────────────────── Hierarchy safety ─────────────────────────

    /** @test */
    public function detail_breadcrumbs_include_only_eligible_ancestors_from_the_same_tenant(): void
    {
        $auth = $this->registerTenant('cat-hierarchy', 'owner@cat-hierarchy.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $root = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'الجذر']);
        $child = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'الابن', 'parent_id' => $root->id]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $child->id))
            ->assertOk();

        $this->assertSame(['الجذر'], array_column($res->json('data.ancestors'), 'name'));
    }

    /** @test */
    public function an_unpublished_parent_does_not_appear_in_breadcrumbs(): void
    {
        $auth = $this->registerTenant('cat-hierarchy-unpub-parent', 'owner@cat-hierarchy-unpub-parent.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $unpublishedRoot = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'جذر غير منشور'], published: false);
        $child = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ابن منشور', 'parent_id' => $unpublishedRoot->id]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $child->id))
            ->assertOk();

        $ancestorNames = array_column($res->json('data.ancestors') ?? [], 'name');
        $this->assertNotContains('جذر غير منشور', $ancestorNames);
    }

    /** @test */
    public function a_foreign_tenants_category_never_leaks_as_a_parent_or_child(): void
    {
        $a = $this->registerTenant('cat-hierarchy-a', 'owner@cat-hierarchy-a.test');
        $b = $this->registerTenant('cat-hierarchy-b', 'owner@cat-hierarchy-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $foreignRoot = $this->seedCategory($b['tenant_id'], $seededB['channel'], ['name' => 'جذر أجنبي']);
        // نفس معرّف تصنيف "الأب" من مستأجر آخر لا يُحلّ عبر استعلام مقيَّد
        // بالمستأجر الحالي أصلاً (`TenantScope` على `ProductCategory`) — تصنيف
        // مستأجر A يشير إلى `parent_id` لتصنيف أجنبي يبقى بلا أبٍ ظاهر، لا
        // يُسقِط الطلب ولا يُسرِّب اسم التصنيف الأجنبي.
        $ownCategory = $this->seedCategory($a['tenant_id'], $seededA['channel'], ['name' => 'تصنيف أ', 'parent_id' => $foreignRoot->id]);

        $res = $this->withToken($a['token'])
            ->getJson($this->itemPath($seededA['storefront']->id, $ownCategory->id))
            ->assertOk();

        $this->assertStringNotContainsString('جذر أجنبي', $res->getContent());
        $this->assertSame([], $res->json('data.ancestors') ?? []);
    }

    /** @test */
    public function children_in_the_detail_response_are_filtered_by_the_same_eligibility_rule(): void
    {
        $auth = $this->registerTenant('cat-children', 'owner@cat-children.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $parent = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'أب']);
        $eligibleChild = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ابن مؤهَّل', 'parent_id' => $parent->id]);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ابن غير منشور', 'parent_id' => $parent->id], published: false);

        $res = $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $parent->id))
            ->assertOk();

        $childIds = array_column($res->json('data.children') ?? [], 'id');
        $this->assertSame([$eligibleChild->id], $childIds);
    }

    /** @test */
    public function list_parent_name_hint_reflects_the_real_parent_category(): void
    {
        $auth = $this->registerTenant('cat-parent-hint', 'owner@cat-parent-hint.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $parent = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'الأجهزة']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'الجوالات', 'parent_id' => $parent->id]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        $bySlug = collect($res->json('data'))->keyBy('name');
        $this->assertNull($bySlug['الأجهزة']['parent_name']);
        $this->assertSame('الأجهزة', $bySlug['الجوالات']['parent_name']);
    }

    // ───────────────────────── CUST-H4-3 (parity fix) — root_only ─────────────────────────

    /** @test */
    public function default_list_behavior_is_unchanged_when_root_only_is_omitted(): void
    {
        $auth = $this->registerTenant('cat-root-only-default', 'owner@cat-root-only-default.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $root = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'جذر']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'فرعي', 'parent_id' => $root->id]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        // Mixed-depth list, exactly as before this fix — root_only absent
        // never implicitly filters.
        $this->assertEqualsCanonicalizing(['جذر', 'فرعي'], array_column($res->json('data'), 'name'));
    }

    /** @test */
    public function root_only_true_returns_only_categories_with_a_null_parent(): void
    {
        $auth = $this->registerTenant('cat-root-only-true', 'owner@cat-root-only-true.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $root = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'جذر']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'فرعي', 'parent_id' => $root->id]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?root_only=true')
            ->assertOk();

        $this->assertSame(['جذر'], array_column($res->json('data'), 'name'));
    }

    /** @test */
    public function root_only_pagination_happens_after_the_filter_so_root_categories_are_never_starved_by_children(): void
    {
        $auth = $this->registerTenant('cat-root-only-pagination', 'owner@cat-root-only-pagination.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        // Alphabetically-first children (sort before the roots below under
        // the endpoint's own `orderBy('name')`) — enough of them to fully
        // occupy a 2-row page on their own, exactly the scenario where a
        // "fetch one page, then filter parentId===null client-side"
        // approach would silently lose every root category below them.
        // `$rootA` is itself a root category too (it has no `parent_id` of
        // its own) in addition to being these children's parent — three
        // root categories in total (`$rootA`, `$rootB`, `$rootC`).
        $rootA = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ظ-أب']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'أ-فرعي-1', 'parent_id' => $rootA->id]);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'أ-فرعي-2', 'parent_id' => $rootA->id]);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'أ-فرعي-3', 'parent_id' => $rootA->id]);
        $rootB = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ر-جذر-ب']);
        $rootC = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ر-جذر-ج']);

        // Control: proves the premise — a plain (non-root-only), 2-row page
        // really is fully consumed by the alphabetically-earlier children,
        // with zero root categories reaching it.
        $plainPage = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?per_page=2')
            ->assertOk();
        $this->assertSame(['أ-فرعي-1', 'أ-فرعي-2'], array_column($plainPage->json('data'), 'name'));

        // The actual fix: with root_only=true, the same 2-row first page
        // contains only root categories — the filter ran before
        // pagination, so the three children never consumed any of the
        // page's rows at all, and all 3 real root categories are reachable
        // (none lost/starved), 2 on this page and the 3rd on the next.
        $rootOnlyPage = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?root_only=true&per_page=2')
            ->assertOk();
        $this->assertSame([$rootB->id, $rootC->id], array_column($rootOnlyPage->json('data'), 'id'));
        $this->assertSame(3, $rootOnlyPage->json('meta.pagination.total'));
        $this->assertTrue($rootOnlyPage->json('meta.pagination.has_more'));

        $rootOnlyPageTwo = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?root_only=true&per_page=2&page=2')
            ->assertOk();
        $this->assertSame([$rootA->id], array_column($rootOnlyPageTwo->json('data'), 'id'));
        $this->assertFalse($rootOnlyPageTwo->json('meta.pagination.has_more'));
    }

    /** @test */
    public function root_only_still_respects_tenant_storefront_and_channel_publication_isolation(): void
    {
        $a = $this->registerTenant('cat-root-only-isolation-a', 'owner@cat-root-only-isolation-a.test');
        $b = $this->registerTenant('cat-root-only-isolation-b', 'owner@cat-root-only-isolation-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->seedCategory($a['tenant_id'], $seededA['channel'], ['name' => 'جذر أ']);
        $this->seedCategory($b['tenant_id'], $seededB['channel'], ['name' => 'جذر ب']);
        // Unpublished root for tenant A — root_only must not bypass the
        // existing publication-eligibility gate.
        $this->seedCategory($a['tenant_id'], $seededA['channel'], ['name' => 'جذر غير منشور'], published: false);

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id).'?root_only=true')
            ->assertOk();

        $this->assertSame(['جذر أ'], array_column($res->json('data'), 'name'));
    }

    /** @test */
    public function an_unsupported_root_only_value_fails_validation(): void
    {
        $auth = $this->registerTenant('cat-root-only-invalid', 'owner@cat-root-only-invalid.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?root_only=maybe')
            ->assertStatus(422);
    }
}
