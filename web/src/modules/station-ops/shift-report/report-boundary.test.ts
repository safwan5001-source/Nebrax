// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AWJ-DOC-V2-PR7 — حارس حدود تقرير إغلاق الوردية: **قراءة وعرض فقط**. لا كتابة ولا شبكة ولا حساب مالي في ملفات هذا المجلد؛ كل ما يُطبع
 * يأتي من قراءات الوردية القائمة (hooks) عبر `ShiftReportModel`، والـPDF لا يُبنى إلا بضغطة صريحة داخل `run`.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

describe('shift report files are read-only', () => {
  it('has the expected files (no hidden extra module)', () => {
    expect(sources.map((entry) => entry.file).sort()).toEqual(['actions.tsx', 'model.ts', 'pdf.ts', 'preview.tsx']);
  });

  it.each(sources)('$file: no network, no write client, no HTTP verbs, no storage of report data', ({ text }) => {
    const source = code(text);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bapi\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket/);
    expect(source).not.toMatch(/opsWrite|write-client|write-outcome|intents/);
    expect(source).not.toMatch(/['"`](POST|PUT|PATCH|DELETE)['"`]/);
    expect(source).not.toMatch(/sessionStorage|indexedDB/);
  });

  it('model.ts and pdf.ts are pure: no React, no hooks, no Date.now()/clock reads (time is an input)', () => {
    for (const name of ['model.ts', 'pdf.ts']) {
      const source = code(sources.find((entry) => entry.file === name)!.text);
      expect(source, name).not.toMatch(/from 'react'|use[A-Z]\w+\(/);
      expect(source, name).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });

  it('the model does no financial arithmetic on amounts (only formats what the server sent)', () => {
    const source = code(sources.find((entry) => entry.file === 'model.ts')!.text);
    // لا جمع/ضرب/قسمة على مبالغ؛ الاستثناء الوحيد جمع لترات فوهات المنتج في الوردية غير المجمَّدة (ml صحيحة) وفرق العدّاد داخل `readings.ts`.
    expect(source).not.toMatch(/amount_minor\s*[-+*/]|minor\s*[*/]|_minor\s*\*|price\w*\s*\*/);
    expect(source).not.toMatch(/Math\.(round|floor|ceil)|toFixed|parseFloat|Number\(/);
  });

  it('the PDF is built only on an explicit click (inside run), never from an effect', () => {
    const source = code(sources.find((entry) => entry.file === 'actions.tsx')!.text);
    expect(source.match(/createShiftReportPdf\(/g)).toHaveLength(1);
    const effects = [...source.matchAll(/useEffect\(\(\) => \{[^}]*\}/g)].map((m) => m[0]);
    for (const effect of effects) expect(effect).not.toMatch(/createShiftReportPdf|openForPrint|downloadBlob|shareBlob/);
  });

  it('only closed/approved shifts render the actions (the gate is in the component, not left to callers)', () => {
    const source = code(sources.find((entry) => entry.file === 'actions.tsx')!.text);
    expect(source).toMatch(/if \(!isReportableShift\(detail\.status\)\) return null/);
  });
});
