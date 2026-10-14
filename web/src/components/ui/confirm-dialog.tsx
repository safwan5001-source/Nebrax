'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { useCommonLabel } from '@/lib/ui-label';

export interface ConfirmOptions {
  /** نصّ السؤال كما كان يُمرَّر إلى `window.confirm` — لا يتغيّر المعنى ولا الصياغة. */
  message: string;
  title?: string;
  confirmLabel?: string;
  /** `danger` للحذف والتعطيل؛ الافتراضي للترحيل والإرسال. */
  tone?: 'danger' | 'default';
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * بديلٌ داخل التطبيق لـ`window.confirm` (ERP-UX-017): حوارٌ نمطي من `Dialog` المشترك
 * (تركيز محبوس، Escape يلغي، يعود التركيز لزرّ الإجراء)، بتسمياتٍ بلغة الواجهة وبنمط
 * التصميم نفسه. «إلغاء» أولاً في ترتيب التركيز فلا يُنفَّذ إجراءٌ هدّام بضغطة Enter عابرة.
 *
 * النتيجة نفسها التي كان يعطيها `window.confirm`: `true` للتأكيد و`false` لكل ما عداه
 * (إلغاء، Escape، النقر خارج الحوار، أو طلب تأكيدٍ جديد قبل حسم السابق).
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const defaultTitle = useCommonLabel('confirmTitle', { ar: 'تأكيد الإجراء', en: 'Confirm action' });
  const defaultConfirm = useCommonLabel('confirm', { ar: 'تأكيد', en: 'Confirm' });
  const cancelLabel = useCommonLabel('cancel', { ar: 'إلغاء', en: 'Cancel' });

  const confirm = useCallback<Confirm>((next) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(next);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={options !== null} onClose={() => settle(false)} title={options?.title ?? defaultTitle}>
        <p className="whitespace-pre-line text-sm leading-relaxed text-text">{options?.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => settle(false)}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={options?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {options?.confirmLabel ?? defaultConfirm}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * يعيد دالة تأكيد تُستدعى مثل `window.confirm` لكن بـ`await`. خارج `ConfirmProvider`
 * (اختبار مكوّن معزول) تسقط على `window.confirm` نفسه، فلا يصير المزوّد شرطاً جديداً.
 */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext);
  return ctx ?? nativeConfirm;
}

function nativeConfirm({ message }: ConfirmOptions): Promise<boolean> {
  return Promise.resolve(typeof window !== 'undefined' && window.confirm(message));
}
