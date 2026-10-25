// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Baseline,
  compare,
  isExcludedPath,
  scanProject,
  scanSource,
  serializeBaseline,
  toBaseline,
} from "../../../../scripts/spree-ratchet/scan";

const STOREFRONT_ROOT = path.resolve(__dirname, "../../../..");
const tmpDirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spree-ratchet-"));
  tmpDirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return root;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const BASE_FILES = {
  "src/lib/data/legacy.ts": `import { SpreeError } from "@spree/sdk";
import type { Product } from "@spree/sdk";
import { getClient } from "@/lib/spree";
export const x = () => getClient();
export const e = process.env.SPREE_API_URL;
export type P = Product;
export { SpreeError };
`,
};

const verdict = (root: string, baselineRoot: string) =>
  compare(toBaseline(scanProject(baselineRoot)), scanProject(root));

describe("scanSource — detection", () => {
  it("counts runtime imports, per specifier", () => {
    const c = scanSource(
      `import { A, B } from "@spree/sdk";\nimport def from "@spree/x";\nimport * as ns from "@spree/y";\nimport "@spree/z";`,
      "src/a.ts",
    );
    expect(c.spree_value_imports).toBe(5);
    expect(c.spree_type_imports).toBeUndefined();
  });

  it("counts type-only imports in every syntax", () => {
    const c = scanSource(
      `import type { A } from "@spree/sdk";\nimport { type B, type C } from "@spree/sdk";\nexport type { D } from "@spree/sdk";\ntype E = import("@spree/sdk").Product;`,
      "src/a.ts",
    );
    expect(c.spree_type_imports).toBe(5);
    expect(c.spree_value_imports).toBeUndefined();
  });

  it("splits mixed imports between value and type", () => {
    const c = scanSource(`import { type A, B } from "@spree/sdk";`, "src/a.ts");
    expect(c).toMatchObject({ spree_type_imports: 1, spree_value_imports: 1 });
  });

  it("counts dynamic import(), require() and re-exports as runtime", () => {
    const c = scanSource(
      `const m = await import("@spree/sdk");\nconst r = require("@spree/sdk");\nexport * from "@spree/sdk";`,
      "src/a.ts",
    );
    expect(c.spree_value_imports).toBe(3);
  });

  it("counts client helper calls, including renamed and destructured aliases", () => {
    const c = scanSource(
      `import { getClient as gc, getClientForSurface } from "@/lib/spree";
import * as spree from "@/lib/spree";
gc();
getClientForSurface("dtc");
spree.getWholesaleClient();
const { withAuthRefresh: war } = await import("@/lib/spree");
war(async () => 1);
const alias = getClientForSurface;
alias("dtc");`,
      "src/lib/data/a.ts",
    );
    // gc(), getClientForSurface(), spree.getWholesaleClient(), war(), `= getClientForSurface`, alias()
    expect(c.spree_client_access).toBe(6);
  });

  it("counts createClient only when it comes from the SDK", () => {
    expect(
      scanSource(
        `import { createClient } from "@spree/sdk";\ncreateClient({});`,
        "src/a.ts",
      ).spree_client_access,
    ).toBe(1);
    expect(
      scanSource(
        `import { createClient } from "other";\ncreateClient({});`,
        "src/a.ts",
      ).spree_client_access,
    ).toBeUndefined();
  });

  it("does not count the helper's own declaration", () => {
    const c = scanSource(
      `export function getClient() { return 1; }`,
      "src/lib/spree/config.ts",
    );
    expect(c.spree_client_access).toBeUndefined();
  });

  it("counts every form of SPREE_* env read", () => {
    const c = scanSource(
      `const a = process.env.SPREE_API_URL;
const b = process.env["SPREE_PUBLISHABLE_KEY"];
const { SPREE_WEBHOOK_SECRET } = process.env;
const env = process.env;
const d = env.NEXT_PUBLIC_SPREE_X;
const other = process.env.NODE_ENV;`,
      "src/a.ts",
    );
    expect(c.spree_env_reads).toBe(4);
  });

  it("counts wrapper imports by alias and relative path, but not from inside the wrapper", () => {
    expect(
      scanSource(
        `import { getAccessToken } from "@/lib/spree";`,
        "src/app/a.ts",
      ).spree_wrapper_imports,
    ).toBe(1);
    expect(
      scanSource(`import { x } from "../spree/jwt";`, "src/lib/data/a.ts")
        .spree_wrapper_imports,
    ).toBe(1);
    expect(
      scanSource(`import { x } from "./jwt";`, "src/lib/spree/index.ts")
        .spree_wrapper_imports,
    ).toBeUndefined();
  });

  it("ignores comments, strings, template text and JSX text", () => {
    const c = scanSource(
      `// import { x } from "@spree/sdk"; getClient(); process.env.SPREE_API_URL
/** import type { P } from "@spree/sdk"; getClient() */
const s = 'import { x } from "@spree/sdk"; process.env.SPREE_API_URL';
const t = \`getClient() \${1} process.env.SPREE_API_URL\`;
export const u = <p>getClient() process.env.SPREE_API_URL @spree/sdk</p>;
const key = "SPREE_API_URL";`,
      "src/a.tsx",
    );
    expect(c).toEqual({});
  });
});

