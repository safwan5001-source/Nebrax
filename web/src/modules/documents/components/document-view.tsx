'use client';

import type { DocumentModel, ThemeId, DocSectionLayoutItem } from '../types';
import { getTemplate } from '../registry/templates';
import { getTheme } from '../themes';
import { makeMoneyFormatter } from '../utils/currency';

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
}: {
  model: DocumentModel;
  templateId?: string | null;
  themeId?: ThemeId | null;
  showLogo?: boolean;
  layout?: DocSectionLayoutItem[] | null;
  rootId?: string | null;
}) {
  const descriptor = getTemplate(templateId);
  const Template = descriptor.component;
  const theme = getTheme(themeId ?? descriptor.defaultTheme);
  const formatMoney = makeMoneyFormatter(model.currency);

  return (
    <Template
      model={model}
      theme={theme}
      formatMoney={formatMoney}
      sections={{ logo: showLogo }}
      layout={layout}
      rootId={rootId}
    />
  );
}
