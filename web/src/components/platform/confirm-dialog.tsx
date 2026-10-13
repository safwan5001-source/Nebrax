'use client';

/**
 * حوار تأكيد لإجراءات المنصة الحساسة (H1-4B) فوق `Dialog` القائم دون تعديله.
 *
 * ما يضيفه: التركيز الأولي على «تراجع» (لا على زر التنفيذ)، إعادة التركيز إلى العنصر الذي فتح الحوار،
 * واحتواء Tab وShift+Tab داخل الحوار. Escape والنقر على الخلفية وزر الإغلاق يُغلقها `Dialog` كما هو
 * فتعني كلها «تراجع». لا يُرسَل أي طلب إلا بالنقر على زر التأكيد.
 */
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  /** تراجع: يُستدعى من Escape والخلفية وزر الإغلاق وزر «تراجع». لا ينفّذ شيئاً. */
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  /** نص يصف ما سيحدث بالضبط. */
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  confirmVariant?: 'primary' | 'danger';
  /** أيقونة تسبق نص زر التأكيد الخطر كي لا يعتمد التمييز على اللون وحده. */
  confirmIcon?: React.ReactNode;
  busy?: boolean;
  confirmDisabled?: boolean;
  /** العنصر الذي يعود إليه التركيز عند الإغلاق؛ الافتراضي العنصر المركَّز لحظة الفتح. */
  returnFocusTo?: HTMLElement | null;
  /** حقول إضافية (تاريخ، سبب…) تُعرض بين الوصف والأزرار. */
  children?: React.ReactNode;
}

export function ConfirmDialog({ open, onCancel, ...rest }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      // أثناء التنفيذ لا يُغلَق الحوار من Escape أو الخلفية فلا يُترك طلبٌ معلّق بلا نتيجة ظاهرة.
      onClose={() => !rest.busy && onCancel()}
      title={rest.title}
      closeLabel={rest.closeLabel}
    >
      <ConfirmBody onCancel={onCancel} {...rest} />
    </Dialog>
  );
}

function ConfirmBody({
  onCancel,
  onConfirm,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'primary',
  confirmIcon,
  busy,
  confirmDisabled,
  returnFocusTo,
  children,
}: Omit<ConfirmDialogProps, 'open' | 'title' | 'closeLabel'>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLElement>(null);
  // يُلتقط أثناء أول رسم، أي قبل أن ينقل الحوار التركيز.
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);

  useEffect(() => {
    cancelRef.current?.focus();
    const target = returnFocusTo ?? opener.current;
    return () => {
      const element = target instanceof HTMLElement && target.isConnected ? target : document.getElementById('platform-content');
      element?.focus();
    };
    // الالتقاط والتنظيف مرة واحدة لكل فتح.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
      const dialog = rootRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!dialog.contains(active) || (event.shiftKey && active === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={rootRef} className="space-y-4">
      <p className="text-sm leading-relaxed text-text">{description}</p>
      {children}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button ref={cancelRef} variant="outline" className="h-11" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} className="h-11" onClick={onConfirm} disabled={busy || confirmDisabled}>
          {confirmIcon}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
