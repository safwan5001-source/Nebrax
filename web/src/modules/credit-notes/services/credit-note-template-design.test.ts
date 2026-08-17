import { describe, expect, it } from 'vitest';
import {
  resolveCreditNoteTemplateDesign,
  resolveLiveCreditNoteTemplateDesign,
  type LegacyCreditNoteDesign,
} from './credit-note-template-design';

describe('resolveCreditNoteTemplateDesign', () => {
  const legacyDesign: LegacyCreditNoteDesign = {
    template: 'modern',
    theme: 'green' as const,
    footer_text: 'تذييل حي لا يجب أن يظهر',
    show_logo: false,
    logo: 'https://live.example/logo.svg',
    logo_height: 48,
    sections: [{ key: 'footer', visible: true }],
    terms_text: 'شروط حية',
    bank_text: 'بيانات بنك حية',
    stamp: 'https://live.example/stamp.png',
    signature: 'https://live.example/signature.png',
  };

  it('uses the frozen revision as the complete historical design boundary', () => {
    const resolved = resolveCreditNoteTemplateDesign({
      template_id: 'tax-invoice-minimal',
      theme_id: 'purple',
      footer_text: 'تذييل المراجعة المثبتة',
      show_logo: true,
      logo: 'https://frozen.example/logo.svg',
      logo_height: 36,
      layout: [{ key: 'summary', visible: true }],
      terms_text: 'شروط مثبتة',
      bank_text: 'بيانات بنك مثبتة',
      stamp: 'https://frozen.example/stamp.png',
      signature: 'https://frozen.example/signature.png',
    }, legacyDesign);

    expect(resolved).toMatchObject({
      templateId: 'tax-invoice-minimal',
      themeId: 'purple',
      footerText: 'تذييل المراجعة المثبتة',
      showLogo: true,
      logoUrl: 'https://frozen.example/logo.svg',
      logoHeight: 36,
      termsText: 'شروط مثبتة',
      bankText: 'بيانات بنك مثبتة',
      stampUrl: 'https://frozen.example/stamp.png',
      signatureUrl: 'https://frozen.example/signature.png',
      frozen: true,
    });
    expect(resolved.layout).toEqual([{ key: 'summary', visible: true }]);
  });

  it('does not merge missing frozen values with newer live settings', () => {
    const resolved = resolveCreditNoteTemplateDesign({
      template_id: 'tax-invoice-classic',
      show_logo: false,
    }, legacyDesign);

    expect(resolved).toMatchObject({
      templateId: 'tax-invoice-classic',
      themeId: null,
      footerText: null,
      showLogo: false,
      logoUrl: null,
      logoHeight: null,
      layout: null,
      termsText: null,
      bankText: null,
      stampUrl: null,
      signatureUrl: null,
      frozen: true,
    });
  });

  it('maps a resolved live template without borrowing legacy images or signatures', () => {
    const resolved = resolveLiveCreditNoteTemplateDesign({
      templateId: 'tax-invoice-retail',
      themeId: 'blue',
      footerText: 'تذييل القالب المنشور',
      showLogo: false,
      layout: [{ key: 'header', visible: true }],
      termsText: 'شروط منشورة',
      bankText: 'بيانات بنك منشورة',
      logoHeight: null,
      stampUrl: null,
      signatureUrl: null,
    });

    expect(resolved).toMatchObject({
      templateId: 'tax-invoice-retail',
      themeId: 'blue',
      footerText: 'تذييل القالب المنشور',
      showLogo: false,
      termsText: 'شروط منشورة',
      bankText: 'بيانات بنك منشورة',
      logoUrl: null,
      stampUrl: null,
      signatureUrl: null,
      frozen: false,
    });
  });

  it('falls back to the legacy live design only when no frozen revision exists', () => {
    const resolved = resolveCreditNoteTemplateDesign(null, legacyDesign);

    expect(resolved).toMatchObject({
      templateId: 'tax-invoice-modern',
      themeId: 'green',
      footerText: 'تذييل حي لا يجب أن يظهر',
      showLogo: false,
      logoUrl: 'https://live.example/logo.svg',
      logoHeight: 48,
      termsText: 'شروط حية',
      bankText: 'بيانات بنك حية',
      stampUrl: 'https://live.example/stamp.png',
      signatureUrl: 'https://live.example/signature.png',
      frozen: false,
    });
    expect(resolved.layout).toEqual([{ key: 'footer', visible: true }]);
  });
});
