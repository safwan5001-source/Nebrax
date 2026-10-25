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

// Whole-tree scan (~700 files) parses every source file; on a loaded CI runner running
// alongside the full suite it can exceed the 5s default. Scoped to this one test only.
const FULL_TREE_SCAN_TIMEOUT_MS = 30_000;
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

  it("follows alias chains regardless of declaration order (review: chained helper aliases)", () => {
    const c = scanSource(
      `import { getClient as gc } from "@/lib/spree";
const clientFactory = gc;
const again = clientFactory;
clientFactory();
again();
clientFactory();`,
      "src/lib/data/a.ts",
    );
    // `= gc`, `= clientFactory`, then three calls
    expect(c.spree_client_access).toBe(5);
    const reordered = scanSource(
      `const b = a;\nconst a = getClient;\nb();`,
      "src/lib/data/a.ts",
    );
    expect(reordered.spree_client_access).toBe(3);
  });

  it("counts SDK factory calls through namespace imports (review: namespace access)", () => {
    const c = scanSource(
      `import * as sdk from "@spree/sdk";\nsdk.createClient({});\nsdk.createClient({});`,
      "src/a.ts",
    );
    expect(c).toMatchObject({ spree_value_imports: 1, spree_client_access: 2 });
    expect(
      scanSource(
        `import sdk from "@spree/sdk";\nsdk.createClient({});`,
        "src/a.ts",
      ).spree_client_access,
    ).toBe(1);
    expect(
      scanSource(
        `import * as other from "other";\nother.createClient({});`,
        "src/a.ts",
      ).spree_client_access,
    ).toBeUndefined();
  });

  it("counts SDK factory calls through destructuring, require and import() (review: destructured factory)", () => {
    const c = scanSource(
      `const { createClient: make } = require("@spree/sdk");
make({});
const { createClient } = await import("@spree/sdk");
createClient({});
const sdk = require("@spree/sdk");
const { createClient: viaNs } = sdk;
viaNs({});
const f = sdk.createClient;
f({});
(await import("@spree/sdk")).createClient({});`,
      "src/a.ts",
    );
    // make(), createClient(), viaNs(), `sdk.createClient` + f(), inline import().createClient
    expect(c.spree_client_access).toBe(6);
  });

  it("counts literal bracket access and aliases derived from it (review: bracket notation)", () => {
    const c = scanSource(
      `import * as spree from "@/lib/spree";
spree["getClient"]();
spree["getClient"]();
const f = spree["getClientForSurface"];
f("dtc");
const { "getWholesaleClient": w } = spree;
w();
import * as sdk from "@spree/sdk";
sdk["createClient"]({});
const { "createClient": mk } = require("@spree/sdk");
mk({});`,
      "src/lib/data/a.ts",
    );
    // 2 bracket calls, bracket alias + call, destructured alias call, sdk bracket, mk()
    expect(c.spree_client_access).toBe(7);
    expect(
      scanSource(`const o = {};\no["other"]();`, "src/a.ts")
        .spree_client_access,
    ).toBeUndefined();
  });

  it("scopes aliases by lexical binding, not file-wide names (review: shadowing)", () => {
    const c = scanSource(
      `import { getClient as gc } from "@/lib/spree";
function a() { const run = gc; run(); }
function b(run: () => void) { run(); }
const other = () => { const run = () => 1; run(); };`,
      "src/lib/data/a.ts",
    );
    // `= gc` and a()'s run() only
    expect(c.spree_client_access).toBe(2);
  });

  it("does not count a parameter or local that shadows a helper name", () => {
    const c = scanSource(
      `function f(getClient: () => void) { getClient(); }
function g() { const withAuthRefresh = () => 1; return withAuthRefresh(); }`,
      "src/lib/data/a.ts",
    );
    expect(c.spree_client_access).toBeUndefined();
  });

  it("still counts an alias used in a nested scope and an unresolved helper reference", () => {
    const c = scanSource(
      `import { getClient as gc } from "@/lib/spree";
const run = gc;
function inner() { return run(); }
getClientForSurface("dtc");`,
      "src/lib/data/a.ts",
    );
    expect(c.spree_client_access).toBe(3);
  });

  it("does not treat createClient from other modules as a Spree factory", () => {
    const c = scanSource(
      `const { createClient } = require("@supabase/supabase-js");\ncreateClient();`,
      "src/a.ts",
    );
    expect(c.spree_client_access).toBeUndefined();
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

  it("resolves process.env aliases by lexical binding (review: env alias scoping)", () => {
    const c = scanSource(
      `function a() { const env = process.env; return env.SPREE_API_URL; }
function b(env: Record<string, string>) { return env.SPREE_API_URL; }
function c() { const env = { SPREE_API_URL: "x" }; return env.SPREE_API_URL; }
const e2 = (env: { SPREE_X?: string }) => env["SPREE_X"];`,
      "src/lib/data/a.ts",
    );
    // only a()'s read is a real process.env read
    expect(c.spree_env_reads).toBe(1);
  });

  it("still follows env alias chains and nested-scope reads", () => {
    const c = scanSource(
      `const env = process.env;
const again = env;
function f() { return again.SPREE_API_URL; }
const { SPREE_WEBHOOK_SECRET } = again;
const m = import.meta.env.NEXT_PUBLIC_SPREE_X;`,
      "src/lib/data/a.ts",
    );
    expect(c.spree_env_reads).toBe(3);
  });

  it("does not count type-only references to helpers (review: type queries)", () => {
    const c = scanSource(
      `import { getClient } from "@/lib/spree";
import type { getClientForSurface } from "@/lib/spree";
type C = ReturnType<typeof getClient>;
type D = typeof getClientForSurface;
const x: typeof getClient = getClient;`,
      "src/lib/data/a.ts",
    );
    // only the runtime `= getClient` value reference
    expect(c.spree_client_access).toBe(1);
  });

  it('recognises literal bracket access to the environment object (review: process["env"])', () => {
    const c = scanSource(
      `const a = process["env"].SPREE_API_URL;
const b = process["env"]["SPREE_KEY"];
const env = process["env"];
const d = env.SPREE_X;
const { SPREE_Y } = process["env"];
const e = import.meta["env"].NEXT_PUBLIC_SPREE_Z;
const f = other["env"].SPREE_NOPE;`,
      "src/lib/data/a.ts",
    );
    expect(c.spree_env_reads).toBe(5); // a, b, alias read, destructure, import.meta; not other["env"]
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
  it(
    "matches the repository exactly (or the baseline change is deliberate)",
    () => {
      const baseline = JSON.parse(
        fs.readFileSync(
          path.join(STOREFRONT_ROOT, "scripts/spree-ratchet/baseline.json"),
          "utf8",
        ),
      ) as Baseline;
      const cmp = compare(baseline, scanProject(STOREFRONT_ROOT));
      expect(cmp.violations).toEqual([]);
    },
    FULL_TREE_SCAN_TIMEOUT_MS,
  );

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
