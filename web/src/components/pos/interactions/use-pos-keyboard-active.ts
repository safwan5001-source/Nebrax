'use client';

import { useCallback, useRef, useState } from 'react';
import {
  isPosKeyboardNavigationKey,
  shouldRestorePosFocus,
  type PosInputModality,
  type PosKeyIdentity,
  type PosLastInput,
} from '@/components/pos/interactions/pos-input-modality';

export type { PosInputModality, PosLastInput };
export { shouldRestorePosFocus };

/** يميّز التفاعل بلوحة المفاتيح عن اللمس والمسح لإظهار حالات التحديد بصرياً. */
export function usePosKeyboardActive() {
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [lastInput, setLastInput] = useState<PosInputModality>('keyboard');
  const [pointerType, setPointerType] = useState<string | null>(null);
  const lastInputRef = useRef<PosInputModality>('keyboard');

  const commitModality = useCallback((modality: PosInputModality) => {
    lastInputRef.current = modality;
    setLastInput(modality);
    setKeyboardActive(modality === 'keyboard');
  }, []);

  const onPointerDown = useCallback((event?: { pointerType?: string }) => {
    commitModality('pointer');
    if (event?.pointerType) setPointerType(event.pointerType);
  }, [commitModality]);

  const onKeyDown = useCallback((event?: PosKeyIdentity) => {
    if (event && !isPosKeyboardNavigationKey(event)) return;
    commitModality('keyboard');
  }, [commitModality]);

  const markScanner = useCallback(() => {
    commitModality('scanner');
  }, [commitModality]);

  const getLastInput = useCallback(() => lastInputRef.current, []);

  /** بعد إغلاق الحوار: يُؤجَّل حتى يُزال الـ dialog من الشجرة، ويقرأ الـ modality المتزامن. */
  const restoreAfterUi = useCallback((restore: () => boolean) => {
    if (!shouldRestorePosFocus(lastInputRef.current)) return false;
    window.setTimeout(() => { restore(); }, 0);
    return true;
  }, []);

  return {
    keyboardActive,
    lastInput,
    pointerType,
    isPointerSession: lastInput === 'pointer',
    isScannerSession: lastInput === 'scanner',
    onPointerDown,
    onKeyDown,
    markScanner,
    getLastInput,
    restoreAfterUi,
  };
}
