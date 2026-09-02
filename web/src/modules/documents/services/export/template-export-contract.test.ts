import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const documentPages = [
  'src/app/(app)/invoices/[id]/page.tsx',
  'src/app/(app)/purchases/[id]/page.tsx',
  'src/app/(app)/quotes/[id]/page.tsx',
  'src/app/(app)/credit-notes/[id]/page.tsx',
  'src/app/(app)/returns/[id]/page.tsx',
  'src/components/procurement/procurement-detail.tsx',
] as const;

const legacyVectorExport = /createInvoicePdf|createLineDocumentPdf|createPurchaseInvoicePdf|downloadLineDocumentPdf|shareLineDocumentPdf|downloadPurchaseInvoicePdf|sharePurchaseInvoicePdf/;

describe('تصدير القالب الحقيقي', () => {
  it.each(documentPages)('%s يصدّر ويشارك DOM القالب نفسه', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');

    expect(source).toContain('documentExporter.download');
    expect(source).toContain('documentExporter.share');
    expect(source).not.toMatch(legacyVectorExport);
  });

  it('يربط فاتورة التفاصيل بمراجع PDF/Thermal عبر المحوّل وجذر PDF المستقل', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(app)/invoices/[id]/page.tsx'), 'utf8');
    expect(source).toContain('resolveDocumentOutputTemplates');
    expect(source).toContain('pdf-print-root');
    expect(source).toContain('usage=${usage}');
  });

  it('يربط عرض السعر وأمر الشراء بالمحوّل وجذر PDF المستقل', () => {
    const quote = readFileSync(resolve(process.cwd(), 'src/app/(app)/quotes/[id]/page.tsx'), 'utf8');
    const purchaseOrder = readFileSync(resolve(process.cwd(), 'src/components/procurement/procurement-detail.tsx'), 'utf8');
    expect(quote).toContain('resolveDocumentOutputTemplates');
    expect(quote).toContain('pdf-print-root');
    expect(quote).toContain('usage=${usage}');
    expect(purchaseOrder).toContain('resolveDocumentOutputTemplates');
    expect(purchaseOrder).toContain('pdf-print-root');
    expect(purchaseOrder).toContain('usage=${usage}');
  });

  it('يربط الإشعار الدائن بالمحوّل وجذر PDF المستقل', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(app)/credit-notes/[id]/page.tsx'), 'utf8');
    expect(source).toContain('resolveDocumentOutputTemplates');
    expect(source).toContain('pdf-print-root');
    expect(source).toContain('usage=${usage}');
    expect(source).toContain("documentType: 'credit_note'");
  });
});
