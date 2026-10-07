import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGlobalTokens } from "../global-tokens";

/**
 * CUST-HV V5e-2a/b — every `--gt-*` variable and `data-gt` token the resolver can emit must be
 * consumed by the stylesheet (and the Canvas twin): a token with no rule is a control that does
 * nothing, and a rule with no token is dead CSS.
 */
const css = readFileSync(
  resolve(__dirname, "../../../app/globals.css"),
  "utf8",
);
const preview = readFileSync(
  resolve(
    __dirname,
    "../../../../../web/src/modules/store-experience-builder/store-preview.css",
  ),
  "utf8",
);

const EVERYTHING = resolveGlobalTokens(
  {
    typography: {
      headingScale: "lg",
      bodyScale: "lg",
      headingWeight: 800,
      bodyWeight: 500,
      lineHeight: "relaxed",
      sectionHeading: "underline",
      headingFamily: "amiri-lora",
      bodyFamily: "readex",
      buttonText: { weight: 800, case: "upper" },
    },
    buttons: {
      style: "outline",
      size: "lg",
      radius: "pill",
      colour: "accent",
      hover: "lift",
    },
    surfaces: { radius: "pill", border: { width: "medium" }, shadow: "medium" },
    layout: { contentWidth: "narrow" },
    motion: { duration: "slow", easing: "emphasized" },
  },
  { primaryColor: "#12372a", accentColor: "#0b5fff" },
)!;

// the style variants only one branch of the resolver can emit
const LINK = resolveGlobalTokens(
  {
    buttons: { style: "link", hover: "underline" },
    typography: { sectionHeading: "centered" },
  },
  { primaryColor: "#12372a", accentColor: null },
)!;

describe("global token ↔ stylesheet coverage", () => {
  const tokens = new Set(
    [EVERYTHING, LINK].flatMap((r) => (r.attrs["data-gt"] ?? "").split(" ")),
  );
  const vars = new Set([EVERYTHING, LINK].flatMap((r) => Object.keys(r.style)));
  // platform variables the existing theme already consumes (not `--gt-*`)
  const PLATFORM = new Set([
    "--store-radius",
    "--radius",
    "--store-content-max",
  ]);

  for (const stylesheet of [
    ["storefront globals.css", css],
    ["Canvas store-preview.css", preview],
  ] as const) {
    it(`${stylesheet[0]} has a rule for every emitted token`, () => {
      for (const token of tokens) {
        expect(stylesheet[1], `token ${token}`).toContain(
          `[data-gt~="${token}"]`,
        );
      }
    });
    it(`${stylesheet[0]} reads every emitted --gt variable`, () => {
      for (const name of vars) {
        if (PLATFORM.has(name)) continue;
        expect(stylesheet[1], `variable ${name}`).toContain(`var(${name})`);
      }
    });
  }

  it("the emitted values contain no CSS from the document", () => {
    for (const result of [EVERYTHING, LINK]) {
      for (const value of Object.values(result.style)) {
        expect(value).not.toMatch(/url\(|[{};<>]|javascript|expression/i);
      }
    }
  });
});
