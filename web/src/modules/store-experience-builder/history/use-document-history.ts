"use client";

/**
 * CUST-H5-1 — الغلاف الرفيع لمحرّك `document-history` على React.
 *
 * الحالة تعيش في `ref` (لا `useState`) كي تكون القراءة بعد الكتابة متزامنة داخل المعالج نفسه: `undo()` ثم `undo()`
 * في الحدث نفسه يجب أن يريا النتيجة السابقة. يُعاد الرسم عبر عدّاد فقط حين تتغيّر `canUndo`/`canRedo` فعلاً.
 *
 * لا يملك هذا الخطّاف المستند: المحرِّر يبقى مالك `draft`، ويطبّق ما تُعيده `undo()`/`redo()` عبر مساره المعتاد.
 * الخطّاف يتتبّع **نسخة** المستند فقط للتراجع، ولا سلطة له على الحفظ أو النشر أو المراجعة.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  type DocumentHistory,
  type HistoryOptions,
  canRedo as engineCanRedo,
  canUndo as engineCanUndo,
  createHistory,
  markSaved as engineMarkSaved,
  recordEdit,
  redo as engineRedo,
  resetHistory,
  undo as engineUndo,
} from "./document-history";

export interface UseDocumentHistoryOptions<T> extends HistoryOptions<T> {
  /** ساعة قابلة للحقن للاختبار. */
  now?: () => number;
}

export interface DocumentHistoryApi<T> {
  canUndo: boolean;
  canRedo: boolean;
  /** يبدأ جلسة جديدة لنسخة (فتح/تبديل/تجاهل/نشر). يُفرغ كل شيء. */
  begin: (scopeKey: string, present: T) => void;
  /** ينهي الجلسة (لا نسخة مفتوحة أو نسخة منشورة): كل العمليات اللاحقة تُتجاهل. */
  end: () => void;
  /** تعديل تاجر. */
  record: (scopeKey: string, next: T, group?: string) => void;
  /** يعيد المستند المُستعاد، أو `null` إن لم يكن هناك ما يُتراجع عنه. */
  undo: (scopeKey: string) => T | null;
  redo: (scopeKey: string) => T | null;
  /** حفظ ناجح: حدّ التراجع. فشل الحفظ لا يستدعي شيئاً. */
  markSaved: (scopeKey: string, saved: T, editedSincePersist: boolean) => void;
}

export function useDocumentHistory<T>(
  initial: T,
  options: UseDocumentHistoryOptions<T> = {},
): DocumentHistoryApi<T> {
  const stateRef = useRef<DocumentHistory<T>>(createHistory<T>(null, initial));
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [, setTick] = useState(0);

  const apply = useCallback((next: DocumentHistory<T>) => {
    const prev = stateRef.current;
    if (next === prev) return;
    stateRef.current = next;
    if (engineCanUndo(prev) !== engineCanUndo(next) || engineCanRedo(prev) !== engineCanRedo(next)) {
      setTick((n) => n + 1);
    }
  }, []);

  const api = useMemo(
    () => ({
      begin: (scopeKey: string, present: T) => apply(resetHistory(scopeKey, present)),
      end: () => apply(resetHistory<T>(null, stateRef.current.present)),
      record: (scopeKey: string, next: T, group?: string) => {
        const now = (optionsRef.current.now ?? Date.now)();
        apply(recordEdit(stateRef.current, scopeKey, next, { group, now }, optionsRef.current));
      },
      undo: (scopeKey: string): T | null => {
        const before = stateRef.current;
        const after = engineUndo(before, scopeKey);
        if (after === before) return null;
        apply(after);
        return after.present;
      },
      redo: (scopeKey: string): T | null => {
        const before = stateRef.current;
        const after = engineRedo(before, scopeKey);
        if (after === before) return null;
        apply(after);
        return after.present;
      },
      markSaved: (scopeKey: string, saved: T, editedSincePersist: boolean) =>
        apply(engineMarkSaved(stateRef.current, scopeKey, saved, editedSincePersist, optionsRef.current)),
    }),
    [apply],
  );

  return {
    ...api,
    canUndo: engineCanUndo(stateRef.current),
    canRedo: engineCanRedo(stateRef.current),
  };
}
