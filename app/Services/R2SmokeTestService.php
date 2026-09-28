<?php

namespace App\Services;

use Aws\Exception\AwsException;
use Aws\S3\S3Client;
use Aws\S3\S3ClientInterface;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Bounded, manual-only R2 diagnostic. This is deliberately separate from
 * R2StorageService so tenant-scoped storage cannot be widened by the smoke test.
 */
final class R2SmokeTestService
{
    private const PREFIX = 'system/r2-smoke-test/';
    private const PAYLOAD = 'AWJ R2 smoke test payload';

    public function __construct(private readonly ?S3ClientInterface $client = null) {}

    /** @return array{success:bool,category:string,key:?string,steps:array<string,string>,message:?string} */
    public function run(): array
    {
        $steps = [
            'write' => 'NOT_RUN',
            'exists' => 'NOT_RUN',
            'read' => 'NOT_RUN',
            'delete' => 'NOT_RUN',
            'cleanup' => 'NOT_RUN',
        ];
        $key = self::PREFIX . Str::uuid()->toString() . '.txt';
        $written = false;
        $cleanupConfirmed = false;
        $failureCategory = null;
        $failureMessage = null;

        try {
            $settings = $this->settings();
            $client = $this->client($settings);
            $parameters = [
                'Bucket' => $settings['bucket'],
                'Key' => $key,
                'Body' => self::PAYLOAD,
                'ContentType' => 'text/plain',
            ];

            $client->putObject($parameters);
            $written = true;
            $steps['write'] = 'PASS';

            if (! $this->objectExists($client, $settings['bucket'], $key)) {
                throw new RuntimeException('exists failure');
            }
            $steps['exists'] = 'PASS';

            $body = $client->getObject([
                'Bucket' => $settings['bucket'],
                'Key' => $key,
            ])['Body'] ?? null;
            if ($this->bodyContents($body) !== self::PAYLOAD) {
                throw new RuntimeException('read mismatch');
            }
            $steps['read'] = 'PASS';

            $client->deleteObject([
                'Bucket' => $settings['bucket'],
                'Key' => $key,
            ]);
            $steps['delete'] = 'PASS';

            if ($this->objectExists($client, $settings['bucket'], $key)) {
                throw new RuntimeException('cleanup could not be confirmed');
            }
            $steps['cleanup'] = 'PASS';
            $cleanupConfirmed = true;
        } catch (Throwable $exception) {
            $failureCategory = $this->categoryFor($steps, $exception);
            $failureMessage = $failureCategory;
        } finally {
            if ($written && ! $cleanupConfirmed) {
                try {
                    $settings ??= $this->settings();
                    $client ??= $this->client($settings);
                    $client->deleteObject([
                        'Bucket' => $settings['bucket'],
                        'Key' => $key,
                    ]);
                    if ($this->objectExists($client, $settings['bucket'], $key)) {
                        throw new RuntimeException('temporary object still exists');
                    }
                    $steps['cleanup'] = 'PASS';
                    $cleanupConfirmed = true;
                } catch (Throwable) {
                    $steps['cleanup'] = 'FAIL';
                    $failureCategory = 'cleanup could not be confirmed';
                    $failureMessage = $failureCategory;
                }
            }
        }

        $success = $failureCategory === null && $cleanupConfirmed;
        if ($success) {
            $failureMessage = null;
        }

        return [
            'success' => $success,
            'category' => $success ? 'pass' : ($failureCategory ?? 'cleanup could not be confirmed'),
            'key' => $success || $steps['cleanup'] === 'FAIL' ? $key : null,
            'steps' => $steps,
            'message' => $failureMessage,
        ];
    }

    public static function prefix(): string
    {
        return self::PREFIX;
    }

    private function objectExists(S3ClientInterface $client, string $bucket, string $key): bool
    {
        try {
            $client->headObject(['Bucket' => $bucket, 'Key' => $key]);
            return true;
        } catch (AwsException $exception) {
            if ($exception->getStatusCode() === 404 || $exception->getAwsErrorCode() === 'NoSuchKey') {
                return false;
            }
            throw $exception;
        }
    }

    private function bodyContents(mixed $body): string
    {
        if (is_resource($body)) {
            return (string) stream_get_contents($body);
        }
        if (is_object($body) && method_exists($body, 'getContents')) {
            return (string) $body->getContents();
        }
        return is_string($body) ? $body : (string) $body;
    }

    /** @param array{key:string,secret:string,bucket:string,endpoint:string,region:string,use_path_style_endpoint:bool} $settings */
    private function client(array $settings): S3ClientInterface
    {
        if ($this->client !== null) {
            return $this->client;
        }

        return new S3Client([
            'version' => 'latest',
            'region' => $settings['region'],
            'endpoint' => $settings['endpoint'],
            'use_path_style_endpoint' => $settings['use_path_style_endpoint'],
            'credentials' => ['key' => $settings['key'], 'secret' => $settings['secret']],
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
                throw new RuntimeException('missing configuration');
            }
        }

        return $settings;
    }

    /** @param array<string,string> $steps */
    private function categoryFor(array $steps, Throwable $exception): string
    {
        if (in_array($exception->getMessage(), [
            'exists failure',
            'read mismatch',
            'cleanup could not be confirmed',
        ], true)) {
            return $exception->getMessage();
        }
        if ($steps['write'] === 'NOT_RUN') {
            return $exception->getMessage() === 'missing configuration'
                ? 'missing configuration'
                : 'authentication/connection failure';
        }
        if ($steps['exists'] === 'NOT_RUN') {
            return 'exists failure';
        }
        if ($steps['read'] === 'NOT_RUN') {
            return 'read failure';
        }
        if ($steps['delete'] === 'NOT_RUN') {
            return 'delete failure';
        }
        return 'cleanup could not be confirmed';
    }
}
