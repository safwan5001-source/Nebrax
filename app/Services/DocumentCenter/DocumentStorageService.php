<?php

namespace App\Services\DocumentCenter;

use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/** عقد تخزين خاص محايد عن R2/S3؛ بيانات الاتصال لا تدخل صفوف التشغيل. */
class DocumentStorageService
{
    public function profile(): string
    {
        return (string) config('document_center.storage.profile', 'platform');
    }

    /** @param resource $stream */
    public function put(string $profile, string $objectKey, $stream): void
    {
        if (! is_resource($stream)) {
            throw new RuntimeException('Document storage requires a readable stream.');
        }

        $written = $this->filesystem($profile)->put($objectKey, $stream, ['visibility' => 'private']);
        if (! $written) {
            throw new RuntimeException('Document storage write failed.');
        }
    }

    /** @return resource */
    public function readStream(string $profile, string $objectKey)
    {
        $stream = $this->filesystem($profile)->readStream($objectKey);
        if (! is_resource($stream)) {
            throw new RuntimeException('Document storage object is unavailable.');
        }

        return $stream;
    }

    public function exists(string $profile, string $objectKey): bool
    {
        return $this->filesystem($profile)->exists($objectKey);
    }

    public function delete(string $profile, string $objectKey): void
    {
        $this->filesystem($profile)->delete($objectKey);
    }

    private function filesystem(string $profile): Filesystem
    {
        if ($profile !== $this->profile()) {
            throw new RuntimeException('Unknown document storage profile.');
        }

        $driver = (string) config('document_center.storage.driver', 'local');
        if ($driver === 'local') {
            return Storage::disk((string) config('document_center.storage.disk', 'local'));
        }
        if ($driver !== 's3') {
            throw new RuntimeException('Unsupported document storage driver.');
        }

        foreach (['key', 'secret', 'bucket', 'endpoint'] as $required) {
            if (blank(config("document_center.storage.{$required}"))) {
                throw new RuntimeException("Document storage setting is missing: {$required}.");
            }
        }

        return Storage::build([
            'driver' => 's3',
            'key' => config('document_center.storage.key'),
            'secret' => config('document_center.storage.secret'),
            'region' => config('document_center.storage.region', 'auto'),
            'bucket' => config('document_center.storage.bucket'),
            'endpoint' => config('document_center.storage.endpoint'),
            'url' => config('document_center.storage.url'),
            'use_path_style_endpoint' => (bool) config('document_center.storage.use_path_style_endpoint', true),
            'throw' => true,
            'visibility' => 'private',
        ]);
    }
}
