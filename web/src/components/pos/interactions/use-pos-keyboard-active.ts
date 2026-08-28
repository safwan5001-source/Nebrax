'use client';

import { useCallback, useState } from 'react';

export type PosLastInput = 'keyboard' | 'pointer';

/** لا تُعد استعادة التركيز بعد تفاعل لمس حتى لا يُسحب الكاشير إلى حقل البحث. */
export function shouldRestorePosFocus(lastInput: PosLastInput): boolean {
  return lastInput !== 'pointer';
}

/** يميّز التفاعل بلوحة المفاتيح عن اللمس لإظهار حالات التحديد بصرياً. */
export function usePosKeyboardActive() {
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [lastInput, setLastInput] = useState<PosLastInput>('keyboard');
  const [pointerType, setPointerType] = useState<string | null>(null);

  const onPointerDown = useCallback((event?: { pointerType?: string }) => {
    setKeyboardActive(false);
    setLastInput('pointer');
    if (event?.pointerType) setPointerType(event.pointerType);
  }, []);

  const onKeyDown = useCallback(() => {
    setKeyboardActive(true);
    setLastInput('keyboard');
  }, []);

  return {
    keyboardActive,
    lastInput,
    pointerType,
    isPointerSession: lastInput === 'pointer',
    onPointerDown,
    onKeyDown,
  };
}
