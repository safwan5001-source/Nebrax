<?php

declare(strict_types=1);

if (! extension_loaded('gd')) {
    fwrite(STDERR, "GD extension is not loaded.\n");
    exit(1);
}

$gdInfo = gd_info();

foreach (['JPEG Support', 'PNG Support', 'WebP Support'] as $capability) {
    if (empty($gdInfo[$capability])) {
        fwrite(STDERR, "GD capability missing: {$capability}\n");
        exit(1);
    }
}

$prefix = tempnam(sys_get_temp_dir(), 'awj-gd-smoke-');
if ($prefix === false) {
    fwrite(STDERR, "Unable to allocate a temporary path.\n");
    exit(1);
}

$sourcePath = $prefix . '.png';
$jpegPath = $prefix . '.jpg';
$webpPath = $prefix . '.webp';

try {
    $source = imagecreatetruecolor(4, 2);
    if ($source === false || ! imagepng($source, $sourcePath)) {
        throw new RuntimeException('Unable to create the source PNG.');
    }
    imagedestroy($source);

    $input = imagecreatefrompng($sourcePath);
    if ($input === false) {
        throw new RuntimeException('Unable to read the source PNG.');
    }

    $output = imagecreatetruecolor(2, 1);
    if ($output === false || ! imagecopyresampled($output, $input, 0, 0, 0, 0, 2, 1, 4, 2)) {
        throw new RuntimeException('Unable to resize the source image.');
    }

    if (! imagejpeg($output, $jpegPath, 90) || ! imagewebp($output, $webpPath, 80)) {
        throw new RuntimeException('Unable to write JPEG and WebP outputs.');
    }

    imagedestroy($input);
    imagedestroy($output);

    foreach ([$jpegPath, $webpPath] as $outputPath) {
        if (! is_file($outputPath)) {
            throw new RuntimeException("Output was not written: {$outputPath}");
        }

        $dimensions = getimagesize($outputPath);
        if ($dimensions === false || $dimensions[0] !== 2 || $dimensions[1] !== 1) {
            throw new RuntimeException('Resize did not preserve the expected 2:1 aspect ratio.');
        }
    }

    fwrite(STDOUT, "GD smoke passed: JPEG, PNG, WebP, resize, aspect ratio, and write.\n");
} finally {
    @unlink($prefix);
    @unlink($sourcePath);
    @unlink($jpegPath);
    @unlink($webpPath);
}
