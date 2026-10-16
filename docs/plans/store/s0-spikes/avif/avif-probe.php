<?php
/**
 * S0-A SPIKE PROTOTYPE - NOT production code. Bounded pure-PHP ISOBMFF probe for AVIF / AVIS.
 * Goal: show whether a StorefrontAnimatedImage-style validator can measure an AVIF sequence without a decoder.
 * Reads: ftyp brands, ispe (still dims), moov/trak/mdia (mdhd timescale+duration), stbl/stsz (frames), stts (duration),
 *        edts/elst (loop), meta/iinf item types (Exif / XMP 'mime' items). Never decodes pixels.
 */
final class AvifProbe
{
    private const MAX_DEPTH = 8;
    private const MAX_BOXES = 4000;
    private int $boxes = 0;
    private array $r = ['brands' => [], 'w' => null, 'h' => null, 'timescale' => null, 'mdhd_duration' => null, 'frames' => null,
        'stts_total' => null, 'elst' => null, 'items' => [], 'has_moov' => false, 'handlers' => []];
    private const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'meta', 'iprp', 'ipco', 'iinf'];

    /** @return array<string,mixed> @throws RuntimeException on structurally invalid input */
    public static function probe(string $b): array
    {
        $p = new self;
        $p->walk($b, 0, strlen($b), 0);
        if ($p->r['brands'] === []) {
            throw new RuntimeException('no ftyp');
        }
        $r = $p->r;
        $r['is_sequence'] = $r['has_moov'] && in_array('avis', $r['brands'], true);
        $r['duration_ms'] = ($r['timescale'] && $r['stts_total'] !== null) ? (int) round($r['stts_total'] * 1000 / $r['timescale']) : null;
        $r['has_exif'] = in_array('Exif', $r['items'], true);
        $r['has_xmp'] = in_array('mime', $r['items'], true);

        return $r;
    }

    private function walk(string $b, int $pos, int $end, int $depth, bool $isMeta = false): void
    {
        if ($depth > self::MAX_DEPTH) {
            throw new RuntimeException('too deep');
        }
        if ($isMeta) {            // 'meta' is a FullBox: 4 bytes version/flags first
            $pos += 4;
        }
        while ($pos < $end) {
            if (++$this->boxes > self::MAX_BOXES) {
                throw new RuntimeException('too many boxes');
            }
            if ($pos + 8 > $end) {
                throw new RuntimeException('truncated box header');
            }
            $size = unpack('N', substr($b, $pos, 4))[1];
            $type = substr($b, $pos + 4, 4);
            $hdr = 8;
            if ($size === 1) {
                if ($pos + 16 > $end) {
                    throw new RuntimeException('truncated largesize');
                }
                $hi = unpack('N', substr($b, $pos + 8, 4))[1];
                $lo = unpack('N', substr($b, $pos + 12, 4))[1];
                if ($hi !== 0) {
                    throw new RuntimeException('box too large');
                }
                $size = $lo;
                $hdr = 16;
            } elseif ($size === 0) {
                $size = $end - $pos;      // extends to end of enclosing box
            }
            if ($size < $hdr || $pos + $size > $end) {
                throw new RuntimeException("bad box size for $type");
            }
            $body = $pos + $hdr;
            $bend = $pos + $size;
            $this->visit($b, $type, $body, $bend, $depth);
            $pos = $bend;
        }
    }

    private function visit(string $b, string $type, int $s, int $e, int $depth): void
    {
        $u32 = static fn (int $o): int => unpack('N', substr($b, $o, 4))[1];
        switch ($type) {
            case 'ftyp':
                if ($e - $s < 8) {
                    throw new RuntimeException('short ftyp');
                }
                $this->r['brands'][] = substr($b, $s, 4);
                for ($o = $s + 8; $o + 4 <= $e; $o += 4) {
                    $this->r['brands'][] = substr($b, $o, 4);
                }
                break;
            case 'meta':
                $this->walk($b, $s, $e, $depth + 1, true);
                break;
            case 'moov':
                $this->r['has_moov'] = true;
                $this->walk($b, $s, $e, $depth + 1);
                break;
            case 'trak': case 'mdia': case 'minf': case 'stbl': case 'edts': case 'iprp': case 'ipco':
                $this->walk($b, $s, $e, $depth + 1);
                break;
            case 'iinf':                      // FullBox + entry_count(2 or 4) then infe boxes
                $ver = ord($b[$s]);
                $o = $s + 4 + ($ver === 0 ? 2 : 4);
                $this->walk($b, $o, $e, $depth + 1);
                break;
            case 'infe':                      // FullBox v2/3: id(2|4) protection(2) item_type(4)
                $ver = ord($b[$s]);
                if ($ver >= 2) {
                    $o = $s + 4 + ($ver === 2 ? 2 : 4) + 2;
                    if ($o + 4 <= $e) {
                        $this->r['items'][] = substr($b, $o, 4);
                    }
                }
                break;
            case 'ispe':                      // FullBox + w + h
                if ($this->r['w'] === null && $e - $s >= 12) {
                    $this->r['w'] = $u32($s + 4);
                    $this->r['h'] = $u32($s + 8);
                }
                break;
            case 'mdhd':                      // FullBox: v0 -> ctime(4) mtime(4) timescale(4) duration(4)
                $ver = ord($b[$s]);
                $o = $s + 4 + ($ver === 1 ? 16 : 8);
                if ($this->r['timescale'] === null && $o + 8 <= $e) {
                    $this->r['timescale'] = $u32($o);
                    $this->r['mdhd_duration'] = $ver === 1 ? $u32($o + 8) : $u32($o + 4);
                }
                break;
            case 'hdlr':
                if ($e - $s >= 12) {
                    $this->r['handlers'][] = substr($b, $s + 8, 4);
                }
                break;
            case 'stsz':                      // FullBox: sample_size(4) sample_count(4)
                if ($this->r['frames'] === null && $e - $s >= 12) {
                    $this->r['frames'] = $u32($s + 8);
                }
                break;
            case 'stts':                      // FullBox: entry_count(4) then (count,delta)*
                $n = $u32($s + 4);
                if ($n > ($e - $s - 8) / 8) {
                    throw new RuntimeException('stts count lies');
                }
                $total = 0;
                for ($i = 0, $o = $s + 8; $i < $n; $i++, $o += 8) {
                    $total += $u32($o) * $u32($o + 4);
                }
                $this->r['stts_total'] ??= $total;
                break;
            case 'elst':                      // FullBox: flags(3) -> bit0 = repeat; entries
                $flags = (ord($b[$s + 1]) << 16) | (ord($b[$s + 2]) << 8) | ord($b[$s + 3]);
                $this->r['elst'] = ['flags' => $flags, 'repeat' => ($flags & 1) === 1];
                break;
        }
    }
}

if (PHP_SAPI === 'cli' && isset($argv[1]) && realpath($argv[1])) {
    try {
        echo json_encode(AvifProbe::probe((string) file_get_contents($argv[1])), JSON_UNESCAPED_SLASHES), "\n";
    } catch (RuntimeException $e) {
        echo json_encode(['rejected' => $e->getMessage()]), "\n";
    }
}
