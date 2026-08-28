'use client';

import { useEffect, useRef } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';
import { isPosDialogOpen, isPosShortcutBlocked, type PosDialogFlags, type PosSaleStep } from '@/components/pos/interactions/pos-interaction-context';
import { matchPosShortcut, type PosShortcutId } from '@/components/pos/interactions/shortcut-registry';

export type PosShortcutHandlers = Partial<Record<PosShortcutId, () => void>>;

export interface PosKeyboardShortcutContext {
  step: PosSaleStep;
  dialogFlags: PosDialogFlags;
}

/**
 * اختصارات نقطة البيع من مصدر الحقيقة الواحد، مع حراسة السياق (حوار/دفع).
 * المفتاح بلا معالج لا يُلغى؛ Esc خلف حوار يُترك للحوار.
 */
export function usePosKeyboardShortcuts(
  handlers: PosShortcutHandlers,
  context: PosKeyboardShortcutContext,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const binding = matchPosShortcut(event);
      if (!binding) return;
      const handler = handlersRef.current[binding.id];
      if (!handler) return;
      if (binding.skipWhenEditable && isPosEditableTarget(document.activeElement)) return;

      const ctx = contextRef.current;
      const dialogOpen = isPosDialogOpen(ctx.dialogFlags);
      if (isPosShortcutBlocked(binding.id, binding, { step: ctx.step, dialogOpen })) return;

      event.preventDefault();
      handler();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
