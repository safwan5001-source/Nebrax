<?php

namespace Tests\Feature;

use App\Services\AppBuilder\DataResourceRegistry;
use App\Services\AppBuilder\ResourceDefinition;
use App\Services\AppBuilder\ResourceFieldDefinition;
use App\Services\AppBuilder\ResourceQueryParamDefinition;
use Tests\TestCase;

/**
 * APP-BUILDER-13 (ADR-01) — سجلّ موارد البيانات مُعبَّأ بنطاق V1 الثلاثي
 * (`commerce.categories`/`commerce.products`/`commerce.cart`)، مربوطاً حصراً
 * بسطح `commerce/v1` الحقيقي. صنفٌ وصفي بحت — بلا قاعدة بيانات ولا HTTP.
 *
 * تشغيل: php artisan test --filter=DataResourceRegistryTest
 */
class DataResourceRegistryTest extends TestCase
{
    public function test_resources_is_locked_to_the_v1_three_resource_scope(): void
    {
        $this->assertSame(
            ['commerce.categories', 'commerce.products', 'commerce.cart'],
            array_keys(DataResourceRegistry::RESOURCES),
            'نطاق V1 مقفل بموجب ADR-01 — أي مورد إضافي (عميل/طلبات/عروض) يحتاج قراراً صريحاً جديداً.'
        );

        foreach (DataResourceRegistry::RESOURCES as $version) {
            $this->assertSame(1, $version);
        }
    }

    public function test_definitions_key_set_matches_resources_exactly(): void
    {
        $this->assertSame(
            array_keys(DataResourceRegistry::RESOURCES),
            array_keys(DataResourceRegistry::definitions()),
            'سجلّ بيانات الموارد يجب أن يصف كل هوية مورد مدعومة فعلياً — لا أكثر ولا أقل.'
        );
    }

    public function test_every_definition_reports_its_own_id_and_the_shared_registry_version(): void
    {
        foreach (DataResourceRegistry::definitions() as $id => $definition) {
            $this->assertSame($id, $definition->id);
            $this->assertSame(DataResourceRegistry::RESOURCES[$id], $definition->version);
            $this->assertSame('commerce/v1', $definition->apiSurface, "{$id} يجب أن يُربَط حصراً بـ commerce/v1، لا store/v1 ولا storefront/.");
        }
    }

    public function test_every_field_key_is_unique_within_its_resource(): void
    {
        foreach (DataResourceRegistry::definitions() as $id => $definition) {
            $keys = array_map(fn (ResourceFieldDefinition $field) => $field->key, $definition->fields);
            $this->assertSame($keys, array_unique($keys), "مفاتيح حقول {$id} يجب ألا تتكرر.");
        }
    }

    public function test_every_query_param_key_is_unique_within_its_kind_per_resource(): void
    {
        foreach (DataResourceRegistry::definitions() as $id => $definition) {
            $filterKeys = $definition->filterKeys();
            $sortKeys = $definition->sortKeys();
            $this->assertSame($filterKeys, array_unique($filterKeys), "مفاتيح ترشيح {$id} يجب ألا تتكرر.");
            $this->assertSame($sortKeys, array_unique($sortKeys), "مفاتيح فرز {$id} يجب ألا تتكرر.");
        }
    }

    public function test_only_products_resource_supports_filtering_and_sorting(): void
    {
        $definitions = DataResourceRegistry::definitions();

        $this->assertSame([], $definitions['commerce.categories']->queryParams);
        $this->assertSame([], $definitions['commerce.cart']->queryParams);

        $products = $definitions['commerce.products'];
        $this->assertSame(['search', 'category_id'], $products->filterKeys());
        $this->assertSame(['name', 'sale_price', 'created_at'], $products->sortKeys());
    }

    public function test_only_products_resource_is_paginated(): void
    {
        $definitions = DataResourceRegistry::definitions();

        $this->assertFalse($definitions['commerce.categories']->paginated);
        $this->assertTrue($definitions['commerce.products']->paginated);
        $this->assertFalse($definitions['commerce.cart']->paginated);
    }

    public function test_categories_resource_has_no_english_name_field_matching_the_confirmed_wire_gap(): void
    {
        $fieldKeys = DataResourceRegistry::definitions()['commerce.categories']->readableFieldKeys();

        $this->assertNotContains(
            'name_en',
            $fieldKeys,
            'commerce/v1 categories لا يعيد name_en اليوم فعلياً — إضافته هنا قبل إصلاح الاستجابة الحقيقية يخترع حقلاً غير موجود.'
        );
    }

    public function test_cart_resource_requires_cart_token_auth_and_others_do_not(): void
    {
        $definitions = DataResourceRegistry::definitions();

        $this->assertSame(ResourceDefinition::AUTH_STORE_BEARER_AND_CART_TOKEN, $definitions['commerce.cart']->auth);
        $this->assertSame(ResourceDefinition::AUTH_STORE_BEARER, $definitions['commerce.categories']->auth);
        $this->assertSame(ResourceDefinition::AUTH_STORE_BEARER, $definitions['commerce.products']->auth);
    }

    public function test_v1_excludes_customer_profile_orders_and_promotions_per_adr_01(): void
    {
        $ids = array_keys(DataResourceRegistry::RESOURCES);

        $this->assertNotContains('commerce.customer.profile', $ids);
        $this->assertNotContains('commerce.orders', $ids);
        $this->assertNotContains('commerce.promotions', $ids);
    }
}
