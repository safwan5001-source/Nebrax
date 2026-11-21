// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockPropertiesEditor } from './block-properties-editor';
import { getDefaultDocumentLayout, validateDocumentLayout } from '@/modules/documents/registry/document-types';
import { getTemplate } from '@/modules/documents/registry/templates';
import { TaxInvoicePremium } from '@/modules/documents/templates/tax-invoice-premium';
import { makeDocumentQaModel } from '@/modules/documents/qa/document-qa-fixtures';
import { getTheme } from '@/modules/documents/themes';
import { normalizeDefinition } from '../template-definition';
import type { DocSectionLayoutItem } from '@/modules/documents/types';

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
  useTranslations: () => (key: string) => key,
}));

afterEach(cleanup);

const PREMIUM = 'tax-invoice-premium-v1';
const model = () => makeDocumentQaModel({ scenario: 'reference_sample', direction: 'rtl', showQr: true, showAssets: true });

function Harness({ initial, defaultColumns, onLayout }: { initial: DocSectionLayoutItem[]; defaultColumns?: Parameters<typeof BlockPropertiesEditor>[0]['defaultColumns']; onLayout: (layout: DocSectionLayoutItem[]) => void }) {
  const [layout, setLayout] = useState(initial);
  return <BlockPropertiesEditor value={layout} onChange={(next) => { setLayout(next); onLayout(next); }} documentType="tax_invoice" defaultColumns={defaultColumns} />;
}

function openItemsBlock() {
  const select = screen.getByLabelText('property_block') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'items' } });
}

const skuButton = () => screen.getAllByRole('button').find((b) => b.textContent?.startsWith('product_code') || b.textContent?.includes('product_code') && b.hasAttribute('aria-pressed'))!;

describe('studio — product code (SKU) option for tax-invoice-premium-v1', () => {
  it('the premium template declares its own studio default columns (SKU off); other templates declare none', () => {
    expect(getTemplate(PREMIUM).defaultItemColumns).toBeDefined();
    expect(getTemplate(PREMIUM).defaultItemColumns).not.toContain('product_code');
    expect(getTemplate('tax-invoice-erp').defaultItemColumns).toBeUndefined();
  });

  it('shows the SKU toggle OFF for the premium default, and toggling saves it through the existing columns contract', () => {
    const saved: DocSectionLayoutItem[][] = [];
    render(<Harness initial={getDefaultDocumentLayout('tax_invoice')} defaultColumns={getTemplate(PREMIUM).defaultItemColumns} onLayout={(l) => saved.push(l)} />);
    openItemsBlock();
    const toggle = skuButton();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(skuButton().getAttribute('aria-pressed')).toBe('true');
    const items = saved.at(-1)!.find((i) => i.key === 'items')!;
    expect(items.properties?.columns?.map((c) => c.id)).toContain('product_code');
    // العقد القائم يقبل الأعمدة المحفوظة (لا تغيير في الخادم/المخطط).
    expect(validateDocumentLayout('tax_invoice', saved.at(-1)!).valid).toBe(true);
  });

  it('turning it back off removes product_code again (hide)', () => {
    const saved: DocSectionLayoutItem[][] = [];
    render(<Harness initial={getDefaultDocumentLayout('tax_invoice')} defaultColumns={getTemplate(PREMIUM).defaultItemColumns} onLayout={(l) => saved.push(l)} />);
    openItemsBlock();
    fireEvent.click(skuButton());
    fireEvent.click(skuButton());
    expect(skuButton().getAttribute('aria-pressed')).toBe('false');
    expect(saved.at(-1)!.find((i) => i.key === 'items')!.properties?.columns?.map((c) => c.id)).not.toContain('product_code');
  });

  it('without a template default the editor keeps the engine default list (existing templates unchanged)', () => {
    render(<Harness initial={getDefaultDocumentLayout('tax_invoice')} onLayout={() => undefined} />);
    openItemsBlock();
    expect(skuButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('save → reopen round trip: the saved definition restores the option and the rendered document shows / hides the SKU accordingly', () => {
    const saved: DocSectionLayoutItem[][] = [];
    render(<Harness initial={getDefaultDocumentLayout('tax_invoice')} defaultColumns={getTemplate(PREMIUM).defaultItemColumns} onLayout={(l) => saved.push(l)} />);
    openItemsBlock();
    fireEvent.click(skuButton());
    const definition = normalizeDefinition({ definition: { template_id: PREMIUM, layout: JSON.parse(JSON.stringify(saved.at(-1))) } }, 'tax_invoice');
    cleanup();

    // إعادة فتح الاستوديو بالتعريف المحفوظ: الخيار مفعّل.
    render(<Harness initial={definition.layout} defaultColumns={getTemplate(PREMIUM).defaultItemColumns} onLayout={() => undefined} />);
    openItemsBlock();
    expect(skuButton().getAttribute('aria-pressed')).toBe('true');
    cleanup();

    // الرسم بالتعريف المحفوظ يُظهر الرمز تحت الاسم؛ وبغيابه لا يظهر.
    const on = render(<TaxInvoicePremium model={model()} theme={getTheme('green')} formatMoney={String} layout={definition.layout} rootId="r" />);
    expect(on.container.querySelectorAll('[data-premium-sku]').length).toBeGreaterThan(0);
    cleanup();
    const off = render(<TaxInvoicePremium model={model()} theme={getTheme('green')} formatMoney={String} layout={definition.layout.map((i) => (i.key === 'items' ? { ...i, properties: undefined } : i))} rootId="r" />);
    expect(off.container.querySelectorAll('[data-premium-sku]')).toHaveLength(0);
  });
});