describe("isExcludedPath", () => {
  it.each([
    "src/components/__tests__/a.ts",
    "src/lib/x.test.ts",
    "src/lib/x.spec.tsx",
    "src/__tests__/setup.tsx",
    "e2e/flow.ts",
    "src/lib/__fixtures__/f.ts",
    "src/app/dev/market-visual/page.tsx",
    "src/types/x.d.ts",
  ])("excludes %s", (p) => expect(isExcludedPath(p)).toBe(true));

  it.each([
    "src/lib/data/latest.ts",
    "src/lib/data/contest.ts",
    "src/lib/testimonials.ts",
    "src/lib/data/products.ts",
    "next.config.ts",
  ])("keeps production file %s", (p) => expect(isExcludedPath(p)).toBe(false));
});

describe("ratchet behaviour", () => {
  it("passes at the baseline and is deterministic across runs", () => {
    const root = fixture(BASE_FILES);
    const a = serializeBaseline(toBaseline(scanProject(root)));
    const b = serializeBaseline(toBaseline(scanProject(root)));
    expect(a).toBe(b);
    const cmp = verdict(root, root);
    expect(cmp.violations).toEqual([]);
    expect(cmp.improvements).toEqual([]);
  });

  const withExtra = (extra: Record<string, string>) => {
    const base = fixture(BASE_FILES);
    const next = fixture({ ...BASE_FILES, ...extra });
    return verdict(next, base);
  };

  it("fails on a new production client call in lib/data", () => {
    const cmp = withExtra({
      "src/lib/data/new.ts": `import { getClient } from "@/lib/spree";\nexport const f = () => getClient();`,
    });
    expect(cmp.violations.map((v) => v.category)).toContain(
      "spree_client_access",
    );
  });

  it("fails on a new runtime import", () => {
    const cmp = withExtra({
      "src/lib/data/new.ts": `import { SpreeError } from "@spree/sdk";\nexport { SpreeError };`,
    });
    expect(
      cmp.violations.some((v) => v.category === "spree_value_imports"),
    ).toBe(true);
  });

  it("fails on a new type-only import", () => {
    const cmp = withExtra({
      "src/lib/data/new.ts": `import type { Order } from "@spree/sdk";\nexport type O = Order;`,
    });
    expect(
      cmp.violations.some((v) => v.category === "spree_type_imports"),
    ).toBe(true);
  });

  it("fails on a new SPREE_* env read", () => {
    const cmp = withExtra({
      "src/lib/data/new.ts": `export const k = process.env.SPREE_NEW_KEY;`,
    });
    expect(cmp.violations.some((v) => v.category === "spree_env_reads")).toBe(
      true,
    );
  });

  it("fails when an existing file grows even if the total is offset elsewhere", () => {
    const base = fixture({
      "src/a.ts": `export const a = process.env.SPREE_A;`,
      "src/b.ts": `export const b = process.env.SPREE_B;`,
    });
    const next = fixture({
      "src/a.ts": `export const a = process.env.SPREE_A + process.env.SPREE_A2;`,
      "src/b.ts": `export const b = 1;`,
    });
    const cmp = verdict(next, base);
    expect(cmp.violations).toEqual([
      {
        category: "spree_env_reads",
        file: "src/a.ts",
        baseline: 1,
        current: 2,
      },
    ]);
    expect(cmp.improvements).toEqual([
      {
        category: "spree_env_reads",
        file: "src/b.ts",
        baseline: 1,
        current: 0,
      },
    ]);
  });

  it("fails on a renamed alias used to hide a client call", () => {
    const cmp = withExtra({
      "src/lib/data/new.ts": `import { getClient as quiet } from "@/lib/spree";\nexport const f = () => quiet();`,
    });
    expect(
      cmp.violations.some((v) => v.category === "spree_client_access"),
    ).toBe(true);
  });

  it("accepts docs, tests, comments, translations and dev pages", () => {
    const cmp = withExtra({
      "docs/note.md": `import { getClient } from "@/lib/spree"; process.env.SPREE_API_URL`,
      "README.md": `getClient()`,
      "src/lib/__tests__/new.test.ts": `import { SpreeError } from "@spree/sdk";\nimport type { Order } from "@spree/sdk";\ngetClient();\nprocess.env.SPREE_X;`,
      "src/lib/data/__tests__/helper.ts": `import { getClient } from "@/lib/spree";\ngetClient();`,
      "src/lib/data/commented.ts": `// getClient() import { x } from "@spree/sdk" process.env.SPREE_Q\nexport const ok = 1;`,
      "messages/en.json": `{"a":"getClient() @spree/sdk SPREE_API_URL"}`,
      "e2e/flow.ts": `import { getClient } from "@/lib/spree";\ngetClient();`,
      "src/app/dev/page.tsx": `import { getClient } from "@/lib/spree";\ngetClient();`,
    });
    expect(cmp.violations).toEqual([]);
  });

  it("does not exclude production files whose name merely contains 'test'", () => {
    const cmp = withExtra({
      "src/lib/data/latest.ts": `export const f = () => getClient();`,
    });
    expect(
      cmp.violations.some((v) => v.category === "spree_client_access"),
    ).toBe(true);
  });

  it("passes when dependencies decrease and reports the improvement", () => {
    const base = fixture(BASE_FILES);
    const next = fixture({ "src/lib/data/legacy.ts": `export const x = 1;` });
    const cmp = verdict(next, base);
    expect(cmp.violations).toEqual([]);
    expect(cmp.improvements.length).toBeGreaterThan(0);
  });
});

describe("committed baseline", () => {
  it("matches the repository exactly (or the baseline change is deliberate)", () => {
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(STOREFRONT_ROOT, "scripts/spree-ratchet/baseline.json"),
        "utf8",
      ),
    ) as Baseline;
    const cmp = compare(baseline, scanProject(STOREFRONT_ROOT));
    expect(cmp.violations).toEqual([]);
  });

  it("is serialised canonically (sorted, trailing newline)", () => {
    const raw = fs.readFileSync(
      path.join(STOREFRONT_ROOT, "scripts/spree-ratchet/baseline.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Baseline;
    expect(raw).toBe(serializeBaseline(parsed));
    for (const cat of Object.values(parsed.categories)) {
      expect(cat.total).toBe(
        Object.values(cat.files).reduce((a, b) => a + b, 0),
      );
    }
  });
});
