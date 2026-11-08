'use client';

import { createContext, useContext } from 'react';
import type { DocPageFrame } from '../services/output-spec';

/**
 * إطار الصفحة الذي يرسمه `DocLayout`. غيابه (القيمة `null`) = الإطار الثابت القديم
 * (A4 210mm) بصنفيه الأصليين حرفياً؛ وجوده يأتي من Output Profile مدعوم فقط
 * (AWJ-DOC-V2-PR3B) عبر `DocumentView`.
 */
const DocPageFrameContext = createContext<DocPageFrame | null>(null);

export const DocPageFrameProvider = DocPageFrameContext.Provider;

export function useDocPageFrame(): DocPageFrame | null {
  return useContext(DocPageFrameContext);
}

/**
 * عرض المحتوى (مم) دون هذا الحد = إطار ضيّق (A5 عمودي، A6…): يُدمج تدفّق الجدول
 * (يُخفي أعمدة التعريف فقط ويضغط الحشو) بدل تصغير تصميم A4 بشكل أعمى. الإطار الأعرض
 * (A4/A5 أفقي/Letter/Legal) يبقى بتدفّقه الكامل.
 */
export const NARROW_CONTENT_WIDTH_MM = 150;

export function isNarrowDocPageFrame(frame: DocPageFrame | null): boolean {
  return frame !== null && frame.contentWidthMm < NARROW_CONTENT_WIDTH_MM;
}
