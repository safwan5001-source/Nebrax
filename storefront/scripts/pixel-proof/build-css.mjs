// CUST-HV V6b-5 — compiles the storefront stylesheet exactly as the app does (Tailwind v4 via PostCSS),
// so the browser proof paints with the real `globals.css` rules (backdrop, overlay, tokens).
//   node scripts/pixel-proof/build-css.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(join(root, "package.json"));
const tw = req("@tailwindcss/postcss");
// pnpm does not hoist `postcss`; resolve it the way @tailwindcss/postcss does
const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const from = join(root, "src/app/globals.css");
const result = await postcss([(tw.default ?? tw)({ base: root })]).process(readFileSync(from, "utf8"), { from });
writeFileSync(join(out, "storefront.css"), result.css);
console.log("storefront.css", result.css.length, "bytes");
