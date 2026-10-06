import type { Page } from '@playwright/test';

export type AuditFinding = { kind: string; detail: string };

/**
 * FLOWERS-H2-14 — تدقيق وصول/بنية خفيف داخل المتصفح (لا اعتماد على حزمة خارجية). يفحص العناصر **المرئية** فقط:
 * تسمية كل حقل وزر ورابط وتبويب ومفتاح، اسم كل حوار، صحة مراجع aria، تكرار المعرّفات، قفزات ترتيب العناوين،
 * وحدّاً أدنى لهدف اللمس (24×24 بكسل — WCAG 2.2 AA، 2.5.8). ليس بديلاً عن مراجعة بشرية بل حارس انحدار.
 */
export async function auditPage(page: Page): Promise<AuditFinding[]> {
  return page.evaluate(() => {
    const findings: { kind: string; detail: string }[] = [];
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      // داخل حاوية مخفية (hidden / aria-hidden) أو خارج الشاشة بلا عرض.
      return !el.closest('[hidden],[aria-hidden="true"],nextjs-portal');
    };
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const joined = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim();
        if (joined) return joined;
      }
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label && text(label)) return text(label);
      }
      const wrap = el.closest('label');
      if (wrap && text(wrap)) return text(wrap);
      if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) return (el as HTMLInputElement).value;
      const own = text(el);
      if (own) return own;
      const img = el.querySelector('img[alt]');
      if (img && img.getAttribute('alt')) return img.getAttribute('alt') as string;
      return el.getAttribute('title')?.trim() ?? '';
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')}`;

    const controls = document.querySelectorAll('input:not([type=hidden]), select, textarea, button, a[href], [role=tab], [role=switch], [role=combobox], [role=checkbox], [role=radio]');
    controls.forEach((el) => {
      if (!visible(el)) return;
      if (!nameOf(el)) findings.push({ kind: 'unnamed-control', detail: describe(el) });
    });

    document.querySelectorAll('[role=dialog],[role=alertdialog]').forEach((el) => {
      if (visible(el) && !nameOf(el)) findings.push({ kind: 'unnamed-dialog', detail: describe(el) });
    });

    document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]').forEach((el) => {
      for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        // تبويبٌ غير محدّد تُركَّب لوحته عند الاختيار فقط (النمط المشترك في `Tabs`): مرجعه المفقود مقبول.
        if (attr === 'aria-controls' && el.getAttribute('role') === 'tab' && el.getAttribute('aria-selected') !== 'true') continue;
        for (const id of value.split(/\s+/)) {
          if (id && !document.getElementById(id)) findings.push({ kind: 'dangling-aria-ref', detail: `${describe(el)} ${attr}="${id}"` });
        }
      }
    });

    const seen = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) ?? 0) + 1));
    seen.forEach((count, id) => {
      if (count > 1) findings.push({ kind: 'duplicate-id', detail: `${id} ×${count}` });
    });

    let previous = 0;
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el) => {
      if (!visible(el)) return;
      const level = Number(el.tagName[1]);
      if (previous !== 0 && level > previous + 1) findings.push({ kind: 'heading-jump', detail: `h${previous} → h${level} "${text(el).slice(0, 40)}"` });
      previous = level;
    });

    document.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=tab], [role=switch]').forEach((el) => {
      if (!visible(el)) return;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) findings.push({ kind: 'small-target', detail: `${describe(el)} ${Math.round(rect.width)}×${Math.round(rect.height)}` });
    });

    return findings;
  });
}
