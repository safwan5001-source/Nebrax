<?php
// Long-running PHP worker. Protocol: stdin = [1 byte fmt 'G'|'W'][u32 LE len][bytes]; stdout = one JSON line per request.
// Env: FUZZ_NO_GD=1 to skip GD decode.
ini_set('memory_limit', getenv('FUZZ_MEM') ?: '256M');
error_reporting(E_ALL);
require '/home/user/nibras-app/vendor/autoload.php';

use App\Services\Commerce\StorefrontAnimatedImage as P;
use App\Services\Commerce\StorefrontMediaException;

set_error_handler(function ($no, $str, $file, $line) {
    throw new ErrorException($str, 0, $no, $file, $line);
});

function u16($b, $o) { return ord($b[$o]) | (ord($b[$o + 1]) << 8); }
function u32($b, $o) { return unpack('V', substr($b, $o, 4))[1]; }

/** Independent strict grammar check of sanitised GIF. Returns list of violations. */
function gifGrammar(string $s): array
{
    $v = []; $n = strlen($s);
    if ($n < 14 || substr($s, 0, 6) !== 'GIF89a') return ['hdr'];
    $pk = ord($s[10]); $p = 13;
    if ($pk & 0x80) $p += 3 * (1 << (($pk & 7) + 1));
    $ns = 0; $frames = 0;
    while (true) {
        if ($p >= $n) { $v[] = 'no_trailer'; break; }
        $c = ord($s[$p]);
        if ($c === 0x3B) { if ($p !== $n - 1) $v[] = 'trailing_after_trailer'; break; }
        if ($c === 0x21) {
            $l = ord($s[$p + 1] ?? "\0");
            if ($l === 0xF9) {
                if (substr($s, $p, 3) !== "\x21\xF9\x04" || ($s[$p + 7] ?? '') !== "\0") $v[] = 'bad_gce';
                $p += 8; continue;
            }
            if ($l === 0xFF) {
                if (substr($s, $p, 14) === "\x21\xFF\x0BNETSCAPE2.0" && substr($s, $p + 14, 2) === "\x03\x01" && ($s[$p + 18] ?? '') === "\0") { $ns++; $p += 19; continue; }
                $v[] = 'non_netscape_app'; return $v;
            }
            $v[] = 'ext_' . $l; return $v;
        }
        if ($c === 0x2C) {
            $lp = ord($s[$p + 9]); $q = $p + 10;
            if ($lp & 0x80) $q += 3 * (1 << (($lp & 7) + 1));
            $q++; // lzw min
            while (true) { if ($q >= $n) { $v[] = 'img_trunc'; return $v; } $sz = ord($s[$q]); $q += 1 + $sz; if ($sz === 0) break; }
            $p = $q; $frames++; continue;
        }
        $v[] = 'unknown_block_' . $c; return $v;
    }
    if ($ns > 1) $v[] = 'multi_netscape';
    return $v;
}

/** Independent strict grammar check of sanitised WebP. */
function webpGrammar(string $s): array
{
    $v = []; $n = strlen($s);
    if ($n < 30 || substr($s, 0, 4) !== 'RIFF' || substr($s, 8, 4) !== 'WEBP') return ['hdr'];
    if (u32($s, 4) !== $n - 8) $v[] = 'riff_size';
    $p = 12; $idx = 0; $anim = 0; $anmf = 0; $icc = 0; $flags = 0; $stage = 0;
    while ($p < $n) {
        if ($p + 8 > $n) { $v[] = 'trunc_hdr'; break; }
        $id = substr($s, $p, 4); $sz = u32($s, $p + 4); $e = $p + 8 + $sz + ($sz & 1);
        if ($e > $n) { $v[] = 'chunk_overrun'; break; }
        if ($sz & 1 && ord($s[$e - 1]) !== 0) $v[] = 'nonzero_pad';
        if ($idx === 0) { if ($id !== 'VP8X' || $sz !== 10) $v[] = 'first_not_vp8x'; else $flags = ord($s[$p + 8]); }
        elseif ($id === 'ICCP') { $icc++; if ($anim || $anmf) $v[] = 'iccp_late'; if ($sz > 65536) $v[] = 'iccp_big'; }
        elseif ($id === 'ANIM') { $anim++; if ($sz !== 6) $v[] = 'anim_size'; }
        elseif ($id === 'ANMF') {
            $anmf++; if ($sz < 24) $v[] = 'anmf_small';
            $q = $p + 8 + 16; $end = $p + 8 + $sz; $bs = 0;
            while ($q < $end) {
                if ($q + 8 > $end) { $v[] = 'anmf_inner_hdr'; break; }
                $iid = substr($s, $q, 4); $isz = u32($s, $q + 4); $ie = $q + 8 + $isz + ($isz & 1);
                if ($ie > $end) { $v[] = 'anmf_inner_overrun'; break; }
                if ($isz & 1 && ord($s[$ie - 1]) !== 0) $v[] = 'nonzero_pad_inner';
                if (!in_array($iid, ['ALPH', 'VP8 ', 'VP8L'], true)) $v[] = 'anmf_inner_id_' . bin2hex($iid);
                if ($iid !== 'ALPH') $bs++;
                $q = $ie;
            }
            if ($bs !== 1) $v[] = 'anmf_bitstreams_' . $bs;
        } else $v[] = 'chunk_' . bin2hex($id);
        $p = $e; $idx++;
    }
    if ($flags & 0x0C) $v[] = 'exif_xmp_flag';
    if ($icc > 1) $v[] = 'multi_icc';
    if ($anim !== 1) $v[] = 'anim_count_' . $anim;
    if (!($flags & 2)) $v[] = 'anim_flag_clear';
    if ((bool)($flags & 0x20) !== (bool)$icc) $v[] = 'icc_flag_mismatch';
    return $v;
}

