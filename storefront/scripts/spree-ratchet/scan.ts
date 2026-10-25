/**
 * X6 — Spree dependency ratchet: scanner.
 *
 * Counts *operational* dependencies on Spree in non-test storefront source.
 * Pure and offline: parses with the TypeScript compiler API (already a
 * devDependency), so comments, string literals and docs can never be counted
 * and renamed imports / destructured aliases cannot hide a call.
 *
 * Contract: docs/plans/store/AWJ_STORE_COMMERCE_MASTER_HORIZON_V1.md §6.1.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const CATEGORIES = [
  "spree_value_imports",
  "spree_type_imports",
  "spree_client_access",
  "spree_wrapper_imports",
  "spree_env_reads",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type FileCounts = Partial<Record<Category, number>>;

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  spree_value_imports:
    "Runtime/value imports from @spree/* (import, export-from, dynamic import(), require())",
  spree_type_imports:
    "Type-only imports from @spree/* (import type, `type` specifiers, import-type nodes)",
  spree_client_access:
    "Uses of Spree client helpers (getClient, getClientForSurface, getWholesaleClient, initSpreeNext, resetClient, withAuthRefresh), including aliases and references",
  spree_wrapper_imports:
    "Imports of the @/lib/spree wrapper from code outside src/lib/spree",
  spree_env_reads:
    "Reads of SPREE_* / NEXT_PUBLIC_SPREE_* environment variables",
};

/** Client helper names whose use is counted (calls AND bare references). */
export const CLIENT_HELPERS: ReadonlySet<string> = new Set([
  "getClient",
  "getClientForSurface",
  "getWholesaleClient",
  "initSpreeNext",
  "resetClient",
  "withAuthRefresh",
]);

const SPREE_ENV = /^(NEXT_PUBLIC_)?SPREE_/;
const WRAPPER_DIR = "src/lib/spree";

/** Paths (posix, relative to the storefront root) that are never scanned. */
export function isExcludedPath(rel: string): boolean {
  const p = rel.split(path.sep).join("/");
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p)) return true;
  if (/\.d\.ts$/.test(p)) return true;
  const segments = p.split("/");
  const dirs = segments.slice(0, -1);
  if (
    dirs.some((s) =>
      ["__tests__", "__mocks__", "__fixtures__", "fixtures", "e2e"].includes(s),
    )
  )
    return true;
  if (p.startsWith("src/app/dev/")) return true;
  return false;
}

const SOURCE_EXT = /\.[cm]?[jt]sx?$/;
// Root-level operational files (src/ is always scanned).
const ROOT_OPERATIONAL =
  /^(next\.config|middleware|proxy|instrumentation(-client)?|sentry\.[a-z-]+\.config)\.[cm]?[jt]s$/;

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const isSdk = (spec: string) => spec.startsWith("@spree/");

function isWrapper(spec: string, importerRel: string): boolean {
  if (importerRel === WRAPPER_DIR || importerRel.startsWith(`${WRAPPER_DIR}/`))
    return false;
  if (spec === "@/lib/spree" || spec.startsWith("@/lib/spree/")) return true;
  if (spec.startsWith(".")) {
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(importerRel), spec),
    );
    return resolved === WRAPPER_DIR || resolved.startsWith(`${WRAPPER_DIR}/`);
  }
  return false;
}

function bump(counts: FileCounts, cat: Category, n = 1) {
  counts[cat] = (counts[cat] ?? 0) + n;
}

const stringLiteral = (n: ts.Node | undefined): string | undefined =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
    ? n.text
    : undefined;

/** `import("x")` / `require("x")` → "x". */
function dynamicSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length < 1) return undefined;
  const callee = node.expression;
  const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(callee) && callee.text === "require";
  return isImport || isRequire ? stringLiteral(node.arguments[0]) : undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (
    ts.isAwaitExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n)
  )
    n = n.expression;
  return n;
}

