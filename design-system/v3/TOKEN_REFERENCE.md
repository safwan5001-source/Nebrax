# مرجع التوكنز (Token Reference) — v3.0-draft

> **مرجع قيم للتحقق، لا مصدر حقيقة نهائي.** المصدر المستهدف هو `design-system/tokens/awj.tokens.json` (DTCG-subset)
> الذي تُولَّد منه هذه الجداول وCSS ([`GOVERNANCE.md`](./GOVERNANCE.md) §1). حتى ذلك الحين: هذا الملف هو **المواصفة**،
> و`web/src/app/globals.css` هو **الواقع المنفَّذ** (وهما مختلفان — انظر [`GOVERNANCE.md`](./GOVERNANCE.md) §2).
>
> نسب التباين **محسوبة** (WCAG 2.x relative luminance) من القيم المذكورة. أي تعديل hex يُعيد حسابها آلياً في CI.

## 1. Primitives (لا تُستهلك في مكوّن)

| العائلة | الدرجة | Hex | ملاحظة |
|---|---|---|---|
| **brand** | 50 | `#EAF0FE` | خلفية شارة محايدة/معلومة |
| | 100 | `#DDE7FB` | الصف المحدّد |
| | 200 | `#C2D2F2` | حدّ الصف المحدّد |
| | 250 | `#8FA9EA` | حدّ صف قيد التحرير |
| | 300 | `#7FA8FF` | الهوية على الحبر (Apex/تركيز/خط الإجمالي) |
| | 500 | `#4F8CFF` | الهوية في Dark (v2.0 القائم) |
| | 600 | `#1E40AF` | **الهوية** |
| | 700 | `#1E3A8A` | hover |
| | 800 | `#172F73` | pressed |
| **ink** | 50 | `#F2F6FD` | نص سطح النتيجة |
| | 100 | `#E8EEF9` | نص على القشرة الحبرية |
| | 200 | `#C5D1E8` | تسميات على سطح النتيجة |
| | 300 | `#A9B8D3` | كسور المبالغ على سطح النتيجة |
| | 400 | `#9FB0CC` | نص خافت على القشرة الحبرية |
| | 500 | `#5A74A8` | حدّ حقل على الحبر |
| | 600 | `#22345A` | خطوط القشرة الحبرية |
| | 700 | `#1A2A4A` | عنصر نشط على الحبر |
| | 800 | `#15244A` | hover/حقل على الحبر |
| | 900 | `#0E1A31` | **الحبر** (قشرة Ink + سطح النتيجة) |
| **tint** | 50 | `#E9EFF9` | حقل على قشرة Default |
| | 100 | `#D5DFF0` | **قشرة Default** |
| | 150 | `#C6D3EA` | hover على القشرة |
| | 200 | `#BFCCE3` | خطوط القشرة |
| | 500 | `#6F82A6` | حدّ حقل على القشرة |
| | 600 | `#3F4F6C` | نص خافت على القشرة |
| | 900 | `#12203B` | نص على القشرة |
| **paper/desk** | paper-0 | `#FFFFFF` | Paper |
| | paper-25 | `#F8F9FC` | Band |
| | paper-50 | `#F1F3F7` | Sunken |
| | desk-100 | `#E9E8E4` | Desk |
| **line** | 100 | `#DCE0E8` | hairline |
| | 200 | `#C6CCD7` | strong |
| | 300 | `#7F8898` | control |
| **gray** | 900 | `#15181D` | نص أساسي |
| | 600 | `#586172` | نص ثانوي |
| | 500 | `#656D7B` | نص ثالث |
| **status** | green-700 | `#166534` | positive fg |
| | green-50 / 200 / 300 | `#E8F5EC` / `#BFE2CB` / `#7FD1A0` | bg / border / على الحبر |
| | red-700 | `#B91C1C` | negative fg |
| | red-50 / 200 | `#FDECEC` / `#F5C2C2` | bg / border |
| | amber-800 | `#92400E` | warning fg |
| | amber-50 / 200 / 600 | `#FDF3E3` / `#F1D9A8` / `#D97706` | bg / border / رسوم بيانية |

