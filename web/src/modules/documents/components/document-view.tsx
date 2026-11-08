'use client';

import type { DocumentModel, ThemeId, DocSectionLayoutItem } from '../types';
import { getTemplate } from '../registry/templates';
import { getTheme } from '../themes';
import { makeMoneyFormatter } from '../utils/currency';
import type { OutputProfile } from '@/modules/print-templates/services/output-profile';
import { resolveDocumentOutputSpec } from '../services/output-spec';
import { DocPageFrameProvider } from './doc-page-frame-context';
import { DocPageSheet } from './doc-page-sheet';

/**
 * العارض العامّ لأي مستند — يبني القالب المسجَّل من `DocumentModel` أياً كان نوعه
 * (فاتورة/عرض سعر/سند…). نقطة الدخول المشتركة لكل أغلفة المستندات.
 */
export function DocumentView({
  model,
  templateId,
  themeId,
  showLogo = true,
  layout,
  rootId,
  outputProfile,
}: {
  model: DocumentModel;
  templateId?: string | null;
  themeId?: ThemeId | null;
  showLogo?: boolean;
  layout?: DocSectionLayoutItem[] | null;
  rootId?: string | null;
  /**
   * ملف الإخراج من مراجعة القالب (AWJ-DOC-V2-PR3B). غيابه — أو ملف لا يدعمه القالب —
   * يبقي المعاينة بإطارها الثابت القديم تماماً؛ صفحة مدعومة ترسم الورقة بأبعاد الملف.
   */
  outputProfile?: OutputProfile | null;
}) {
  const descriptor = getTemplate(templateId);
  const Template = descriptor.component;
  const theme = getTheme(themeId ?? descriptor.defaultTheme);
  const formatMoney = makeMoneyFormatter(model.currency);

  const frame = resolveDocumentOutputSpec(descriptor.id, outputProfile).frame;
  const rendered = (
    <Template
      model={model}
      theme={theme}
      formatMoney={formatMoney}
      sections={{ logo: showLogo }}
      layout={layout}
      rootId={rootId}
    />
  );

  if (!frame) return rendered;

  return (
    <DocPageSheet frame={frame}>
      <DocPageFrameProvider value={frame}>{rendered}</DocPageFrameProvider>
    </DocPageSheet>
  );
}
