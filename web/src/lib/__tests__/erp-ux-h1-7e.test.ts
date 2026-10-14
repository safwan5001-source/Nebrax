import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

describe('ERP-UX-H1-7E residual P3 fixes', () => {
  it('numeric fields render their placeholder (often Arabic hint text) in Sans, values stay Mono (ERP-UX-018)', () => {
    const css = src('app/globals.css');
    expect(css).toMatch(/\.num\s*\{\s*font-family: var\(--font-mono\);/);
    expect(css).toMatch(/\.num::placeholder\s*\{\s*font-family: var\(--font-sans\);/);
  });

  it('the Customizer sidebar chevron draws its points as a polyline, not as invalid path data (ERP-UX-020)', () => {
    const builder = src('modules/store-experience-builder/ExperienceBuilder.tsx');
    expect(builder).toMatch(/<polyline points=\{points\} \/>/);
    expect(builder).not.toMatch(/<path d=\{points\} \/>/);
  });
});
