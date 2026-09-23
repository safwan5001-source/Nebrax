<?php

namespace Tests\Feature;

use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\CompatibilityResult;
use App\Services\AppBuilder\RuntimeCapabilities;
use App\Services\AppBuilder\SchemaVersion;
use Tests\TestCase;

/**
 * APP-BUILDER-2 — محلّل التوافق، بلا قاعدة بيانات ولا HTTP. يطابق تسمية
 * اختبارات `mobile/test/schema/compatibility_test.dart` عمداً — نفس الحالات
 * المرجعية (نسخة أقدم/أحدث متوافقة، قدرة مطلوبة غير مدعومة تُفشل الوثيقة
 * كاملة، قدرة اختيارية غير مدعومة تُسقَط فقط) بحيث يتفق محلّلا Dart وPHP على
 * نفس القرار لنفس المدخلات.
 *
 * تشغيل: php artisan test --filter=CompatibilityResolverTest
 */
class CompatibilityResolverTest extends TestCase
{
    private function resolver(): CompatibilityResolver
    {
        return new CompatibilityResolver;
    }

    private function manifest(
        string $runtimeVersion = '1.0.0',
        string $minSchema = '1.0.0',
        string $maxSchema = '1.0.0',
        ?array $components = null,
        ?array $actions = null,
    ): CapabilityManifest {
        return new CapabilityManifest(
            runtimeVersion: SchemaVersion::tryParse($runtimeVersion),
            minSupportedSchemaVersion: SchemaVersion::tryParse($minSchema),
            maxSupportedSchemaVersion: SchemaVersion::tryParse($maxSchema),
            components: $components ?? RuntimeCapabilities::COMPONENTS,
            actions: $actions ?? RuntimeCapabilities::ACTIONS,
            nativeCapabilities: RuntimeCapabilities::NATIVE_CAPABILITIES,
        );
    }

    /** @return array<string, mixed> */
    private function baseSchema(array $overrides = []): array
    {
        return array_replace([
            'schemaVersion' => '1.0.0',
            'minRuntimeVersion' => '1.0.0',
            'requiredCapabilities' => [],
            'navigation' => ['initialPageId' => 'home'],
            'pages' => [
                'home' => [
                    'type' => 'Page',
                    'id' => 'home-root',
                    'children' => [
                        ['type' => 'Text', 'id' => 't1'],
                        ['type' => 'ProductList', 'id' => 'p1'],
                    ],
                ],
            ],
        ], $overrides);
    }

    /** @test */
    public function current_schema_and_current_runtime_is_fully_compatible_with_no_fallbacks(): void
    {
        $result = $this->resolver()->resolve($this->baseSchema(), CapabilityManifest::current());

        $this->assertTrue($result->compatible);
        $this->assertSame([], $result->fallbacks);
    }

    /** @test */
    public function an_unsupported_optional_component_is_omitted_but_publish_remains_compatible(): void
    {
        $schema = $this->baseSchema();
        $schema['pages']['home']['children'][] = ['type' => 'NotReal', 'id' => 'x1', 'optional' => true];

        $result = $this->resolver()->resolve($schema, CapabilityManifest::current());

        $this->assertTrue($result->compatible);
        $this->assertCount(1, $result->fallbacks);
        $this->assertSame('x1', $result->fallbacks[0]['componentId']);
    }

    /** @test */
    public function an_unsupported_optional_action_is_omitted_along_with_its_component(): void
    {
        $schema = $this->baseSchema();
        $schema['pages']['home']['children'][] = [
            'type' => 'Button', 'id' => 'x1', 'optional' => true,
            'action' => ['type' => 'notARealAction'],
        ];

        $result = $this->resolver()->resolve($schema, CapabilityManifest::current());

        $this->assertTrue($result->compatible);
        $this->assertCount(1, $result->fallbacks);
    }