## 2. Semantic — Surfaces / Borders / Text / Action / Status

| التوكن (`--awj-…`) | القيمة (Default · Light) | يُشتق من | Alias v2.0 |
|---|---|---|---|
| `surface-desk` | `#E9E8E4` | desk-100 | `--background` |
| `surface-paper` | `#FFFFFF` | paper-0 | `--surface` |
| `surface-band` | `#F8F9FC` | paper-25 | — |
| `surface-sunken` | `#F1F3F7` | paper-50 | — |
| `surface-outcome` | `#0E1A31` | ink-900 | — |
| `border-hairline` | `#DCE0E8` | line-100 | `--border` |
| `border-strong` | `#C6CCD7` | line-200 | — |
| `border-control` | `#7F8898` | line-300 | — |
| `text-primary` | `#15181D` | gray-900 | `--text` |
| `text-secondary` | `#586172` | gray-600 | `--muted` |
| `text-tertiary` | `#656D7B` | gray-500 | — |
| `text-inverse` | `#FFFFFF` | paper-0 | `--primary-foreground` |
| `action-primary` | `#1E40AF` | brand-600 | `--primary` |
| `action-primary-hover` | `#1E3A8A` | brand-700 | `--primary-hover` |
| `action-primary-pressed` | `#172F73` | brand-800 | — |
| `action-primary-fg` | `#FFFFFF` | paper-0 | `--primary-foreground` |
| `brand-soft` | `#EAF0FE` | brand-50 | `--primary-soft` (انظر §10) |
| `status-positive-{fg,bg,border}` | `#166534` / `#E8F5EC` / `#BFE2CB` | green | `--positive` |
| `status-negative-{fg,bg,border}` | `#B91C1C` / `#FDECEC` / `#F5C2C2` | red | `--negative` |
| `status-warning-{fg,bg,border}` | `#92400E` / `#FDF3E3` / `#F1D9A8` | amber | `--warning` |
| `status-info-{fg,bg}` | `#1E40AF` / `#EAF0FE` | brand | — |
| `status-neutral-{fg,bg}` | `#586172` / `#F1F3F7` | gray/paper | — |

> قيم `positive/negative/warning` أعلاه **تطابق الكود المنفَّذ في الوضع الفاتح** (`#166534`, `#B91C1C`, `#92400E` في `globals.css`)
> لا الوثائق القديمة (`#16A34A`, `#DC2626`, `#D97706`). ← [`GOVERNANCE.md`](./GOVERNANCE.md) §2.

## 3. Interaction

| التوكن | القيمة | الاستعمال |
|---|---|---|
| `state-hover` | `#F2F5FC` | صف/عنصر تحويم (≈1.09:1 — غير معلوماتي) |
| `state-selected` | `#DDE7FB` | صف/عنصر محدّد (1.24:1 مع Apex وخانة) |
| `state-selected-edge` | `#C2D2F2` | حدّ الصف المحدّد |
| `state-editing-edge` | `#8FA9EA` | حدّ الصف قيد التحرير |
| `state-focus-ring` | `#1E40AF` (فاتح) · `#7FA8FF` (على الحبر/Dark) | حلقة التركيز 2px |
| `state-focus-halo` | `rgba(30,64,175,.18)` | هالة حالة التحرير (3px) |
| `state-disabled-fg` | `#9AA3B2` | تعطيل (مُستثنى من 4.5:1 كما في WCAG) |
| `apex-color` | = `action-primary` (فاتح) / `shell-apex` داخل القشرة | [`SIGNATURE_LANGUAGE.md`](./SIGNATURE_LANGUAGE.md) §1 |
| `apex-rail` / `apex-cap` | `3px` / `9px × 3px` | هندسة Apex |

