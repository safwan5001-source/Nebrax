<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * AWJ-UPLOAD-PHP-LIMITS-1 — سلوك محرك PHP الحقيقي للرفع، لا `UploadedFile::fake()`.
 *
 * `fake()` يبني ملفاً صالحاً بـ`UPLOAD_ERR_OK` فلا يلمس `upload_max_filesize`
 * إطلاقاً — ولذلك مرّ كل اختبار رفع قديم والإنتاج يفشل عند 2MB. هنا نُقلع
 * `php -S` فعلياً (محرك multipart نفسه الذي يقرأ php.ini) بملف الـini الإنتاجي
 * ونرسل طلب multipart حقيقياً، ثم نقرأ `$_FILES` كما رآه PHP.
 *
 * الشاهد الضابط (control): نفس الطلب بلا الـini (`-n`، افتراضات PHP) يفشل برمز
 * UPLOAD_ERR_INI_SIZE — فالاختبار يميّز فعلاً بين الحالتين ويوثّق السبب الجذري.
 *
 * حدّ Apache/mod_php داخل الصورة تفحصه خطوة runtime-smoke في CI (الصورة نفسها).
 *
 * تشغيل: php artisan test --filter=PhpUploadRuntimeTest
 */
class PhpUploadRuntimeTest extends TestCase
{
    private const MIB = 1024 * 1024;

    /** @var array<string,array{proc:resource,port:int,router:string}> */
    private static array $servers = [];

    public static function tearDownAfterClass(): void
    {
        foreach (self::$servers as $server) {
            if (is_resource($server['proc'])) {
                proc_terminate($server['proc']);
                proc_close($server['proc']);
            }
            @unlink($server['router']);
        }
        self::$servers = [];

        parent::tearDownAfterClass();
    }

    private function server(string $profile): int
    {
        if (! function_exists('proc_open')) {
            $this->markTestSkipped('proc_open is disabled in this environment.');
        }
        if (isset(self::$servers[$profile])) {
            return self::$servers[$profile]['port'];
        }

        $router = tempnam(sys_get_temp_dir(), 'awj-upload-router-').'.php';
        file_put_contents($router, <<<'PHP'
<?php
header('Content-Type: application/json');
$files = [];
foreach ($_FILES as $field => $info) {
    $errors = (array) $info['error'];
    $sizes = (array) $info['size'];
    foreach ($errors as $i => $error) {
        $files[] = ['field' => $field, 'i' => $i, 'error' => $error, 'size' => $sizes[$i] ?? 0];
    }
}
echo json_encode([
    'ini' => [
        'upload_max_filesize' => ini_get('upload_max_filesize'),
        'post_max_size' => ini_get('post_max_size'),
        'memory_limit' => ini_get('memory_limit'),
        'max_file_uploads' => ini_get('max_file_uploads'),
    ],
    'files' => $files,
]);
PHP);

        $probe = stream_socket_server('tcp://127.0.0.1:0');
        $this->assertNotFalse($probe, 'cannot reserve a local port');
        $port = (int) substr(strrchr((string) stream_socket_get_name($probe, false), ':'), 1);
        fclose($probe);

        $command = [PHP_BINARY, '-n'];
        if ($profile === 'awj') {
            $ini = base_path('deploy/php/awj-uploads.ini');
            $this->assertFileExists($ini);
            array_push($command, '-c', $ini);
        }
        array_push($command, '-S', "127.0.0.1:{$port}", $router);

        $proc = proc_open($command, [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
        $this->assertIsResource($proc, 'could not start the php built-in server');

        $ready = false;
        for ($i = 0; $i < 50; $i++) {
            $conn = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
            if ($conn !== false) {
                fclose($conn);
                $ready = true;
                break;
            }
            usleep(100_000);
        }
        $this->assertTrue($ready, 'php built-in server did not become ready');

        self::$servers[$profile] = ['proc' => $proc, 'port' => $port, 'router' => $router];

        return $port;
    }

    /**
     * يرسل multipart حقيقياً ويعيد ما رآه PHP.
     *
     * @return array{ini:array<string,string>,files:list<array{field:string,i:int,error:int,size:int}>}
     */
    private function upload(int $port, int $bytes, string $field = 'media[]'): array
    {
        $boundary = '----awj'.bin2hex(random_bytes(8));
        $body = "--{$boundary}\r\n"
            ."Content-Disposition: form-data; name=\"{$field}\"; filename=\"photo.jpg\"\r\n"
            ."Content-Type: image/jpeg\r\n\r\n"
            .str_repeat('a', $bytes)
            ."\r\n--{$boundary}--\r\n";

        $raw = @file_get_contents("http://127.0.0.1:{$port}/", false, stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: multipart/form-data; boundary={$boundary}\r\nContent-Length: ".strlen($body)."\r\n",
            'content' => $body,
            'timeout' => 60,
            'ignore_errors' => true,
        ]]));
        $this->assertIsString($raw, 'no response from the php built-in server');

        $json = json_decode($raw, true);
        $this->assertIsArray($json, 'unexpected response: '.substr($raw, 0, 200));

        return $json;
    }

    /** @test */
    public function control_php_defaults_reject_a_3mb_photo_with_the_error_behind_media_0_failed_to_upload(): void
    {
        $result = $this->upload($this->server('defaults'), 3 * self::MIB);

        $this->assertSame('2M', $result['ini']['upload_max_filesize'], 'control must run with stock PHP defaults');
        $this->assertCount(1, $result['files']);
        $this->assertSame(UPLOAD_ERR_INI_SIZE, $result['files'][0]['error']);
        $this->assertSame(0, $result['files'][0]['size']);
    }

    /** @test */
    public function with_the_awj_ini_the_same_3mb_and_6mb_photos_reach_the_application(): void
    {
        $port = $this->server('awj');

        foreach ([3 * self::MIB, 6 * self::MIB] as $bytes) {
            $result = $this->upload($port, $bytes);

            $this->assertSame('20M', $result['ini']['upload_max_filesize']);
            $this->assertSame('128M', $result['ini']['post_max_size']);
            $this->assertSame('256M', $result['ini']['memory_limit']);
            $this->assertSame('20', $result['ini']['max_file_uploads']);
            $this->assertCount(1, $result['files']);
            $this->assertSame(UPLOAD_ERR_OK, $result['files'][0]['error'], "{$bytes} bytes must not be rejected by PHP");
            $this->assertSame($bytes, $result['files'][0]['size']);
        }
    }

    /** @test */
    public function the_ceiling_is_exactly_the_document_center_maximum_and_nothing_above_it_is_let_through(): void
    {
        $port = $this->server('awj');

        $atLimit = $this->upload($port, 20 * self::MIB, 'file');
        $this->assertSame(UPLOAD_ERR_OK, $atLimit['files'][0]['error'], '20 MiB (document center max_file_kilobytes=20480) must pass');
        $this->assertSame(20 * self::MIB, $atLimit['files'][0]['size']);

        $overByOne = $this->upload($port, 20 * self::MIB + 1, 'file');
        $this->assertSame(UPLOAD_ERR_INI_SIZE, $overByOne['files'][0]['error'], 'one byte over the ceiling must still be refused');
        $this->assertSame(0, $overByOne['files'][0]['size']);

        $wellOver = $this->upload($port, 24 * self::MIB, 'file');
        $this->assertSame(UPLOAD_ERR_INI_SIZE, $wellOver['files'][0]['error']);
    }
}
