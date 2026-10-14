<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-BACKEND-CI-02b — تنظيف الاختبار يجري حتى حين يفشل الاختبار
 * ═══════════════════════════════════════════════════════════════
 *  السبب الجذري لتعليق CI-02: 26 صنفاً كانت تكتب
 *
 *      protected function tearDown(): void { Mockery::close(); parent::tearDown(); }
 *
 *  فإن فشل اختبارٌ قبل استيفاء توقّع `->once()` رمى `Mockery::close()`
 *  `InvalidCountException`، فلم يُستدعَ `parent::tearDown()` قط، ولم يُتراجَع
 *  عن معاملة `RefreshDatabase`/`DatabaseTransactions`. بقي الاتصال «خاملاً داخل
 *  معاملة» يحجز صفّ `tenant_reference_number_sequences`، فانتظره الاختبار
 *  التالي في العامل نفسه بلا حدّ.
 *
 *  `Illuminate\Foundation\Testing\TestCase::tearDown()` يتراجع عن المعاملة
 *  **أولاً** (`beforeApplicationDestroyed`) ثم يغلق Mockery ويعيد رمي
 *  `InvalidCountException`؛ فالاستدعاء اليدوي زائدٌ وهو وحده ما يقفز فوق التراجع.
 *
 *  الحارسان:
 *  - تشغيلي (PostgreSQL): صنفُ مسبارٍ في عملية PHPUnit مستقلة. الاختبار «أ» يحجز
 *    الصفّ ثم يفشل بتوقّع غير مستوفى؛ «ب» يحاول الحجز `NOWAIT`. الشكل القديم يسرّب
 *    القفل (55P03 في «ب») — فالمسبار حسّاس فعلاً؛ وتنظيف Laravel يحرّره و«أ» يبقى فاشلاً.
 *  - ثابت (كل المحرّكات): لا `tearDown()` في tests/Feature يستدعي `Mockery::close()`.
 */
class TestTeardownCleanupTest extends TestCase
{
    /** @test */
    public function no_feature_test_closes_mockery_itself_in_tear_down(): void
    {
        $offenders = [];
        foreach (glob(__DIR__.'/*.php') ?: [] as $file) {
            if ($file === __FILE__) {
                continue; // يحمل الشكل القديم نصّاً مقصوداً لمسبار التسرّب.
            }
            $body = $this->tearDownBody((string) file_get_contents($file));
            if ($body !== null && str_contains($body, 'Mockery::close(')) {
                $offenders[] = basename($file);
            }
        }

        $this->assertSame([], $offenders,
            "tearDown() يستدعي Mockery::close() بنفسه: إن رمى (توقّعٌ غير مستوفى) سقط parent::tearDown() "
            .'فلم يُتراجَع عن معاملة قاعدة البيانات وبقي قفلها. Laravel يغلق Mockery بعد التراجع — احذف الاستدعاء.');
    }

    /** @test */
    public function the_legacy_tear_down_shape_leaks_the_row_lock_of_a_failed_test(): void
    {
        $this->requirePostgres();

        $results = $this->runProbe('protected function tearDown(): void { \Mockery::close(); parent::tearDown(); }');

        $this->assertSame('error', $results['a']['status'], 'المسبار «أ» يجب أن يفشل بتوقّع غير مستوفى.');
        $this->assertSame('error', $results['b']['status'],
            'الشكل القديم لم يسرّب القفل: المسبار لم يعد يعيد إنتاج الحادثة، فلا يثبت الإصلاح شيئاً.');
        $this->assertStringContainsString('55P03', $results['b']['message']);
    }

    /** @test */
    public function laravel_tear_down_releases_the_row_lock_and_still_reports_the_failure(): void
    {
        $this->requirePostgres();

        $results = $this->runProbe('');

        $this->assertSame('error', $results['a']['status'], 'التوقّع غير المستوفى يجب أن يبقى فشلاً مُبلَّغاً.');
        $this->assertStringContainsString('should be called', $results['a']['message']);
        $this->assertSame('passed', $results['b']['status'],
            'القفل بقي بعد فشل «أ»: لم يُتراجَع عن معاملته. '.$results['b']['message']);
    }