## 4. Theme tokens (القشرة فقط)

**القائمة مغلقة: 13 توكناً.** السمة لا تُضيف ولا تُبدّل غيرها. (ومعها ثابتان لا يتبدّلان: `surface-outcome` و`status-*`.)

| التوكن | **Default** (Tinted Neutral) | **Ink** | الدور |
|---|---|---|---|
| `shell-bg` | `#D5DFF0` | `#0E1A31` | خلفية القشرة |
| `shell-fg` | `#12203B` | `#E8EEF9` | نص/أيقونة نشطة |
| `shell-fg-muted` | `#3F4F6C` | `#9FB0CC` | نص عنصر عادي |
| `shell-line` | `#BFCCE3` | `#22345A` | فواصل القشرة |
| `shell-hover` | `#C6D3EA` | `#15244A` | hover |
| `shell-active-bg` | `#FFFFFF` | `#1A2A4A` | العنصر النشط |
| `shell-active-fg` | `#12203B` | `#FFFFFF` | نص العنصر النشط |
| `shell-active-shadow` | `0 1px 2px rgba(15,27,51,.14), 0 0 0 1px rgba(15,27,51,.04)` | `inset 0 0 0 1px #2C4170` | بروز النشط |
| `shell-apex` | `#1E40AF` | `#7FA8FF` | Apex داخل القشرة |
| `shell-field-bg` | `#E9EFF9` | `#15244A` | حقل البحث |
| `shell-field-line` | `#6F82A6` | `#5A74A8` | حدّ حقل ≥ 3:1 |
| `shell-focus-ring` | `#1E40AF` | `#7FA8FF` | تركيز داخل القشرة |
| `shell-brandmark-bg` | `#1E40AF` | `#2D5BDB` | خلفية علامة المؤسسة الافتراضية |

## 5. Posture tokens

| التوكن | Ledger | Floor | Studio | الوحدة |
|---|---|---|---|---|
| `density-tier` | `standard` (auto `compact` ≤ 740px ارتفاعاً) | `touch` | `compact` (مفتّش) / `standard` | — |
| `row-1l` / `row-2l` | 36 / 40 (compact 32 / 36) | 48 / 56 | 32 / 36 | px |
| `control-h` | 36 (compact 32) | 48 | 32 | px |
| `touch-min` | 24 مطلق · 32 | 44 | 32 | px |
| `chrome-h` | 48 (قشرة علوية) | 48–56 | 44 | px |
| `motion-scale` | 1 | 0.8 (أقل) | 1 | × |
| `media-thumb` | 40 / 48 (قوائم تجارة) | 96–160 (بلاطة منتج) | 56–120 | px |
| `shell-variant` | سمة المستخدم | `minimal` (بلا قائمة جانبية) | `graphite` (ثابتة) | — |

## 6. Elevation / Radius / Borders

| التوكن | القيمة |
|---|---|
| `elevation-0` | بلا ظل |
| `elevation-1` (raised) | `0 1px 0 rgba(15,27,51,.04), 0 1px 2px rgba(15,27,51,.07)` |
| `elevation-2` (docked) | `0 -8px 18px -10px rgba(15,27,51,.22)` — اتجاهي؛ يُقلب مع موضع الحافة |
| `elevation-3` (float) | `0 10px 28px rgba(15,27,51,.16), 0 2px 6px rgba(15,27,51,.08)` |
| `elevation-4` (modal) | `elevation-3` + `scrim: rgba(14,26,49,.5)` |
| `shell-cast` | `inset 0 7px 7px -7px rgba(15,27,51,.20)` + حافة القشرة الجانبية بالاتجاه المنطقي (`inset ±7px 0 7px -7px rgba(15,27,51,.14)`، الإشارة تتبع `dir`) |
| `radius-micro/control/surface/float/canvas/pill` | 4 / 6 / **8** / 12 / 16 / 9999 px |
| `rule-ledger` | `4px double` بلون `text-primary` (على Outcome: `apex-color`) |
| `rule-total` | `2px solid text-primary` |

