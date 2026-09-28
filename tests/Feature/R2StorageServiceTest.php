<?php

namespace Tests\Feature;

use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Response;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class R2StorageServiceTest extends TestCase
{
    protected function tearDown(): void
    {
        app(TenantContext::class)->forget();
        Mockery::close();
        parent::tearDown();
    }

    public function test_key_is_server_derived_and_tenant_prefixed(): void
    {
        app(TenantContext::class)->set('tenant-a');
        $service = new R2StorageService(app(TenantContext::class), Mockery::mock(S3ClientInterface::class));

        $this->assertSame('tenant/tenant-a/documents/file-1/report.pdf', $service->key('documents', 'file-1', 'report.pdf'));
    }

    public function test_missing_tenant_and_traversal_are_rejected(): void
    {
        $service = new R2StorageService(app(TenantContext::class), Mockery::mock(S3ClientInterface::class));
        $this->assertThrows(
            fn () => $service->key('documents', 'file-1', 'report.pdf'),
            RuntimeException::class,
        );

        app(TenantContext::class)->set('tenant-a');
        $this->assertThrows(
            fn () => $service->key('../documents', 'file-1', 'report.pdf'),
            RuntimeException::class,
        );
    }

    public function test_put_get_exists_and_delete_use_only_acl_free_object_operations(): void
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-access-key',
            'secret' => 'placeholder-secret-key',
            'bucket' => 'placeholder-bucket',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto',
            'use_path_style_endpoint' => false,
        ]);
        app(TenantContext::class)->set('tenant-a');
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldNotReceive('putObjectAcl');
        $client->shouldNotReceive('getObjectAcl');
        $key = 'tenant/tenant-a/documents/file-1/report.pdf';
        $client->shouldReceive('putObject')->once()->with(Mockery::on(fn (array $args): bool => $args['Bucket'] === 'placeholder-bucket'
            && $args['Key'] === $key
            && $args['Body'] === 'payload'
            && $args['ContentType'] === 'application/pdf'
            && ! array_key_exists('ACL', $args)
        ))->andReturn([]);
        $client->shouldReceive('getObject')->once()->with(['Bucket' => 'placeholder-bucket', 'Key' => $key])->andReturn(['Body' => 'read-body']);
        $client->shouldReceive('headObject')->once()->with(['Bucket' => 'placeholder-bucket', 'Key' => $key])->andReturn([]);
        $client->shouldReceive('deleteObject')->once()->with(['Bucket' => 'placeholder-bucket', 'Key' => $key])->andReturn([]);

        $service = new R2StorageService(app(TenantContext::class), $client);
        $this->assertSame($key, $service->put('documents', 'file-1', 'report.pdf', 'payload', 'application/pdf'));
        $this->assertSame('read-body', $service->get('documents', 'file-1', 'report.pdf'));
        $this->assertTrue($service->exists('documents', 'file-1', 'report.pdf'));
        $service->delete('documents', 'file-1', 'report.pdf');
    }

    public function test_exists_returns_false_for_missing_object_without_acl_call(): void
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-access-key', 'secret' => 'placeholder-secret-key',
            'bucket' => 'placeholder-bucket', 'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto', 'use_path_style_endpoint' => false,
        ]);
        app(TenantContext::class)->set('tenant-a');
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldNotReceive('putObjectAcl');
        $client->shouldNotReceive('getObjectAcl');
        $client->shouldReceive('headObject')->once()->andThrow(new AwsException(
            'missing',
            Mockery::mock('Aws\\CommandInterface'),
            ['code' => 'NoSuchKey', 'response' => new Response(404)],
        ));

        $this->assertFalse((new R2StorageService(app(TenantContext::class), $client))->exists('documents', 'file-1', 'report.pdf'));
    }

    public function test_missing_r2_configuration_fails_before_client_operation(): void
    {
        config()->set('filesystems.disks.r2', []);
        app(TenantContext::class)->set('tenant-a');
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldNotReceive('putObject');

        $this->expectException(RuntimeException::class);
        (new R2StorageService(app(TenantContext::class), $client))->put('documents', 'file-1', 'report.pdf', 'payload');
    }

    public function test_no_existing_storage_flow_selects_r2(): void
    {
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app')));
        $source = '';
        foreach ($files as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $source .= (string) file_get_contents($file->getPathname());
            }
        }

        $this->assertStringNotContainsString("Storage::disk('r2')", $source);
        $this->assertStringNotContainsString('Storage::build([\'driver\' => \'r2\'', $source);
    }
}