    private function requirePostgres(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('إثبات تسرّب القفل خاصٌّ بـPostgreSQL (لا FOR UPDATE في SQLite).');
        }
    }

    /**
     * يشغّل صنف المسبار في عملية PHPUnit مستقلة على قاعدة هذا العامل نفسها،
     * ويعيد حالة الاختبارين من تقرير JUnit.
     *
     * @return array{a: array{status: string, message: string}, b: array{status: string, message: string}}
     */
    private function runProbe(string $tearDown): array
    {
        $class = 'TeardownProbe'.bin2hex(random_bytes(6));
        $dir = sys_get_temp_dir().'/awj-teardown-probe-'.$class;
        mkdir($dir, 0700, true);
        $file = "{$dir}/{$class}.php";
        $junit = "{$dir}/junit.xml";
        file_put_contents($file, $this->probeSource($class, $tearDown));

        try {
            $env = getenv();
            // المسبار ليس عاملاً متوازياً: بلا هذه المفاتيح يبدّل Laravel القاعدة إلى `<db>_test_<token>`.
            foreach (['LARAVEL_PARALLEL_TESTING', 'TEST_TOKEN', 'UNIQUE_TEST_TOKEN', 'PARATEST'] as $key) {
                $env[$key] = false;
            }
            $env['DB_CONNECTION'] = 'pgsql';
            $env['DB_DATABASE'] = (string) config('database.connections.pgsql.database');

            $process = new Process(
                [PHP_BINARY, base_path('vendor/bin/phpunit'), '-c', base_path('phpunit.xml'),
                    '--do-not-cache-result', '--log-junit', $junit, $file],
                base_path(), $env, null, 120,
            );
            $process->run();

            $this->assertFileExists($junit, "لم يُنتج المسبار تقريراً:\n".$process->getOutput().$process->getErrorOutput());

            return $this->readJunit($junit);
        } finally {
            @unlink($file);
            @unlink($junit);
            @rmdir($dir);
        }
    }

    private function probeSource(string $class, string $tearDown): string
    {
        return <<<PHP
<?php

namespace Tests\Feature\TeardownProbe;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class {$class} extends TestCase
{
    use DatabaseTransactions;

    {$tearDown}

    public function test_a(): void
    {
        // الاستعلام نفسه الذي علِق في الحادثة، داخل معاملة DatabaseTransactions.
        DB::select('SELECT id FROM tenant_reference_number_sequences WHERE id = 1 FOR UPDATE');
        \Mockery::mock()->shouldReceive('neverCalled')->once();
        \$this->assertTrue(true);
    }

    public function test_b(): void
    {
        DB::select('SELECT id FROM tenant_reference_number_sequences WHERE id = 1 FOR UPDATE NOWAIT');
        \$this->assertTrue(true);
    }
}
PHP;
    }

    /** @return array<string, array{status: string, message: string}> */
    private function readJunit(string $path): array
    {
        $xml = simplexml_load_file($path);
        $this->assertNotFalse($xml, 'تقرير JUnit غير صالح.');

        $results = [];
        foreach ($xml->xpath('//testcase') ?: [] as $case) {
            $name = substr((string) $case['name'], strlen('test_'));
            $status = 'passed';
            $message = '';
            foreach (['error', 'failure'] as $kind) {
                if (isset($case->{$kind})) {
                    $status = 'error';
                    $message = (string) $case->{$kind};
                }
            }
            $results[$name] = ['status' => $status, 'message' => $message];
        }

        $this->assertArrayHasKey('a', $results, 'المسبار «أ» لم يُشغَّل.');
        $this->assertArrayHasKey('b', $results, 'المسبار «ب» لم يُشغَّل.');

        return $results;
    }

    /** جسم `tearDown()` المعرَّف في الملف (بموازنة الأقواس)، أو null إن لم يُعرَّف. */
    private function tearDownBody(string $source): ?string
    {
        if (! preg_match('/function\s+tearDown\s*\(\s*\)\s*(?::\s*void\s*)?\{/', $source, $m, PREG_OFFSET_CAPTURE)) {
            return null;
        }
        $start = $m[0][1] + strlen($m[0][0]);
        $depth = 1;
        for ($i = $start, $n = strlen($source); $i < $n; $i++) {
            $depth += $source[$i] === '{' ? 1 : ($source[$i] === '}' ? -1 : 0);
            if ($depth === 0) {
                return substr($source, $start, $i - $start);
            }
        }

        return substr($source, $start);
    }
}