$in = fopen('php://stdin', 'rb');
$out = fopen('php://stdout', 'wb');
$svc = new P();
$noGd = getenv('FUZZ_NO_GD') === '1';

function timed(callable $f, array &$stat, string $name)
{
    memory_reset_peak_usage();
    $base = memory_get_usage();
    $t = hrtime(true);
    try { return $f(); } finally {
        $stat[$name . '_ms'] = round((hrtime(true) - $t) / 1e6, 3);
        $stat[$name . '_mem'] = memory_get_peak_usage() - $base;
    }
}

while (true) {
    $h = fread($in, 5);
    if ($h === false || strlen($h) < 5) break;
    $fmt = $h[0]; $len = unpack('V', substr($h, 1, 4))[1];
    $data = '';
    while (strlen($data) < $len) { $c = fread($in, $len - strlen($data)); if ($c === false || $c === '') exit(1); $data .= $c; }
    $mime = $fmt === 'G' ? 'image/gif' : 'image/webp';
    $r = ['bugs' => [], 'note' => [], 'st' => []];
    $st = &$r['st'];
    try {
        try {
            $meta = timed(fn () => $svc->inspect($data, $mime), $st, 'insp');
        } catch (StorefrontMediaException $e) {
            $r['ok'] = false; $r['code'] = $e->errorCode;
            // reject-path: sanitize/poster must also reject (no TypeError etc.)
            foreach (['sanitize', 'posterBytes'] as $m) {
                try { $svc->$m($data, $mime); $r['bugs'][] = "$m accepted but inspect rejected"; } catch (StorefrontMediaException $e2) {}
            }
            goto emit;
        }
        $r['ok'] = true; $r['meta'] = $meta;
        $san = timed(fn () => $svc->sanitize($data, $mime), $st, 'san');
        $poster = timed(fn () => $svc->posterBytes($data, $mime), $st, 'poster');
        $r['san'] = base64_encode($san);
        $r['in_len'] = strlen($data); $r['san_len'] = strlen($san);
        if ($mime === 'image/webp' && !$meta['animated']) { $r['note'][] = 'static_webp_passthrough'; if ($san !== $data) $r['bugs'][] = 'static san != input'; goto emit; }
        if (!$meta['animated']) $r['note'][] = 'gif_single_frame';
        // (c) meta identical
        $meta2 = $svc->inspect($san, $mime);
        if ($meta2 !== $meta) $r['bugs'][] = 'meta_changed_after_sanitize: ' . json_encode([$meta, $meta2]);
        // (e) idempotent
        $san2 = $svc->sanitize($san, $mime);
        if ($san2 !== $san) $r['bugs'][] = 'not_idempotent';
        // (d) size + grammar
        if (strlen($san) > strlen($data) + 32) $r['bugs'][] = 'san_larger';
        $g = $mime === 'image/gif' ? gifGrammar($san) : webpGrammar($san);
        foreach ($g as $x) $r['bugs'][] = 'grammar:' . $x;
        // poster
        if ($poster === null) { $r['note'][] = 'poster_null'; }
        else {
            try {
                $ps = @getimagesizefromstring($poster);
                if (!is_array($ps)) $r['note'][] = 'poster_gis_false';
                else {
                    $r['poster_dims'] = [$ps[0], $ps[1]];
                    if ([$ps[0], $ps[1]] !== [$meta['width'], $meta['height']]) $r['note'][] = 'poster_dims_mismatch';
                    // service only accepts if dims match; if they match, does GD actually decode?
                    if (!$noGd && $ps[0] * $ps[1] <= 1000000 && $meta['animated']) {
                        $im = @imagecreatefromstring($poster);
                        if ($im === false) $r['note'][] = 'gd_decode_fail';
                        else { if ([imagesx($im), imagesy($im)] !== [$ps[0], $ps[1]]) $r['note'][] = 'gd_dims_differ_from_header'; unset($im); }
                    }
                }
            } catch (\Throwable $e) { $r['note'][] = 'gd_warn:' . substr($e->getMessage(), 0, 60); }
        }
        if ($meta['animated'] && $poster !== null && $mime === 'image/gif' && $poster !== $san) $r['bugs'][] = 'gif poster != clean';
    } catch (\Throwable $e) {
        $r['bugs'][] = 'ESCAPED ' . get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    emit:
    $r['peak'] = memory_get_peak_usage();
    fwrite($out, json_encode($r) . "\n");
    fflush($out);
}
