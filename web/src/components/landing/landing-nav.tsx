'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

interface NavLink {
  href: string;
  label: string;
}

interface LandingNavProps {
  brand: ReactNode;
  /** أزرار اللغة والسمة (مكوّنات عميل جاهزة) تُمرَّر من الخادم. */
  tools: ReactNode;
  links: NavLink[];
  brandLabel: string;
  navLabel: string;
  menuLabel: string;
  closeLabel: string;
  loginHref: string;
  loginLabel: string;
  registerHref: string;
  registerLabel: string;
}

/**
 * شريط علوي شفاف فوق الواجهة الداكنة، يتحوّل إلى زجاج معتم بعد أول تمرير.
 * تحت 60rem تصير الروابط لوحة منسدلة: Escape أو النقر خارجها يغلقها ويعيد التركيز إلى الزر،
 * ويُقفل تمرير الصفحة ما دامت مفتوحة.
 */
export function LandingNav({
  brand,
  tools,
  links,
  brandLabel,
  navLabel,
  menuLabel,
  closeLabel,
  loginHref,
  loginLabel,
  registerHref,
  registerLabel,
}: LandingNavProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 8);
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('a')?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    // اللوحة تختفي فوق 60rem؛ إن كُبّرت النافذة وهي مفتوحة تُغلق فلا يبقى التمرير مقفلاً.
    const wide = window.matchMedia('(min-width: 60.0625rem)');
    function onWide() {
      if (wide.matches) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    wide.addEventListener('change', onWide);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header ref={rootRef} className="lp-nav" data-scrolled={scrolled || open ? '' : undefined} data-open={open ? '' : undefined}>
      <div className="lp-container lp-nav__bar">
        <Link href="/" className="lp-nav__brand" aria-label={brandLabel}>
          {brand}
        </Link>
        <nav className="lp-nav__links" aria-label={navLabel}>
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="lp-nav__tools">
          <div className="lp-nav__toggles">{tools}</div>
          <Link href={loginHref} className="lp-nav__login">
            {loginLabel}
          </Link>
          <Link href={registerHref} className="lp-btn lp-btn--sm lp-nav__register">
            {registerLabel}
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className="lp-nav__menu-btn"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? closeLabel : menuLabel}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden="true" size={20} strokeWidth={1.8} /> : <Menu aria-hidden="true" size={20} strokeWidth={1.8} />}
          </button>
        </div>
      </div>
      <div ref={panelRef} id={panelId} className="lp-nav__panel" hidden={!open}>
        <div className="lp-container">
          <nav aria-label={navLabel} className="lp-nav__panel-links">
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={close}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="lp-nav__panel-cta">
            <Link href={registerHref} className="lp-btn" onClick={close}>
              {registerLabel}
            </Link>
            <Link href={loginHref} className="lp-btn lp-btn--ghost" onClick={close}>
              {loginLabel}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
