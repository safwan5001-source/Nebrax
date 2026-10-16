<?php
// S0-A: what does PHP GD do with AVIF / AVIS? Run inside the spike image: php probe-gd.php corpus/
error_reporting(E_ALL);
$dir = rtrim($argv[1] ?? 'corpus', '/');
$out = ['php' => PHP_VERSION, 'gd_info' => array_intersect_key(gd_info(), array_flip(['GD Version', 'AVIF Support', 'WebP Support', 'JPEG Support', 'PNG Support'])),
    'has_imagecreatefromavif' => function_exists('imagecreatefromavif'), 'has_imageavif' => function_exists('imageavif'), 'files' => []];
$rss = static fn () => (int) (getrusage()['ru_maxrss'] ?? 0); // KiB on Linux, includes GD's native allocations
foreach (glob("$dir/*.avif") as $f) {
    $r = ['size' => filesize($f)];
    $gi = @getimagesize($f);                       // header-only dimension probe (no decode)
    $r['getimagesize'] = is_array($gi) ? [$gi[0], $gi[1], $gi['mime'] ?? null] : false;
    if (! $out['has_imagecreatefromavif']) { $out['files'][basename($f)] = $r; continue; }
    $warn = null; set_error_handler(function ($n, $s) use (&$warn) { $warn = $s; return true; });
    $t0 = hrtime(true); $rss0 = $rss();
    $im = imagecreatefromavif($f);
    $r['decode_ms'] = round((hrtime(true) - $t0) / 1e6, 1);
    restore_error_handler();
    $r['warning'] = $warn;
    if ($im === false) { $r['decoded'] = false; $out['files'][basename($f)] = $r; continue; }
    $w = imagesx($im); $h = imagesy($im);
    $px = imagecolorsforindex($im, imagecolorat($im, intdiv($w, 2), intdiv($h, 2)));
    $r += ['decoded' => true, 'dims' => [$w, $h], 'center_rgba' => [$px['red'], $px['green'], $px['blue'], $px['alpha']],
           'truecolor' => imageistruecolor($im), 'rss_growth_kib' => $rss() - $rss0, 'maxrss_kib' => $rss()];
    $out['files'][basename($f)] = $r;
    imagedestroy($im);
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
