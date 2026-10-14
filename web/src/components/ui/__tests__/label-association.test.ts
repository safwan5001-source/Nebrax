import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ERP-UX-H1-5B: a visible `<Label>` placed right before a control names nothing unless it is
 * associated (`htmlFor` ↔ `id`). Screen readers then announce "combo box" with no name, and axe
 * reports `select-name` / `label`. This guard rejects the pattern `<Label>…</Label><Input|Select…`
 * without `htmlFor` anywhere in the ERP source.
 */
const SRC = resolve(__dirname, '../../..');
const UNASSOCIATED = /<Label(?![^>]*htmlFor)(?:\s+className="[^"]*")?>[^<]*<\/Label>\s*<(?:Input|Select|textarea|select)[\s>]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe('Label/control association (ERP-UX-H1-5B)', () => {
  it('has no visible Label followed by an unassociated control', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => UNASSOCIATED.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('detects the pattern it guards against', () => {
    expect(UNASSOCIATED.test('<Label>{label}</Label><Select value={v}>')).toBe(true);
    expect(UNASSOCIATED.test('<Label className="xl:sr-only">{t(\'account\')}</Label><Select value={v}>')).toBe(true);
    expect(UNASSOCIATED.test('<Label htmlFor={id}>{label}</Label><Select id={id}>')).toBe(false);
  });
});
