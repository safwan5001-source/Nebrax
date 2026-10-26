import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const landingAr = (ar as { landing: Record<string, string> }).landing;
const landingEn = (en as { landing: Record<string, string> }).landing;

/** مفاتيح تُركَّب في الشيفرة (`m_${id}_title`…) فتُفحص هنا بقوائمها الصريحة. */
const MODULE_PREFIXES = ['m_sales', 'm_pos', 'm_purchases', 'm_books', 'm_reports'];
const STATUS_KEYS = ['sales', 'stock', 'books', 'zatca', 'hr', 'ops'];
const CONTROL_KEYS = ['isolation', 'roles', 'immutable', 'money'];

describe('landing page messages', () => {
  it('Arabic and English carry exactly the same keys', () => {
    expect(Object.keys(landingEn).sort()).toEqual(Object.keys(landingAr).sort());
  });

  it('every message is a non-empty string in both languages', () => {
    for (const catalog of [landingAr, landingEn]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(typeof value, key).toBe('string');
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it('every literal key the page and its components read exists', () => {
    const source = ['app/page.tsx', 'components/landing/landing-nav.tsx', 'components/landing/module-tabs.tsx'].map(read).join('\n');
    const literal = [...source.matchAll(/\bt\('([a-z0-9_]+)'\)/g)].map((match) => match[1]);
    expect(literal.length).toBeGreaterThan(20);
    for (const key of literal) expect(landingAr, key).toHaveProperty(key);
  });

  it('every composed key family exists', () => {
    const composed = [
      ...MODULE_PREFIXES.flatMap((prefix) => [`${prefix}_tab`, `${prefix}_title`, `${prefix}_1`, `${prefix}_2`, `${prefix}_3`, `${prefix}_alt`]),
      ...STATUS_KEYS.flatMap((key) => [`status_row_${key}_module`, `status_row_${key}_detail`]),
      ...['ready', 'partial', 'building'].map((state) => `state_${state}`),
      ...CONTROL_KEYS.flatMap((key) => [`security_${key}_title`, `security_${key}_desc`]),
    ];
    for (const key of composed) expect(landingAr, key).toHaveProperty(key);
  });

  it('keeps the brand key the auth shell reads', () => {
    expect(landingAr.brand_aria).toBeTruthy();
    expect(landingEn.brand_aria).toBeTruthy();
  });

  it('never prints the legacy currency text or an invented customer claim', () => {
    const all = [...Object.values(landingAr), ...Object.values(landingEn)].join('\n');
    expect(all).not.toMatch(/﷼|ر\.س|\bSAR\b/);
    expect(all).not.toMatch(/\b(trusted by|testimonial)\b|يثق بنا|عملاؤنا/i);
  });
});
