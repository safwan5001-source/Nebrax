'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * قائمة منسدلة قابلة لإعادة الاستخدام — بنفس مبدأ الشريط الجانبي: **واحدة مفتوحة فقط**.
 * سجلّ عام (module-level) يضمن أن فتح أي قائمة يُغلق سواها فوراً في كل التطبيق.
 * تُغلق أيضاً بالنقر خارجها أو بمفتاح Escape، وتنفتح/تنغلق بانتقال خفيف لا مفاجئ.
 */
const closers = new Set<() => void>();

const DropdownCtx = createContext<{ open: boolean; close: () => void }>({ open: false, close: () => {} });

export function Dropdown({
  trigger,
  children,
  align = 'end',
  menuLabel,
  triggerLabel,
  triggerClassName,
  menuClassName,
  mobilePopover = false,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end';
  menuLabel?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  menuClassName?: string;
  /** قائمة الجوال تُثبت تحت زرها وتُقاس داخل النافذة بدل أن تتحول إلى ورقة سفلية. */
  mobilePopover?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mobilePopoverPosition, setMobilePopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // تسجيل مُغلِق هذه القائمة في السجلّ العام (لتحقيق الفتح الحصري).
  useEffect(() => {
    closers.add(close);
    return () => {
      closers.delete(close);
    };
  }, [close]);

  // إغلاق بالنقر خارجها + بمفتاح Escape (يعملان فقط أثناء الفتح).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !mobilePopover) return;
    const placeWithinViewport = () => {
      const anchor = rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const safeMargin = 12;
      const anchorBox = anchor.getBoundingClientRect();
      const preferredTop = anchorBox.bottom + 4;
      const maximumTop = window.innerHeight - menu.offsetHeight - safeMargin;
      const preferredLeft = anchorBox.right - menu.offsetWidth;
      const maximumLeft = window.innerWidth - menu.offsetWidth - safeMargin;
      setMobilePopoverPosition({
        top: Math.max(safeMargin, Math.min(preferredTop, maximumTop)),
        left: Math.max(safeMargin, Math.min(preferredLeft, maximumLeft)),
      });
    };
    placeWithinViewport();
    window.addEventListener('resize', placeWithinViewport);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', placeWithinViewport);
      window.removeEventListener('scroll', close, true);
    };
  }, [close, mobilePopover, open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setMobilePopoverPosition(null);
    // فتح حصري: أغلق كل القوائم الأخرى ثم افتح هذه.
    closers.forEach((c) => {
      if (c !== close) c();
    });
    setOpen(true);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          triggerClassName
        )}
      >
        {trigger}
      </button>

      {/* القائمة تبقى في DOM لانتقال ناعم؛ تُخفى من التفاعل/الوصول عند الإغلاق. */}
      <div
        ref={menuRef}
        role="menu"
        aria-label={menuLabel}
        aria-hidden={!open}
        style={mobilePopover ? (mobilePopoverPosition ?? { top: 12, left: 12 }) : undefined}
        className={cn(
          mobilePopover
            ? 'fixed z-50 w-[min(18rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded border border-border bg-surface p-1 shadow-lg lg:absolute lg:w-auto lg:!left-auto lg:!top-auto lg:mt-1 lg:max-h-none lg:min-w-36 lg:shadow-md'
            : 'absolute top-full z-50 mt-1 min-w-36 rounded border border-border bg-surface p-1 shadow-md',
          'transition duration-150 ease-out',
          mobilePopover
            ? (align === 'end' ? 'lg:end-0' : 'lg:start-0')
            : (align === 'end' ? 'end-0' : 'start-0'),
          open ? 'opacity-100 translate-y-0' : 'pointer-events-none translate-y-1 opacity-0',
          menuClassName
        )}
      >
        <DropdownCtx.Provider value={{ open, close }}>{children}</DropdownCtx.Provider>
      </div>
    </div>
  );
}

export function DropdownItem({
  children,
  icon: Icon,
  href,
  onClick,
  tone = 'default',
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** سببُ التعطيل خاصةً — عنصرٌ معطَّل بلا تفسير يبدو عطلاً لا قاعدة عمل. */
  title?: string;
}) {
  const { open, close } = useContext(DropdownCtx);
  const tabIndex = open ? 0 : -1; // خارج ترتيب التنقّل عند الإغلاق
  const className = cn(
    'flex min-h-11 w-full items-center gap-2 rounded px-2.5 py-1.5 text-sm',
    tone === 'danger'
      ? 'text-negative hover:bg-negative/10'
      : 'text-text hover:bg-primary-soft hover:text-primary',
    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-inherit'
  );
  const inner = (
    <>
      {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />}
      <span className="truncate">{children}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} role="menuitem" tabIndex={tabIndex} onClick={close} className={className} title={title}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={tabIndex}
              disabled={disabled}
        title={title}
        onClick={() => {
          if (disabled) return;
          onClick?.();
          close();
        }}
        className={className}

    >
      {inner}
    </button>
  );
}
