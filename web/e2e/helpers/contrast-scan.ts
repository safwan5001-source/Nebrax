import type { Page } from '@playwright/test';

export type ContrastFailure = { text: string; ratio: number; required: number; fg: string; bg: string; selector: string };

/**
 * In-page WCAG 1.4.3 scan. For every visible element that owns a text node it resolves the
 * effective foreground (with alpha and ancestor opacity) and the effective background (the
 * composited stack of ancestor backgrounds up to <html>), then reports pairs below 4.5:1
 * (3:1 for large text). Elements over images/gradients and disabled controls are skipped —
 * they cannot be resolved to one colour, and WCAG exempts disabled controls.
 */
export async function scanContrast(page: Page, root = 'body'): Promise<ContrastFailure[]> {
  return page.evaluate((rootSelector) => {
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top: RGBA, below: RGBA): RGBA => {
      const a = top[3] + below[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: number) => (top[i] * top[3] + below[i] * below[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    const effectiveBg = (el: Element): RGBA | null => {
      const stack: RGBA[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage !== 'none') return null; // gradient / image: unresolvable
        const bg = parse(cs.backgroundColor);
        if (bg[3] > 0) stack.push(bg);
        if (bg[3] === 1) break;
      }
      let result: RGBA = [255, 255, 255, 1];
      for (const layer of stack.reverse()) result = over(layer, result);
      return result;
    };
    const opacityOf = (el: Element) => { let o = 1; for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join('');
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };

    const failures: { text: string; ratio: number; required: number; fg: string; bg: string; selector: string }[] = [];
    const seen = new Set<string>();
    const container = document.querySelector(rootSelector) ?? document.body;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[disabled], [aria-disabled="true"], nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay], .awj-store-preview, [hidden], [aria-hidden="true"], .sr-only')) continue;
      if (opacityOf(el) < 0.1) continue; // closed menus / fade-in layers are not on screen
      const bg = effectiveBg(el);
      if (!bg) continue;
      const fgRaw = parse(cs.color);
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacityOf(el)], bg);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const r = ratio(fg, bg);
      if (r + 0.005 < required) {
        const key = `${describe(el)}|${Math.round(r * 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        failures.push({ text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, required, fg: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`, selector: describe(el) });
      }
    }
    return failures;
  }, root);
}
