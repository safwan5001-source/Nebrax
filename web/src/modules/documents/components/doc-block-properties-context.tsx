'use client';

import { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';
import type { DocBlockPropertiesMap, DocSectionKey, DocSectionProperties } from '../types';

const EMPTY_PROPERTIES: DocSectionProperties = {};
const DocBlockPropertiesContext = createContext<DocBlockPropertiesMap>({});

/** يوفر خصائص المراجعة المثبتة لعارض كل كتلة من دون نسخها في أغلفة المستندات. */
export function DocBlockPropertiesProvider({
  value,
  children,
}: {
  value: DocBlockPropertiesMap;
  children: React.ReactNode;
}) {
  return <DocBlockPropertiesContext.Provider value={value}>{children}</DocBlockPropertiesContext.Provider>;
}

/** خصائص كتلة واحدة؛ غيابها يحافظ على المخرج القديم حرفياً. */
export function useDocBlockProperties(key: DocSectionKey): DocSectionProperties {
  return useContext(DocBlockPropertiesContext)[key] ?? EMPTY_PROPERTIES;
}

/** أصناف نصية ثابتة لجميع الكتل؛ المحاذاة منطقية ومتوافقة مع اتجاه المستند. */
export function blockTextClassName(properties: DocSectionProperties, className?: string): string {
  const alignment = properties.alignment ? {
    start: 'text-start',
    center: 'text-center',
    end: 'text-end',
  }[properties.alignment] : undefined;
  const fontSize = properties.font_size ? {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  }[properties.font_size] : undefined;

  return cn(className, alignment, fontSize);
}

/** محاذاة حاويات الصور المرنة من دون استخدام start/end في CSS خام. */
export function blockJustifyClassName(properties: DocSectionProperties): string {
  return {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
  }[properties.alignment ?? 'end'];
}
