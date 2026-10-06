'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { flowersAdminT } from './messages';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isVisible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/**
 * FLOWERS-H2-14 — حوار شاشات إدارة الهدايا: يضيف فوق `Dialog` المشترك ما ينقصه للوحة المفاتيح دون المساس بغيره من الوحدات:
 * (1) تركيز أول عنصر قابل للتركيز داخل المحتوى عند الفتح (ما لم يكن التركيز داخله أصلاً، مثل `autoFocus`)،
 * (2) حبس Tab/Shift+Tab داخل الحوار، (3) إعادة التركيز إلى العنصر الذي فتحه عند الإغلاق، (4) تسمية زر الإغلاق بلغة الواجهة.
 */
export function FlowersDialog({
  open = true,
  onClose,
  title,
  className,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = flowersAdminT(useLocale());

  return (
    <Dialog open={open} onClose={onClose} title={title} className={className} closeLabel={t('closeDialog')}>
      <FocusScope>{children}</FocusScope>
    </Dialog>
  );
}

function FocusScope({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // يُلتقط أثناء أول تصيير (قبل أن ينقل `autoFocus` التركيز) فيكون العنصر الذي فتح الحوار فعلاً.
  const [opener] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const scope = ref.current;
    const root = scope?.closest<HTMLElement>('[role="dialog"]') ?? scope;
    if (!scope || !root) return;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);

    if (!root.contains(document.activeElement) || document.activeElement === root) {
      (Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isVisible) ?? focusables()[0])?.focus();
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);

    return () => {
      root.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  return <div ref={ref}>{children}</div>;
}
