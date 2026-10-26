'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';

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
  loginHref: string;
  loginLabel: string;
  registerHref: string;
  registerLabel: string;
}

/** شريط علوي بحافتين: الشعار عند البداية والأدوات عند النهاية، وقائمة منسدلة تحت 60rem. */
export function LandingNav({ brand, tools, links, brandLabel, navLabel, menuLabel, loginHref, loginLabel, registerHref, registerLabel }: LandingNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <header ref={rootRef} className="lp-nav">
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
          {tools}
          <Link href={loginHref} className="lp-nav__login lp-link">
            {loginLabel}
          </Link>
          <Link href={registerHref} className="lp-nav__register">
            {registerLabel}
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className="lp-nav__menu-btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {menuLabel}
          </button>
        </div>
      </div>
      {open && (
        <div id={panelId} className="lp-nav__panel">
          <div className="lp-container">
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            ))}
            <Link href={registerHref} onClick={() => setOpen(false)}>
              {registerLabel}
            </Link>
            <Link href={loginHref} onClick={() => setOpen(false)}>
              {loginLabel}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