## 7. الطباعة والتباعد والحركة

| التوكن | القيمة |
|---|---|
| `font-sans` / `font-mono` | IBM Plex Sans Arabic / IBM Plex Mono (لا تتغيّر) |
| `fs` | 12 · 13 · 14 · 16 · 20 · 24 · 30 · (40 POS) — أُضيف 13 و30 فقط |
| `fw` | 400 · 500 · 600 (700 للمصادقة حصراً) |
| `space` | 2 · 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 32 · 40 · 48 |
| `motion-dur` | `instant 0` · `fast 100` · `base 160` · `slow 240` (ms) |
| `motion-ease` | `cubic-bezier(0.2, 0, 0, 1)` |

## 8. Component tokens (الدنيا الضرورية)

| التوكن | القيمة (standard) | ملاحظة |
|---|---|---|
| `grid-row-1l` / `grid-row-2l` | = `row-1l` / `row-2l` | من Posture |
| `grid-head-h` | 34 (compact 30) | |
| `grid-cell-px` | 10 | `px-2.5` |
| `dock-h` | 68 (compact 56) | [`TOTALS_DOCK.md`](./TOTALS_DOCK.md) |
| `cmdbar-h` | 46 (compact 42) | |
| `button-h` | 36 (compact 32، touch 44) | يطابق `h-9` اليوم |
| `grid-row-media` / `thumb` | 56 / 40 (compact 48 / 32) | قوائم Commerce بصور مصغّرة ([`COMMERCE_ADMIN.md`](./COMMERCE_ADMIN.md) §5.2) |

## 9. ربط Tailwind (مقترح — الشريحة 1)

| المفتاح | → |
|---|---|
| `bg-desk`, `bg-paper`, `bg-band`, `bg-sunken`, `bg-outcome` | `--awj-surface-*` |
| `border-hairline`, `border-strong`, `border-control` | `--awj-border-*` |
| `text-primary-ink` *(اسم مؤقت لتفادي التعارض مع `primary`)*, `text-secondary`, `text-tertiary` | `--awj-text-*` |
| `bg-hover`, `bg-selected`, `ring-focus` | `--awj-state-*` |
| `bg-shell`, `text-shell`, `bg-shell-active` … | `--awj-shell-*` |
| `rounded-control`, `rounded-surface`, `rounded-float`, `rounded-canvas` | `--awj-radius-*` |
| `shadow-raised`, `shadow-docked`, `shadow-float` | `--awj-elevation-*` |

مفاتيح v2.0 القائمة (`bg-surface`, `bg-background`, `border-border`, `text-muted`, `bg-primary-soft`, …) **تبقى تعمل** كـAliases.

## 10. تحويل Aliases v2.0 → v3

| v2.0 | v3 | قرار |
|---|---|---|
| `--background` | `--awj-surface-desk` | يتبدّل لونه عند تفعيل v3 (الشريحة 2) |
| `--surface` | `--awj-surface-paper` | لا يتغيّر |
| `--border` | `--awj-border-hairline` | يقوى (1.16 → 1.32:1) |
| `--text` / `--muted` | `--awj-text-primary` / `--awj-text-secondary` | لا يتغيّر جوهرياً |
| `--primary` / `-hover` / `-foreground` | `--awj-action-primary*` | لا يتغيّر |
| **`--primary-soft`** | **يتفرّع**: `brand-soft` (شارة محايدة) · `state-hover` · `state-selected` | 319 استعمالاً — يُرحَّل **بالسياق لا بالاستبدال الأعمى** (الشريحة 3) |
| `--positive` / `--negative` / `--warning` | `--awj-status-*-fg` | تُوحَّد الوثائق على قيم الكود |

