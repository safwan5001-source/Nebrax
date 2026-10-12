<?php

namespace App\Services\DocumentCenter;

use App\Services\PlatformIntegrationResolver;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Aws\Exception\AwsException;
use Aws\S3\S3Client;
use Aws\S3\S3ClientInterface;
use RuntimeException;
use Throwable;

/** عقد تخزين خاص محايد عن R2/S3؛ بيانات الاتصال لا تدخل صفوف التشغيل. */
class DocumentStorageService
{
    /**
     * ملفٌّ كُتب على التخزين الدائم المضبوط في تكامل المنصة: **يُقرأ ويُحذف من هناك دائماً**، بصرف النظر عن قفل
     * التشغيل الحالي. بلا هذا المؤشر كان إغلاق `DOCUMENT_DURABLE_STORAGE_ENABLED` بعد إنشاء مستندات يجعلها غير
     * مقروءة (الصف لا يعرف أين كُتب). الصفوف القديمة تحمل `platform` وتبقى تتبع القفل كما كانت (توافق خلفي).
     */
    public const PROFILE_DURABLE = 'platform-s3';

    public function __construct(private readonly PlatformIntegrationResolver $integrations) {}

    /**
     * ملف **الكتابة الجديدة** (يُسجَّل في صف المستند): `platform-s3` حين يكون التخزين الدائم فعلياً الآن (القفل مفتوح
     * وتكامل مفعَّل)، وإلا `platform` كالسابق. مستدعو `profile()` الآخرون (وسائط المنتج القديمة…) يحصلون على
     * `platform-s3` في الحالة نفسها، وهو يبني الـS3 نفسه الذي كان `platform` سيبنيه والقفل مفتوح — فلا فرق لهم.
     */
    public function profile(): string
    {
        return $this->persistentEnabled() && $this->integrations->activeConfiguration('document_storage') !== []
            ? self::PROFILE_DURABLE
            : $this->baseProfile();
    }

    private function baseProfile(): string
    {
        return (string) config('document_center.storage.profile', 'platform');
    }

