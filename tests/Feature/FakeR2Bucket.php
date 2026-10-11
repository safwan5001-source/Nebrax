<?php

namespace Tests\Feature;

use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Utils;
use Mockery;
use Mockery\MockInterface;

/**
 * دلو R2 في الذاكرة لاختبارات المرفقات: يحفظ البايتات فعلاً (فيُثبَت الدوام والقراءة الراجعة) ويحقن
 * الفشل بدقة (الكتابة رقم N، أي حذف). لا شبكة ولا اعتماد حقيقي. لا يدعم سرداً ولا ACL عمداً —
 * أيُّ استدعاء لهما يفشل الاختبار لأن Mockery يرفض الدالة غير المعرَّفة.
 */
final class FakeR2Bucket
{
    /** @var array<string,string> */
    public array $objects = [];

    /** @var array<int,string> مفاتيح كل كتابة ناجحة بالترتيب. */
    public array $written = [];

    public int $putAttempts = 0;
    public int $getCalls = 0;

    /** @var array<int,int> أرقام محاولات الكتابة (1-based) التي تفشل. */
    public array $failPutAttempts = [];

    public bool $failDeletes = false;

    private MockInterface $client;

    public function __construct()
    {
        $this->client = Mockery::mock(S3ClientInterface::class);

        $this->client->shouldReceive('putObject')->andReturnUsing(function (array $args): array {
            $this->putAttempts++;
            if (in_array($this->putAttempts, $this->failPutAttempts, true)) {
                throw new AwsException('boom', Mockery::mock('Aws\\CommandInterface'), ['code' => 'InternalError', 'response' => new Response(500)]);
            }
            $body = $args['Body'];
            $this->objects[$args['Key']] = is_resource($body) ? (string) stream_get_contents($body) : (string) $body;
            $this->written[] = $args['Key'];

            return [];
        });

        $this->client->shouldReceive('headObject')->andReturnUsing(function (array $args): array {
            if (! isset($this->objects[$args['Key']])) {
                throw $this->missing();
            }

            return [];
        });

        $this->client->shouldReceive('getObject')->andReturnUsing(function (array $args): array {
            $this->getCalls++;
            if (! isset($this->objects[$args['Key']])) {
                throw $this->missing();
            }

            return ['Body' => Utils::streamFor($this->objects[$args['Key']])];
        });

        $this->client->shouldReceive('deleteObject')->andReturnUsing(function (array $args): array {
            if ($this->failDeletes) {
                throw new AwsException('boom', Mockery::mock('Aws\\CommandInterface'), ['code' => 'InternalError', 'response' => new Response(500)]);
            }
            unset($this->objects[$args['Key']]);

            return [];
        });
    }

    /** يضبط إعداد R2 الوهمي ويربط الخدمة بالدلو ويفتح علم المرفقات. */
    public function install(bool $flagEnabled = true): self
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key', 'secret' => 'placeholder-secret',
            'bucket' => 'awj-attachments-test', 'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto', 'use_path_style_endpoint' => false,
        ]);
        config()->set('attachments.r2.enabled', $flagEnabled);
        app()->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $this->client));
        // AttachmentStorage يُحلّ بالحاوية؛ إسقاط النسخة المخزَّنة يضمن أنه يرى الخدمة المربوطة.
        app()->forgetInstance(\App\Services\AttachmentStorage::class);

        return $this;
    }

    public function keys(): array
    {
        return array_keys($this->objects);
    }

    private function missing(): AwsException
    {
        return new AwsException('missing', Mockery::mock('Aws\\CommandInterface'), ['code' => 'NoSuchKey', 'response' => new Response(404)]);
    }
}
