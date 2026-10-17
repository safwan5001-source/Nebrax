import type { AssistantStatus } from './contract';
import type { ClassifiedError, NoticeKey } from './state';

/**
 * ما تعرضه الواجهة بدل المحتوى، مشتقّاً **حصراً** من حالة الخادم المحسوبة (`AssistantStatus.chat/financial`).
 * لا تخمين من جهة العميل: قبل وصول الحالة لا يُسمح بأي طلب مالي أو محادثة.
 */
export type Gate =
  | { kind: 'loading' }
  | { kind: 'error'; error: ClassifiedError }
  | { kind: 'blocked'; notice: NoticeKey }
  | { kind: 'ready' };

export function gateFor(
  input: { statusPhase: 'idle' | 'loading' | 'ready' | 'error'; status: AssistantStatus | null; statusError: ClassifiedError | null },
  capability: 'chat' | 'financial' | 'document',
): Gate {
  if (input.status) {
    const state = input.status[capability];
    return state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', notice: state };
  }
  if (input.statusPhase === 'error' && input.statusError) return { kind: 'error', error: input.statusError };
  return { kind: 'loading' };
}

/** المستخدم يرى المساعد أصلاً (الزر/العناصر) فقط إن كان يملك صلاحية الاستخدام. */
export function canSeeAssistant(can: (permission: string) => boolean): boolean {
  return can('ai.assistant.use');
}
