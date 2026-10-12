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

    private function awsError(string $code, int $status, ?string $message = null): AwsException
    {
        $command = Mockery::mock(CommandInterface::class);
        $command->shouldReceive('getName')->andReturn('PutObject');

        return new AwsException("secret-bearing raw message SECRET-X {$code}", $command, ['code' => $code, 'message' => $message, 'response' => new \GuzzleHttp\Psr7\Response($status)]);
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
        // path: get NoSuchKey (creds+bucket ok) · put no-acl OK · put acl FAIL 501 NotImplemented · delete OK ×2
        // virtual: head 403 · put 403 · put-acl 403 · delete 403
        $queue = [
            $this->awsError('NoSuchKey', 404), new Result([]), $this->awsError('NotImplemented', 501), new Result([]), new Result([]),
            $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403), $this->awsError('AccessDenied', 403),
        ];
        $report = $this->serviceWithSdk($queue)->diagnosePlatformConfiguration();

        $this->assertSame('YES (should be empty)', $report['endpoint_has_path']);
        $this->assertStringStartsWith('OK (NoSuchKey', $report['path.get_missing_key']);
        $this->assertSame('OK', $report['path.put_no_acl']);
        $this->assertSame('FAIL: AwsException NotImplemented http=501', $report['path.put_acl_private']);
        $this->assertSame('FAIL: AwsException AccessDenied http=403', $report['virtual.get_missing_key']);
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

    /** @test */
    public function a_missing_bucket_is_not_reported_as_valid_credentials(): void
    {
        $this->integration();
        $queue = array_merge(
            [$this->awsError('NoSuchBucket', 404), new Result([]), new Result([]), new Result([]), new Result([])],
            [$this->awsError('NoSuchBucket', 404), new Result([]), new Result([]), new Result([]), new Result([])],
        );
        $report = $this->serviceWithSdk($queue)->diagnosePlatformConfiguration();

        $this->assertSame('FAIL: AwsException NoSuchBucket http=404', $report['path.get_missing_key']);
    }

    /** @test */
    public function both_diagnostic_objects_are_deleted_even_when_the_first_deletion_fails(): void
    {
        $this->integration();
        $deleted = [];
        $service = Mockery::mock(DocumentStorageService::class, [app(\App\Services\PlatformIntegrationResolver::class)])->makePartial();
        $service->shouldAllowMockingProtectedMethods();
        $service->shouldReceive('makeS3Client')->andReturnUsing(function () use (&$deleted): S3ClientInterface {
            $handler = function (CommandInterface $command, RequestInterface $request) use (&$deleted) {
                if ($command->getName() === 'DeleteObject') {
                    $deleted[] = $command['Key'];
                    if (count($deleted) % 2 === 1) {
                        return \GuzzleHttp\Promise\Create::rejectionFor($this->awsError('InternalError', 500));
                    }
                }

                return \GuzzleHttp\Promise\Create::promiseFor(new Result([]));
            };

            return new S3Client(['version' => 'latest', 'region' => 'auto', 'endpoint' => 'https://x.r2.cloudflarestorage.com', 'credentials' => ['key' => 'k', 'secret' => 's'], 'retries' => 0, 'handler' => $handler]);
        });

        $report = $service->diagnosePlatformConfiguration();

        $this->assertSame('FAIL: AwsException InternalError http=500', $report['path.delete']);
        $this->assertSame('OK', $report['path.delete_acl_object'], 'the second object is still attempted');
        $this->assertCount(4, $deleted);
    }

    /** @test */
    public function the_sanitised_s3_message_names_the_rejected_parameter_without_leaking_secrets(): void
    {
        $badKey = 'cfat_'.str_repeat('Q', 35); // 40 محرفاً: «Token value» ملصوق بدل Access Key ID
        $this->integration(['access_key_id' => $badKey]);
        $message = "Credential access key has length 40, should be 32 (key {$badKey}) token ".str_repeat('Z', 30);
        $queue = array_fill(0, 10, $this->awsError('InvalidArgument', 400, $message));
        $report = $this->serviceWithSdk($queue)->diagnosePlatformConfiguration();
        $json = json_encode($report, JSON_UNESCAPED_UNICODE);

        $this->assertStringContainsString('Credential access key has length 40, should be 32', $report['path.get_missing_key']);
        $this->assertStringContainsString('InvalidArgument http=400', $report['path.get_missing_key']);
        $this->assertStringNotContainsString($badKey, $json);
        $this->assertStringNotContainsString(str_repeat('Z', 30), $json);
        $this->assertStringNotContainsString('SECRET-X', $json);
        $this->assertStringContainsString('[REDACTED]', $report['path.get_missing_key']);
    }

    /** @test */
    public function the_credential_shape_flags_a_wrong_length_charset_and_whitespace_without_showing_values(): void
    {
        $badKey = "cfat_abc123DEF456ghi789JKL012mno345pqr678\n"; // طول ≠ 32 + محارف غير سداسية + سطر جديد
        $this->integration(['access_key_id' => $badKey, 'bucket' => 'Bad_Bucket']);
        $report = $this->serviceWithSdk([])->diagnosePlatformConfiguration();

        $this->assertStringContainsString('MISMATCH', $report['access_key_id_length']);
        $this->assertStringContainsString('R2 expects hex', $report['access_key_id_charset']);
        $this->assertStringStartsWith('YES', $report['access_key_id_whitespace']);
        $this->assertStringStartsWith('NO', $report['bucket_name_valid']);
        $this->assertStringNotContainsString('abc123DEF456', json_encode($report));
    }

    /** @test */
    public function a_well_formed_credential_shape_is_reported_clean(): void
    {
        $this->integration(['access_key_id' => str_repeat('a1', 16), 'secret_access_key' => str_repeat('b2', 32)]);
        $report = $this->serviceWithSdk([])->diagnosePlatformConfiguration();

        $this->assertSame('32 (R2 expects 32)', $report['access_key_id_length']);
        $this->assertSame('hex', $report['access_key_id_charset']);
        $this->assertSame('no', $report['access_key_id_whitespace']);
        $this->assertSame('64 (R2 expects 64)', $report['secret_length']);
        $this->assertSame('yes', $report['bucket_name_valid']);
    }
}
