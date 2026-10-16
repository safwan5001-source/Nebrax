<?php
/** S0-C/D SPIKE PROTOTYPE - NOT production code. Bounded pure-PHP WebM (EBML/Matroska) validator: DocType, codec, size, duration, audio, Cues, Tags. */
final class WebmProbe
{
    private const MAX_ELEMENTS = 50000, MAX_DEPTH = 6;
    private int $n = 0;
    private array $r = ['doctype' => null, 'timecode_scale' => 1000000, 'duration' => null, 'tracks' => [], 'cues' => false, 'tags' => false, 'clusters' => 0, 'segment_unknown_size' => false];
    private ?array $cur = null;
    private const CONTAINERS = [0x18538067 => 'segment', 0x1549A966 => 'info', 0x1654AE6B => 'tracks', 0xAE => 'trackentry', 0xE0 => 'video', 0x1A45DFA3 => 'ebml'];

    public static function probe(string $b): array
    {
        $p = new self; $p->walk($b, 0, strlen($b), 0);
        if ($p->r['doctype'] === null) { throw new RuntimeException('no EBML header'); }
        $r = $p->r; $r['duration_s'] = $r['duration'] !== null ? round($r['duration'] * $r['timecode_scale'] / 1e9, 3) : null;
        $r['video'] = array_values(array_filter($r['tracks'], fn ($t) => ($t['type'] ?? 0) === 1))[0] ?? null;
        $r['has_audio'] = (bool) array_filter($r['tracks'], fn ($t) => ($t['type'] ?? 0) === 2);
        return $r;
    }

    /** @return array{0:int,1:int} [value, length] — id keeps its marker bits */
    private static function vint(string $b, int $pos, int $end, bool $keepMarker): array
    {
        if ($pos >= $end) { throw new RuntimeException('truncated vint'); }
        $first = ord($b[$pos]); $len = 1; $mask = 0x80;
        while ($len <= 8 && !($first & $mask)) { $len++; $mask >>= 1; }
        if ($len > 8 || ($keepMarker && $len > 4)) { throw new RuntimeException('bad vint'); }
        if ($pos + $len > $end) { throw new RuntimeException('truncated vint'); }
        $v = $keepMarker ? $first : ($first & ($mask - 1));
        for ($i = 1; $i < $len; $i++) { $v = ($v << 8) | ord($b[$pos + $i]); }
        $unknown = !$keepMarker && $v === ((1 << (7 * $len)) - 1) && $len < 8;
        return [$unknown ? -1 : $v, $len];
    }

    private function walk(string $b, int $pos, int $end, int $depth): void
    {
        if ($depth > self::MAX_DEPTH) { throw new RuntimeException('too deep'); }
        while ($pos < $end) {
            if (++$this->n > self::MAX_ELEMENTS) { throw new RuntimeException('too many elements'); }
            [$id, $il] = self::vint($b, $pos, $end, true); [$size, $sl] = self::vint($b, $pos + $il, $end, false);
            $body = $pos + $il + $sl;
            $bend = $size === -1 ? $end : $body + $size;
            if ($size === -1 && $id === 0x18538067) { $this->r['segment_unknown_size'] = true; }
            if ($size !== -1 && $bend > $end) {
                if ($id === 0x18538067) { throw new RuntimeException('segment exceeds file (truncated upload)'); }
                throw new RuntimeException('element exceeds parent');
            }
            $this->visit($b, $id, $body, $bend, $depth);
            if ($id === 0x1F43B675) { $this->r['clusters']++; }      // Cluster: counted, never descended (frames are not needed)
            $pos = $bend;
        }
    }

    private function uint(string $b, int $s, int $e): int { if ($e - $s > 8 || $e - $s < 0) { throw new RuntimeException('bad uint'); } $v = 0; for ($i = $s; $i < $e; $i++) { $v = ($v << 8) | ord($b[$i]); } return $v; }

    private function visit(string $b, int $id, int $s, int $e, int $d): void
    {
        switch ($id) {
            case 0x1A45DFA3: case 0x18538067: case 0x1549A966: case 0x1654AE6B: case 0xE0: $this->walk($b, $s, $e, $d + 1); break;
            case 0xAE: $this->cur = []; $this->walk($b, $s, $e, $d + 1); $this->r['tracks'][] = $this->cur; $this->cur = null; break;
            case 0x4282: $this->r['doctype'] = substr($b, $s, $e - $s); break;
            case 0x2AD7B1: $this->r['timecode_scale'] = $this->uint($b, $s, $e); break;
            case 0x4489: $len = $e - $s; if ($len === 4) { $this->r['duration'] = unpack('G', substr($b, $s, 4))[1]; } elseif ($len === 8) { $this->r['duration'] = unpack('E', substr($b, $s, 8))[1]; } else { throw new RuntimeException('bad duration'); } break;
            case 0x83: if ($this->cur !== null) { $this->cur['type'] = $this->uint($b, $s, $e); } break;
            case 0x86: if ($this->cur !== null) { $this->cur['codec'] = substr($b, $s, $e - $s); } break;
            case 0xB0: if ($this->cur !== null) { $this->cur['w'] = $this->uint($b, $s, $e); } break;
            case 0xBA: if ($this->cur !== null) { $this->cur['h'] = $this->uint($b, $s, $e); } break;
            case 0x1C53BB6B: $this->r['cues'] = true; break;
            case 0x1254C367: $this->r['tags'] = true; break;
        }
    }
}
if (PHP_SAPI === 'cli' && isset($argv[1]) && is_file($argv[1])) { try { echo json_encode(WebmProbe::probe((string) file_get_contents($argv[1])), JSON_UNESCAPED_SLASHES), "\n"; } catch (RuntimeException $e) { echo json_encode(['rejected' => $e->getMessage()]), "\n"; } }
