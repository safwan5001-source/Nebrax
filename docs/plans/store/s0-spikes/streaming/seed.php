<?php // S0-E: seed the 15 MB test video into an S3-compatible bucket. usage: php seed.php <autoload> <endpoint> <file>
require $argv[1]; $s3 = new Aws\S3\S3Client(['version' => 'latest', 'region' => 'us-east-1', 'endpoint' => $argv[2], 'use_path_style_endpoint' => true, 'credentials' => ['key' => 'any', 'secret' => 'anysecretanysecret']]);
try { $s3->createBucket(['Bucket' => 's0-stream']); } catch (Throwable $e) {}
$s3->putObject(['Bucket' => 's0-stream', 'Key' => 'video.mp4', 'Body' => fopen($argv[3], 'rb'), 'ContentType' => 'video/mp4']); echo "seeded ", filesize($argv[3]), " bytes\n";
