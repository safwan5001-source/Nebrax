<?php
// S0-A: mutation fuzz of the AvifProbe prototype. Invariants: only RuntimeException may escape, no warnings, bounded time.
require __DIR__ . '/avif-probe.php';
error_reporting(E_ALL); set_error_handler(function ($n, $s, $f, $l) { throw new ErrorException($s, 0, $n, $f, $l); });
mt_srand(1337);
$seeds = array_map('file_get_contents', glob(__DIR__ . '/corpus/{anim3,anim3-alpha,still,still-meta}.avif', GLOB_BRACE));
$N = (int) ($argv[1] ?? 30000); $ok = $rej = 0; $maxMs = 0.0; $bad = [];
$interesting = [0, 1, 2, 3, 4, 7, 8, 0x7f, 0x80, 0xff, 0xffff, 0xffffffff];
for ($i = 0; $i < $N; $i++) {
    $b = $seeds[array_rand($seeds)]; $len = strlen($b);
    for ($k = mt_rand(1, 4); $k--;) {
        switch (mt_rand(0, 4)) {
            case 0: $b[mt_rand(0, $len - 1)] = chr(mt_rand(0, 255)); break;
            case 1: $b[mt_rand(0, $len - 1)] = chr(ord($b[mt_rand(0, $len - 1)]) ^ (1 << mt_rand(0, 7))); break;
            case 2: $b = substr($b, 0, mt_rand(0, $len)); $len = strlen($b); if ($len === 0) { $b = "\0"; $len = 1; } break;
            case 3: $o = mt_rand(0, max(0, $len - 4)); $v = $interesting[array_rand($interesting)]; $b = substr($b, 0, $o) . pack('N', $v) . substr($b, $o + 4); $len = strlen($b); break;
            case 4: $o = mt_rand(0, $len - 1); $b = substr($b, 0, $o) . substr($b, $o, mt_rand(1, 16)) . substr($b, $o); $len = strlen($b); break;
        }
    }
    $t = hrtime(true);
    try { AvifProbe::probe($b); $ok++; } catch (RuntimeException) { $rej++; } catch (Throwable $e) { $bad[] = get_class($e) . ': ' . $e->getMessage(); }
    $maxMs = max($maxMs, (hrtime(true) - $t) / 1e6);
}
echo json_encode(['inputs' => $N, 'accepted' => $ok, 'rejected' => $rej, 'unexpected_throwables' => count($bad), 'examples' => array_slice(array_unique($bad), 0, 5), 'max_ms' => round($maxMs, 2), 'peak_mem_mib' => round(memory_get_peak_usage() / 1048576, 1)]), "\n";
