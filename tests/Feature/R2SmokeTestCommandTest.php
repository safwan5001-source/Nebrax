<?php

namespace Tests\Feature;

use App\Console\Commands\AwjR2SmokeTestCommand;
use App\Services\R2SmokeTestService;
use Aws\Exception\AwsException;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Response;
use Illuminate\Support\Str;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class R2SmokeTestCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    public function test_happy_path_uses_internal_system_key_and_only_allowed_operations(): void
    {
        $this->fakeR2Config();
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldNotReceive('putObjectAcl');
        $client->shouldNotReceive('getObjectAcl');
        $client->shouldNotReceive('listObjects');
        $client->shouldNotReceive('listObjectsV2');
        $client->shouldNotReceive('listBuckets');
        $key = null;
        $client->shouldReceive('putObject')->once()->with(Mockery::on(function (array $args) use (&$key): bool {
            $key = $args['Key'];
            return str_starts_with($key, R2SmokeTestService::prefix())
                && Str::isUuid(basename($key, '.txt'))
                && $args['Body'] === 'AWJ R2 smoke test payload'
                && ! array_key_exists('ACL', $args)
                && ! array_key_exists('x-amz-acl', $args);
        }))->andReturn([]);
        $headCalls = 0;
        $missing = $this->missingObject();
        $client->shouldReceive('headObject')->twice()->with(Mockery::on(function (array $args) use (&$key): bool {
            return $args['Bucket'] === 'placeholder-bucket' && $args['Key'] === $key;
        }))->andReturnUsing(function () use (&$headCalls, $missing): array {
            $headCalls++;
            if ($headCalls === 1) {
                return [];
            }
            throw $missing;
        });
        $client->shouldReceive('getObject')->once()->with(Mockery::on(function (array $args) use (&$key): bool {
            return $args['Bucket'] === 'placeholder-bucket' && $args['Key'] === $key;
        }))->andReturn(['Body' => 'AWJ R2 smoke test payload']);
        $client->shouldReceive('deleteObject')->once()->with(Mockery::on(function (array $args) use (&$key): bool {
            return $args['Bucket'] === 'placeholder-bucket' && $args['Key'] === $key;
        }))->andReturn([]);

        $result = (new R2SmokeTestService($client))->run();

        $this->assertTrue($result['success']);
        $this->assertSame('PASS', $result['steps']['write']);
        $this->assertSame('PASS', $result['steps']['exists']);
        $this->assertSame('PASS', $result['steps']['read']);
        $this->assertSame('PASS', $result['steps']['delete']);
        $this->assertSame('PASS', $result['steps']['cleanup']);
        $this->assertNotNull($key);
    }

    public function test_read_mismatch_fails_and_cleanup_attempts_the_exact_key(): void
    {
        $this->fakeR2Config();
        $client = Mockery::mock(S3ClientInterface::class);
        $key = null;
        $client->shouldReceive('putObject')->once()->with(Mockery::on(function (array $args) use (&$key): bool {
            $key = $args['Key'];
            return str_starts_with($key, 'system/r2-smoke-test/');
        }))->andReturn([]);
        $client->shouldReceive('headObject')->once()->andReturn([]);
        $client->shouldReceive('getObject')->once()->andReturn(['Body' => 'unexpected']);
        $client->shouldReceive('deleteObject')->once()->with(Mockery::on(function (array $args) use (&$key): bool {
            return $args['Key'] === $key;
        }))->andReturn([]);
        $client->shouldReceive('headObject')->once()->andThrow($this->missingObject());

        $result = (new R2SmokeTestService($client))->run();

        $this->assertFalse($result['success']);
        $this->assertSame('read mismatch', $result['category']);
        $this->assertSame('PASS', $result['steps']['cleanup']);
    }

    public function test_cleanup_failure_is_nonzero_and_exposes_only_safe_key(): void
    {
        $this->fakeR2Config();
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldReceive('putObject')->once()->andReturn([]);
        $client->shouldReceive('headObject')->once()->andReturn([]);
        $client->shouldReceive('getObject')->once()->andReturn(['Body' => 'unexpected']);
        $client->shouldReceive('deleteObject')->once()->andThrow(new RuntimeException('do not expose this'));

        $result = (new R2SmokeTestService($client))->run();

        $this->assertFalse($result['success']);
        $this->assertSame('cleanup could not be confirmed', $result['category']);
        $this->assertSame('FAIL', $result['steps']['cleanup']);
        $this->assertNotNull($result['key']);
        $this->assertStringStartsWith('system/r2-smoke-test/', $result['key']);
        $this->assertStringNotContainsString('do not expose this', (string) $result['message']);
    }

    public function test_missing_configuration_fails_before_any_network_operation(): void
    {
        config()->set('filesystems.disks.r2', []);
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldNotReceive('putObject');
        $client->shouldNotReceive('headObject');
        $client->shouldNotReceive('getObject');
        $client->shouldNotReceive('deleteObject');

        $result = (new R2SmokeTestService($client))->run();

        $this->assertFalse($result['success']);
        $this->assertSame('missing configuration', $result['category']);
        $this->assertNull($result['key']);
    }

    public function test_command_has_no_key_or_prefix_argument_and_service_cannot_target_tenant_paths(): void
    {
        $definition = (new AwjR2SmokeTestCommand())->getDefinition();
        $this->assertFalse($definition->hasArgument('key'));
        $this->assertFalse($definition->hasArgument('prefix'));
        $this->assertSame('system/r2-smoke-test/', R2SmokeTestService::prefix());

        $source = (string) file_get_contents(base_path('app/Services/R2SmokeTestService.php'));
        $this->assertStringNotContainsString("tenant/", $source);
        $this->assertStringNotContainsString('listObjects', $source);
        $this->assertStringNotContainsString('listBuckets', $source);
        $this->assertStringNotContainsString('putObjectAcl', $source);
        $this->assertStringNotContainsString('getObjectAcl', $source);
    }

    private function fakeR2Config(): void
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-access-key',
            'secret' => 'placeholder-secret-key',
            'bucket' => 'placeholder-bucket',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto',
            'use_path_style_endpoint' => false,
        ]);
    }

    private function missingObject(): AwsException
    {
        return new AwsException(
            'missing',
            Mockery::mock('Aws\\CommandInterface'),
            ['code' => 'NoSuchKey', 'response' => new Response(404)],
        );
    }
}
