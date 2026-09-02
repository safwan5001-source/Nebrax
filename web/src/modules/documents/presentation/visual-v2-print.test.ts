import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('عزل قواعد طباعة Modern V2', () => {
  it('يقيّد تكرار thead وتجنّب orphan بتركيب modern فقط', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="modern"] thead');
    expect(css).toContain('[data-doc-composition="modern"] [data-doc-keep="summary"]');
    expect(css).not.toMatch(/^\s*thead\s*\{\s*display:\s*table-header-group/m);
  });

  it('لا يمس عقد التصدير ولا يضيف محرّك عارض ثانٍ', () => {
    const header = readFileSync(resolve(process.cwd(), 'src/modules/documents/components/sections/doc-header.tsx'), 'utf8');
    const layout = readFileSync(resolve(process.cwd(), 'src/modules/documents/components/sections/doc-layout.tsx'), 'utf8');
    const exporter = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(layout).toContain('data-doc-composition={style.composition}');
    expect(header).toContain("style.composition === 'modern'");
    expect(header).toContain("style.composition === 'erp'");
    expect(exporter).toContain('pdfSharesPrintRoot');
  });
});
