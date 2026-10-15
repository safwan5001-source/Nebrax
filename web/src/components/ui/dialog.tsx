'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCommonLabel } from '@/lib/ui-label';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  /** تسمية زر الإغلاق؛ الافتراضي من `common.close` بلغة الواجهة الحالية. */
  closeLabel?: string;
  /**
   * يُخفي زرّ الإغلاق العلوي. للحوار الذي لا يجوز إغلاقه الآن (طلب جارٍ، أو سرّ لم يُؤكَّد حفظه): زرٌّ ظاهر لا يفعل شيئاً
   * يوهم المستخدم بعطل. Escape والخلفية يبقيان على `onClose` ليقرّر المستدعي. الافتراضي `false` = السلوك القائم حرفياً.
   */
  hideClose?: boolean;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0
  );
}

/**
 * آخر مفتاح بدأ توزيعه (طور الالتقاط يسبق كل مستمعي الفقاعة). يُسجَّل على مستوى الوحدة لأن أول حوار يُركَّب أثناء
 * المفتاح نفسه لا يستطيع التقاطه بعد فوات الأوان. كائن الحدث فريد لكل ضغطة، فمطابقته لاحقاً لا تصيب إلا الضغطة ذاتها.
 */
let keydownInFlight: KeyboardEvent | undefined;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => { keydownInFlight = event; }, true);
}

/**
 * الحوارات المفتوحة بترتيب فتحها. الأعلى وحده يستجيب لـEscape ويحبس Tab،
 * فلا يُغلق حوارٌ أبٌ مع ابنه ولا يتنازعان التركيز (ERP-UX-001).
 */
const openStack: HTMLElement[] = [];

/** الأعلى: آخر حوار مفتوح لا يحتوي حواراً مفتوحاً آخر (الحوار المتداخل في DOM أعلى من أبيه دائماً). */
function topDialog(): HTMLElement | undefined {
  const leaves = openStack.filter((panel) => !openStack.some((other) => other !== panel && panel.contains(other)));
  return leaves[leaves.length - 1];
}

/**
 * حوار نمطي وفق نمط WAI-ARIA APG: ينقل التركيز إلى داخله عند الفتح، ويحبس
 * Tab/Shift+Tab داخله، ويُغلق بـEscape، ويعيد التركيز إلى العنصر الذي فتحه،
 * ويمنع تمرير الصفحة خلفه. السلوك وحده تغيّر — لا خاصيات جديدة ولا تغيير في
 * أي استدعاء قائم.
 */
export function Dialog({ open, onClose, title, children, className, closeLabel, hideClose = false }: DialogProps) {
  const defaultCloseLabel = useCommonLabel('close', { ar: 'إغلاق', en: 'Close' });
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // المستدعون يمرّرون onClose كدالة سطرية؛ المرجع يمنع إعادة تشغيل منطق الفتح
  // (ومعه إعادة نقل التركيز) مع كل إعادة رسم.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openStack.push(panel);

    // التركيز الأولي: احترام عنصر داخل الحوار أخذ التركيز بنفسه (autoFocus)،
    // وإلا أول عنصر تفاعلي في المحتوى، وإلا زر الإغلاق، وإلا الحاوية نفسها.
    // على اللمس يُركَّز الحوار نفسه لا أول حقل، كي لا تفتح لوحة المفاتيح الافتراضية
    // فتغطي الحوار قبل أن يقرأه المستخدم (APG يجيز التركيز على عنصر ثابت).
    if (!panel.contains(document.activeElement)) {
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const first = coarse ? undefined : (bodyRef.current && focusableIn(bodyRef.current)[0]) ?? focusableIn(panel)[0];
      (first ?? panel).focus({ preventScroll: true });
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // مفتاحٌ فتح هذا الحوار نفسه (Escape على حوارٍ أبٍ يطلب تأكيداً): المتصفح يُفرّغ تحديث React وتأثيراته قبل المستمع
    // التالي من الحدث ذاته، فيُسجَّل مستمعنا والحدث لا يزال في طريقه ويصله في طور الفقاعة. من غير هذا الحارس يعدّه
    // الحوار الجديد Escape موجّهاً إليه ويُغلق نفسه في اللحظة ذاتها (D-W-4). ما بعده من الأحداث كائناتٌ أخرى فلا يتأثر.
    const openingEvent = keydownInFlight;

    const onKey = (event: KeyboardEvent) => {
      if (event === openingEvent) return;
      if (topDialog() !== panel) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const index = openStack.lastIndexOf(panel);
      if (index !== -1) openStack.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      // إعادة التركيز لمن فتح الحوار ما دام موجوداً في الصفحة.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative z-10 my-8 flex max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-lg flex-col overflow-hidden rounded border border-border bg-surface outline-none sm:max-h-[calc(100dvh-4rem)]',
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-text">{title}</h2>
          {hideClose ? null : (
            <button type="button" onClick={onClose} className="-m-1 shrink-0 rounded p-1 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={closeLabel ?? defaultCloseLabel}>
              <X className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}
        </div>
        <div ref={bodyRef} className="min-w-0 overflow-y-auto overflow-x-hidden p-4 [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-all">{children}</div>
      </div>
    </div>
  );
}
