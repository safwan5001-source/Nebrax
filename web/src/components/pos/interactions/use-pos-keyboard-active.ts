'use client';

import { useCallback, useState } from 'react';

/** يميّز التفاعل بلوحة المفاتيح عن اللمس لإظهار حالات التحديد بصرياً. */
export function usePosKeyboardActive() {
  const [keyboardActive, setKeyboardActive] = useState(false);

  const onPointerDown = useCallback(() => {
    setKeyboardActive(false);
  }, []);

  const onKeyDown = useCallback(() => {
    setKeyboardActive(true);
  }, []);

  return { keyboardActive, onPointerDown, onKeyDown };
}
