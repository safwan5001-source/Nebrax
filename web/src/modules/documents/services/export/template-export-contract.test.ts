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
});
