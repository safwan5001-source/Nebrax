<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Intervention\Image\Drivers\Gd\Driver as GdDriver;
use Intervention\Image\ImageManager;
use Intervention\Image\Interfaces\ImageManagerInterface;

$appDir = $argv[1] ?? null;
if (! is_string($appDir) || $appDir === '' || ! is_dir($appDir)) {
    fwrite(STDERR, "Laravel application directory is required.\n");
    exit(1);
}

$autoload = rtrim($appDir, DIRECTORY_SEPARATOR) . '/vendor/autoload.php';
$bootstrap = rtrim($appDir, DIRECTORY_SEPARATOR) . '/bootstrap/app.php';
if (! is_file($autoload) || ! is_file($bootstrap)) {
    fwrite(STDERR, "Laravel application is missing vendor/autoload.php or bootstrap/app.php.\n");
    exit(1);
}

require $autoload;
$app = require $bootstrap;
$app->make(Kernel::class)->bootstrap();

$manager = $app->make(ImageManagerInterface::class);
if (! $manager instanceof ImageManager) {
    throw new RuntimeException('Intervention Image manager did not resolve to ImageManager.');
}

if (! $manager->driver instanceof GdDriver) {
    throw new RuntimeException('Intervention Image is not using the GD driver.');
}

if (config('intervention-image.driver') !== GdDriver::class) {
    throw new RuntimeException('Intervention Image config does not select the GD driver.');
}

$scaled = $manager->createImage(40, 20)->scaleDown(width: 20);
if ($scaled->width() !== 20 || $scaled->height() !== 10) {
    throw new RuntimeException('scaleDown did not preserve the expected 2:1 aspect ratio.');
}

$small = $manager->createImage(4, 2)->scaleDown(width: 100);
if ($small->width() !== 4 || $small->height() !== 2) {
    throw new RuntimeException('scaleDown unexpectedly upscaled a small source.');
}

$outputPath = tempnam(sys_get_temp_dir(), 'awj-intervention-smoke-') . '.png';
try {
    $scaled->save($outputPath);
    if (! is_file($outputPath) || filesize($outputPath) === 0) {
        throw new RuntimeException('Intervention Image did not write an encoded output.');
    }

    $decoded = $manager->decodePath($outputPath);
    if ($decoded->width() !== 20 || $decoded->height() !== 10) {
        throw new RuntimeException('The written output could not be decoded with the expected dimensions.');
    }

    fwrite(STDOUT, "Intervention Image smoke passed: Laravel boot, GD driver, scaleDown, no-upscale, encode, and write.\n");
} finally {
    @unlink($outputPath);
}
