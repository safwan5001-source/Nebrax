<?php

namespace Tests\Feature;

use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaVersion;
use Tests\TestCase;

/**
 * CPT-05 / AD-02 — «أرشيف نسخ»: النسخ المنشورة غير قابلة للتعديل ويجب أن تبقى صالحة بعد **كل** ميزة. يُشغَّل في كل شريحة تمسّ المخطط
 * أو المحلل أو المحلل التوافقي أو الأجيال. الوثائق المجمَّدة في `contracts/app-builder/archive/` مشتركة مع اختبار Dart
 * (`mobile/test/schema/version_archive_test.dart`): لا تُعدَّل وثيقة قائمة أبداً — يُضاف ملف جديد لكل شكل جديد.
 *
 * تشغيل: php artisan test --filter=PublishedVersionArchiveTest
 */
class PublishedVersionArchiveTest extends TestCase
{
    private const INDEX = __DIR__.'/../../contracts/app-builder/archive/index.v1.json';

    /** @return array<string, array{0: string, 1: array<string, mixed>, 2: array<string, mixed>}> */
    public static function archive(): array
    {
        $index = json_decode((string) file_get_contents(self::INDEX), true, 512, JSON_THROW_ON_ERROR);
        $cases = [];
        foreach ($index['versions'] as $entry) {
            $path = dirname(self::INDEX).'/'.$entry['file'];
            $cases[$entry['file']] = [$entry['file'], json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR), $entry['expect']];
        }

        return $cases;
    }

    /** @dataProvider archive */
    public function test_every_archived_version_still_parses_and_resolves_exactly_as_recorded(string $file, array $schema, array $expect): void
    {
        app(AppSchemaParser::class)->validate($schema); // لا استثناء: يُحلَّل للأبد

        $resolver = app(CompatibilityResolver::class);
        foreach ($expect as $runtime => $outcome) {
            $manifest = $this->generation($runtime);
            $result = $resolver->resolve($schema, $manifest);

            $this->assertSame($outcome['compatible'], $result->compatible, "{$file} @ {$runtime}: التوافق تغيّر");
            $this->assertSame($outcome['fallbackIds'], array_map(fn ($f) => $f['componentId'], $result->fallbacks), "{$file} @ {$runtime}: ما يُسقَط تغيّر");
        }
    }

    /** @dataProvider archive */
    public function test_a_newer_generation_never_breaks_a_version_an_older_generation_renders(string $file, array $schema, array $expect): void
    {
        $resolver = app(CompatibilityResolver::class);
        $generations = $this->allGenerations();

        foreach ($generations as $i => $older) {
            if (! $resolver->resolve($schema, $older)->compatible) {
                continue;
            }
            foreach (array_slice($generations, $i + 1) as $newer) {
                $this->assertTrue(
                    $resolver->resolve($schema, $newer)->compatible,
                    "{$file}: يُعرض على {$older->runtimeVersion} ويفشل على الجيل الأحدث {$newer->runtimeVersion} — انحدار توافق",
                );
            }
        }
        $this->assertNotEmpty($generations);
    }

    /** @test */
    public function the_archive_index_is_well_formed_and_every_listed_file_exists(): void
    {
        $index = json_decode((string) file_get_contents(self::INDEX), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame('app-builder.version-archive', $index['contract']);
        $this->assertNotEmpty($index['versions']);
        foreach ($index['versions'] as $entry) {
            $this->assertFileExists(dirname(self::INDEX).'/'.$entry['file']);
            $this->assertNotEmpty($entry['expect'], $entry['file']);
        }
    }

    /** الأجيال المعروفة + جيل لاحق اصطناعي (يبيّن أن الاختبار يلتقط انحداراً حقيقياً لو ضاقت قدرات جيل). */
    private function allGenerations(): array
    {
        $known = app(RuntimeGenerations::class)->all();
        $base = end($known);
        $future = new CapabilityManifest(
            runtimeVersion: new SchemaVersion(1, 9, 0),
            minSupportedSchemaVersion: $base->minSupportedSchemaVersion,
            maxSupportedSchemaVersion: new SchemaVersion(1, 9, 0),
            components: $base->components,
            actions: $base->actions,
            nativeCapabilities: $base->nativeCapabilities,
            dataResources: $base->dataResources,
            schemaFeatures: $base->schemaFeatures,
        );

        return [...$known, $future];
    }

    private function generation(string $runtime): CapabilityManifest
    {
        return app(RuntimeGenerations::class)->forRuntime($runtime);
    }
}