/** Import/destructure/alias names that resolve to a tracked client helper. */
function collectHelperAliases(sf: ts.SourceFile): Set<string> {
  const tracked = new Set<string>(CLIENT_HELPERS);
  const visit = (node: ts.Node) => {
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      const from = node.parent.parent.parent.moduleSpecifier;
      const spec = stringLiteral(from);
      if (CLIENT_HELPERS.has(imported)) tracked.add(node.name.text);
      // `createClient` is only a Spree client factory when it comes from the SDK.
      else if (imported === "createClient" && spec && isSdk(spec))
        tracked.add(node.name.text);
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      const key =
        node.propertyName && ts.isIdentifier(node.propertyName)
          ? node.propertyName.text
          : node.name.text;
      if (CLIENT_HELPERS.has(key)) tracked.add(node.name.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      // const alias = getClient;   const alias = ns.getClient;
      const init = unwrap(node.initializer);
      const name = ts.isIdentifier(init)
        ? init.text
        : ts.isPropertyAccessExpression(init)
          ? init.name.text
          : undefined;
      if (name && CLIENT_HELPERS.has(name)) tracked.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return tracked;
}

/** Local names bound to `process.env` / `import.meta.env`. */
function collectEnvAliases(sf: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isEnvObject(unwrap(node.initializer), aliases)
    )
      aliases.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return aliases;
}

function isEnvObject(e: ts.Expression, aliases: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(e)) return aliases.has(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    // process.env
    if (
      ts.isIdentifier(e.expression) &&
      e.expression.text === "process" &&
      e.name.text === "env"
    )
      return true;
    // import.meta.env
    if (ts.isMetaProperty(e.expression) && e.name.text === "env") return true;
  }
  return false;
}

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p)
  )
    return true;
  if (ts.isBindingElement(p)) return p.name === id || p.propertyName === id;
  if (
    (ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumMember(p)) &&
    p.name === id
  )
    return true;
  if (ts.isShorthandPropertyAssignment(p)) return false; // `{ getClient }` is a real reference
  return false;
}

/** Counts operational Spree dependencies in one source text. */
export function scanSource(text: string, rel: string): FileCounts {
  const sf = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  );
  const counts: FileCounts = {};
  const helpers = collectHelperAliases(sf);
  const envAliases = collectEnvAliases(sf);

  const countModule = (spec: string, kind: "value" | "type", n = 1) => {
    if (isSdk(spec))
      bump(
        counts,
        kind === "value" ? "spree_value_imports" : "spree_type_imports",
        n,
      );
    else if (isWrapper(spec, rel)) bump(counts, "spree_wrapper_imports", n);
  };

  const visit = (node: ts.Node) => {
    // import ... from "x"
    if (ts.isImportDeclaration(node)) {
      const spec = stringLiteral(node.moduleSpecifier);
      if (spec) {
        const clause = node.importClause;
        if (!clause) countModule(spec, "value");
        else {
          const declType = clause.isTypeOnly;
          if (clause.name) countModule(spec, declType ? "type" : "value");
          const nb = clause.namedBindings;
          if (nb && ts.isNamespaceImport(nb))
            countModule(spec, declType ? "type" : "value");
          else if (nb && ts.isNamedImports(nb)) {
            if (nb.elements.length === 0 && !clause.name)
              countModule(spec, declType ? "type" : "value");
            for (const el of nb.elements)
              countModule(spec, declType || el.isTypeOnly ? "type" : "value");
          }
        }
      }
    }
    // export ... from "x"
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const spec = stringLiteral(node.moduleSpecifier);
      if (spec) {
        const ex = node.exportClause;
        if (!ex || ts.isNamespaceExport(ex))
          countModule(spec, node.isTypeOnly ? "type" : "value");
        else
          for (const el of ex.elements)
            countModule(
              spec,
              node.isTypeOnly || el.isTypeOnly ? "type" : "value",
            );
      }
    }
    // import x = require("@spree/sdk")
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const spec = stringLiteral(node.moduleReference.expression);
      if (spec) countModule(spec, node.isTypeOnly ? "type" : "value");
    }
    // import("x") / require("x")
    else if (ts.isCallExpression(node)) {
      const spec = dynamicSpecifier(node);
      if (spec) countModule(spec, "value");
    }
    // typeof import("x") / import("x").Foo in type position
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = stringLiteral(node.argument.literal);
      if (spec) countModule(spec, "type");
    }

    // Client helper uses: calls, aliases and bare references (not declarations).
    if (
      ts.isIdentifier(node) &&
      helpers.has(node.text) &&
      !isDeclarationName(node)
    ) {
      const p = node.parent;
      // `obj.getClient` is a use of the property; `getClient.x` and plain identifiers are uses too.
      const isPropName = ts.isPropertyAccessExpression(p) && p.name === node;
      if (!isPropName || CLIENT_HELPERS.has(node.text))
        bump(counts, "spree_client_access");
    }

    // Env reads
    if (
      ts.isPropertyAccessExpression(node) &&
      SPREE_ENV.test(node.name.text) &&
      isEnvObject(unwrap(node.expression), envAliases)
    )
      bump(counts, "spree_env_reads");
    else if (
      ts.isElementAccessExpression(node) &&
      isEnvObject(unwrap(node.expression), envAliases)
    ) {
      const key = stringLiteral(node.argumentExpression);
      if (key && SPREE_ENV.test(key)) bump(counts, "spree_env_reads");
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isEnvObject(unwrap(node.initializer), envAliases)
    ) {
      // const { SPREE_API_URL } = process.env
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        const k = ts.isIdentifier(key) ? key.text : stringLiteral(key);
        if (k && SPREE_ENV.test(k)) bump(counts, "spree_env_reads");
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return counts;
}

