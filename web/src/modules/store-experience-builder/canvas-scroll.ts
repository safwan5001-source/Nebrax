/**
 * CUST-HV V7c — the Canvas's scroll source for the header simulators (`HeaderScrollUpPreview`, `HeaderOverlayPreview`).
 *
 * The preview may live inside any scroller (the editor's preview pane) or just the page (the dev fixture): rather than guess
 * the scroll host from computed styles — an `overflow: auto` ancestor is not necessarily the one that scrolls — listen for
 * scrolls in the capture phase on the document and read the position of whichever scroller actually moved, ignoring any
 * scroller that does not contain the header (a sidebar, a dialog).
 */
export function watchScroll(
  header: HTMLElement,
  onChange: (y: number) => void,
): () => void {
  const handler = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLElement || target instanceof SVGElement) {
      const el = target as HTMLElement;
      if (!el.contains(header)) return;
      onChange(el.scrollTop);
      return;
    }
    onChange(window.scrollY);
  };
  document.addEventListener("scroll", handler, { capture: true, passive: true });
  return () => document.removeEventListener("scroll", handler, { capture: true });
}
