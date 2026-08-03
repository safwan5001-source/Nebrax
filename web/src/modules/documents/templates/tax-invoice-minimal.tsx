'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { MINIMAL_STYLE } from './template-styles';

/** Minimal — مساحات بيضاء واسعة، بلا شريط هوية، رأس جدول هادئ. */
export function TaxInvoiceMinimal(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={MINIMAL_STYLE} />;
}
