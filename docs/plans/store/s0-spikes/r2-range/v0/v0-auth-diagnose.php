<?php
/**
 * V0 SPIKE — NOT production code. Read-mostly AUTH DIAGNOSIS for the V-G1 R2 run (AccessDenied on the first PutObject).
 *
 * It answers one question — "credentials/authorisation problem, or signing/endpoint problem?" — with a handful of cheap calls, then prints ONLY
 * {name, ok, status, awsCode} per call plus boolean format checks. No secret, key id, URL, header, message or request id is ever printed.
 *
 *   php v0-auth-diagnose.php /path/to/vendor/autoload.php          env: S3_ENDPOINT S3_KEY S3_SECRET S3_BUCKET [S3_REGION=auto]
 *
 * Calls (all under the key prefix v0-range-probe/; the only write is ONE 1-byte object, deleted and verified gone):
 *   control-bad-secret   real key id + wrong secret     → expected SignatureDoesNotMatch (proves this endpoint/region/style reports signing errors)
 *   control-unknown-key  random key id + random secret  → shows how R2 reports credentials it does not know
 *   head-bucket / list   real credentials, virtual-hosted and path-style
 *   put / head / delete / head-after   real credentials (only if put succeeds)
 */
require $argv[1] ?? __DIR__ . '/vendor/autoload.php';

use Aws\Exception\AwsException;
use Aws\S3\S3Client;

$endpoint = (string) getenv('S3_ENDPOINT'); $key = (string) getenv('S3_KEY'); $secret = (string) getenv('S3_SECRET'); $bucket = (string) getenv('S3_BUCKET');
$region = getenv('S3_REGION') ?: 'auto';
$format = [
    // R2 S3 credentials: Access Key ID = 32 hex characters, Secret Access Key = 64 hex characters (booleans only are printed)
    'key_is_32_hex' => (bool) preg_match('/^[0-9a-f]{32}$/i', $key),
    'secret_is_64_hex' => (bool) preg_match('/^[0-9a-f]{64}$/i', $secret),
    'key_has_whitespace' => (bool) preg_match('/\s/', $key),
    'secret_has_whitespace' => (bool) preg_match('/\s/', $secret),
    'endpoint_shape_ok' => (bool) preg_match('#^https://[0-9a-f]{32}\.(eu\.|fedramp\.|us\.)?r2\.cloudflarestorage\.com$#i', $endpoint),
    'endpoint_is_jurisdictional' => (bool) preg_match('#^https://[0-9a-f]{32}\.(eu|fedramp|us)\.r2\.#i', $endpoint),
    'bucket_name_shape_ok' => (bool) preg_match('/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/', $bucket),
    'bucket_has_whitespace' => (bool) preg_match('/\s/', $bucket),
    'key_secret_differ' => $key !== $secret,
];
foreach (['S3_ENDPOINT' => $endpoint, 'S3_KEY' => $key, 'S3_SECRET' => $secret, 'S3_BUCKET' => $bucket] as $name => $v) { $format[strtolower($name) . '_present'] = $v !== ''; }
if (! $format['s3_endpoint_present'] || ! $format['s3_key_present'] || ! $format['s3_secret_present'] || ! $format['s3_bucket_present']) {
    echo json_encode(['format' => $format, 'calls' => [], 'aborted' => 'missing setting']); exit(2);
}

$client = fn (string $k, string $s, bool $path) => new S3Client(['version' => 'latest', 'region' => $region, 'endpoint' => $endpoint, 'use_path_style_endpoint' => $path,
    'credentials' => ['key' => $k, 'secret' => $s], 'http' => ['connect_timeout' => 5, 'timeout' => 30], 'retries' => 0]);
$calls = [];
$run = function (string $name, callable $fn) use (&$calls) {
    try { $fn(); $calls[] = ['name' => $name, 'ok' => true, 'status' => 200, 'awsCode' => null]; return true; }
    catch (AwsException $e) { $calls[] = ['name' => $name, 'ok' => false, 'status' => $e->getStatusCode(), 'awsCode' => $e->getAwsErrorCode()]; return false; }
    catch (Throwable $e) { $calls[] = ['name' => $name, 'ok' => false, 'status' => null, 'awsCode' => 'client:' . get_class($e)]; return false; }
};

$run('control-bad-secret', fn () => $client($key, bin2hex(random_bytes(32)), false)->headBucket(['Bucket' => $bucket]));
$run('control-unknown-key', fn () => $client(bin2hex(random_bytes(16)), bin2hex(random_bytes(32)), false)->headBucket(['Bucket' => $bucket]));
foreach ([false, true] as $path) {
    $label = $path ? 'path' : 'virtual';
    $s3 = $client($key, $secret, $path);
    $run("head-bucket/$label", fn () => $s3->headBucket(['Bucket' => $bucket]));
    $run("list-prefix/$label", fn () => $s3->listObjectsV2(['Bucket' => $bucket, 'Prefix' => 'v0-range-probe/', 'MaxKeys' => 1]));
}
$s3 = $client($key, $secret, false);
$objectKey = 'v0-range-probe/diag-' . bin2hex(random_bytes(6)) . '/p.txt';
if ($run('put', fn () => $s3->putObject(['Bucket' => $bucket, 'Key' => $objectKey, 'Body' => 'x', 'ContentType' => 'text/plain']))) {
    $run('head', fn () => $s3->headObject(['Bucket' => $bucket, 'Key' => $objectKey]));
    $run('delete', fn () => $s3->deleteObject(['Bucket' => $bucket, 'Key' => $objectKey]));
    $run('head-after-delete', fn () => $s3->headObject(['Bucket' => $bucket, 'Key' => $objectKey])); // 404 expected (recorded as a failed call with status 404)
}
echo json_encode(['format' => $format, 'calls' => $calls, 'putObjectCreated' => (bool) array_filter($calls, fn ($c) => $c['name'] === 'put' && $c['ok'])]);
