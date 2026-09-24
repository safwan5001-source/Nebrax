<?php

namespace Tests\Feature;

use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\SchemaFormatException;
use Tests\TestCase;

/**
 * APP-BUILDER-2 — تحقق بنيوي عميق من App Schema، بلا قاعدة بيانات ولا HTTP.
 * يطابق تسمية اختبارات `mobile/test/schema/schema_parser_test.dart` عمداً
 * (نفس الحالات، نفس الترتيب) — إثبات أن المحلّلين (Dart وPHP) يتفقان على
 * نفس قواعد القبول/الرفض لنفس المدخلات.
 *
 * تشغيل: php artisan test --filter=AppSchemaParserTest
 */
class AppSchemaParserTest extends TestCase
{
    private function parser(): AppSchemaParser
    {
        return app(AppSchemaParser::class);
    }

    /** @return array<string, mixed> */
    private function minimalSchema(): array
    {
        return [
            'schemaVersion' => '1.0.0',
            'minRuntimeVersion' => '1.0.0',
            'navigation' => ['initialPageId' => 'home'],
            'theme' => ['tokens' => []],
            'pages' => [
                'home' => ['type' => 'Page', 'id' => 'home-root', 'children' => []],
            ],
        ];
    }

    /** @test */
    public function parses_a_minimal_valid_schema(): void
    {
        $this->parser()->validate($this->minimalSchema());
        $this->assertTrue(true);
    }

    /** @test */
    public function parses_required_capabilities_when_present(): void
    {
        $schema = $this->minimalSchema();
        $schema['requiredCapabilities'] = ['addToCart' => 1];
        $this->parser()->validate($schema);
        $this->assertTrue(true);
    }

    /** @test */
    public function parses_an_action_reference_on_a_component(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'NavigationTarget', 'id' => 'go-cart', 'action' => [
                'type' => 'navigate', 'params' => ['pageId' => 'cart'],
            ]],
        ];
        $this->parser()->validate($schema);
        $this->assertTrue(true);
    }

    /** @test */
    public function rejects_an_unknown_top_level_field(): void
    {
        $schema = $this->minimalSchema();
        $schema['tenantId'] = 'attempt-to-smuggle-tenant-authority';

        $this->expectException(SchemaFormatException::class);
        $this->parser()->validate($schema);
    }

    /** @test */
    public function rejects_a_missing_schema_version(): void
    {
        $schema = $this->minimalSchema();
        unset($schema['schemaVersion']);

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('missing_field', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_an_invalid_schema_version_format(): void
    {
        $schema = $this->minimalSchema();
        $schema['schemaVersion'] = '1.0';

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('invalid_version', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_an_unknown_component_field(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'x1', 'url' => 'https://evil.example/steal'],
        ];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('unknown_field', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_a_component_missing_id(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [['type' => 'Text']];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('missing_field', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_children_that_are_not_a_list(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = ['type' => 'Text', 'id' => 'x1'];

        $this->expectException(SchemaFormatException::class);
        $this->parser()->validate($schema);
    }

    /** @test */
    public function rejects_a_non_page_root_component(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['type'] = 'Section';

        $this->expectException(SchemaFormatException::class);
        $this->parser()->validate($schema);
    }

    /** @test */
    public function rejects_navigation_initial_page_id_referencing_an_undeclared_page(): void
    {
        $schema = $this->minimalSchema();
        $schema['navigation']['initialPageId'] = 'does-not-exist';

        $this->expectException(SchemaFormatException::class);
        $this->parser()->validate($schema);
    }

    /** @test */
    public function rejects_a_component_tree_deeper_than_the_max_depth(): void
    {
        $schema = $this->minimalSchema();
        $node = ['type' => 'Text', 'id' => 'leaf'];
        for ($i = 0; $i < 40; $i++) {
            $node = ['type' => 'Section', 'id' => "depth-{$i}", 'children' => [$node]];
        }
        $schema['pages']['home']['children'] = [$node];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('too_deep', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_a_component_tree_with_too_many_nodes(): void
    {
        $schema = $this->minimalSchema();
        $children = [];
        for ($i = 0; $i < 600; $i++) {
            $children[] = ['type' => 'Text', 'id' => "n{$i}"];
        }
        $schema['pages']['home']['children'] = $children;

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('too_many_nodes', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_an_action_with_an_unknown_field(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'NavigationTarget', 'id' => 'x1', 'action' => [
                'type' => 'navigate', 'confirm' => true,
            ]],
        ];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('unknown_field', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_required_capabilities_with_a_non_positive_int_value(): void
    {
        $schema = $this->minimalSchema();
        $schema['requiredCapabilities'] = ['addToCart' => 0];

        $this->expectException(SchemaFormatException::class);
        $this->parser()->validate($schema);
    }

    /** @test */
    public function rejects_a_numeric_string_page_id_that_json_decode_would_coerce(): void
    {
        // json_decode(['... "123": {...}'], true) يحوّل المفتاح "123" إلى
        // int(123) في PHP (بخلاف Dart's Map<String,dynamic>) — يثبت أن
        // المحلّل يتعامل مع الحالة بلا رفض معرّف صفحة صالح خطأً.
        $decoded = json_decode('{"123": {"type": "Page", "id": "root", "children": []}}', true);
        $schema = $this->minimalSchema();
        $schema['pages'] = $decoded;
        $schema['navigation']['initialPageId'] = '123';

        $this->parser()->validate($schema);
        $this->assertTrue(true);
    }

    /** @test */
    public function parses_a_component_with_a_well_formed_binding(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'ProductList', 'id' => 'p1', 'binding' => [
                'resource' => 'commerce.products',
                'query' => ['category_id' => '$route.categoryId', 'sort' => 'name'],
                'itemProps' => ['title' => 'name', 'amountMinor' => 'price.amount_minor'],
            ]],
        ];

        $this->parser()->validate($schema);
        $this->assertTrue(true);
    }

    /** @test */
    public function rejects_a_binding_with_an_unknown_field(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'ProductList', 'id' => 'p1', 'binding' => [
                'resource' => 'commerce.products', 'endpoint' => '/anything',
            ]],
        ];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('unknown_field', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_a_binding_missing_resource(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'ProductList', 'id' => 'p1', 'binding' => ['query' => []]],
        ];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('missing_field', $e->errorCode);
        }
    }

    /** @test */
    public function rejects_a_binding_with_a_non_string_item_props_value(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'ProductList', 'id' => 'p1', 'binding' => [
                'resource' => 'commerce.products',
                'itemProps' => ['title' => 5],
            ]],
        ];

        $this->expectException(SchemaFormatException::class);
        $this->parser()->validate($schema);
    }

    /** @test */
    public function rejects_the_old_plural_bindings_key_since_only_binding_singular_is_accepted(): void
    {
        $schema = $this->minimalSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'bound-text', 'bindings' => ['text' => 'commerce.products.0.title']],
        ];

        try {
            $this->parser()->validate($schema);
            $this->fail('expected SchemaFormatException');
        } catch (SchemaFormatException $e) {
            $this->assertSame('unknown_field', $e->errorCode);
        }
    }
}
