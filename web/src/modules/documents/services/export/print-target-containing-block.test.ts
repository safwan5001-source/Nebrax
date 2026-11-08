import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../../../../app/globals.css'), 'utf8');

describe('وجهة الطباعة المطلقة لا تنزاح عن أعلى الصفحة (AWJ-DOC-V2-PR5)', () => {
  it('المصغِّر يفقد will-change في الطباعة للمستند ذي الورقة وحده', () => {
    expect(css).toMatch(/@media print[\s\S]*\.doc-scaler-inner:has\(\[data-doc-sheet\]\)\s*\{\s*will-change:\s*auto\s*!important;/);
  });

  it('لا قاعدة عامة تمسّ المستند بلا ملف إخراج (A4 كما كان)', () => {
    const rules = [...css.matchAll(/\.doc-scaler-inner[^{]*\{[^}]*will-change[^}]*\}/g)].map((m) => m[0]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain(':has([data-doc-sheet])');
  });
});
