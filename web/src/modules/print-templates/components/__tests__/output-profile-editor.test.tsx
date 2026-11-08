// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import type { DocumentTypeId } from '@/modules/documents/types';
import type { OutputProfile } from '../../services/output-profile';
import { OutputProfileEditor } from '../output-profile-editor';

afterEach(cleanup);

const INVOICE: DocumentTypeId[] = ['tax_invoice'];

function Harness({
  templateId = 'tax-invoice-classic',
  documentTypes = INVOICE,
  disabled = false,
  initial,
  onProfile,
}: {
  templateId?: string;
  documentTypes?: DocumentTypeId[];
  disabled?: boolean;
  initial?: unknown;
  onProfile: (profile: OutputProfile | null) => void;
}) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <OutputProfileEditor
      value={value}
      templateId={templateId}
      documentTypes={documentTypes}
      disabled={disabled}
      onChange={(profile) => { setValue(profile ?? undefined); onProfile(profile); }}
    />
  );
}

const messages = (locale: TestLocale) => TEST_MESSAGES[locale].printTemplateStudio.pageSetup;
const pick = (value: string) => fireEvent.change(screen.getByTestId('page-setup-paper'), { target: { value } });
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('OutputProfileEditor — إعداد الصفحة في المحرر (AWJ-DOC-V2-PR3B)', () => {
  it('اختيار A4 أفقي يرفع ملفاً مُطبَّعاً (a4_landscape) إلى المسودة', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness onProfile={onProfile} />, 'ar');
    pick('a4');
    fireEvent.click(screen.getByTestId('page-setup-orientation-landscape'));
    const last = onProfile.mock.calls.at(-1)![0] as OutputProfile;
    expect(last.paper).toBe('a4_landscape');
    expect(last.margins_mm).toEqual({ top: 14, right: 14, bottom: 14, left: 14 });
    expect(screen.getByTestId('page-setup-summary').textContent).toContain('297×210');
  });

  it('الخيارات = ما يعلنه القالب فقط: classic بلا A6، وclassic-v2 يضيف A6 (أفقي فقط)', () => {
    renderIntl(<Harness onProfile={vi.fn()} />, 'en');
    const options = () => [...(screen.getByTestId('page-setup-paper') as HTMLSelectElement).options].map((o) => o.value);
    expect(options()).toEqual(['default', 'a4', 'a5', 'letter', 'legal', 'custom']);
    cleanup();
    renderIntl(<Harness templateId="tax-invoice-classic-v2" onProfile={vi.fn()} />, 'en');
    expect(options()).toEqual(['default', 'a4', 'a5', 'a6', 'letter', 'legal', 'custom']);
    pick('a6');
    expect((screen.getByTestId('page-setup-orientation-portrait') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('page-setup-orientation-landscape').getAttribute('aria-checked')).toBe('true');
  });

  it('هامش خارج المدى: رسالة عند الحقل ولا تُرفع المسودة بقيمة غير صالحة', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness onProfile={onProfile} />, 'ar');
    pick('a4');
    onProfile.mockClear();
    type('page-setup-margin-top', '60');
    expect(onProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(messages('ar').error_margin_out_of_range.replace('{min}', '0').replace('{max}', '50'));
    expect((screen.getByTestId('page-setup-margin-top') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('هوامش تضيّق المحتوى عن حدّ القالب: رسالة مفهومة بالحد، بلا رفع', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness onProfile={onProfile} />, 'en');
    pick('a4');
    onProfile.mockClear();
    type('page-setup-margin-left', '20'); // محتوى 210−14−20 = 176 < 182
    expect(onProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId('page-setup-error-form').textContent).toContain('182');
  });

  it('تصحيح الخطأ يرفع الملف الصالح، و«الهوامش الافتراضية» تعيد الافتراضي', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness onProfile={onProfile} />, 'en');
    pick('a4');
    type('page-setup-margin-left', '8');
    expect((onProfile.mock.calls.at(-1)![0] as OutputProfile).margins_mm.left).toBe(8);
    fireEvent.click(screen.getByTestId('page-setup-margins-reset'));
    expect((onProfile.mock.calls.at(-1)![0] as OutputProfile).margins_mm.left).toBe(14);
  });

  it('مخصص: يظهر العرض والارتفاع ويُرفع الملف بأبعادهما؛ غير الصالح لا يُرفع', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness onProfile={onProfile} />, 'ar');
    pick('custom');
    onProfile.mockClear();
    type('page-setup-custom-width', '230');
    type('page-setup-custom-height', '300');
    expect((onProfile.mock.calls.at(-1)![0] as OutputProfile).custom).toEqual({ width_mm: 230, height_mm: 300 });
    onProfile.mockClear();
    type('page-setup-custom-width', '5000');
    expect(onProfile).not.toHaveBeenCalled();
  });

  it('«افتراضي القالب» يمسح الملف (null) فيعود السلوك السابق', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness onProfile={onProfile} initial={{ version: 1, paper: 'a4', orientation: 'portrait', output_mode: 'page', margins_mm: { top: 14, right: 14, bottom: 14, left: 14 } }} />, 'ar');
    expect((screen.getByTestId('page-setup-paper') as HTMLSelectElement).value).toBe('a4');
    pick('default');
    expect(onProfile).toHaveBeenLastCalledWith(null);
  });

  it('القالب الحراري: نص مقاس ثابت ولا عناصر تحكم', () => {
    renderIntl(<Harness templateId="tax-invoice-thermal80" onProfile={vi.fn()} />, 'ar');
    const section = screen.getByTestId('page-setup');
    expect(section.textContent).toContain('80');
    expect(within(section).queryByTestId('page-setup-paper')).toBeNull();
  });

  it('أنواع غير مربوطة بعد (سند قبض): العناصر معطَّلة مع إعلان صريح', () => {
    renderIntl(<Harness documentTypes={['tax_invoice', 'receipt_voucher']} onProfile={vi.fn()} />, 'ar');
    expect(screen.getByTestId('page-setup-unwired')).toBeTruthy();
    expect((screen.getByTestId('page-setup-paper') as HTMLSelectElement).disabled).toBe(true);
  });

  it('بلا صلاحية (للقراءة فقط): كل الحقول معطَّلة', () => {
    renderIntl(<Harness disabled initial={{ version: 1, paper: 'a4', orientation: 'portrait', output_mode: 'page', margins_mm: { top: 14, right: 14, bottom: 14, left: 14 } }} onProfile={vi.fn()} />, 'en');
    expect((screen.getByTestId('page-setup-paper') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByTestId('page-setup-margin-top') as HTMLInputElement).disabled).toBe(true);
  });

  it('ملف محفوظ لا يدعمه القالب (وُضع عبر API): تحذير «سيُتجاهل» بلا تعديل صامت', () => {
    const onProfile = vi.fn();
    renderIntl(<Harness initial={{ version: 1, paper: 'a6', orientation: 'portrait', output_mode: 'page', margins_mm: { top: 8, right: 8, bottom: 8, left: 8 } }} onProfile={onProfile} />, 'en');
    expect(screen.getByTestId('page-setup-ignored')).toBeTruthy();
    expect(onProfile).not.toHaveBeenCalled();
  });

  it('الإطار الضيّق يُعلَن: ملاحظة إخفاء أعمدة التعريف عند A5 عمودي لـclassic-v2', () => {
    renderIntl(<Harness templateId="tax-invoice-classic-v2" onProfile={vi.fn()} />, 'en');
    pick('a5');
    expect(screen.getByTestId('page-setup-summary').textContent).toContain(messages('en').narrow_note.slice(0, 20));
  });

  it('كل رمز خطأ يصدره النموذج له ترجمة عربية وإنجليزية', () => {
    const codes = ['margin_invalid', 'margin_out_of_range', 'custom_invalid', 'custom_out_of_range', 'content_too_narrow', 'printable_area_too_small', 'paper_not_supported', 'custom_not_supported', 'roll_not_supported', 'orientation_unsupported', 'orientation_conflict', 'generic'];
    for (const locale of ['ar', 'en'] as const) {
      for (const code of codes) expect((messages(locale) as Record<string, string>)[`error_${code}`], `${locale}:${code}`).toBeTruthy();
    }
  });
});
