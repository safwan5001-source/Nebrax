// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { DocumentLanguageSelector } from './document-language-selector';
import arMessages from '@/messages/ar.json';

afterEach(() => cleanup());

function wrap(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ar" messages={arMessages as unknown as Record<string, unknown>}>
      {children}
    </NextIntlClientProvider>
  );
}

describe('DocumentLanguageSelector', () => {
  it('يعرض الخيارات الثلاثة (ar/en/bilingual)', () => {
    render(wrap(<DocumentLanguageSelector value={null} onChange={() => {}} />));
    expect(screen.getByTestId('document-language-ar')).toBeTruthy();
    expect(screen.getByTestId('document-language-en')).toBeTruthy();
    expect(screen.getByTestId('document-language-bilingual')).toBeTruthy();
  });

  it('اختيار قيمة يستدعي onChange بها فقط (لا يمس تصميم)', () => {
    const onChange = vi.fn();
    render(wrap(<DocumentLanguageSelector value={null} onChange={onChange} />));
    fireEvent.click(screen.getByTestId('document-language-en'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('en');
  });

  it('زر «إعادة إلى الافتراضي» يظهر عندما value != null، ويرسل null', () => {
    const onChange = vi.fn();
    render(wrap(<DocumentLanguageSelector value="bilingual" onChange={onChange} />));
    const reset = screen.getByTestId('document-language-reset');
    fireEvent.click(reset);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('عندما value=null: نصّ سقوط الافتراضي يظهر، وزر الإعادة يختفي', () => {
    render(wrap(<DocumentLanguageSelector value={null} onChange={() => {}} tenantDefault="en" />));
    // نص "يتبع افتراضي المؤسسة (English)" — نطابقه بالجزء العربي الفريد.
    expect(screen.getByText(/يتبع افتراضي المؤسسة/)).toBeTruthy();
    expect(screen.queryByTestId('document-language-reset')).toBeNull();
  });

  it('disabled: كل الأزرار معطلة وظهور ملاحظة التجميد', () => {
    render(wrap(<DocumentLanguageSelector value="ar" disabled onChange={() => {}} />));
    expect((screen.getByTestId('document-language-ar') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('document-language-frozen-note')).toBeTruthy();
    // زر الإعادة لا يظهر عند التجميد حتى مع value != null
    expect(screen.queryByTestId('document-language-reset')).toBeNull();
  });

  it('ARIA: radiogroup + radios مع aria-checked صحيحة', () => {
    render(wrap(<DocumentLanguageSelector value="bilingual" onChange={() => {}} />));
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    const bilingual = screen.getByTestId('document-language-bilingual');
    expect(bilingual.getAttribute('aria-checked')).toBe('true');
    const ar = screen.getByTestId('document-language-ar');
    expect(ar.getAttribute('aria-checked')).toBe('false');
  });
});