function walk(dir: string, root: string, out: string[]) {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, root, out);
    else if (SOURCE_EXT.test(entry.name))
      out.push(path.relative(root, abs).split(path.sep).join("/"));
  }
}

/** Lists every file the guard measures (posix paths relative to `root`). */
export function listMonitoredFiles(root: string): string[] {
  const files: string[] = [];
  const src = path.join(root, "src");
  if (fs.existsSync(src)) walk(src, root, files);
  for (const name of fs.readdirSync(root)) {
    if (
      ROOT_OPERATIONAL.test(name) &&
      fs.statSync(path.join(root, name)).isFile()
    )
      files.push(name);
  }
  return files.filter((f) => !isExcludedPath(f)).sort();
}

export type Snapshot = Record<Category, Record<string, number>>;

/** Per-category, per-file counts for the whole tree (zero-count files omitted). */
export function scanProject(root: string): Snapshot {
  const snap = Object.fromEntries(CATEGORIES.map((c) => [c, {}])) as Snapshot;
  for (const rel of listMonitoredFiles(root)) {
    const counts = scanSource(
      fs.readFileSync(path.join(root, rel), "utf8"),
      rel,
    );
    for (const cat of CATEGORIES) {
      const n = counts[cat];
      if (n) snap[cat][rel] = n;
    }
  }
  return snap;
}

export const total = (files: Record<string, number>): number =>
  Object.values(files).reduce((a, b) => a + b, 0);

export interface Baseline {
  version: 1;
  categories: Record<
    Category,
    { total: number; files: Record<string, number> }
  >;
}

export function toBaseline(snap: Snapshot): Baseline {
  const categories = {} as Baseline["categories"];
  for (const cat of CATEGORIES) {
    const files = Object.fromEntries(
      Object.entries(snap[cat]).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
    categories[cat] = { total: total(files), files };
  }
  return { version: 1, categories };
}

export function serializeBaseline(b: Baseline): string {
  return `${JSON.stringify(b, null, 2)}\n`;
}

export interface Diff {
  category: Category;
  file: string | null; // null = category total
  baseline: number;
  current: number;
}

export interface Comparison {
  /** Increases: fail the guard. */
  violations: Diff[];
  /** Decreases: allowed; the baseline can be tightened. */
  improvements: Diff[];
}

/**
 * Ratchet rule: a category fails if its total grew OR any single file grew
 * (a new file with dependencies counts as growth from 0, so a dependency
 * cannot be "moved" into new code without a reviewed baseline change).
 */
export function compare(baseline: Baseline, snap: Snapshot): Comparison {
  const violations: Diff[] = [];
  const improvements: Diff[] = [];
  for (const cat of CATEGORIES) {
    const base = baseline.categories[cat] ?? { total: 0, files: {} };
    const cur = total(snap[cat]);
    if (cur > base.total)
      violations.push({
        category: cat,
        file: null,
        baseline: base.total,
        current: cur,
      });
    else if (cur < base.total)
      improvements.push({
        category: cat,
        file: null,
        baseline: base.total,
        current: cur,
      });
    const files = [
      ...new Set([...Object.keys(base.files), ...Object.keys(snap[cat])]),
    ].sort();
    for (const f of files) {
      const b = base.files[f] ?? 0;
      const c = snap[cat][f] ?? 0;
      if (c > b)
        violations.push({ category: cat, file: f, baseline: b, current: c });
      else if (c < b)
        improvements.push({ category: cat, file: f, baseline: b, current: c });
    }
  }
  return { violations, improvements };
}

export function formatReport(cmp: Comparison): string {
  const lines: string[] = [];
  const fmt = (d: Diff) =>
    `  ${d.file ?? "(category total)"}: ${d.baseline} -> ${d.current}`;
  if (cmp.violations.length) {
    lines.push(
      "Spree dependency ratchet FAILED — operational Spree dependencies increased:",
    );
    for (const cat of CATEGORIES) {
      const ds = cmp.violations.filter((d) => d.category === cat);
      if (!ds.length) continue;
      lines.push(`\n[${cat}] ${CATEGORY_DESCRIPTIONS[cat]}`, ...ds.map(fmt));
    }
    lines.push(
      "\nDo not add new Spree dependencies; use the AWJ Commerce API layer (src/lib/commerce).",
      "If the increase is intentional and reviewed, update the baseline explicitly (see scripts/spree-ratchet/README.md).",
    );
  }
  if (cmp.improvements.length) {
    lines.push(
      "\nSpree dependencies decreased (allowed). Tighten the baseline in a follow-up PR: pnpm spree-ratchet:update",
    );
    for (const cat of CATEGORIES) {
      const ds = cmp.improvements.filter((d) => d.category === cat);
      if (ds.length) lines.push(`[${cat}]`, ...ds.map(fmt));
    }
  }
  return lines.join("\n");
}
