'use client';

import { useEffect, useRef } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';

/** أقصر تسلسل يُقبل كباركود؛ ما دونه ضغطُ مفاتيح عابر لا مسح. */
export const POS_SCANNER_MIN_LENGTH = 3;
/** أطول فجوة بين حرفين تُعدّ ما زالت مسحاً؛ ما فوقها تسلسل بشري فيُفرغ المخزن. */
export const POS_SCANNER_MAX_GAP_MS = 80;

export interface PosBarcodeScannerOptions {
  /** يُستدعى بالكود المجمَّع عند Enter — لا مطابقة ولا بحث داخل هذه الطبقة. */
  onScan: (code: string) => unknown;
  minLength?: number;
  maxGapMs?: number;
}

/**
 * ماسح الباركود من نوع keyboard-wedge: يكتب الكود سريعاً ثم Enter. يلتقط التسلسل
 * السريع خارج حقول الإدخال، فالمسح يعمل دون تركيز حقل معيّن، ولا يلتقط شيئاً
 * أثناء الكتابة اليدوية داخل حقل. طبقة تفاعل فقط: تجمّع الأحرف وتطلق callback.
 */
export function usePosBarcodeScanner({
  onScan,
  minLength = POS_SCANNER_MIN_LENGTH,
  maxGapMs = POS_SCANNER_MAX_GAP_MS,
}: PosBarcodeScannerOptions): void {
  // مرجع حيّ لأحدث callback (يقرأ أحدث كتالوج) — فلا يُعاد تسجيل المستمع لكل رسم.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;

    function onKeyDown(event: KeyboardEvent) {
      const editable = isPosEditableTarget(document.activeElement);
      if (event.key === 'Enter') {
        if (!editable && buffer.length >= minLength) {
          event.preventDefault();
          onScanRef.current(buffer);
        }
        buffer = '';
        return;
      }
      if (editable) return; // لا نلتقط أثناء الكتابة اليدوية في الحقول
      if (event.key.length === 1) {
        const now = Date.now();
        if (now - lastKeyAt > maxGapMs) buffer = ''; // فجوة طويلة = تسلسل بشري لا ماسح
        buffer += event.key;
        lastKeyAt = now;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maxGapMs, minLength]);
}
