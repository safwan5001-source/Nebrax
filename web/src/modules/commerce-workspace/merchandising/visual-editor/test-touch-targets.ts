/**
 * Test helper: a class-based check that every interactive element is a ≥ 44 px touch target (jsdom has no layout, so the
 * Tailwind classes are the evidence). It also rejects any breakpoint-prefixed class (`md:`, `sm:`, `max-md:`…) that
 * shrinks height / size below 44 px, which is how a target quietly drops to 36 px on desktop.
 *
 * A target passes when one of these holds:
 * - its own classes set `min-h-` / `h-` / `size-` to ≥ 44 px;
 * - an ancestor carries an arbitrary variant such as `[&_button]:min-h-11` whose selector matches it (it also outranks
 *   the element's own classes, so it cancels a shared `md:min-h-8`);
 * - it is labelled by a `<label>` that passes (a switch or checkbox whose label row is the clickable area).
 */

const MIN_PX = 44;

/** A Tailwind size value in px: spacing units (×4), `[44px]`, `[2.75rem]`. `null` = not a size (`auto`, `full`…). */
function sizePx(value: string): number | null {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 4;
  const px = value.match(/^\[(\d+(?:\.\d+)?)px\]$/);
  if (px) return Number(px[1]);
  const rem = value.match(/^\[(\d+(?:\.\d+)?)rem\]$/);
  if (rem) return Number(rem[1]) * 16;
  return null;
}

const SIZE_TOKEN = /^(min-h|h|size)-(.+)$/;

function tokensOf(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** Heights set by the element's own, unprefixed classes. */
function ownBigEnough(tokens: string[]): boolean {
  return tokens.some((token) => {
    const m = token.match(SIZE_TOKEN);
    const px = m ? sizePx(m[2]) : null;
    return px !== null && px >= MIN_PX;
  });
}

/** Any prefixed height / size class (`md:min-h-8`, `max-md:size-9`) below 44 px. */
export function shrinkingClasses(el: Element): string[] {
  return tokensOf(el).filter((token) => {
    const parts = token.split(':');
    if (parts.length < 2 || token.startsWith('[')) return false;
    const m = parts[parts.length - 1].match(SIZE_TOKEN);
    const px = m ? sizePx(m[2]) : null;
    return px !== null && px < MIN_PX;
  });
}

function ancestorGrants(el: Element): boolean {
  for (let a = el.parentElement; a; a = a.parentElement) {
    for (const token of tokensOf(a)) {
      const m = token.match(/^\[(&.+)\]:(?:min-h|h|size)-(.+)$/);
      if (!m) continue;
      const px = sizePx(m[2]);
      if (px === null || px < MIN_PX) continue;
      const selector = m[1].replace(/^&/, ':scope').replace(/_/g, ' ');
      try {
        if (Array.from(a.querySelectorAll(selector)).includes(el)) return true;
      } catch {
        // an arbitrary variant that is not a plain selector grants nothing
      }
    }
  }
  return false;
}

export function isBigEnough(el: Element): boolean {
  if (ownBigEnough(tokensOf(el)) || ancestorGrants(el)) return true;
  const labels = (el as HTMLInputElement).labels;
  return labels ? Array.from(labels).some((label) => isBigEnough(label)) : false;
}

const INTERACTIVE = 'button, input:not([type=hidden]), select, textarea, [role="switch"], a[href]';

/** Interactive elements under `root` that are not a ≥ 44 px target, or that shrink at a breakpoint. */
export function touchTargetViolations(root: ParentNode, options: { skip?: string } = {}): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE))) {
    if (options.skip && el.matches(options.skip)) continue;
    // the tab strip is a shared component whose tabs are 46 px tall by padding (`py-3` + a 20 px line + 2 px border)
    if (el.getAttribute('role') === 'tab') continue;
    const name = `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? ''}]`;
    // An ancestor's arbitrary variant (`.wrap button`, specificity 0,1,1) beats any single-class utility, prefixed or
    // not, so a grant from it settles the question even when the element still carries a shared `md:min-h-8`.
    const shrinking = ancestorGrants(el) ? [] : shrinkingClasses(el);
    if (shrinking.length > 0) out.push(`${name} shrinks: ${shrinking.join(' ')}`);
    else if (!isBigEnough(el)) out.push(`${name} is not a 44px target`);
  }
  return out;
}
