import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BASELINE_PATH, scan } from '../../../scripts/awj-drift-scan.mjs';

// AWJ v3 (Horizon 5) — drift ratchet (GOVERNANCE.md §4.3). Fixed-palette classes and raw hex in
// TSX bypass the semantic token layer, so they cannot adapt to Light/Dark/Ink. The committed
// baseline is today's count per file: it may only go DOWN. A failure here means a change added
// a bypass — use a semantic utility (bg-surface, text-muted, border-border, bg-primary,
// text-primary-foreground, …) or a --awj-* token instead. If you removed bypasses, lower the
// baseline:  node scripts/awj-drift-scan.mjs --write

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
  totals: { palette: number; hex: number };
  files: Record<string, { palette: number; hex: number }>;
};
const current = scan() as Record<string, { palette: number; hex: number }>;

describe('semantic-token drift ratchet', () => {
  it('no file gains fixed-palette classes or raw hex, and no new file introduces any', () => {
    const regressions: string[] = [];
    for (const [file, counts] of Object.entries(current)) {
      const allowed = baseline.files[file] ?? { palette: 0, hex: 0 };
      if (counts.palette > allowed.palette) regressions.push(`${file}: palette classes ${allowed.palette} → ${counts.palette}`);
      if (counts.hex > allowed.hex) regressions.push(`${file}: raw hex ${allowed.hex} → ${counts.hex}`);
    }
    expect(regressions, regressions.join('\n')).toEqual([]);
  });

  it('the recorded totals match the per-file entries (the baseline cannot be hand-inflated)', () => {
    const sum = Object.values(baseline.files).reduce((a, v) => ({ palette: a.palette + v.palette, hex: a.hex + v.hex }), { palette: 0, hex: 0 });
    expect(sum).toEqual(baseline.totals);
  });

  it('the accepted exceptions are the documented ones: print documents and the Studio Builder', () => {
    const outsideExceptions = Object.entries(baseline.files)
      .filter(([file]) => !/document|doc-|report-document|thermal-layout|store-experience-builder|app-builder/.test(file))
      .reduce((sum, [, v]) => sum + v.palette + v.hex, 0);
    // Everything else is a handful of intentional `text-white` on fills and scrims; keep it small.
    expect(outsideExceptions).toBeLessThanOrEqual(60);
  });
});
