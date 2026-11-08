// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaxReceiptThermal58, TaxReceiptThermal80 } from '../templates/thermal-receipt';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
  useTranslations: () => (key: string) => key,
}));

const theme = getTheme('blue');
const formatMoney = (minor: number) => `${(minor / 100).toFixed(2)} SAR`;

afterEach(() => cleanup());

function renderReceipt(width: 58 | 80, scenario: 'single' | 'twenty' | 'long_content', direction: 'rtl' | 'ltr' = 'rtl') {
  const model = makeDocumentQaModel({ documentType: 'simplified_tax_invoice', scenario, direction, showQr: true, showAssets: true });
  const Receipt = width === 58 ? TaxReceiptThermal58 : TaxReceiptThermal80;
  const view = render(<Receipt model={model} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
  return { model, root: view.container.querySelector('#print-root') as HTMLElement };
}

describe('الإيصال الحراري — التفاف لا اقتطاع (AWJ-DOC-V2-PR2)', () => {
  it.each([[58], [80]] as const)('%smm: لا عنصر يقتطع بـ `truncate`/ellipsis، والوصف كاملاً في DOM', (width) => {
    const { model, root } = renderReceipt(width, 'long_content');
    expect(root.querySelectorAll('.truncate, [class*="text-ellipsis"]')).toHaveLength(0);
    for (const line of model.lines) {
      const node = [...root.querySelectorAll('div.break-words')].find((element) => element.textContent === line.description);
      expect(node, `وصف البند «${line.description}» يجب أن يظهر كاملاً وبالتفاف`).toBeTruthy();
    }
  });

  it('عرض الجذر 58mm/80mm كما كان', () => {
    expect(renderReceipt(58, 'single').root.style.width).toBe('58mm');
    cleanup();
    expect(renderReceipt(80, 'single').root.style.width).toBe('80mm');
  });

  it.each(['rtl', 'ltr'] as const)('%s: كل مبلغ معزول LTR وغير قابل للالتفاف (لا انقسام «المبلغ/العملة»)', (direction) => {
    const { model, root } = renderReceipt(58, 'twenty', direction);
    const amounts = [...root.querySelectorAll<HTMLElement>('span.num[dir="ltr"]')];
    // سطور البنود (كمية×سعر + إجمالي) + المجموع/الخصم/الضريبة/الإجمالي
    expect(amounts.length).toBeGreaterThanOrEqual(model.lines.length * 2 + 4);
    for (const amount of amounts) expect(amount.className).toContain('whitespace-nowrap');
  });

  it('الإجماليات والضريبة كما في النموذج حرفياً (لا تغيير مالي)', () => {
    const { model, root } = renderReceipt(80, 'twenty');
    const text = root.textContent ?? '';
    expect(text).toContain(formatMoney(model.totals.total));
    expect(text).toContain(formatMoney(model.totals.tax));
    expect(text).toContain(formatMoney(model.totals.subtotal));
    for (const line of model.lines) expect(text).toContain(formatMoney(line.total));
  });

  it('QR الضريبي موجود وبحجمه (88px) على الورقين', () => {
    for (const width of [58, 80] as const) {
      const { root } = renderReceipt(width, 'single');
      const qr = root.querySelector('svg');
      expect(qr?.getAttribute('width')).toBe('88');
      cleanup();
    }
  });

  it('عنوان الصف الطويل (الإجمالي شامل الضريبة) يلتفّ والمبلغ يبقى في سطر واحد', () => {
    const { root } = renderReceipt(58, 'single');
    const totalRow = [...root.querySelectorAll('div')].find((element) => element.className.includes('text-[13px]') && element.textContent?.includes('grand_total'));
    expect(totalRow).toBeTruthy();
    const [label, amount] = [...(totalRow as HTMLElement).children] as HTMLElement[];
    expect(label.className).toContain('flex-1');
    expect(label.className).toContain('break-words');
    expect(amount.className).toContain('shrink-0');
  });

  it('كمية × سعر: القيم متماسكة لكن يجوز الكسر بينها، والإجمالي ينزل لسطر خاص عند الضيق (لا تداخل على 58mm)', () => {
    const { model, root } = renderReceipt(58, 'twenty');
    // لا Amount واحد يضم التعبير كله: لو ضمّه لمنع nowrap الكسر وتداخل مع الإجمالي (ملاحظة مراجعة PR2)
    for (const amount of root.querySelectorAll('span.num[dir="ltr"]')) expect(amount.textContent).not.toContain('×');
    const rows = [...root.querySelectorAll('div.flex-wrap')].filter((row) => row.textContent?.includes('×'));
    expect(rows).toHaveLength(model.lines.length);
    for (const row of rows) {
      const [expression, total] = [...row.children] as HTMLElement[];
      expect(expression.getAttribute('dir')).toBe('ltr'); // الترتيب «1 × 125.00» في RTL
      expect(expression.className).toContain('min-w-0');
      expect(total.className).toContain('ms-auto');
    }
  });
});
