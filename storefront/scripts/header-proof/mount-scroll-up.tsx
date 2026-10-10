// CUST-HV V7c-1 — proof entry: mounts the PRODUCTION `HeaderScrollUp` inside the rendered header (the static pages carry no
// hydration), so the browser proof drives the real controller against the real stylesheet.
import { createRoot } from "react-dom/client";
import { HeaderScrollUp } from "@/components/layout/HeaderScrollUp";

const header = document.querySelector("header");
if (header) {
  const host = document.createElement("div");
  header.appendChild(host);
  createRoot(host).render(<HeaderScrollUp />);
}
