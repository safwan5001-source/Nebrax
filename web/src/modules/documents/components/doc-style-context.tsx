'use client';

import { createContext, useContext } from 'react';
import type { TemplateStyle } from '../types';
import { CLASSIC_STYLE } from '../templates/template-styles';

/** أسلوب القالب الحالي — تقرؤه الأقسام لتتكيّف دون تكرار. */
const DocStyleContext = createContext<TemplateStyle>(CLASSIC_STYLE);

export function DocStyleProvider({ value, children }: { value: TemplateStyle; children: React.ReactNode }) {
  return <DocStyleContext.Provider value={value}>{children}</DocStyleContext.Provider>;
}

export function useDocStyle(): TemplateStyle {
  return useContext(DocStyleContext);
}
