<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AIA-0.4 / D-08 — حرّاس بنيوية ساكنة (قراءة ملفات فقط).
 *
 *  1) لا مسار إنتاجي يُصدر مفتاحاً (`->issueKey(` / `->rotateKey(`) إلا ويمرّ بحارس السقف.
 *  2) لا `skip` ولا `incomplete` في اختبارات قبول AIA-0.4.
 *  3) ملفات القبول كلها في المجموعة `aia-0-4-security` (التي تُشغَّل في CI بأعلام صارمة).
 */
#[Group('aia-0-4-security')]
class PublicApiScopeCeilingArchitectureTest extends TestCase
{
    private const ACCEPTANCE_FILES = [
        'PublicApiScopeCeilingEnforcementTest.php',
        'PublicApiCreateClientCommandCeilingTest.php',
        'PublicApiScopeCeilingArchitectureTest.php',
    ];

    private function appPhpFiles(): array
    {
        $root = base_path('app');
        $files = [];
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile() && $f->getExtension() === 'php') {
                $files[] = $f->getPathname();
            }
        }

        return $files;
    }

    #[Test]
    public function every_production_caller_of_issue_key_goes_through_the_ceiling_guard(): void
    {
        $callers = [];
        foreach ($this->appPhpFiles() as $file) {
            $src = file_get_contents($file);
            if (preg_match('/->\s*(issueKey|rotateKey)\s*\(/', $src) === 1) {
                $callers[basename($file)] = $src;
            }
        }

        // المنفذ الوحيد المعرِّف: ApiClientKeyService نفسها (rotateKey تستدعي issueKey).
        unset($callers['ApiClientKeyService.php']);

        $this->assertNotEmpty($callers, 'يجب أن يوجد مستدعٍ إنتاجي واحد على الأقل (المتحكم والأمر).');
        $this->assertEqualsCanonicalizing(
            ['DeveloperApiClientController.php', 'PublicApiCreateClientCommand.php'],
            array_keys($callers),
            'مستدعٍ جديد لـissueKey/rotateKey يجب أن يُراجَع صراحةً ويمرّ بالحارس.'
        );

        foreach ($callers as $name => $src) {
            $this->assertStringContainsString('PublicApiKeyIssuanceGuard', $src, "{$name} يُصدر مفتاحاً بلا حارس السقف.");
            $this->assertMatchesRegularExpression('/->\s*(assertIssuable|denied)\s*\(/', $src, "{$name} لا يفرض السقف قبل الإصدار.");
            // الحارس قبل الإصدار نصّاً (ترتيب الاستدعاء داخل الملف).
            $guardPos = preg_match('/->\s*(assertIssuable|denied)\s*\(/', $src, $m, PREG_OFFSET_CAPTURE) ? $m[0][1] : PHP_INT_MAX;
            $issuePos = preg_match('/->\s*issueKey\s*\(/', $src, $m2, PREG_OFFSET_CAPTURE) ? $m2[0][1] : PHP_INT_MAX;
            $this->assertLessThan($issuePos, $guardPos, "{$name}: السقف يجب أن يسبق الإصدار.");
        }
    }

    #[Test]
    public function no_other_code_mints_api_client_tokens_directly(): void
    {
        foreach ($this->appPhpFiles() as $file) {
            if (basename($file) === 'ApiClientKeyService.php') {
                continue;
            }
            $this->assertDoesNotMatchRegularExpression(
                '/ApiClient[^;]{0,80}->\s*createToken\s*\(/',
                file_get_contents($file),
                basename($file).' يُنشئ توكن ApiClient خارج ApiClientKeyService.'
            );
        }
    }

    #[Test]
    public function acceptance_tests_are_strict_and_grouped(): void
    {
        $forbidden = [
            'markTestIncomplete', 'markTestSkipped', 'markTestSkip', '#[RequiresPhp', '#[RequiresOperatingSystem', '@requires',
            '@incomplete', '@skip', '->skip(', 'Test::skip',
        ];

        foreach (self::ACCEPTANCE_FILES as $name) {
            $path = base_path('tests/Feature/'.$name);
            $this->assertFileExists($path);
            $src = file_get_contents($path);
            // نفحص ما عدا قائمة الممنوعات في هذا الملف نفسه (تُكتب كسلاسل لا كاستدعاءات).
            $code = $name === basename(__FILE__) ? preg_replace("/'[^']*'/", "''", $src) : $src;
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsString($needle, $code, "{$name} يحتوي «{$needle}» — ممنوع في اختبارات قبول AIA-0.4.");
            }
            $this->assertStringContainsString("#[Group('aia-0-4-security')]", $src, "{$name} خارج المجموعة aia-0-4-security.");
        }
    }
}
