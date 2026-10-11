// CUST-HV V7c-2 — proof entry: mounts the PRODUCTION `HeaderOverlay` (and, for the on-scroll-up scenario, the production
// `HeaderScrollUp`) inside the rendered header, standing in for hydration. Options arrive as `window.__PROOF`.
import { createRoot } from "react-dom/client";
import { HeaderOverlay } from "@/components/layout/HeaderOverlay";
import { HeaderScrollUp } from "@/components/layout/HeaderScrollUp";

declare global {
  interface Window {
    __PROOF?: { sticky: boolean; up: boolean };
  }
}

const header = document.querySelector("header");
if (header) {
  const host = document.createElement("div");
  header.appendChild(host);
  const options = window.__PROOF ?? { sticky: true, up: false };
  createRoot(host).render(
    <>
      <HeaderOverlay sticky={options.sticky} />
      {options.up ? <HeaderScrollUp /> : null}
    </>,
  );
}