    /** @test */
    public function an_unsupported_required_component_fails_the_whole_document_closed(): void
    {
        $schema = $this->baseSchema();
        $schema['pages']['home']['children'][] = ['type' => 'NotReal', 'id' => 'x1'];

        $result = $this->resolver()->resolve($schema, CapabilityManifest::current());

        $this->assertFalse($result->compatible);
        $this->assertSame(CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY, $result->reason);
    }

    /** @test */
    public function an_unsupported_required_action_fails_the_whole_document_closed(): void
    {
        $schema = $this->baseSchema();
        $schema['pages']['home']['children'][] = [
            'type' => 'Button', 'id' => 'x1', 'action' => ['type' => 'notARealAction'],
        ];

        $result = $this->resolver()->resolve($schema, CapabilityManifest::current());

        $this->assertFalse($result->compatible);
        $this->assertSame(CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY, $result->reason);
    }

    /** @test */
    public function a_schema_newer_than_the_runtime_supports_is_rejected(): void
    {
        $schema = $this->baseSchema(['schemaVersion' => '2.0.0', 'minRuntimeVersion' => '1.0.0']);

        $result = $this->resolver()->resolve($schema, $this->manifest(maxSchema: '1.0.0'));

        $this->assertFalse($result->compatible);
        $this->assertSame(CompatibilityResult::REASON_SCHEMA_VERSION_TOO_NEW, $result->reason);
    }

    /** @test */
    public function a_schema_older_than_the_runtime_supports_is_rejected(): void
    {
        $schema = $this->baseSchema(['schemaVersion' => '1.0.0', 'minRuntimeVersion' => '1.0.0']);

        $result = $this->resolver()->resolve($schema, $this->manifest(minSchema: '2.0.0', maxSchema: '2.0.0'));

        $this->assertFalse($result->compatible);
        $this->assertSame(CompatibilityResult::REASON_SCHEMA_VERSION_TOO_OLD, $result->reason);
    }

    /** @test */
    public function a_schema_requiring_a_newer_runtime_than_installed_is_rejected(): void
    {
        $schema = $this->baseSchema(['minRuntimeVersion' => '9.0.0']);

        $result = $this->resolver()->resolve($schema, $this->manifest(runtimeVersion: '1.0.0'));

        $this->assertFalse($result->compatible);
        $this->assertSame(CompatibilityResult::REASON_RUNTIME_TOO_OLD, $result->reason);
    }

    /** @test */
    public function a_missing_named_required_capability_is_rejected(): void
    {
        $schema = $this->baseSchema(['requiredCapabilities' => ['addToCart' => 99]]);

        $result = $this->resolver()->resolve($schema, CapabilityManifest::current());

        $this->assertFalse($result->compatible);
        $this->assertSame(CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY, $result->reason);
    }

    /** @test */
    public function the_same_schema_can_be_compatible_on_one_manifest_and_not_another(): void
    {
        $schema = $this->baseSchema();
        $schema['pages']['home']['children'][] = [
            'type' => 'Button', 'id' => 'push-btn',
            'action' => ['type' => 'navigate'],
        ];
        $schema['requiredCapabilities'] = ['push.notifications' => 1];

        $withPush = $this->resolver()->resolve($schema, $this->manifest());
        // withPush uses RuntimeCapabilities::NATIVE_CAPABILITIES (has push.notifications => 1)
        $this->assertTrue($withPush->compatible);

        $withoutPush = $this->resolver()->resolve(
            $schema,
            new CapabilityManifest(
                runtimeVersion: SchemaVersion::tryParse('1.0.0'),
                minSupportedSchemaVersion: SchemaVersion::tryParse('1.0.0'),
                maxSupportedSchemaVersion: SchemaVersion::tryParse('1.0.0'),
                components: RuntimeCapabilities::COMPONENTS,
                actions: RuntimeCapabilities::ACTIONS,
                nativeCapabilities: [],
            ),
        );
        $this->assertFalse($withoutPush->compatible);
    }
}
