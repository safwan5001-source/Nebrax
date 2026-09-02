// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModernBilingualLabel, ModernColumnHeader, ModernFieldLabel } from './modern-bilingual-label';

describe('ModernBilingualLabel', () => {
  it('يعزل العربية والإنجليزية في عقدتين باتجاه صريح دون فاصل نصي', () => {
    const { container } = render(<ModernBilingualLabel ar="الرقم الضريبي" en="VAT No." mode="bilingual" />);
    const root = container.querySelector('[data-modern-bilingual="label"]');
    expect(root).toBeTruthy();
    expect(root?.querySelector('[dir="rtl"]')?.textContent).toBe('الرقم الضريبي');
    expect(root?.querySelector('[dir="ltr"]')?.textContent).toBe('VAT No.');
    expect(container.textContent).not.toContain(' | ');
  });

  it('يبقي سطراً واحداً عندما يتساوى النصان', () => {
    const { container } = render(<ModernBilingualLabel ar="#" en="#" mode="bilingual" />);
    expect(container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(container.textContent).toBe('#');
  });

  it('لا يغيّر العربية أو الإنجليزية المنفردتين', () => {
    const arabic = render(<ModernFieldLabel field="date" mode="ar" />);
    expect(arabic.container.textContent).toBe('التاريخ');
    expect(arabic.container.querySelector('[data-modern-bilingual]')).toBeNull();
    arabic.unmount();

    const english = render(<ModernFieldLabel field="date" mode="en" />);
    expect(english.container.textContent).toBe('Date');
    expect(english.container.querySelector('[data-modern-bilingual]')).toBeNull();
  });

  it('يلحق وحدة المال بالسطر الإنجليزي فقط في الثنائي', () => {
    const { container } = render(<ModernColumnHeader column="total" mode="bilingual" currency="SAR" />);
    expect(container.querySelector('[dir="rtl"]')?.textContent).toBe('الإجمالي');
    expect(container.querySelector('[dir="ltr"]')?.textContent).toBe('Total (SAR)');
    expect(container.querySelector('[dir="rtl"]')?.textContent).not.toContain('SAR');
  });
});