## 11. Dark — خط الأساس القائم (للتوثيق فقط، غير مُعاد تصميمه هنا)

القيم المنفَّذة اليوم في `.dark` (`globals.css`) — تبقى كما هي حتى الشريحة 10:

| Alias | `.dark` | | Alias | `.dark` |
|---|---|---|---|---|
| `--background` | `#0E1014` | | `--primary` | `#4F8CFF` |
| `--surface` | `#181B20` | | `--primary-hover` | `#6BA0FF` |
| `--text` | `#F3F4F6` | | `--primary-soft` | `#1B2740` |
| `--muted` | `#9099A5` | | `--positive` | `#16A34A` |
| `--border` | `#262A31` | | `--negative` / `--warning` | `#F87171` / `#D97706` |

بنية الداكن المستقبلية: [`THEMES.md`](./THEMES.md) §6.

## 12. مصفوفة التباين المحسوبة (Default · Light)

| الزوج | النسبة | المعيار | النتيجة |
|---|---|---|---|
| `text-primary` / paper | 17.79 | 4.5 | ✓ |
| `text-primary` / desk | 14.51 | 4.5 | ✓ |
| `text-secondary` / paper · band · sunken · hover · selected · desk | 6.24 · 5.92 · 5.61 · 5.71 · 5.02 · 5.09 | 4.5 | ✓ |
| `text-tertiary` / paper · band · sunken · hover | 5.22 · 4.95 · 4.69 · 4.78 | 4.5 | ✓ |
| `text-tertiary` / selected · desk | 4.20 · 4.25 | 4.5 | **✗ — ممنوع؛ استعمل secondary** |
| `action-primary` / paper · selected · desk | 8.72 · 7.02 · 7.11 | 4.5 | ✓ |
| أبيض / `action-primary` | 8.72 | 4.5 | ✓ |
| positive / paper · positive-bg | 7.13 · 6.35 | 4.5 | ✓ |
| negative / paper · negative-bg | 6.47 · 5.66 | 4.5 | ✓ |
| warning / paper · warning-bg | 7.09 · 6.45 | 4.5 | ✓ |
| `border-control` / paper · band | 3.57 · ≈3.4 | 3.0 (1.4.11) | ✓ |
| `border-strong` / paper | 1.61 | بنيوي (غير تعريفي للتحكّم) | ✓ لغير الحقول فقط |
| `border-hairline` / paper | 1.32 | بنيوي | ✓ |
| desk / paper | 1.23 | تصميمي ≥ 1.2 | ✓ |
| selected / paper | 1.24 | مع Apex وخانة (لا لون وحده) | ✓ |
| shell Default: `fg` / `muted` / `muted على hover` | 12.07 · 6.14 · 5.46 | 4.5 | ✓ |
| shell Default: Apex / active-white · shell | 8.72 · 6.50 | 3.0 | ✓ |
| shell Default / desk | 1.09 | بنيوي (يُميَّز بالصبغة + خط) | يُراقَب `[EXPERIMENTAL]` |
| shell Default: field-line / field-bg | 3.35 | 3.0 | ✓ |
| shell Ink: `fg` / `muted` / `muted على hover` | 14.89 · 7.89 · 6.91 | 4.5 | ✓ |
| shell Ink: Apex / ink · active | 7.39 · 6.07 | 3.0 | ✓ |
| shell Ink: field-line / field-bg | 3.25 | 3.0 | ✓ |
| `action-primary` (600) / ink | 1.97 | — | **✗ — لذلك Apex/تركيز على الحبر `brand-300`** |
| Outcome: fg · label · decimals · rule · green | 16.0 · 11.28 · 8.66 · 7.39 · 9.52 | 4.5 / 3.0 | ✓ |

أمثلة التحقق الآلي المقترحة: [`GOVERNANCE.md`](./GOVERNANCE.md) §4.
