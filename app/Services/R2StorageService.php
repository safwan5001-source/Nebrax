<?php

namespace App\Services;

use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Aws\S3\S3Client;
use Aws\S3\S3ClientInterface;
use RuntimeException;

/**
 * Narrow, ACL-free R2 proof path. Existing storage flows do not use this service.
 *
 * Tenant identity is always read from TenantContext; callers cannot supply a
 * tenant prefix or an arbitrary object key. The service intentionally exposes
 * no listing, URL, visibility, or migration operation.
 */
final class R2StorageService
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly ?S3ClientInterface $client = null,
    ) {}

    /** @param string|resource $body */
    public function put(string $domain, string $resourceId, string $filename, $body, ?string $contentType = null): string
    {
        if (! is_string($body) && ! is_resource($body)) {
            throw new RuntimeException('R2 storage body must be a string or readable stream.');
        }
        if (is_resource($body) && ! is_readable($body)) {
            throw new RuntimeException('R2 storage body stream must be readable.');
        }

        $key = $this->key($domain, $resourceId, $filename);
        $parameters = [
            'Bucket' => $this->settings()['bucket'],
            'Key' => $key,
            'Body' => $body,
        ];
        if ($contentType !== null && $contentType !== '') {
            $parameters['ContentType'] = $contentType;
        }

        $this->client()->putObject($parameters);

        return $key;
    }

    /** @return mixed The AWS SDK response Body stream */
    public function get(string $domain, string $resourceId, string $filename)
    {
        $result = $this->client()->getObject([
            'Bucket' => $this->settings()['bucket'],
            'Key' => $this->key($domain, $resourceId, $filename),
        ]);

        return $result['Body'];
    }

    public function exists(string $domain, string $resourceId, string $filename): bool
    {
        try {
            $this->client()->headObject([
                'Bucket' => $this->settings()['bucket'],
                'Key' => $this->key($domain, $resourceId, $filename),
            ]);

            return true;
        } catch (AwsException $exception) {
            if ($exception->getStatusCode() === 404 || $exception->getAwsErrorCode() === 'NoSuchKey') {
                return false;
            }

            throw $exception;
        }
    }

    public function delete(string $domain, string $resourceId, string $filename): void
    {
        $this->client()->deleteObject([
            'Bucket' => $this->settings()['bucket'],
            'Key' => $this->key($domain, $resourceId, $filename),
        ]);
    }

    public function key(string $domain, string $resourceId, string $filename): string
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null || $tenantId === '') {
            throw new RuntimeException('R2 storage requires an active tenant context.');
        }

        foreach ([$tenantId, $domain, $resourceId, $filename] as $segment) {
            if ($segment === '' || preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]{0,127}\z/', $segment) !== 1 || str_contains($segment, '..')) {
                throw new RuntimeException('R2 object key contains an unsafe path segment.');
            }
        }

        return "tenant/{$tenantId}/{$domain}/{$resourceId}/{$filename}";
    }

    private function client(): S3ClientInterface
    {
        if ($this->client !== null) {
            return $this->client;
        }

        $settings = $this->settings();

        return new S3Client([
            'version' => 'latest',
            'region' => $settings['region'],
            'endpoint' => $settings['endpoint'],
            'use_path_style_endpoint' => $settings['use_path_style_endpoint'],
            'credentials' => [
                'key' => $settings['key'],
                'secret' => $settings['secret'],
            ],
        ]);
    }

    /** @return array{key:string,secret:string,bucket:string,endpoint:string,region:string,use_path_style_endpoint:bool} */
    private function settings(): array
    {
        $settings = [
            'key' => (string) config('filesystems.disks.r2.key', ''),
            'secret' => (string) config('filesystems.disks.r2.secret', ''),
            'bucket' => (string) config('filesystems.disks.r2.bucket', ''),
            'endpoint' => (string) config('filesystems.disks.r2.endpoint', ''),
            'region' => (string) config('filesystems.disks.r2.region', 'auto'),
            'use_path_style_endpoint' => (bool) config('filesystems.disks.r2.use_path_style_endpoint', false),
        ];

        foreach (['key', 'secret', 'bucket', 'endpoint'] as $required) {
            if ($settings[$required] === '') {
                throw new RuntimeException("R2 storage setting is missing: {$required}.");
            }
        }

        return $settings;
    }
}
