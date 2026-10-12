<?php

namespace Tests\Feature;

use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\DocumentStorageService;
use Aws\CommandInterface;
use Aws\Exception\AwsException;
use Aws\MockHandler;
use Aws\Result;
use Aws\S3\S3Client;
use Aws\S3\S3ClientInterface;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Psr\Http\Message\RequestInterface;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S8 — تشخيص فشل كتابة R2 في Production: رمز خطأ S3 وحالة HTTP **بلا أسرار**،
 * وخطوات مستقلة تفصل فشل الكتابة عن فشل الحذف، ومصفوفة تشخيص (نمط العنونة × ACL) عند الفشل.
 *
 * تشغيل: php artisan test --filter=DocumentStorageDiagnoseTest
 */
class DocumentStorageDiagnoseTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function integration(array $overrides = []): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_storage', 'provider' => 'r2', 'enabled' => true,
            'configuration' => array_merge([
                'endpoint' => 'https://0123456789abcdef.r2.cloudflarestorage.com', 'bucket' => 'awj-documents',
                'region' => 'auto', 'access_key_id' => 'AKIA-X', 'secret_access_key' => 'SECRET-X',
            ], $overrides),
            'configured_at' => now(),
        ]);
    }

    private function awsError(string $code, int $status): AwsException
    {
        $command = Mockery::mock(CommandInterface::class);
        $command->shouldReceive('getName')->andReturn('PutObject');

        return new AwsException("secret-bearing raw message SECRET-X {$code}", $command, ['code' => $code, 'response' => new \GuzzleHttp\Psr7\Response($status)]);
    }

    /** @param array<int, \Aws\ResultInterface|\Throwable> $queue */
    private function serviceWithSdk(array $queue): DocumentStorageService
    {
        $service = Mockery::mock(DocumentStorageService::class, [app(\App\Services\PlatformIntegrationResolver::class)])->makePartial();
        $service->shouldAllowMockingProtectedMethods();
        $service->shouldReceive('makeS3Client')->andReturnUsing(function () use (&$queue): S3ClientInterface {
            return new S3Client([
                'version' => 'latest', 'region' => 'auto', 'endpoint' => 'https://x.r2.cloudflarestorage.com',
                'credentials' => ['key' => 'k', 'secret' => 's'],
                'handler' => new MockHandler(array_splice($queue, 0, 5)),
            ]);
        });

        return $service;
    }

    /** @test */
    public function a_failed_write_reports_the_s3_code_and_http_status_but_no_raw_message_or_secret(): void
    {
        $this->integration();
        $fs = Mockery::mock(Filesystem::class);
        $fs->shouldReceive('put')->andThrow(new \RuntimeException('UnableToWriteFile', 0, $this->awsError('AccessDenied', 403)));
        $fs->shouldReceive('exists')->andThrow(new \RuntimeException('x', 0, $this->awsError('AccessDenied', 403)));
        $fs->shouldReceive('get')->andThrow(new \RuntimeException('x', 0, $this->awsError('AccessDenied', 403)));
        $fs->shouldReceive('delete')->andThrow(new \RuntimeException('x', 0, $this->awsError('AccessDenied', 403)));
        Storage::shouldReceive('build')->andReturn($fs);

        $report = app(DocumentStorageService::class)->verifyPlatformConfiguration();

        $this->assertFalse($report['ok']);
        $this->assertSame('FAIL: RuntimeException ← AwsException AccessDenied http=403', $report['steps']['write']);
        // كل خطوة تُنفَّذ ولو فشلت سابقتها — فالنمط بينها هو التشخيص.
        foreach (['exists', 'content_intact', 'deleted'] as $step) {
            $this->assertStringStartsWith('FAIL:', (string) $report['steps'][$step], $step);
        }
        $this->assertStringNotContainsString('SECRET-X', json_encode($report));
        $this->assertStringNotContainsString('secret-bearing', json_encode($report));
    }

    /** @test */
    public function the_diagnosis_matrix_separates_credentials_from_acl_and_addressing(): void
    {
        $this->integration(['endpoint' => 'https://0123456789abcdef.r2.cloudflarestorage.com/awj-documents']);
        // path: head 404 (creds ok) · put no-acl OK · put acl FAIL 501 NotImplemented · delete OK
        // virtual: head 403 · put 403 · put-acl 403 · delete 403
        $queue = [
            $this->awsError('NotFound', 404), new Result([]), $this->awsError('NotImplemented', 501), new Result([]), new Result([]),
            $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403),
        ];
        $report = $this->serviceWithSdk($queue)->diagnosePlatformConfiguration();

        $this->assertSame('YES (should be empty)', $report['endpoint_has_path']);
        $this->assertStringStartsWith('OK (404', $report['path.head_missing_key']);
        $this->assertSame('OK', $report['path.put_no_acl']);
        $this->assertSame('FAIL: AwsException NotImplemented http=501', $report['path.put_acl_private']);
        $this->assertSame('FAIL: AwsException AccessDenied http=403', $report['virtual.head_missing_key']);
        $this->assertStringNotContainsString('SECRET-X', json_encode($report));
    }

    /** @test */
    public function the_diagnosis_without_an_active_integration_touches_nothing(): void
    {
        $this->assertSame(['integration' => 'disabled'], app(DocumentStorageService::class)->diagnosePlatformConfiguration());
    }

    /** @test */
    public function a_jurisdiction_endpoint_is_reported(): void
    {
        $this->integration(['endpoint' => 'https://0123456789abcdef.eu.r2.cloudflarestorage.com']);
        $report = $this->serviceWithSdk([])->diagnosePlatformConfiguration();

        $this->assertSame('eu', $report['endpoint_jurisdiction']);
        $this->assertSame('no', $report['endpoint_has_path']);
    }
}
