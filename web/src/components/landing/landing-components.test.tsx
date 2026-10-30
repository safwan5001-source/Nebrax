// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandShowcase, type BrandShowcaseCopy } from './brand-showcase';
import { LandingMotion } from './landing-motion';
import { LandingNav } from './landing-nav';
import { PosAuditSignals } from './pos-audit-signals';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let reduceMotion = false;

beforeEach(() => {
  reduceMotion = false;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduceMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  document.documentElement.dir = 'rtl';
});

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = '';
});

function renderNav() {
  return render(
    <LandingNav
      brand={<span>AWJ</span>}
      tools={<button type="button">EN</button>}
      links={[
        { href: '#features', label: 'المميزات' },
        { href: '#solutions', label: 'الحلول' },
        { href: '#commerce', label: 'التجارة الإلكترونية' },
        { href: '#why', label: 'لماذا أَوْج؟' },
      ]}
      brandLabel="home"
      navLabel="sections"
      menuLabel="القائمة"
      closeLabel="إغلاق القائمة"
      loginHref="/login"
      loginLabel="تسجيل الدخول"
      registerHref="/register"
      registerLabel="ابدأ الآن"
    />
  );
}

describe('LandingNav', () => {
  it('keeps the real login and signup destinations', () => {
    renderNav();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/register');
    expect(hrefs).toContain('/login');
    expect(hrefs).toEqual(expect.arrayContaining(['#features', '#solutions', '#commerce', '#why']));
  });

  it('opens the mobile panel, locks page scroll, and closes on Escape with focus back on the button', () => {
    renderNav();
    const button = screen.getByRole('button', { name: 'القائمة' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(true);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('إغلاق القائمة');
    expect(panel.hidden).toBe(false);
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement?.getAttribute('href')).toBe('#features');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel.hidden).toBe(true);
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(button);
  });

  it('closes the panel when a section link is followed', () => {
    renderNav();
    const button = screen.getByRole('button', { name: 'القائمة' });
    fireEvent.click(button);
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    fireEvent.click(panel.querySelector('a[href="#commerce"]')!);
    expect(panel.hidden).toBe(true);
  });
});

describe('PosAuditSignals', () => {
  const groups = [
    { id: 'discounts', label: 'الخصومات', description: 'd1', rules: ['معدّل نشاط الخصومات'] },
    { id: 'returns', label: 'المرتجعات', description: 'd2', rules: ['مرتجع من كاشير مختلف'] },
    { id: 'drawer', label: 'الدرج', description: 'd3', rules: ['مقدار فروقات الإغلاق'] },
  ];

  it('shows the first group without interaction and moves with RTL arrow keys', () => {
    render(<PosAuditSignals groups={groups} tablistLabel="groups" rulesLabel="rules" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('معدّل نشاط الخصومات')).toBeTruthy();

    // In RTL the next tab sits to the left.
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    expect(screen.getByRole('tabpanel').textContent).toContain('مرتجع من كاشير مختلف');

    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[2], { key: 'ArrowLeft' });
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });
});

describe('BrandShowcase', () => {
  const copy: BrandShowcaseCopy = {
    swatchLabel: 'جرّب لون علامتك',
    swatches: [
      { id: 'blue', label: 'أزرق' },
      { id: 'emerald', label: 'زمردي' },
      { id: 'plum', label: 'عنابي' },
      { id: 'amber', label: 'كهرماني' },
    ],
    storeAria: 'store',
    appAria: 'app',
    storeName: 'متجر الورد',
    storeSearch: 'search',
    heroTitle: 'hero',
    heroCta: 'cta',
    benefits: ['a', 'b', 'c'],
    featured: 'featured',
    products: ['p1', 'p2', 'p3'],
    add: 'add',
    greeting: 'hi',
    tabs: ['t1', 't2', 't3', 't4'],
  };

  it('re-themes the store and the app together from one accessible radio group', () => {
    const { container } = render(<BrandShowcase copy={copy} />);
    const root = container.querySelector<HTMLElement>('.lp-brandshow')!;
    expect(root.style.getPropertyValue('--mk-store')).toBe('var(--mk-swatch-blue)');
    expect(screen.getByRole('group', { name: 'جرّب لون علامتك' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'زمردي' }));
    expect(root.style.getPropertyValue('--mk-store')).toBe('var(--mk-swatch-emerald)');
    expect((screen.getByRole('radio', { name: 'زمردي' }) as HTMLInputElement).checked).toBe(true);
    // Both mock-ups are labelled illustrations, not fake interactive UI.
    expect(screen.getByRole('img', { name: 'store' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'app' })).toBeTruthy();
  });
});

describe('LandingMotion', () => {
  class Observer {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  beforeEach(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  });

  function mount() {
    const host = document.createElement('div');
    host.className = 'lp';
    host.innerHTML = '<section data-reveal></section><div data-loop></div>';
    document.body.append(host);
    const view = render(<LandingMotion />);
    return { host, view };
  }

  it('hides nothing until JavaScript confirms motion is welcome', () => {
    const { host, view } = mount();
    expect(host.classList.contains('lp-motion')).toBe(true);
    view.unmount();
    expect(host.classList.contains('lp-motion')).toBe(false);
    host.remove();
  });

  it('never arms reveals under prefers-reduced-motion', () => {
    reduceMotion = true;
    const { host, view } = mount();
    act(() => undefined);
    expect(host.classList.contains('lp-motion')).toBe(false);
    view.unmount();
    host.remove();
  });
});

describe('landing page routes and assets', () => {
  const page = readFileSync(resolve(__dirname, '../../app/page.tsx'), 'utf8');
  const shot = readFileSync(resolve(__dirname, './landing-shot.tsx'), 'utf8');

  it('keeps every CTA on the existing auth routes', () => {
    const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    const routes = hrefs.filter((href) => href.startsWith('/'));
    expect(new Set(routes)).toEqual(new Set(['/', '/register', '/login']));
    const anchors = hrefs.filter((href) => href.startsWith('#'));
    for (const anchor of anchors) expect(page, anchor).toContain(`id="${anchor.slice(1)}"`);
  });

  it('ships every screenshot it declares in all four theme × language variants', () => {
    const names = [...shot.matchAll(/^\s+'([a-z-]+)': [[{]/gm)].map((match) => match[1]);
    expect(names).toContain('app-pos-audit');
    for (const name of names) {
      for (const theme of ['light', 'dark']) {
        for (const locale of ['ar', 'en']) {
          expect(() => readFileSync(resolve(__dirname, `../../../public/landing/${name}-${theme}-${locale}.webp`)), `${name}-${theme}-${locale}`).not.toThrow();
        }
      }
    }
  });
});
