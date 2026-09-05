// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PosCategorySwatch } from './pos-category-swatch';

describe('PosCategorySwatch', () => {
  afterEach(() => cleanup());

  it('يعرض اللون الآمن كخلفية حين يطابق نمط #RRGGBB', () => {
    const { container } = render(<PosCategorySwatch color="#2563EB" alt="مشروبات" />);
    const swatch = container.querySelector('[role="img"]') as HTMLElement;
    expect(swatch).toBeTruthy();
    expect(swatch.style.backgroundColor).toBeTruthy();
    expect(swatch.getAttribute('aria-label')).toBe('مشروبات');
  });

  it('يسقط على أيقونة محايدة حين يغيب اللون', () => {
    render(<PosCategorySwatch color={null} alt="مشروبات" />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('يسقط على أيقونة محايدة حين يكون اللون قيمة غير آمنة (لا يثق بالمصدر الخام)', () => {
    render(<PosCategorySwatch color="url(javascript:alert(1))" alt="مشروبات" />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('يرفض ألواناً مختصرة أو صيغاً غير كاملة', () => {
    render(<PosCategorySwatch color="#FFF" alt="مشروبات" />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
