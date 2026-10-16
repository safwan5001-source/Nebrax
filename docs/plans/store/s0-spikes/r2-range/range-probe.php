<?php
/**
 * S0-B SPIKE - NOT production code. Probes S3 GetObject `Range` semantics through the AWS SDK for PHP (the SDK the app uses).
 * Works against ANY S3 endpoint, including Cloudflare R2 (the owner runs it with a TEST bucket; it writes and deletes only
 * the key `s0-range-probe/probe.bin`):
 *
 *   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com S3_KEY=... S3_SECRET=... S3_BUCKET=<test-bucket> S3_REGION=auto \
 *   php range-probe.php /path/to/vendor/autoload.php > result-r2.json
 *
 * Local runs: S3_PATH_STYLE=1 S3_CREATE_BUCKET=1 (creates the bucket if missing).
 */
require $argv[1] ?? __DIR__ . '/vendor/autoload.php';

use Aws\S3\S3Client;
use Aws\Exception\AwsException;

$cfg = ['endpoint' => getenv('S3_ENDPOINT'), 'key' => getenv('S3_KEY'), 'secret' => getenv('S3_SECRET'), 'bucket' => getenv('S3_BUCKET') ?: 's0-range', 'region' => getenv('S3_REGION') ?: 'us-east-1'];
$s3 = new S3Client(['version' => 'latest', 'region' => $cfg['region'], 'endpoint' => $cfg['endpoint'], 'use_path_style_endpoint' => (bool) getenv('S3_PATH_STYLE'),
    'credentials' => ['key' => $cfg['key'], 'secret' => $cfg['secret']], 'http' => ['connect_timeout' => 5, 'timeout' => 30]]);
$KEY = 's0-range-probe/probe.bin'; $SIZE = 1048576;
mt_srand(7); $data = ''; for ($i = 0; $i < $SIZE; $i += 4) { $data .= pack('N', mt_rand()); }

if (getenv('S3_CREATE_BUCKET')) { try { $s3->createBucket(['Bucket' => $cfg['bucket']]); } catch (AwsException $e) { /* exists */ } }
$put = $s3->putObject(['Bucket' => $cfg['bucket'], 'Key' => $KEY, 'Body' => $data, 'ContentType' => 'video/mp4']);
$etag = trim((string) $put['ETag'], '"');

$case = function (string $name, array $extra, ?array $expectSlice) use ($s3, $cfg, $KEY, $data) {
    $row = ['case' => $name, 'range' => $extra['Range'] ?? null];
    try {
        $r = $s3->getObject(['Bucket' => $cfg['bucket'], 'Key' => $KEY] + $extra);
        $body = (string) $r['Body'];
        $row += ['status' => $r['@metadata']['statusCode'], 'content_range' => $r['ContentRange'] ?? null, 'content_length' => (int) ($r['ContentLength'] ?? -1),
            'accept_ranges' => $r['AcceptRanges'] ?? null, 'body_len' => strlen($body)];
        if ($expectSlice !== null) { $row['body_matches_expected_slice'] = $body === substr($data, $expectSlice[0], $expectSlice[1]); }
    } catch (AwsException $e) {
        $row += ['status' => $e->getStatusCode(), 'error' => $e->getAwsErrorCode()];
    }
    return $row;
};
$N = $SIZE; $rows = [];
$h = $s3->headObject(['Bucket' => $cfg['bucket'], 'Key' => $KEY]);
$rows[] = ['case' => 'HEAD', 'status' => $h['@metadata']['statusCode'], 'content_length' => (int) $h['ContentLength'], 'accept_ranges' => $h['AcceptRanges'] ?? null, 'etag' => $h['ETag'], 'content_type' => $h['ContentType']];
$rows[] = $case('full GET (no Range)', [], [0, $N]);
$rows[] = $case('first byte  bytes=0-0', ['Range' => 'bytes=0-0'], [0, 1]);
$rows[] = $case('Safari probe  bytes=0-1', ['Range' => 'bytes=0-1'], [0, 2]);
$rows[] = $case('closed  bytes=100-199', ['Range' => 'bytes=100-199'], [100, 100]);
$rows[] = $case('open-ended  bytes=1048000-', ['Range' => 'bytes=1048000-'], [1048000, $N - 1048000]);
$rows[] = $case('suffix  bytes=-100', ['Range' => 'bytes=-100'], [$N - 100, 100]);
$rows[] = $case('end beyond size  bytes=0-99999999', ['Range' => 'bytes=0-99999999'], [0, $N]);
$rows[] = $case('start == size  bytes=1048576-1048600 (unsatisfiable)', ['Range' => 'bytes=1048576-1048600'], null);
$rows[] = $case('start > size  bytes=5000000-', ['Range' => 'bytes=5000000-'], null);
$rows[] = $case('multi-range  bytes=0-1,5-6', ['Range' => 'bytes=0-1,5-6'], null);
$rows[] = $case('malformed  bytes=abc', ['Range' => 'bytes=abc'], null);
$rows[] = $case('wrong unit  items=0-1', ['Range' => 'items=0-1'], null);
$rows[] = $case('Range + IfMatch(correct etag)', ['Range' => 'bytes=0-9', 'IfMatch' => $etag], [0, 10]);
$rows[] = $case('Range + IfMatch(wrong etag)', ['Range' => 'bytes=0-9', 'IfMatch' => 'deadbeef'], null);
$rows[] = $case('Range + IfNoneMatch(current etag)', ['Range' => 'bytes=0-9', 'IfNoneMatch' => $etag], null);
$s3->deleteObject(['Bucket' => $cfg['bucket'], 'Key' => $KEY]);
echo json_encode(['endpoint' => $cfg['endpoint'], 'sdk' => Aws\Sdk::VERSION, 'object_bytes' => $SIZE, 'put_etag' => $etag, 'cases' => $rows], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
