<?php
// S0-A: a tiny AVIF that declares huge dimensions. Shows (1) getimagesize() sees the size WITHOUT decoding, (2) what a decode costs.
$f = $argv[1]; $gi = getimagesize($f);
echo "file=", filesize($f), " B  header-dims=", $gi[0], 'x', $gi[1], "  (mem peak ", round(memory_get_peak_usage() / 1048576, 1), " MiB)\n";
if (($argv[2] ?? '') !== 'decode') exit(0);
$t = hrtime(true); $im = imagecreatefromavif($f);
echo $im ? "decoded OK " . imagesx($im) . 'x' . imagesy($im) : 'decode FAILED', "  ", round((hrtime(true) - $t) / 1e6), " ms  maxrss=", round(getrusage()['ru_maxrss'] / 1024), " MiB\n";
