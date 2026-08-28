'use client';

import { useEffect, useRef } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';

/** أقصر تسلسل يُقبل كباركود؛ ما دونه ضغطُ مفاتيح عابر لا مسح. */
export const POS_SCANNER_MIN_LENGTH = 3;
/** أطول فجوة بين حرفين تُعدّ ما زالت مسحاً؛ ما فوقها تسلسل بشري فيُفرغ المخزن. */
export const POS_SCANNER_MAX_GAP_MS = 80;

export interface PosBarcodeScannerOptions {
  onScan: (code: string) => unknown;
  minLength?: number;
  maxGapMs?: number;
  /** عند false لا يُجمَّع المخزن ولا يُستدعى callback — مثلاً أثناء الدفع أو حوار. */
  enabled?: boolean;
}

export function usePosBarcodeScanner({
  onScan,
  minLength = POS_SCANNER_MIN_LENGTH,
  maxGapMs = POS_SCANNER_MAX_GAP_MS,
  enabled = true,
}: PosBarcodeScannerOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;

    function onKeyDown(event: KeyboardEvent) {
      if (!enabledRef.current) return;
      const editable = isPosEditableTarget(document.activeElement);
      if (event.key === 'Enter') {
        if (!editable && buffer.length >= minLength) {
          event.preventDefault();
          onScanRef.current(buffer);
        }
        buffer = '';
        return;
      }
      if (editable) return;
      if (event.key.length === 1) {
        const now = Date.now();
        if (now - lastKeyAt > maxGapMs) buffer = '';
        buffer += event.key;
        lastKeyAt = now;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maxGapMs, minLength]);
}
