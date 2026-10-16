<?php
/**
 * S0-E SPIKE - NOT production code. Models the planned Laravel `video` route: validates ONE Range (RFC 9110), answers 206/416/200,
 * and streams the bytes either from an S3-compatible bucket through the AWS SDK with a ranged GetObject (src=s3, the planned design)
 * or from local disk (src=file, the control that isolates Apache/PHP from the SDK).
 */
require_once '/vendor/autoload.php';
const SIZE = 15184887;                     // known from the DB in the real design (variants[].bytes): no HEAD round trip per request
const KEY = 'video.mp4', BUCKET = 's0-stream';
if (getenv('S0_TIME_LIMIT') !== false) { set_time_limit((int) getenv('S0_TIME_LIMIT')); } // 0 = unlimited; unset = php default (30)
$src = $_GET['src'] ?? 's3';
$h = $_SERVER['HTTP_RANGE'] ?? null; $start = 0; $end = SIZE - 1; $status = 200;
if ($h !== null && preg_match('/^bytes=(\d*)-(\d*)$/', trim($h), $m) && ($m[1] !== '' || $m[2] !== '')) {
    if ($m[1] === '') { $n = (int) $m[2]; if ($n === 0) { $bad = true; } else { $start = max(0, SIZE - $n); } }
    else { $start = (int) $m[1]; if ($m[2] !== '') { $end = min((int) $m[2], SIZE - 1); } }
    if (isset($bad) || $start >= SIZE || $start > $end) { http_response_code(416); header('Content-Range: bytes */' . SIZE); exit; }
    $status = 206;
}   // anything else (multi-range, malformed): RFC 9110 permits ignoring Range -> full 200
http_response_code($status);
header('Content-Type: video/mp4'); header('Accept-Ranges: bytes'); header('X-Content-Type-Options: nosniff'); header('Cache-Control: private, no-store');
header('ETag: "s0-video"'); header('Content-Length: ' . ($end - $start + 1));
if ($status === 206) { header("Content-Range: bytes $start-$end/" . SIZE); }
if ($_SERVER['REQUEST_METHOD'] === 'HEAD') { exit; }
while (ob_get_level() > 0) { ob_end_clean(); }
$CHUNK = 65536;
if ($src === 'file') {
    $f = fopen('/data/video.mp4', 'rb'); fseek($f, $start); $left = $end - $start + 1;
    while ($left > 0 && !connection_aborted()) { $d = fread($f, min($CHUNK, $left)); if ($d === '' || $d === false) { break; } echo $d; $left -= strlen($d); flush(); }
    exit;
}
$s3 = new Aws\S3\S3Client(['version' => 'latest', 'region' => 'us-east-1', 'endpoint' => getenv('S3_ENDPOINT') ?: 'http://s0-sw:8333', 'use_path_style_endpoint' => true,
    'credentials' => ['key' => 'any', 'secret' => 'anysecretanysecret']]);
$r = $s3->getObject(['Bucket' => BUCKET, 'Key' => KEY, 'Range' => "bytes=$start-$end"]);
$body = $r['Body'];
while (!$body->eof() && !connection_aborted()) { echo $body->read($CHUNK); flush(); }
