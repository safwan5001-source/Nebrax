import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AWJ ERP browser icon', () => {
  it('ships a Next.js App Router icon asset', () => {
    const iconPath = path.join(process.cwd(), 'src/app/icon.ico');
    const icon = fs.readFileSync(iconPath);

    expect(icon.length).toBeGreaterThan(0);
    expect(icon.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });

  it('does not reference legacy Nebrax/Nibras favicon branding', () => {
    const layout = fs.readFileSync(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    );

    expect(layout).not.toMatch(/Nebrax|Nibras|نبراس|نبراكس/i);
  });
});
