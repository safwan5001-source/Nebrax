#!/usr/bin/env node
// Offline checker for the awj-erp OpenClaw skill. No network, no writes, no secrets, runs no external code.
// Usage: node check-skill.mjs <path/to/SKILL.md>
// Part 1 mirrors OpenClaw's skill security rules (copied from src/skills/security/scanner.ts, main @ 5e4a575,
// 2026-11-05) and is applied to the raw text (stricter than OpenClaw, which strips comments first).
// Part 2 checks the skill structure. It is an approximation: the authoritative scan runs inside OpenClaw on import.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node check-skill.mjs <SKILL.md>'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');

const NET = /\bfetch\s*\(|\bpost\s*\(|\.\s*post\s*\(|http\.request\s*\(/i;
const RULES = [
  ['literal-secret', 'critical', /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35})(?![A-Za-z0-9_-])|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
  ['shell-pipe-to-shell', 'critical', /\b(curl|wget)\b[^|\n]{0,120}\|\s*(sh|bash|zsh)\b/i],
  ['secret-exfiltration', 'critical', /\b(process\.env|env)\b.{0,80}\b(fetch|curl|wget|http|https)\b/i],
  ['destructive-delete', 'warn', /\brm\s+-rf\s+(\/|\$HOME|~|\.)/i],
  ['unsafe-permissions', 'warn', /\bchmod\s+(-R\s+)?777\b/i],
  ['dynamic-code-execution', 'critical', /\beval\s*\(|new\s+Function\s*\(/],
  ['crypto-mining', 'critical', /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i],
  ['suspicious-network', 'warn', /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/],
  ['obfuscated-code', 'warn', /(\\x[0-9a-fA-F]{2}){6,}/],
  ['obfuscated-code', 'warn', /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/],
];

let critical = 0, warn = 0;
for (const [id, sev, re] of RULES) {
  lines.forEach((l, i) => {
    if (re.test(l)) {
      console.log(`${sev.toUpperCase()} ${id} line ${i + 1}: ${l.trim().slice(0, 100)}`);
      sev === 'critical' ? critical++ : warn++;
    }
  });
}
// env-harvesting: process.env near a network-send call (8 lines)
lines.forEach((l, i) => {
  if (/process\.env/.test(l) && NET.test(lines.slice(Math.max(0, i - 8), i + 9).join('\n'))) { console.log(`CRITICAL env-harvesting line ${i + 1}`); critical++; }
});
if (/child_process/.test(text) && /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/.test(text)) { console.log('CRITICAL dangerous-exec'); critical++; }
console.log(`scan: critical=${critical} warn=${warn}`);

// ---- structure
const fails = [];
const need = (ok, msg) => { if (!ok) fails.push(msg); };
const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
need(!!fm, 'frontmatter missing');
need(/^name:\s*awj-erp\s*$/m.test(fm?.[1] ?? ''), 'frontmatter name must be awj-erp');
need(/^description:\s*\S/m.test(fm?.[1] ?? ''), 'frontmatter description missing');
need(/AWJ_API_KEY/.test(text) && /AWJ_API_BASE/.test(text), 'AWJ_API_KEY / AWJ_API_BASE not referenced');
need(!/https?:\/\//.test(text.replace(/^---\n[\s\S]*?\n---\n/, '')), 'literal URL found in body (base comes from AWJ_API_BASE)');
need(/Bearer \$AWJ_API_KEY/.test(text), 'Authorization: Bearer $AWJ_API_KEY style missing');
// the seven original operations must be present, unchanged
const core = [
  '| 1 | List/search products | `GET $AWJ_API_BASE/products?search=<text>&per_page=5` | products:read |',
  '| 2 | Create product | `POST $AWJ_API_BASE/products` | products:write |',
  '| 3 | List/search partners | `GET $AWJ_API_BASE/partners?type=customer&search=<text>&per_page=5` | partners:read |',
  '| 4 | Create partner | `POST $AWJ_API_BASE/partners` | partners:write |',
  '| 5 | List/get invoices | `GET $AWJ_API_BASE/invoices?per_page=5` / `GET .../invoices/<uuid>` | invoices:read |',
  '| 6 | Create DRAFT sales invoice | `POST $AWJ_API_BASE/invoices` | invoices:write |',
  '| 7 | Partner statement | `GET $AWJ_API_BASE/partners/<uuid>/statement?from=YYYY-MM-DD&to=YYYY-MM-DD` | statements:read |',
];
core.forEach((r, i) => need(text.includes(r), `core operation ${i + 1} missing or changed`));
// supplier operations
need(/type=supplier/.test(text) && /role=supplier/.test(text), 'supplier list/statement missing');
need(/"type":"supplier"/.test(text), 'supplier create body missing');
need(/Search before you create/.test(text) && /Idempotency-Key/.test(text), 'search-first / idempotency rule missing');
// no new API surface: only these paths and scopes may appear
const scopes = [...new Set([...text.matchAll(/\b([a-z]+:(?:read|write))\b/g)].map(m => m[1]))];
const allowed = new Set(['partners:read', 'partners:write', 'products:read', 'products:write', 'invoices:read', 'invoices:write', 'statements:read']);
scopes.filter(s => !allowed.has(s)).forEach(s => fails.push(`unexpected scope ${s}`));
console.log(`scopes referenced: ${scopes.sort().join(', ')}`);
fails.forEach(f => console.log('STRUCTURE FAIL: ' + f));
console.log(fails.length ? `structure: ${fails.length} failure(s)` : 'structure: ok');
process.exit(critical || fails.length ? 1 : 0);
