'use client';

import { useCallback, useState } from 'react';
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

  const onPointerDown = useCallback((event?: { pointerType?: string }) => {
    setKeyboardActive(false);
    setLastInput('pointer');
    if (event?.pointerType) setPointerType(event.pointerType);
  }, []);

  const onKeyDown = useCallback((event?: PosKeyIdentity) => {
    if (event && !isPosKeyboardNavigationKey(event)) return;
    setKeyboardActive(true);
    setLastInput('keyboard');
  }, []);

  const markScanner = useCallback(() => {
    setKeyboardActive(false);
    setLastInput('scanner');
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
  };
}
