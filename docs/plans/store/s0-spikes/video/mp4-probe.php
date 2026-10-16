<?php
/**
 * S0-C/D SPIKE PROTOTYPE - NOT production code. Bounded pure-PHP MP4 (ISOBMFF) validator: codec, size, duration, fps, bitrate,
 * audio presence, faststart (moov before mdat), fragmentation, rotation, and privacy-relevant boxes (udta/meta/©xyz GPS).
 */
final class Mp4Probe
{
    private const MAX_DEPTH = 8, MAX_BOXES = 20000;
    private int $boxes = 0;
    private array $r = ['brands' => [], 'top' => [], 'tracks' => [], 'timescale' => null, 'duration' => null, 'fragmented' => false, 'udta' => false, 'gps' => false, 'meta' => false];
    private ?array $cur = null;

    public static function probe(string $b): array
    {
        $p = new self; $p->walk($b, 0, strlen($b), 0, true);
        if ($p->r['brands'] === []) { throw new RuntimeException('no ftyp'); }
        $r = $p->r; $order = array_values(array_filter($r['top'], fn ($t) => in_array($t, ['moov', 'mdat', 'moof'], true)));
        $r['faststart'] = ($i = array_search('moov', $order, true)) !== false && ($j = array_search('mdat', $order, true)) !== false ? $i < $j : null;
        $r['duration_s'] = ($r['timescale'] ?? 0) > 0 ? round($r['duration'] / $r['timescale'], 3) : null;
        $v = array_values(array_filter($r['tracks'], fn ($t) => ($t['handler'] ?? '') === 'vide'))[0] ?? null;
        $r['video'] = $v; $r['has_audio'] = (bool) array_filter($r['tracks'], fn ($t) => ($t['handler'] ?? '') === 'soun');
        if ($v && ($v['mdhd_ts'] ?? 0) > 0 && $v['mdhd_dur'] > 0) { $r['fps'] = round(($v['samples'] ?? 0) / ($v['mdhd_dur'] / $v['mdhd_ts']), 2); $r['video_bitrate_bps'] = (int) round(($v['bytes'] ?? 0) * 8 / ($v['mdhd_dur'] / $v['mdhd_ts'])); }
        unset($r['top']); return $r;
    }

    private function walk(string $b, int $pos, int $end, int $depth, bool $top = false, int $skip = 0): void
    {
        if ($depth > self::MAX_DEPTH) { throw new RuntimeException('too deep'); }
        $pos += $skip;
        while ($pos < $end) {
            if (++$this->boxes > self::MAX_BOXES) { throw new RuntimeException('too many boxes'); }
            if ($pos + 8 > $end) { throw new RuntimeException('truncated box header'); }
            $size = unpack('N', substr($b, $pos, 4))[1]; $type = substr($b, $pos + 4, 4); $hdr = 8;
            if ($size === 1) { if ($pos + 16 > $end) { throw new RuntimeException('truncated largesize'); } if (unpack('N', substr($b, $pos + 8, 4))[1] !== 0) { throw new RuntimeException('box too large'); } $size = unpack('N', substr($b, $pos + 12, 4))[1]; $hdr = 16; }
            elseif ($size === 0) { $size = $end - $pos; }
            if ($size < $hdr || $pos + $size > $end) { throw new RuntimeException("bad box size for " . bin2hex($type[0]) . substr($type, 1)); }
            if ($top) { $this->r['top'][] = $type; }
            $this->visit($b, $type, $pos + $hdr, $pos + $size, $depth);
            $pos += $size;
        }
    }

