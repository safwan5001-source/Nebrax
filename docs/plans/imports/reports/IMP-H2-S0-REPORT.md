# IMP-H2-S0 — Honest AI labeling of the products "assisted review" import

**Branch:** `claude/imp-h2-s0-honest-ai-labeling` · web copy only · no backend, API, migration, env or AI-setting change

## Problem

The products screen offered "استيراد عبر مساعد أَوْج / Import via AWJ Assistant" and the page titled itself the same. The pipeline behind it extracts and matches the file by deterministic steps and then shows a preview and asks for approval; the AWJ Assistant (chat) is not connected to this screen yet (H9-S1). The label claimed an AI that does not run on this path.

## Change

- Products entry label (`products.ai_import`): AR **استيراد بمراجعة مساعدة**, EN **Assisted review import** (menu item still routes to `/products/ai-import`, permissions unchanged).
- The page title uses the same label, and a persistent `role="note"` states, in the interface language, that the file is extracted and matched by deterministic steps (no AI model), the user reviews and approves before anything runs, and the AWJ Assistant is **not yet connected to this screen**. Text lives in `modules/ai-actions/assisted-review-text.ts` (AR + EN, `currentLang()` like the page's other modules, so the page needs no intl provider).
- When H9-S1 connects the import tools to the assistant, the assistant label returns together with a visible "Ask the assistant" entry (tracked in the master plan).

## Evidence note

Copy-only correction of a claim the shipped code does not support; no external UI research was needed. Visual inspection was not performed (no browser run) — the change is two strings and one note line in the existing page header.

## Tests / verification

`products/ai-import/page.test.tsx` gains two tests (AR default and EN via `<html lang>`: heading, "no AI model", "not yet connected"); `products/page.test.tsx` updated to the new label. 88 tests pass across products + ai-actions; `npm run build` succeeds. Independent review: copy-only; CI web build + gate on the PR. Codex is out of quota — no Codex review is claimed.
