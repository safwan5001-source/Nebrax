<?php

namespace App\Services\DocumentCenter;

use App\Services\PlatformIntegrationResolver;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/** عقد تخزين خاص محايد عن R2/S3؛ بيانات الاتصال لا تدخل صفوف التشغيل. */
class DocumentStorageService
{
    public function __construct(private readonly PlatformIntegrationResolver $integrations) {}

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
        if (! $this->filesystem($profile)->delete($objectKey)) {
            throw new RuntimeException('Document storage delete failed.');
        }
    }

    /** اختبار كتابة وقراءة وحذف لكائن مؤقت لا يتضمن أي بيانات عميل. */
    public function healthCheck(): bool
    {
        $key = 'healthchecks/'.Str::uuid().'.txt';
        $filesystem = $this->filesystem($this->profile());
        try {
            if (! $filesystem->put($key, 'nebrax-storage-health', ['visibility' => 'private'])) {
                return false;
            }

            return $filesystem->exists($key);
        } finally {
            $filesystem->delete($key);
        }
    }

    private function filesystem(string $profile): Filesystem
    {
        if ($profile !== $this->profile()) {
            throw new RuntimeException('Unknown document storage profile.');
        }

        $settings = $this->settings();
        if ($settings['driver'] === 'local') {
            return Storage::disk((string) $settings['disk']);
        }
        if ($settings['driver'] !== 's3') {
            throw new RuntimeException('Unsupported document storage driver.');
        }

        foreach (['key', 'secret', 'bucket', 'endpoint'] as $required) {
            if (blank($settings[$required] ?? null)) {
                throw new RuntimeException("Document storage setting is missing: {$required}.");
            }
        }

        return Storage::build([
            'driver' => 's3',
            'key' => $settings['key'],
            'secret' => $settings['secret'],
            'region' => $settings['region'],
            'bucket' => $settings['bucket'],
            'endpoint' => $settings['endpoint'],
            'url' => $settings['url'],
            'use_path_style_endpoint' => $settings['use_path_style_endpoint'],
            'throw' => true,
            'visibility' => 'private',
        ]);
    }

    /** @return array<string, mixed> */
    private function settings(): array
    {
        $base = [
            'driver' => (string) config('document_center.storage.driver', 'local'),
            'disk' => (string) config('document_center.storage.disk', 'local'),
            'key' => config('document_center.storage.key'),
            'secret' => config('document_center.storage.secret'),
            'region' => config('document_center.storage.region', 'auto'),
            'bucket' => config('document_center.storage.bucket'),
            'endpoint' => config('document_center.storage.endpoint'),
            'url' => config('document_center.storage.url'),
            'use_path_style_endpoint' => (bool) config('document_center.storage.use_path_style_endpoint', true),
        ];

        // قرار تشغيلي مؤقت: التخزين الدائم مؤجل لكل النظام.
        // وجود إعداد R2/S3 محفوظ في منصة الإدارة لا يفعّله ما لم يُفتح هذا القفل صراحةً.
        if (! (bool) config('document_center.storage.persistent_enabled', false)) {
            return array_replace($base, [
                'driver' => 'local',
                'disk' => (string) config('document_center.storage.disk', 'local'),
            ]);
        }

        $platform = $this->integrations->activeConfiguration('document_storage');
        if ($platform === []) {
            return $base;
        }

        return array_replace($base, [
            'driver' => 's3',
            'key' => $platform['access_key_id'] ?? null,
            'secret' => $platform['secret_access_key'] ?? null,
            'region' => $platform['region'] ?? 'auto',
            'bucket' => $platform['bucket'] ?? null,
            'endpoint' => $platform['endpoint'] ?? null,
            'url' => null,
            'use_path_style_endpoint' => (bool) ($platform['use_path_style_endpoint'] ?? true),
        ]);
    }
}