    private function visit(string $b, string $t, int $s, int $e, int $d): void
    {
        $u32 = static fn (int $o): int => unpack('N', substr($b, $o, 4))[1];
        $u16 = static fn (int $o): int => unpack('n', substr($b, $o, 2))[1];
        switch ($t) {
            case 'ftyp': if ($e - $s < 8) { throw new RuntimeException('short ftyp'); } $this->r['brands'][] = substr($b, $s, 4); for ($o = $s + 8; $o + 4 <= $e; $o += 4) { $this->r['brands'][] = substr($b, $o, 4); } break;
            case 'moov': case 'mdia': case 'minf': case 'stbl': case 'edts': $this->walk($b, $s, $e, $d + 1); break;
            case 'moof': $this->r['fragmented'] = true; break;
            case 'mvex': $this->r['fragmented'] = true; break;
            case 'udta': $this->r['udta'] = true; $this->walk($b, $s, $e, $d + 1); break;
            case 'meta': $this->r['meta'] = true; $this->walk($b, $s, $e, $d + 1, false, 4); break;
            case 'ilst': $this->walk($b, $s, $e, $d + 1); break;
            case "\xA9xyz": $this->r['gps'] = true; break;
            case 'trak': $this->cur = ['handler' => null]; $this->walk($b, $s, $e, $d + 1); $this->r['tracks'][] = $this->cur; $this->cur = null; break;
            case 'mvhd': $v = ord($b[$s]); $o = $s + 4 + ($v === 1 ? 16 : 8); $this->r['timescale'] = $u32($o); $this->r['duration'] = $v === 1 ? $u32($o + 8) * 4294967296 + $u32($o + 12) : $u32($o + 4); break;
            case 'tkhd': if ($this->cur !== null) { $v = ord($b[$s]); $o = $s + 4 + ($v === 1 ? 32 : 20) + 8 + 8 + 4; /* layer,alt,vol,rsv then matrix at +36 */ $m = $s + 4 + ($v === 1 ? 32 : 20) + 8 + 8; $a = unpack('N', substr($b, $m + 0, 4))[1]; $bb = unpack('N', substr($b, $m + 4, 4))[1];
                $sg = static fn ($x) => $x > 0x7fffffff ? $x - 4294967296 : $x; $this->cur['rotation'] = (int) round(rad2deg(atan2($sg($bb), $sg($a))));
                $w = $u32($e - 8) >> 16; $h = $u32($e - 4) >> 16; $this->cur['tkhd_w'] = $w; $this->cur['tkhd_h'] = $h; } break;
            case 'mdhd': if ($this->cur !== null) { $v = ord($b[$s]); $o = $s + 4 + ($v === 1 ? 16 : 8); $this->cur['mdhd_ts'] = $u32($o); $this->cur['mdhd_dur'] = $v === 1 ? $u32($o + 8) * 4294967296 + $u32($o + 12) : $u32($o + 4); } break;
            case 'hdlr': // QuickTime also nests a data-handler hdlr (pre_defined = 'dhlr', subtype 'url ') inside minf: ignore it, keep the media handler
                if ($this->cur !== null && $e - $s >= 12 && substr($b, $s + 4, 4) !== 'dhlr' && $this->cur['handler'] === null) { $this->cur['handler'] = substr($b, $s + 8, 4); } break;
            case 'stsd': if ($this->cur !== null && $e - $s >= 16) { $this->cur['codec'] = substr($b, $s + 12, 4); $this->codecDetail($b, $s + 8, $e); } break;
            case 'stsz': if ($this->cur !== null && $e - $s >= 12) { $fixed = $u32($s + 4); $n = $u32($s + 8); $this->cur['samples'] = $n; if ($fixed === 0) { if ($n > ($e - $s - 12) / 4) { throw new RuntimeException('stsz count lies'); } $sum = 0; for ($i = 0, $o = $s + 12; $i < $n; $i++, $o += 4) { $sum += $u32($o); } $this->cur['bytes'] = $sum; } else { $this->cur['bytes'] = $fixed * $n; } } break;
            case 'stco': case 'co64': if ($this->cur !== null && !isset($this->cur['first_chunk_offset']) && $e - $s >= 12 && $u32($s + 4) > 0) { $this->cur['first_chunk_offset'] = $t === 'stco' ? $u32($s + 8) : $u32($s + 12); } break;
        }
    }

    private function codecDetail(string $b, int $entry, int $e): void
    {   // $entry = start of the first sample entry: size(4) type(4) reserved(6) dref(2) | visual: pre(2) res(2) pre(12) w(2) h(2) ...
        if ($this->cur === null || $entry + 36 > $e) { return; }
        $entrySize = unpack('N', substr($b, $entry, 4))[1]; $entryEnd = min($e, $entry + max(8, $entrySize));
        if (in_array($this->cur['codec'], ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4v'], true)) {
            $this->cur['entry_w'] = unpack('n', substr($b, $entry + 32, 2))[1]; $this->cur['entry_h'] = unpack('n', substr($b, $entry + 34, 2))[1];
        }
        $p = strpos(substr($b, $entry, $entryEnd - $entry), 'avcC');
        if ($p !== false && $entry + $p + 8 <= $e) { $o = $entry + $p + 4; $this->cur['avc_profile_idc'] = ord($b[$o + 1]); $this->cur['avc_level_idc'] = ord($b[$o + 3]); }
    }
}
if (PHP_SAPI === 'cli' && isset($argv[1]) && is_file($argv[1])) { try { echo json_encode(Mp4Probe::probe((string) file_get_contents($argv[1])), JSON_UNESCAPED_SLASHES), "\n"; } catch (RuntimeException $e) { echo json_encode(['rejected' => $e->getMessage()]), "\n"; } }
