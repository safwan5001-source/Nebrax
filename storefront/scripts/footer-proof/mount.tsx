// CUST-HV V7e-2 — proof entry: the statically rendered footer carries placeholders where the production client component
// `FooterGroupDisclosure` sits; this mounts the REAL component over them (children rebuilt from the rendered list items), so the
// browser proof drives the real narrow-viewport disclosure against the real stylesheet.
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FooterGroupDisclosure } from "@/components/layout/FooterGroupDisclosure";

const RENAME: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  viewbox: "viewBox",
};

function toReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const props: Record<string, unknown> = { key };
  for (const attr of Array.from(node.attributes)) {
    if (attr.name === "style") continue;
    props[RENAME[attr.name] ?? attr.name] = attr.value;
  }
  return createElement(
    node.tagName.toLowerCase(),
    props,
    ...Array.from(node.childNodes).map((child, i) => toReact(child, i)),
  );
}

for (const nav of Array.from(
  document.querySelectorAll<HTMLElement>("nav[data-fgd]"),
)) {
  const heading = nav.querySelector("h2") as HTMLElement;
  const list = nav.querySelector("ul") as HTMLElement;
  const host = document.createElement("div");
  host.style.display = "contents";
  nav.replaceWith(host);
  createRoot(host).render(
    <FooterGroupDisclosure
      id={heading.id}
      title={heading.textContent ?? ""}
      collapsible={nav.dataset.collapsible === "true"}
      headingClassName={heading.className}
      listClassName={list.className}
    >
      {Array.from(list.childNodes).map((child, i) => toReact(child, i))}
    </FooterGroupDisclosure>,
  );
}
