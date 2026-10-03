# أَوْج / AWJ — «معاملة واحدة» · Creative Treatment

**Format:** 15.00 s · 60 fps · 900 frames · 1920×1080 master · silent picture cut, animated to the cue sheet.

## 1. Visual concept — «One Sale»

The whole film is **one sale** that refuses to stop moving. A single demo transaction —
4 × زيت محرك 5W-30 (4 لتر), paid in cash, **1,250.00** including 15% VAT — is born in POS
and physically travels through the business until it becomes a KPI. We never show a
diagram of the connection; we *follow the object*. The film's grammar is the grammar of a
ledger: hairlines, tab stops, tabular numerals, balance.

Arc: **Fragmentation** (dark, macro, ticker bands) → **Connection** (light, the sale moves
through POS → invoice → stock → journal → dashboard) → **Control** (dark, the whole
workspace as one continuous plane) → **أَوْج** (light, a single rising line reaches its
apex — the literal meaning of أوج — and the wordmark owns the frame).

## 2. Beat sheet (frames @ 60 fps)

| Frames | Time | Beat |
|---|---|---|
| 0–40 | 0.00–0.67 | Hard open on dark. Five horizontal ticker bands of macro business data (12,450.00 · INV-2026-00418 · ×4 · مدفوع · المخزون 128 · مؤسسة الخليج) slide at different speeds and scales. «أعمالك كثيرة.» slams into a band gap. |
| 40–62 | 0.67–1.03 | Bands decelerate; every number snaps onto one tab stop — the chaos becomes a column. |
| 62–90 | 1.03–1.50 | «لكن إدارتها واحدة.» — «واحدة» in AWJ blue. Bands collapse into one row; the row wipes the world from dark to light. |
| 90–175 | 1.50–2.92 | That row *is* the POS cart line. Product tile pressed, qty 1→2→3→4 with ticks; total rolls 312.50 → 625.00 → 937.50 → 1,250.00. Camera pushes toward the total. |
| 175–240 | 2.92–4.00 | «دفع» pressed → confirmation stroke → thermal receipt prints line by line. |
| 240–290 | 4.00–4.83 | **Signature I** — receipt widens into an A4 tax invoice; its lines re-flow into invoice columns; ZATCA QR draws; 1,250.00 locks into the invoice total. |
| 290–335 | 4.83–5.58 | Invoice rows accelerate vertically (directional blur). Quantity cell «4» isolated; camera dives into it. |
| 335–400 | 5.58–6.67 | **Signature II** — «4» becomes «−4»: stock movement ledger. Rows re-order, on-hand 128 → 124, movement cost 720.00 emerges. |
| 400–470 | 6.67–7.83 | **Signature III** — masked wipe into the journal. Debit/credit rows fly into place; Σ مدين 1,250.00 ⇄ Σ دائن 1,250.00 snap and lock. |
| 470–520 | 7.83–8.67 | **Signature IV** — the balanced totals collapse to one point; camera pulls back; the point *is* the last point of the dashboard sales chart; KPI rolls 47,580.00 → 48,830.00. |
| 548–586 | 9.13–9.77 | The camera slides the dashboard aside; «كل شيء متصل.» → «لحظة بلحظة.» set in the space it opened. |
| 586–736 | 9.77–12.27 | **Control** — the frame switches to AWJ dark; one continuous workspace plane (Dashboard · POS · Invoices · Inventory · Reports · Store) tracks laterally R→L, then pulls back in 2.5D. «الصورة كاملة.» / «والقرار أوضح.» |
| 736–780 | 12.27–13.00 | The workspace closes like an aperture onto one horizon line; world returns to light; the line retracts into the brand baseline. |
| 780–900 | 13.00–15.00 | أَوْج rises from behind the baseline — the line is the mask's floor; AWJ tracks in at the line's far end; «أعمالك. في أَوْجها.» sets on the RTL start. Last ~0.5 s holds with a 1.8% camera settle. |

## 3. Signature shot design

- **Carrier objects, not arrows.** The total `1,250.00` is a single persistent element for
  POS → receipt → invoice. The qty `4` carries invoice → inventory (camera dives into the cell).
  The cost `720.00` and the source reference carry inventory → journal. The journal's
  balanced total collapses into the chart's endpoint.
- **Financial truth.** All figures reconcile: 4 × 271.74 = 1,086.96; VAT 15% = 163.04;
  total 1,250.00. Journal: مدين 1110 الصندوق 1,250.00 / دائن 4110 إيرادات المبيعات 1,086.96 +
  دائن 2120 ضريبة مخرجات 163.04. Cost entry: مدين 5110 720.00 / دائن 1140 720.00
  (4 × 180.00 moving average). KPI delta = +1,250.00 exactly.
- **Different physics per object:** camera = long exponential ease; panels = heavy, low
  overshoot; data rows = fast staggered snap; numbers = mechanical per-digit roll; type =
  masked rise with a hard stop.

## 4. Typography

IBM Plex Sans Arabic (300–700) for Arabic, IBM Plex Mono for money/refs. Arabic lines are
set RTL, asymmetric (start-aligned to a grid column, never centered by default), at
extreme scale (up to 190 px) and masked from the baseline so glyphs rise as whole shaped
words (never letter-split — splitting breaks Arabic joining). The Saudi Riyal sign is the
U+20C1 glyph rendered from a bundled OFL outline (IBM Plex has no U+20C1 glyph).

## 5. Camera language

One virtual camera per act (translate/scale/rotate with custom bezier curves), pushes into
cells, lateral tracking, a 2.5D perspective pull-back in Act 4. Transitions are motivated
by the previous shot: row → cart line, receipt → invoice, cell → ledger, total → chart
point, chart line → horizon → brand line.

## 6. Assets reused from the repository

- Tokens: `web/src/app/globals.css`, `DESIGN_SYSTEM.md` (#1E40AF, #F6F7F9, #FFFFFF, #0E1014, #181B20, #4F8CFF, hairline #ECEEF1/#262A31).
- Wordmark: `web/src/lib/brand.ts` + `awj-logo.tsx` — the logo *is* the typographic wordmark
  «أَوْج» / «AWJ» in IBM Plex Sans Arabic Bold, primary colour, `0.08em` tracking for Latin.
  Reproduced exactly, not reinterpreted.
- UI grammar: KPI card (`dashboard/kpi-card.tsx`: 16 px radius, 13 px muted label, mono value,
  dashed divider), POS product tile, sidebar groups (Module Map in `CLAUDE.md`).
- Money: `web/src/lib/money.ts` formatting (`1,250.00` + U+20C1).

## 7. Implementation structure

`motion/awj-commercial/` — standalone Remotion 4 + React 19 + TS project, no imports from
`web/`, no network at render (fonts bundled in `public/fonts`).

## 8. Technical risks

- U+20C1 has no glyph in Plex → rendered as SVG outline (mitigated).
- Arabic shaping under masking/scaling — only whole words are animated (mitigated).
- Motion blur cost — directional SVG blur only on the fast segments, no multi-sample blur.
- 4 vCPU container — render time is several minutes; acceptable.
