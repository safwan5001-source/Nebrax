<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ApiController;
use Illuminate\Database\DeadlockException;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use PDOException;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * REM-04 / SEC-02 — `ApiController::domain()` يحوّل تعارض التزامن العابر بعد نفاد محاولات
 * المعاملة (deadlock 40P01 / serialization 40001) إلى 409 قابل لإعادة المحاولة بدل 500،
 * ولا يمسّ أي خطأ قاعدة بيانات آخر (يبقى 500 ولا يُخفى عطلٌ حقيقي) ولا أخطاء العمل (422).
 * لا قاعدة بيانات هنا: يعمل بلا تغيير على SQLite وPostgreSQL.
 */
class Rem04ConcurrencyFailureMappingTest extends TestCase
{
    private function run422or409(\Closure $fn): mixed
    {
        $controller = new class extends ApiController {
            public function run(\Closure $fn): mixed
            {
                return $this->domain($fn);
            }
        };

        return $controller->run($fn);
    }

    private function query(string $sqlState, string $message): QueryException
    {
        $pdo = new PDOException($message);
        $pdo->errorInfo = [$sqlState, 7, $message];

        return new QueryException('pgsql', 'update "tenants" set x = 1', [], $pdo);
    }

    private function assertRetryable409(\Closure $throw): void
    {
        try {
            $this->run422or409($throw);
            $this->fail('expected a 409');
        } catch (HttpException $e) {
            $this->assertSame(409, $e->getStatusCode());
            $this->assertSame('1', $e->getHeaders()['Retry-After'] ?? null);
            $this->assertStringNotContainsString('tenants', $e->getMessage(), 'لا تسرّب لنص SQL.');
            $this->assertStringNotContainsString('40P01', $e->getMessage());
        }
    }

    /** @test */
    public function a_deadlock_victim_becomes_a_retryable_409(): void
    {
        $this->assertRetryable409(fn () => throw $this->query('40P01', 'SQLSTATE[40P01]: Deadlock detected'));
    }

    /** @test */
    public function a_serialization_failure_becomes_a_retryable_409(): void
    {
        $this->assertRetryable409(fn () => throw $this->query('40001', 'SQLSTATE[40001]: Serialization failure'));
    }

    /** @test */
    public function laravels_nested_transaction_deadlock_wrapper_becomes_a_retryable_409(): void
    {
        // داخل معاملة متداخلة يلفّ Laravel الاستثناء بـDeadlockException (الأصل في previous).
        $this->assertRetryable409(fn () => throw new DeadlockException('deadlock detected', 0, $this->query('40P01', 'deadlock detected')));
        $this->assertRetryable409(fn () => throw new DeadlockException('deadlock detected'));
    }

    /** @test */
    public function any_other_database_error_is_still_rethrown_unchanged(): void
    {
        $original = $this->query('23505', 'SQLSTATE[23505]: Unique violation');

        try {
            $this->run422or409(fn () => throw $original);
            $this->fail('expected the PDOException to be rethrown');
        } catch (PDOException $e) {
            $this->assertSame($original, $e);
        }

        $other = $this->query('XX000', 'internal error');
        $this->expectException(QueryException::class);
        $this->run422or409(fn () => throw $other);
    }

    /** @test */
    public function business_errors_still_map_to_422_and_results_pass_through(): void
    {
        try {
            $this->run422or409(fn () => throw new RuntimeException('خطأ عمل'));
            $this->fail('expected 422');
        } catch (HttpException|HttpResponseException $e) {
            $this->assertSame(422, $e->getStatusCode());
            $this->assertSame('خطأ عمل', $e->getMessage());
        }

        $this->assertSame('ok', $this->run422or409(fn () => 'ok'));
    }
}
