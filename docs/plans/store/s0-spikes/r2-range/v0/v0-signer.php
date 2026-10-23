<?php
/**
 * V0 SPIKE — NOT production code. The "Laravel side" of architecture B2: signs S3/R2 requests with the same SDK the app uses
 * (aws/aws-sdk-php via league/flysystem-aws-s3-v3), so the probe exercises exactly the URLs Laravel would hand to the Node proxy.
 *
 * Protocol: one JSON request on STDIN → one JSON answer on STDOUT. Presigned URLs are bearer tokens: they are returned ONLY to the
 * parent probe process over this pipe (kept in memory, never printed or written to disk by the probe). Credentials come from the
 * environment only and are never echoed; error text is reduced to the AWS error CODE.
 *
 *   S3_ENDPOINT   https://<account>.r2.cloudflarestorage.com   (or a local S3 look-alike for the harness self-test)
 *   S3_KEY / S3_SECRET   a token scoped to the TEST bucket only
 *   S3_BUCKET     the isolated test bucket           S3_REGION  (default auto)
 *   S3_PATH_STYLE 1 = https://<endpoint>/<bucket>/<key>, 0 = https://<bucket>.<endpoint>/<key>
 *   S3_CREATE_BUCKET=1 (local look-alikes only)
 *
 * Operations: presign {method,key,ttl,query?} · put {key,file,contentType} · delete {key} · head {key} · create-bucket
 */
require $argv[1] ?? __DIR__ . '/vendor/autoload.php';

use Aws\Exception\AwsException;
use Aws\S3\S3Client;

$cfg = ['endpoint' => getenv('S3_ENDPOINT'), 'key' => getenv('S3_KEY'), 'secret' => getenv('S3_SECRET'), 'bucket' => getenv('S3_BUCKET'),
    'region' => getenv('S3_REGION') ?: 'auto', 'path' => getenv('S3_PATH_STYLE') === '1'];
foreach (['endpoint', 'key', 'secret', 'bucket'] as $required) {
    if (! $cfg[$required]) {
        fwrite(STDOUT, json_encode(['error' => "missing setting: {$required}"]));
        exit(2);
    }
}
$s3 = new S3Client(['version' => 'latest', 'region' => $cfg['region'], 'endpoint' => $cfg['endpoint'], 'use_path_style_endpoint' => $cfg['path'],
    'credentials' => ['key' => $cfg['key'], 'secret' => $cfg['secret']], 'http' => ['connect_timeout' => 5, 'timeout' => 60]]);

$req = json_decode(stream_get_contents(STDIN), true) ?: [];
$out = ['ok' => true];
try {
    switch ($req['op'] ?? '') {
        case 'create-bucket':
            try { $s3->createBucket(['Bucket' => $cfg['bucket']]); } catch (AwsException $e) { /* exists */ }
            break;
        case 'put':
            $r = $s3->putObject(['Bucket' => $cfg['bucket'], 'Key' => $req['key'], 'SourceFile' => $req['file'], 'ContentType' => $req['contentType'] ?? 'application/octet-stream']);
            $out['etag'] = trim((string) $r['ETag'], '"');
            break;
        case 'head':
            $h = $s3->headObject(['Bucket' => $cfg['bucket'], 'Key' => $req['key']]);
            $out += ['etag' => trim((string) $h['ETag'], '"'), 'length' => (int) $h['ContentLength'], 'contentType' => $h['ContentType'] ?? null];
            break;
        case 'delete':
            $s3->deleteObject(['Bucket' => $cfg['bucket'], 'Key' => $req['key']]);
            break;
        case 'presign':
            $command = match (strtoupper($req['method'])) {
                'GET' => 'GetObject', 'HEAD' => 'HeadObject', default => throw new InvalidArgumentException('only GET/HEAD are ever signed'),
            };
            $cmd = $s3->getCommand($command, ['Bucket' => $cfg['bucket'], 'Key' => $req['key']] + ($req['query'] ?? []));
            $out['url'] = (string) $s3->createPresignedRequest($cmd, '+' . (int) $req['ttl'] . ' seconds')->getUri();
            break;
        default:
            $out = ['error' => 'unknown op'];
    }
} catch (AwsException $e) {
    $out = ['error' => 'aws', 'code' => $e->getAwsErrorCode(), 'status' => $e->getStatusCode()];
} catch (Throwable $e) {
    $out = ['error' => 'failure', 'class' => get_class($e)];
}
echo json_encode($out);