    /** @param resource $stream */
    public function put(string $profile, string $objectKey, $stream): void
    {
        if (! is_resource($stream)) {
            throw new RuntimeException('Document storage requires a readable stream.');
        }

        $written = $this->filesystem($profile)->put($objectKey, $stream, $this->writeOptions());
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

    /** قفل التشغيل `DOCUMENT_DURABLE_STORAGE_ENABLED`: ما لم يُفتح، يبقى كل شيء على القرص المحلي. */
    public function persistentEnabled(): bool
    {
        return (bool) config('document_center.storage.persistent_enabled', false);
    }

    /** السائق الذي يستعمله التشغيل **الآن** (`local` أو `s3`) — يتبع القفل لا الإعداد المحفوظ وحده. */
    public function effectiveDriver(): string
    {
        return (string) $this->settings()['driver'];
    }

    /**
     * يتحقق من إعداد التكامل `document_storage` المحفوظ في المنصة **بمعزل عن قفل التشغيل**: كتابة ثم وجود ثم قراءة
     * ومطابقة المحتوى ثم حذف لكائن اصطناعي تحت `healthchecks/` لا يلمس أي مستأجر. لا يغيّر شيئاً في مسار التشغيل
     * العادي، فيُثبت جاهزية R2 **قبل** فتح القفل. لا يعيد أسراراً ولا رسائل استثناء — اسم الخطوة وفئة الخطأ فقط.
     *
     * @return array{ok:bool, steps:array<string,bool|string>, endpoint_host:?string, bucket:?string}
     */
    public function verifyPlatformConfiguration(): array
    {
        $settings = $this->settings(true);
        $platform = $this->integrations->activeConfiguration('document_storage');
        $host = parse_url((string) ($settings['endpoint'] ?? ''), PHP_URL_HOST);
        $result = ['ok' => false, 'steps' => [], 'endpoint_host' => is_string($host) ? $host : null, 'bucket' => $settings['bucket'] ?? null];
        if ($platform === []) {
            $result['steps']['integration_enabled'] = false;

            return $result;
        }
        $result['steps']['integration_enabled'] = true;

        try {
            $filesystem = $this->build($settings);
            $result['steps']['configuration_valid'] = true;
        } catch (RuntimeException $e) {
            $result['steps']['configuration_valid'] = $e->getMessage();

            return $result;
        } catch (Throwable $e) {
            $result['steps']['configuration_valid'] = class_basename($e);

            return $result;
        }

        $key = 'healthchecks/verify-'.Str::uuid().'.txt';
        $payload = 'awj-documents-storage-verify:'.Str::random(32);
        $options = $this->writeOptions($settings);
        // كل خطوة مستقلة: فشل الكتابة لا يُخفي نتيجة القراءة والحذف — النمط بينها يكشف السبب (اعتماد/دلو/endpoint ≠ ACL).
        // `deleted` بعد فشل كتابة لا يعني كائناً يتيماً: لم يُكتب شيء، وفشله غالباً الخطأ الجذري نفسه.
        $steps = [
            'write' => fn () => (bool) $filesystem->put($key, $payload, $options),
            'exists' => fn () => $filesystem->exists($key),
            'content_intact' => fn () => $filesystem->get($key) === $payload,
            'deleted' => function () use ($filesystem, $key) {
                $filesystem->delete($key);

                return ! $filesystem->exists($key);
            },
        ];
        foreach ($steps as $name => $run) {
            try {
                $result['steps'][$name] = $run() === true ? true : false;
            } catch (Throwable $e) {
                $result['steps'][$name] = 'FAIL: '.$this->describeFailure($e);
            }
        }

        $result['ok'] = collect(['write', 'exists', 'content_intact', 'deleted'])
            ->every(fn (string $step) => ($result['steps'][$step] ?? null) === true);

        return $result;
    }

    /**
     * سبب الفشل **بلا أسرار**: فئة الاستثناء + رمز خطأ S3 + حالة HTTP (حين وُجدت في سلسلة الأسباب). لا رسالة خام — قد تحوي
     * عنوان الطلب. مثال: `UnableToWriteFile ← S3Exception AccessDenied http=403`.
     */
    private function describeFailure(Throwable $e): string
    {
        $parts = [];
        for ($cause = $e; $cause !== null; $cause = $cause->getPrevious()) {
            $label = class_basename($cause);
            if ($cause instanceof AwsException) {
                $label .= ' '.($cause->getAwsErrorCode() ?: 'no-code');
                $status = $cause->getStatusCode();
                if ($status !== null) {
                    $label .= ' http='.$status;
                }
            }
            $parts[] = $label;
        }

        return implode(' ← ', $parts);
    }

    /**
     * تشخيص يُشغَّل **عند فشل التحقق فقط**: يفصل الأسباب المحتملة بمصفوفة صغيرة بالإعداد المحفوظ نفسه — SDK مباشر
     * (كما يعمل `R2StorageService` الذي أثبت نجاحه في Production) بنمطَي العنونة (path/virtual-hosted) مع ACL وبدونه.
     * HEAD لمفتاح غير موجود يجب أن يعيد `NotFound` (404) إن كان الاعتماد والدلو سليمين. كائنات اصطناعية تحت `healthchecks/`
     * وتُحذف؛ المخرجات رموز خطأ وحالات HTTP فقط.
     *
     * @return array<string, string>
     */
    public function diagnosePlatformConfiguration(): array
    {
        $platform = $this->integrations->activeConfiguration('document_storage');
        if ($platform === []) {
            return ['integration' => 'disabled'];
        }
        $settings = $this->settings(true);
        $endpoint = (string) ($settings['endpoint'] ?? '');
        $host = (string) parse_url($endpoint, PHP_URL_HOST);
        $path = (string) parse_url($endpoint, PHP_URL_PATH);
        $report = [
            'endpoint_is_r2_host' => $this->isCloudflareR2($settings) ? 'yes' : 'no',
            'endpoint_has_path' => ($path !== '' && $path !== '/') ? 'YES (should be empty)' : 'no',
            'endpoint_jurisdiction' => preg_match('/\.(eu|fedramp)\.r2\./i', $host, $m) === 1 ? strtolower($m[1]) : 'default',
            'region' => (string) ($settings['region'] ?? ''),
            'configured_path_style' => ($settings['use_path_style_endpoint'] ?? false) ? 'true' : 'false',
        ];

        foreach ([true => 'path', false => 'virtual'] as $pathStyle => $label) {
            try {
                $client = $this->makeS3Client($settings, (bool) $pathStyle);
            } catch (Throwable $e) {
                $report["{$label}.client"] = 'FAIL: '.$this->describeFailure($e);

                continue;
            }
            $bucket = (string) $settings['bucket'];
            $key = 'healthchecks/diagnose-'.Str::uuid().'.txt';
            $report["{$label}.head_missing_key"] = $this->probe(fn () => $client->headObject(['Bucket' => $bucket, 'Key' => $key]), expectNotFound: true);
            $report["{$label}.put_no_acl"] = $this->probe(fn () => $client->putObject(['Bucket' => $bucket, 'Key' => $key, 'Body' => 'x']));
            $report["{$label}.put_acl_private"] = $this->probe(fn () => $client->putObject(['Bucket' => $bucket, 'Key' => $key.'.acl', 'Body' => 'x', 'ACL' => 'private']));
            $report["{$label}.delete"] = $this->probe(function () use ($client, $bucket, $key) {
                $client->deleteObject(['Bucket' => $bucket, 'Key' => $key]);
                $client->deleteObject(['Bucket' => $bucket, 'Key' => $key.'.acl']);
            });
        }

        return $report;
    }

    private function probe(\Closure $call, bool $expectNotFound = false): string
    {
        try {
            $call();

            return $expectNotFound ? 'FOUND (unexpected)' : 'OK';
        } catch (Throwable $e) {
            if ($expectNotFound && $e instanceof AwsException && $e->getStatusCode() === 404) {
                return 'OK (404 NotFound: credentials and bucket are valid)';
            }

            return 'FAIL: '.$this->describeFailure($e);
        }
    }

    /** @param array<string, mixed> $settings */
    protected function makeS3Client(array $settings, bool $pathStyle): S3ClientInterface
    {
        return new S3Client([
            'version' => 'latest',
            'region' => $settings['region'],
            'endpoint' => $settings['endpoint'],
            'use_path_style_endpoint' => $pathStyle,
            'credentials' => ['key' => $settings['key'], 'secret' => $settings['secret']],
        ]);
    }

    /** اختبار كتابة وقراءة وحذف لكائن مؤقت لا يتضمن أي بيانات عميل. */
    public function healthCheck(): bool
    {
        // تكامل مفعَّل محفوظ ⇒ يُختبَر **هو** (R2) لا القرص المحلي الذي يعيده القفل المغلق، فلا نجاح مضلِّل.
        // بلا تكامل مفعَّل: السلوك القديم حرفياً (الإعداد الفعلي الحالي).
        if ($this->integrations->activeConfiguration('document_storage') !== []) {
            return $this->verifyPlatformConfiguration()['ok'];
        }

        $key = 'healthchecks/'.Str::uuid().'.txt';
        $filesystem = $this->filesystem($this->profile());
        try {
            if (! $filesystem->put($key, 'nebrax-storage-health', $this->writeOptions())) {
                return false;
            }

            return $filesystem->exists($key);
        } finally {
            $filesystem->delete($key);
        }
    }

    private function filesystem(string $profile): Filesystem
    {
        if ($profile === self::PROFILE_DURABLE) {
            // يُبنى من تكامل المنصة بمعزل عن القفل. تكامل غائب/معطّل = فشل صريح لا سقوط صامت إلى قرص محلي
            // لا يحوي الملف (سقوطٌ كهذا كان سيُخفي فقد القراءة).
            if ($this->integrations->activeConfiguration('document_storage') === []) {
                throw new RuntimeException('Document storage integration is unavailable.');
            }

            return $this->build($this->settings(true));
        }
        if ($profile !== $this->baseProfile()) {
            throw new RuntimeException('Unknown document storage profile.');
        }

        return $this->build($this->settings());
    }

    /** @param array<string, mixed> $settings */
    private function build(array $settings): Filesystem
    {
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

        $config = [
            'driver' => 's3',
            'key' => $settings['key'],
            'secret' => $settings['secret'],
            'region' => $settings['region'],
            'bucket' => $settings['bucket'],
            'endpoint' => $settings['endpoint'],
            'url' => $settings['url'],
            'use_path_style_endpoint' => $settings['use_path_style_endpoint'],
            'throw' => true,
        ];
        if (! $this->isCloudflareR2($settings)) {
            $config['visibility'] = 'private';
        }

        return Storage::build($config);
    }

    /**
     * خيارات الكتابة. `visibility` تُترجمها Flysystem-S3 إلى ترويسة `x-amz-acl`، وCloudflare R2 تُصنّفها
     * غير مدعومة في PutObject (ولا تحدّد إن كانت تتجاهلها أم ترفضها). الخصوصية على R2 يحكمها الدلو
     * الخاص والاعتماد المحدود لا ACL الكائن، فلا نرسلها هناك. سائر السائقين (local وS3 العادي) كما كانت.
     *
     * @return array<string, mixed>
     */
    private function writeOptions(?array $settings = null): array
    {
        return $this->isCloudflareR2($settings ?? $this->settings()) ? [] : ['visibility' => 'private'];
    }

    /** @param array<string, mixed> $settings */
    private function isCloudflareR2(array $settings): bool
    {
        if (($settings['driver'] ?? null) !== 's3') {
            return false;
        }
        $host = strtolower((string) parse_url((string) ($settings['endpoint'] ?? ''), PHP_URL_HOST));

        return $host === 'r2.cloudflarestorage.com' || str_ends_with($host, '.r2.cloudflarestorage.com');
    }

    /** @return array<string, mixed> */
    private function settings(bool $ignoreGate = false): array
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
        if (! $ignoreGate && ! $this->persistentEnabled()) {
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
