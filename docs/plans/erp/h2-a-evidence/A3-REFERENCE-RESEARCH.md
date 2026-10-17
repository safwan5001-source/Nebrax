# A3 — Visual Reference Research (البحث البصري المرجعي)

AWJ ERP (أَوْج) UI/UX horizon, phase A3. Captured 2026-10-15.

**What this is.** Evidence that was observed directly: pages opened in headless Chromium (Playwright, 1440x900 desktop and 390x844 mobile), screenshots taken, page text extracted. Every fact below comes from a screenshot in [`a3/`](a3/) or from the visible text of the cited page. Where something was not observed, the text says so.

**What this is not.** It is not a decision record. Every item under "Implications for AWJ" is a **candidate** for the AWJ team to accept, change or reject. **AWJ Decision:** recorded in the A4 contract ([AWJ-ERP-UI-H2-1-UI-CONTRACT.md](../AWJ-ERP-UI-H2-1-UI-CONTRACT.md) §2–§5), not here; each section below points to it. Items under "Not adopted / caution" mark places where a reference practice conflicts with AWJ's governing principles: a daily accounting tool, RTL Arabic first, dense, one brand colour, financial numbers in Mono, no decoration, double-entry immutability.

## How to read the evidence

- Screenshots are in [`a3/`](a3/), named `<source>-<pattern>-<width>.jpg` (converted from the original PNG captures, ≤1000 px).
- The width suffix is the viewport the page was loaded at. Many captures are **element crops** of an image embedded in a docs page (Carbon, Primer, Zoho, BC, Shopify POS). So a `-1440` file can be narrower than 1440 px. A few (`zoho-settings-orgprofile`, `zoho-detail-splitview`, `bc-report-analysis-*`, `shopify-pos-*`, `daftra-*`) were re-rendered from the original image URL at 1440 px (Daftra POS totals at 800 px) so they stay legible.
- The kind of evidence differs, and it is noted per source:
  - **Real product screenshot (help docs):** Zoho Books, Microsoft Dynamics 365 Business Central (BC).
  - **Live component render:** Shopify App Home / Polaris web-component previews on shopify.dev, Primer React live examples. These are real components rendered in the browser, not the merchant admin.
  - **Design-system illustration:** IBM Carbon, GitHub Primer (static images), Material 3.
  - **Marketing mockup of the real product:** Daftra and Foodics (Arabic RTL), Shopify POS docs renders. These may be stylised.
  - **Text-only documentation:** Daftra help centre. The articles visited had no product screenshots in the DOM, so Daftra facts from docs are textual.
- Only public pages were used. No logins and no account creation. Cookie banners were hidden with CSS for clean crops, and no bot challenge was bypassed.

## Sources reached and used

| Source | URL(s) used | Evidence type | Patterns |
|---|---|---|---|
| Shopify App Home (Polaris web components) | shopify.dev/docs/api/app-home/latest/patterns/templates/{resource-index, details, settings}; …/compositions/index-table | Live component render, desktop + mobile | 1, 2, 3, 4, 5, 8 |
| Shopify POS UI extensions | shopify.dev/docs/api/pos-ui-extensions/latest/targets | Product render (POS iPad) | 7 |
| IBM Carbon | carbondesignsystem.com …/components/data-table/guidelines; …/patterns/{forms, empty-states, dialogs, loading} | Illustration + guideline text | 1, 2, 4, 8 |
| GitHub Primer | primer.style/product/components/{data-table, confirmation-dialog}; …/ui-patterns/{forms, saving, empty-states, degraded-experiences, loading}; …/scenario-patterns/delete | Live render + images + text | 1, 2, 4, 8 |
| Microsoft Business Central | learn.microsoft.com/en-us/dynamics365/business-central/{analysis-mode, ui-views, ui-enter-criteria-filters, ui-enter-data, sales-how-invoice-sales} | Real product screenshots (analysis mode) + text | 1, 2, 3, 6 |
| Zoho Books help | zoho.com/us/books/help/invoice/{delete-invoice, other-actions, record-payment-for-invoice}; …/reports/{manage-reports, receivables}; …/settings/organization/organization-profile | Real product screenshots + text | 3, 5, 6, 8 |
| Daftra (AWJ functional reference) | docs.daftra.com (Arabic articles listed in each section); daftra.com POS and accounting marketing pages | Text docs + Arabic marketing mockups | 1, 3, 5, 6, 7, 8 |
| Foodics | foodics.com/ar/ | Arabic marketing mockup | 6 (RTL numbers) |
| Material Design 3 | m3.material.io/components/dialogs/guidelines | Illustration + text, mobile | 2, 8 |

---

## 1. List page with DataTable (صفحة القائمة)

### External Evidence

**Shopify App Home: Index template and Index-table composition** (live render)
- [`shopify-list-index-1440`](a3/shopify-list-index-1440.jpg) (https://shopify.dev/docs/api/app-home/latest/patterns/templates/resource-index):
  - The page title "Puzzles" sits at the start. Page actions sit at the end, in order: "Export puzzles", "Import puzzles" (secondary) and "Create puzzle" (primary, dark).
  - An empty-state card ("Start creating puzzles" with "Learn more" and "Create puzzle") renders above a table. The columns are Puzzle (thumbnail + link), Pieces (numeric, right-aligned), Created and Status.
  - Status uses badges: "Active" in green, "Draft" in grey.
- The composition text (https://shopify.dev/docs/api/app-home/latest/patterns/compositions/index-table) says: "Use checkboxes for bulk selection, reveal row actions on hover, and include pagination for large data sets."
  - Search and sort sit in a `slot="filters"` area: a search field "Searching all puzzles" plus a sort icon button with a "Sort by" choice list.
  - A code comment reads "Bulk action bar - appears when items are selected".
- [`shopify-list-indextable-390`](a3/shopify-list-indextable-390.jpg): **mobile card fallback, observed.** At 390 px the table becomes stacked cards. Each card has a checkbox, thumbnail, linked name, a status badge at the top end, then label/value pairs ("Pieces 16", "Created Today"). The search field and the sort icon button stay on one row. The docs credit this to "`listSlot` on table headers to control responsive stacking".

**IBM Carbon: Data table** (illustrations + guideline text, https://carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)
- [`carbon-list-toolbar-1440`](a3/carbon-list-toolbar-1440.jpg):
  - The toolbar holds icon buttons for search, edit and settings (gear), then a full-height primary "Invite user +" at the end.
  - The gear opens a **"Row height"** menu: Extra small / Small / Medium / Large. This is a density toggle.
- Text, row heights: XS 24px, S 32px, **M 40px (default)**, L 48px, XL 64px. "The toolbar height should always match the row height"; the batch-action bar and pagination heights also match the row height.
- Text, toolbar: reserved for global actions such as settings, complex filters, export and edit. Include up to five actions, with more in an overflow menu.
- [`carbon-list-search-1440`](a3/carbon-list-search-1440.jpg): the toolbar search expands in place. Typing "11" narrows rows to those containing 11, with a clear (×) button. The text says search is "closed by default" (collapsed to an icon).
- [`carbon-list-batchactions-1440`](a3/carbon-list-batchactions-1440.jpg): a title with a count ("Drafts (10)") and a description line. Checked rows are highlighted. The text says that once an item is selected, a batch action bar appears **at the top of the table**, with "Cancel" at the far end to exit.
- Text, sorting: "Only the sorted column displays an icon, and unsorted icons are only visible on hover". There are three states: unsorted, ascending and descending.
- Text, row actions: an overflow menu per row, persistent by default. "When the overflow menu contains fewer than three options, keep the actions inline as icon buttons." On touch devices overflow menus stay visible even in hover mode.
- [`carbon-list-pagination-1440`](a3/carbon-list-pagination-1440.jpg): simple pagination ("Page 1 ◂ ▸") and advanced pagination ("Items per page: 100 | 1–100 of 1,228 items | 12 of 40 pages ◂ ▸").

**GitHub Primer: DataTable** (live render, https://primer.style/product/components/data-table/)
- [`primer-list-numbers-right-1440`](a3/primer-list-numbers-right-1440.jpg): the "Pull requests" numeric column is right-aligned while text columns are start-aligned.
  - The page text reads verbatim: "Left (default): Follows natural reading direction in right-to-left writing systems. Right-aligned columns are used for numbers…".
  - The first sentence is ambiguous as written. Treat it as "start-aligned text by default".
- [`primer-list-pagination-1440`](a3/primer-list-pagination-1440.jpg): a pagination footer with a range at the start ("1–10 of 1000") and "Previous 1 2 3 … 100 Next" at the end.
- Text:
  - `cellPadding: 'condensed' | 'normal' | 'spacious'`.
  - "If a table is sortable, one column must be sorted by default."
  - "DataTables use 'skeleton' loading states."
  - Row actions come in three variants: inline, dropdown, and overflowing.

**Business Central: saved views, search and filter** (text, https://learn.microsoft.com/en-us/dynamics365/business-central/ui-views, …/ui-enter-criteria-filters)
- Saved views:
  - "If views exist, the Views group appears at the top of the filter pane."
  - Views are "available the next time you open the list, from any device or browser".
  - A new view's default name is "All (Copy)". Views can be renamed or removed.
  - Since 2026 release wave 2 a saved view can be **bookmarked** to the Role Center (navigation).
- The filter pane "appears to the left of the list" (Shift+F3). Search (F3) matches across visible fields and ignores case. Filters can target any field, **including fields not visible on the page**.
- Multiple values selected on an option field combine with **OR**. Sorting works by clicking the column heading text or through a heading dropdown (Ascending/Descending).

**Daftra** (text, https://docs.daftra.com/tutorial/الإجراءات-على-قائمة-الفواتير/)
- Bulk selection uses a checkbox per invoice. The header checkbox offers "الكل (الصفحة الحالية)" and "الكل (جميع الصفحات)".
- The "الإجراءات" menu at the top offers: حذف، إرسال إلى عميل، تحويل إلى مدفوع، طباعة PDF، تصدير (CSV, Excel, XML)، إرسال رسالة نصية.

### Implications for AWJ (candidates)
- **C1.1 Toolbar anatomy.**
  - Order the toolbar along the inline direction: page title and count at the start; page actions (import/export as secondary, one primary "create") at the end.
  - Put a filter row under the title: search, filter chips, a saved-view selector, and column/density settings.
  - Cap visible toolbar actions at about 5 and move the rest to overflow (Carbon).
- **C1.2 Density as a user setting.** Offer 2–3 row heights mapped to Carbon's 32/40/48 px. Toolbar, batch bar and pagination take the same height as rows. AWJ's "balanced density" suggests 40 px as default and 32 px as the "compact" option.
- **C1.3 Bulk mode.** When at least one row is selected, the batch bar replaces the toolbar in place, with a selected count, the actions, and "Cancel" at the end (Carbon). Offer "select all on this page" versus "select all N matching" (Daftra, Carbon).
- **C1.4 Saved views.** Store views per user and per list, with filters, sort, columns and density. Default name pattern "الكل (نسخة)". Allow rename and delete. Pinning to the sidebar is a later step (BC bookmark).
- **C1.5 Sorting.** One default sort column is always visible (Primer). The icon shows only on the sorted column, and the others show it on hover (Carbon). Server-side sort is the single source of truth, as AWJ's `serverSort` already does.
- **C1.6 Pagination.** Show the range ("١–٥٠ من ١٬٢٢٨" or Western digits per AWJ's numeral policy), a page-size selector, and previous/next. Numbered pages are optional.
- **C1.7 Row actions.** With ≤2 actions, show inline icon buttons. Otherwise use a persistent overflow (⋯), not hover-only, because touch persists anyway (Carbon).
- **C1.8 Mobile card fallback.**
  - Below the tablet breakpoint each row becomes a card: primary identifier and status badge in the top row, then 2–4 label/value pairs (Shopify 390).
  - Keep the checkbox only when bulk actions exist.
- **C1.9 Search versus filter semantics** (BC):
  - Search is quick, matches visible text and ignores case.
  - Filters are typed per field, may target hidden fields, and multi-select within one field means OR.

### Not adopted / caution
- **Collapsed-by-default search** (Carbon) hides the most-used control in a daily accounting list. Candidate: keep the search field always open on desktop.
- **Hover-only row actions** (Shopify "reveal row actions on hover") are hard to discover and fail on touch. Prefer persistent ⋯.
- **Thumbnails and coloured status pills everywhere** (Shopify) add decoration. AWJ uses one brand colour and semantic status (colour + text label).
- **Number alignment in RTL.** Every LTR reference right-aligns numbers, which is the trailing edge in LTR.
  - In the Arabic Daftra P&L ([`daftra-report-pnl-ar-1440`](a3/daftra-report-pnl-ar-1440.jpg)), numbers sit at the **physical right** of each cell, the same edge as the RTL headers.
  - In the Daftra POS cart ([`daftra-pos-cart-ar-1440`](a3/daftra-pos-cart-ar-1440.jpg)), line amounts sit at the **physical left** (trailing edge).
  - AWJ's DESIGN_SYSTEM says "الأرقام يمين بخط Mono". The team should state explicitly whether "يمين" means physical right in both directions or the trailing edge. Copying the LTR references literally would give left-aligned numbers in RTL.
- **Daftra's "تحويل إلى مدفوع" bulk action** pays many invoices in one action. Under AWJ's rules any payment must go through `PaymentService` / `LedgerService`. A bulk action that creates financial facts needs its own accounting review and is not a UI shortcut.

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 2. Forms (النماذج)

### External Evidence

**Carbon: Forms pattern** (https://carbondesignsystem.com/building-blocks/core/patterns/forms)
- [`carbon-form-anatomy-1440`](a3/carbon-form-anatomy-1440.jpg): a single column with top-aligned labels. "Description (optional)" carries a counter "0/100". Helper text sits under the field ("Enter the url of the repo…"), and there is one primary button at the bottom start.
- Text on required/optional marking:
  - "If the majority of the fields are required, mark only the optional field labels with (optional). If the majority of the fields are optional, mark only the required field labels with (required)."
  - "The pattern used should be consistent throughout your product."
- Text on validation:
  - Client-side validation "should happen as soon as the field loses focus".
  - Server-side errors use an inline notification **plus** inline field errors.
  - "For short forms… disabling primary action buttons until all of the form's requirements are met". "For longer forms, do not disable primary action buttons." "When a user submits a form, disable the primary action button to prevent duplicate submissions."
  - "The first required input field in a form should receive focus."
- Text on buttons: the primary button is left-aligned in in-page forms (LTR) and right-aligned in progressive and dialog forms. "Do arrange primary and secondary buttons at the bottom of the form."
- [`carbon-dialog-validate-1440`](a3/carbon-dialog-validate-1440.jpg) (Dialogs pattern): an invalid field gets a red border plus an error icon and the message "An email address is required". "Message (optional)" is marked. Cancel and the primary "Send invite" span the full dialog width at the bottom.

**Primer: Forms + Saving** (https://primer.style/product/ui-patterns/forms/, …/saving/)
- [`primer-form-errors-1440`](a3/primer-form-errors-1440.jpg): **error summary.**
  - A red banner at the top reads "The following inputs have errors:" followed by links "Last name, ZIP code, email address".
  - Fields are marked with "*" for required. Each invalid field has a red border and an inline message with an icon: "Enter your last name", "Enter your ZIP code", "This email address is not valid".
- Text:
  - "Validation on submit" is the default. If the form has 3 or more errors, an interactive summary may be shown. Otherwise "the first invalid input should be focused and scrolled into the viewport".
  - After a failed submit, the form may switch to inline validation. "Live regions should not be used for form validation."
  - "Disabled buttons are discouraged."
- [`primer-form-submit-blocked-1440`](a3/primer-form-submit-blocked-1440.jpg): a system-level failure is shown as a warning banner at the top of the form: "This form cannot be submitted due to a system error".
- [`primer-saving-sections-1440`](a3/primer-saving-sections-1440.jpg): a page with two sections, each with its **own** task-specific save button: "Update public profile" and "Update profile settings".
- Saving text:
  - Start from explicit saving, and never mix explicit and auto-save in one form.
  - On unsaved changes, warn through `beforeunload`. Browsers show only a generic message.
  - "Do not disable or hide a form's save button even if the form is invalid or has not been changed."

**Shopify Details/Settings templates** (live render)
- The Save Bar API "displays save/discard controls when the form has unsaved changes" (`data-save-bar` on the form), and saving is confirmed with a Toast ("Settings saved successfully").
- [`shopify-detail-template-390`](a3/shopify-detail-template-390.jpg), [`shopify-settings-template-390`](a3/shopify-settings-template-390.jpg): on mobile the visible labels move **inside** the input boxes (floating labels). The helper text stays under each field.

**Business Central** (text, https://learn.microsoft.com/en-us/dynamics365/business-central/ui-enter-data)
- A **red asterisk** means the field must be filled to complete a process "such as when you post a transaction". "You aren't required to fill in the field before you continue to other fields or close the page."
- Values are validated after focus leaves the field.
- An optional **Check Document / Check Journal FactBox** lists the page's errors in real time. An administrator enables it.

**Zoho Books** ([`zoho-settings-orgprofile-1440`](a3/zoho-settings-orgprofile-1440.jpg)): required labels are red with "*", and labels sit to the side of inputs.

**Material 3** ([`m3-dialog-basic-vs-fullscreen-1440`](a3/m3-dialog-basic-vs-fullscreen-1440.jpg)): on mobile, longer create/edit tasks use a **full-screen dialog** with "×" at the start and "Save" at the end of the top bar.

### Implications for AWJ (candidates)
- **C2.1 Required marking: one rule product-wide.**
  - Accounting documents are mostly required fields, so the Carbon rule gives "(اختياري)" on optional fields only.
  - The alternative is an asterisk on required fields (Primer, Zoho, BC). Choose one and apply it everywhere.
- **C2.2 Validation timing.** Validate on submit first. After the first failed submit, validate inline on blur (Primer + Carbon). Server errors appear as a form-level banner **and** per-field messages.
- **C2.3 Error summary.** For 3 or more errors, show a summary banner at the top of the form with links that focus each field. Otherwise focus the first invalid field (Primer).
  - In document forms with line items, the summary must also list line errors such as "سطر ٣: الحساب مطلوب". This extends the references; none of them show line-item summaries.
- **C2.4 Primary button state.** Do not disable "حفظ" or "ترحيل" because the form is invalid. Disable only while submitting, to block a double post (Carbon + Primer agree on the submit case).
- **C2.5 Sticky action bar.** Keep a bottom (or top) bar on long documents with the action-specific labels "حفظ كمسودة" and "ترحيل". The Shopify Save Bar appears only when the form is dirty. This combines Shopify's dirty-state bar with Primer's task-specific labels.
- **C2.6 Unsaved-changes guard.**
  - In-app navigation gets an AWJ dialog in Arabic with a named action ("تجاهل التغييرات").
  - Leaving the browser uses `beforeunload`, which can only show a generic browser message (Primer).
- **C2.7 Posting-required versus save-required** (BC). Allow saving a draft with incomplete "posting-required" fields. Block only the post, and list what is missing. This matches AWJ's draft → post lifecycle.
- **C2.8 Mobile.** Long forms open full-screen (M3). Labels may float inside the input on mobile (Shopify 390). Desktop keeps top-aligned labels.

### Not adopted / caution
- **Zoho's side labels in red for required fields** spend colour on structure, while AWJ reserves red for errors and negatives. Prefer top labels and a neutral marker.
- **Carbon's advice to disable the primary button on short forms** conflicts with Primer and with keyboard accessibility. Candidate: never disable for validity.
- **Floating labels on desktop** reduce scan density in dense accounting forms. Keep them at mobile width only, if adopted.
- **Auto-save** (Primer imperative controls, BC page model) is not appropriate for financial documents. Totals and postings must be explicit (AWJ rule: posting is explicit and immutable).

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 3. Document detail: invoice / bill (تفاصيل المستند)

### External Evidence

**Zoho Books invoice detail** (real product, [`zoho-detail-splitview-1440`](a3/zoho-detail-splitview-1440.jpg), https://www.zoho.com/us/books/help/invoice/delete-invoice.html)
- **Split view.**
  - The left pane is the invoice list ("All Invoices ▾", "+ New"). Each row shows customer, invoice number, date, amount, and status as coloured uppercase text: DUE TODAY, PAID, DRAFT, APPROVED, PENDING APPROVAL.
  - The right pane is the open document.
- **Header:** "Branch: Head Office" above the document number "INV-000147". At the top right are "Attach File(s)", "Comments & History", and close (×).
- **Action toolbar:** Edit · Mails/SMS ▾ · Share · Reminders ▾ · PDF/Print ▾ · Record Payment ▾ · "•••". The ••• menu holds:
  - Make Recurring, Create Credit Note, Create Debit Note, Add e-Way Bill Details, Clone, Void
  - **View Journal**
  - Delete
  - Invoice Preferences, Page Tips
- **Body:** a payment reminder strip, a payment-gateway promo with "Record Offline Payment", "APPROVERS: View History", then the printed invoice preview.
  - The preview carries a "Sent" ribbon, "Balance Due Rs.472.00", Invoice/Due dates, line table (Qty, Rate, CGST, SGST, Amount) and totals.
- Text: void means "it will not reflect on any of your sales transactions or reports" and requires a reason. "Convert to Draft" reactivates the invoice. Write-off posts to Bad Debt and can be reverted with "Cancel Write Off".

**Daftra invoice view** (text, https://docs.daftra.com/tutorial/عرض-فاتورة-المبيعات/)
- Invoice status can be changed manually with "اختر الحالة". Custom status lists are configurable.
- **Linked-records strip** at the top of the page:
  - **The journal-entry link** opens a hover popover showing entry number, date, description, and lines (account code + name, description, debit, credit). A **total row** shows Σ debit and Σ credit, which "must be equal".
  - Clicking pins the popover until it is closed with ×. "فتح القيد" opens the full entry.
  - There are also a cost-entry link (قيد التكلفة), a customer link, and the payment status (مدفوعة / مدفوعة جزئياً / غير مدفوعة).
- Up/down arrows next to the invoice number move to the previous or next invoice without returning to the list.
- **Actions centre:** تعديل، طباعة، PDF، إضافة عملية دفع، قسائم، مرتجع، نسخ، اتفاقية تقسيط، توزيع الدفعة المقدمة، أرسل عبر، SMS، مراكز التكلفة، خطة إنتاج، أمر شغل، ملاحظة/مرفق، موعد، حذف، إشعار مدين.
- **Tabs:**
  - فاتورة (print view)
  - التفاصيل (custom fields)
  - المواعيد
  - المدفوعات
  - الأذون المخزنية, طلبات الصرف, or المخزون (depending on settings)
  - **سجل النشاط** (every operation with date and time)

**Business Central** (text, https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-invoice-sales)
- The totals under the lines update automatically as lines change. "Release" applies rounding. A "Post and Send Confirmation" dialog appears on posting.
- After posting, the invoice leaves the invoices list and appears in **Posted Sales Invoices** with its final number. Users can look up statistics, dimensions, and **the ledger entries that result from the posted invoice**.
- A posted invoice can be corrected or cancelled before payment. After payment, a credit memo is required.

**Shopify Details template** (live render)
- [`shopify-detail-template-1440`](a3/shopify-detail-template-1440.jpg):
  - Breadcrumb "Puzzles › Mountain view". Header actions: "Duplicate" (secondary) and "Delete" (critical-tone text).
  - Two columns: a wide main column of section cards, and a narrow side card "Puzzle summary" with facts and a "Current status: Active" badge.
- [`shopify-detail-template-390`](a3/shopify-detail-template-390.jpg): on mobile the breadcrumb collapses to "…" and the header actions collapse into a "•••" button. The columns stack.

### Implications for AWJ (candidates)
- **C3.1 Header block.**
  - Document type + number; a status badge plus a separate **payment status**; party link; branch (Zoho shows "Branch:"); dates.
  - Primary action at the end ("ترحيل" for a draft, "تسجيل دفعة" for a posted invoice). Everything else goes in one overflow.
- **C3.2 Separate states.**
  - Keep lifecycle status (مسودة / مرحّلة / ملغاة بقيد عكسي) apart from payment status (غير مدفوعة / جزئي / مدفوعة) and ZATCA status.
  - Zoho mixes them into one coloured label (PAID vs APPROVED vs DUE TODAY). Daftra keeps payment status separate.
- **C3.3 Posted journal entry on the document.**
  - Adopt Daftra's pattern: a "القيد" link in the header showing a compact popover with lines (code, account, debit, credit) and a balanced total row, plus "فتح القيد".
  - The cost/COGS entry gets its own link.
  - This directly expresses AWJ's `source_type/source_id` traceability.
- **C3.4 Tabs / sections.**
  - المستند (rendered document) · السطور والإجماليات · المدفوعات/التخصيصات · الحركات المخزنية · القيود · **سجل النشاط** (actor, action, timestamp).
  - On desktop the totals block sits under the lines, with Σ derived from the lines (AWJ rule).
- **C3.5 Prev/next navigation** between documents of the same list keeps the list's filter context (Daftra arrows, Zoho split view).
- **C3.6 Optional split view** (list + detail) for review-heavy queues such as approvals and collections (Zoho). The default stays full-page detail.
- **C3.7 Mobile.** The side summary stacks below the header. Actions collapse into ••• with the primary action kept visible (Shopify 390).

### Not adopted / caution
- **Delete on a posted invoice** (Zoho ••• → Delete; Daftra deletes an invoice together with "قيودها المحاسبية وقيود مدفوعاتها" per its own docs) conflicts with AWJ's non-negotiable rule that posted entries are immutable. Corrections go through `LedgerService::reverse()` or credit notes. For AWJ, Delete exists only for drafts.
- **Zoho "Void"** removes the invoice from reports without a visible reversing entry, according to its help text. AWJ candidate: cancellation means a reversing entry plus a credit note, visible in the entries tab.
- **Payment-gateway promo banners** inside the document (Zoho) are decoration and upsell. Not for a daily tool.
- **Manually editable invoice status** (Daftra "اختر الحالة") must not alter accounting state. If adopted at all, it should be a separate label or tag.

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 4. Empty / loading / error / permission-denied states (الحالات)

### External Evidence

**Carbon: Empty states** (https://carbondesignsystem.com/building-blocks/core/patterns/empty-states)
- [`carbon-empty-table-1440`](a3/carbon-empty-table-1440.jpg): inside the table area, a left-aligned block with a small illustration, the headline "Start by adding a service", and the body "To provision a service, click Add service". The page's primary "Add a service +" stays in the toolbar.
- Text rules:
  - "Empty states should replace the element that would ordinarily show. For example, an empty state for a table would replace the table and the column headers and footer should not be present."
  - Elements are "left-aligned as a block" (LTR start).
  - Use one primary action. With several empty states on screen, use a tertiary button.
  - No-results states should "suggest adjusting the search or filters".
- **Error-management table (text):**
  - *Permissions issue*: "The user does not have permission to view the data." → "Suggest steps or process to request access."
  - *Systems issue*: suggest steps, for example "viewing an activity log".
  - *Configuration required*: explain, and give the first configuration step.
  - Errors use "plain language (no codes)".
- [`carbon-error-system-1440`](a3/carbon-error-system-1440.jpg): "Something's wrong / We were unable to connect to the service. Click Retry to try again or View Log to learn what happened." Primary "Retry" plus the link "View log".

**Carbon: Loading** (text, …/patterns/loading)
- Skeletons only on container and data components (tables, tiles, cards), "for only a few seconds". Never on toasts, menus, modals or loaders. Buttons and inputs don't need them.
- Use a progress indicator when a process takes more than a moment. Progressive loading works in phases.

**Primer** (https://primer.style/product/ui-patterns/{loading, degraded-experiences}/)
- [`primer-loading-states-1440`](a3/primer-loading-states-1440.jpg): staged loading of one card: 1. skeleton → 2. text → 3. actions → 4. images.
- [`primer-degraded-banner-1440`](a3/primer-degraded-banner-1440.jpg): a partial outage shows a yellow banner above the normal UI: "Some content and actions may be unavailable. Try refreshing. If the problem persists, check the GitHub status page, or contact support."
- [`primer-form-submit-blocked-1440`](a3/primer-form-submit-blocked-1440.jpg): a form-level system error banner, shown under section 2.

**Shopify Index** ([`shopify-list-index-1440`](a3/shopify-list-index-1440.jpg)): the empty state ("Start creating puzzles") has an illustration, a one-line description, a secondary "Learn more" and a primary "Create puzzle".

### Implications for AWJ (candidates)
- **C4.1 One state contract per table/screen**, matching DESIGN_SYSTEM principle 5. Each table defines:
  - *first-use empty*: what this list is for, plus one primary create action
  - *no results*: "لا نتائج مطابقة" plus "مسح الفلاتر"
  - *loading*: a skeleton of the real column layout
  - *error*: plain-language Arabic text, "إعادة المحاولة", and a support/reference ID shown secondarily
  - *permission denied*
  - *app disabled/suspended*
- **C4.2 Permission denied.**
  - Say what is restricted and who can grant access (Carbon). Example: "ليست لديك صلاحية عرض القيود. اطلب من مالك المنشأة أو المدير منحك صلاحية «الحسابات — عرض»."
  - This is a different state from AWJ's `EnsureApplicationActive` *suspended* (read-only) and *disabled* states, which need their own wording.
- **C4.3 Empty replaces the table body, not the page chrome.** Keep the toolbar (with filters, so that no-results can be cleared), but drop the column headers and footer for first-use empty (Carbon).
- **C4.4 Degraded banner.** When one widget or panel fails, show an inline banner at that panel and keep the rest usable (Primer). No full-page error for partial failures.
- **C4.5 Skeleton only for data regions.** Buttons, dialogs and toasts never get skeletons (Carbon). Long operations such as import, posting a batch, or report generation get a progress indicator with counts.

### Not adopted / caution
- **Illustrations** (Carbon cube, Shopify puzzle art) conflict with "no decoration". Candidate: text plus a bare muted Lucide icon at most.
- **Left-aligned empty blocks** (Carbon) become start-aligned in RTL. Avoid centring everything, which is also an AWJ "AI design tell".
- **"View log" links to raw logs** suit an IBM ops audience, not accountants. Show a reference ID instead.

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 5. Settings pages: sectioned settings centre (مركز الإعدادات)

### External Evidence

**Zoho Books settings** (real product, [`zoho-settings-orgprofile-1440`](a3/zoho-settings-orgprofile-1440.jpg), https://www.zoho.com/us/books/help/settings/organization/organization-profile.html)
- **Dedicated settings shell.** "‹ Back to All Settings" at the top start and "Close Settings ×" at the top end. A left settings nav has its own **Search** box.
- Nav groups:
  - Organization ▾, which expands to Profile (active), Branding, Custom Domain, Branches, Currencies, Approvals, Opening Balances, Manage Subscription
  - Taxes & Compliance ›
  - Users & Roles ›
  - Preferences ›
  - Sales ›
  - Purchases ›
  - Items ›
  - Online Payments ›
  - Customisation ›
  - Reminders & Notific… ›
  - Automation ›
- **Content:** page title "Organization Profile"; a logo uploader with constraints ("240 × 240 pixels @ 72 DPI, Maximum File Size: 1MB"); side-labelled fields with required fields in red with "*".
  - An info callout explains *why* an address field moved: "Since Branches has been enabled… Go to Branches ›".
  - A toggle row uses "Yes" plus a switch.

**Shopify Settings template** (live render)
- [`shopify-settings-template-1440`](a3/shopify-settings-template-1440.jpg): a single centred column (~630 px wide in the preview) of **section cards**: "Store Information" (text fields + radio group "Primary currency"), "Notifications" (select + checkbox group) and "Connected accounts" (a status line "No account connected" + "Connect").
- The text says the template "organizes related options into logical groups" and "leverages the Save Bar API to protect unsaved changes", with a Toast "Settings saved successfully".
- [`shopify-settings-template-390`](a3/shopify-settings-template-390.jpg): the same cards stack full-width on mobile, with labels inside inputs.

**Daftra** (text, docs.daftra.com navigation)
- Global settings categories: إعدادات الضرائب، طرق الدفع، إعدادات الترقيم المتسلسل، إعدادات SMTP، إدارة التطبيقات، إدارة التطبيقات الخارجية، الرسائل النصية SMS، الفروع، القوالب.
- Module-level settings sit inside each module: إعدادات المبيعات، إعدادات المشتريات، إعدادات الموردين، إعدادات المخزون والمنتجات.

**Primer** ([`primer-saving-sections-1440`](a3/primer-saving-sections-1440.jpg)): a settings page with several sections, each saved by its own named button.

### Implications for AWJ (candidates)
- **C5.1 Settings centre shell.** Use `/settings` with a secondary nav at the start containing search plus groups that mirror the module map. Candidate groups:
  - المنشأة (الملف، الفروع، الاشتراك)
  - الضرائب وZATCA
  - المستخدمون والأدوار
  - المالية
  - المبيعات
  - المشتريات
  - المخزون
  - الترقيم
  - القوالب والطباعة
  - التطبيقات
  - Module screens keep a "الإعدادات" deep link into the right group (Daftra places module settings with the module).
- **C5.2 One form per section, saved explicitly**, with a dirty-state save bar (Shopify) or a per-section named save (Primer). Do not combine one global save with auto-saving toggles (Primer: "never mix save patterns in a single form").
- **C5.3 Explain dependencies inline.** When a setting is governed elsewhere, as with "since Branches is enabled…", show an info callout with a link (Zoho). This matches AWJ's configurable-policies rule, which requires stating the default and its effect on existing tenants.
- **C5.4 Guarded settings.** Settings that are irreversible or have regulatory impact live in a separate "منطقة حساسة" block at the end of the section, with typed confirmation (see section 8). Examples: ZATCA ICV scope, which is guarded in AWJ, and the numbering reset.
- **C5.5 Mobile.** Section cards stack, and the settings nav becomes a list → detail drill-down. No side-by-side panes.

### Not adopted / caution
- **Zoho's red required labels and side labels** (see section 2).
- **Daftra's numbering reset** ("غيّر الرقم التالي إلى 1" after deleting test invoices) is a sensitive action. In AWJ, numbering is derived from `GeneratesDocumentNumbers` (`max()+1`), and the ZATCA ICV is separate and guarded. Any "next number" setting needs an explicit accounting/ZATCA review.

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 6. Reports: analysis-first (التقارير)

### External Evidence

**Business Central: analysis mode** (real product, https://learn.microsoft.com/en-us/dynamics365/business-central/analysis-mode)
- [`bc-report-analysis-overview-1440`](a3/bc-report-analysis-overview-1440.jpg) ("Customer Ledger Entries"):
  - Analysis tabs ("Analysis 1 ▾", "+" for a new analysis) above a dense grid.
  - Numeric columns are right-aligned, with negatives shown as "-13,478.43".
  - A totals row sits under the grid. A footer bar reads "Rows: 415 | Total Rows: 415".
  - Vertical side tabs at the end open the "Columns" and "Analysis Filters" panes.
- [`bc-report-analysis-totalsrow-1440`](a3/bc-report-analysis-totalsrow-1440.jpg): after selecting cells, the footer shows "Rows: 53 of 67 · Total Rows: 67 · Filtered: 53 · Average: 3,286.25 · Count: 6 · Min: 1,586.25 · Max: 7,931.24 · Sum: 19,717.49".
- Per the page's image captions, an analysis can be copied as a link ("copy link dialog for an analysis view") and exported to Excel. These two screens were not captured.

**Zoho Books reports** (real product)
- [`zoho-report-customize-1440`](a3/zoho-report-customize-1440.jpg) (https://www.zoho.com/us/books/help/reports/manage-reports.html):
  - Report toolbar: period selector "This Month ▾", "Customize Report", a status chip "Report has been scheduled", share, print ▾, "Export As ▾".
  - Centred title block: organisation, "Profit and Loss", "Basis: Accrual", "From 01 May 2023 To 31 May 2023".
  - Columns: Account / Account Code / Total. Amounts are **blue links** that drill down. "+ Add Temporary Note" is available.
- [`zoho-report-aging-1440`](a3/zoho-report-aging-1440.jpg) (https://www.zoho.com/us/books/help/reports/receivables.html):
  - "Ageing Details By Invoice Due Date — As of 10/08/2018".
  - Rows are grouped by bucket ("> 45 Days", "31 - 45 Days", … "Current"), each with a subtotal row, and a final "Total". Status "Overdue" is shown in red text.
- [`zoho-report-aging-filters-1440`](a3/zoho-report-aging-filters-1440.jpg): the "Customize Report" panel has General and Show/Hide Columns tabs.
  - Fields: As of; Aging By; "Aging intervals 4 intervals of 15 Days"; Group By; Show By; checkboxes "Include Credit Notes" and "Include Manual Journals".
  - Buttons: "Run Report" and "Cancel".

**Daftra P&L, Arabic RTL** (marketing mockup, [`daftra-report-pnl-ar-1440`](a3/daftra-report-pnl-ar-1440.jpg), from https://www.daftra.com/برنامج-الحسابات-العربي/)
- The organisation block (logo, address, C.R.) sits on the right. The title "بيان الأرباح والخسائر" sits on the left, with "السنة المالية: 01/07/2023 : 30/06/2023", "فرع الحسابات: جميع الفروع" and "الفروع: جميع الفروع".
- Columns are **periods** ("يوليو 2022 : سبتمبر 2022" … "يوليو 2023 : الآن").
- Sections: الإيرادات / المصروفات, with "إجمالي …" rows on a tinted background.
- Negatives are **red in parentheses**, e.g. "(1,561,953.46)". The currency suffix "ج.م" appears only on total rows. Digits are Western Arabic.

**Foodics** (marketing mockup, [`foodics-report-kpi-ar-1440`](a3/foodics-report-kpi-ar-1440.jpg), https://www.foodics.com/ar/): Arabic KPI rows (الطلبات 1,988 · صافي المبيعات 100,959 · صافي المدفوعات 114,980 …) with the label on the right and the number on the left. Digits are Western Arabic.

### Implications for AWJ (candidates)
- **C6.1 Report header contract.** Title, then a **scope line** (period / as-of date, basis, branch scope "جميع الفروع" or a named branch, currency), then the toolbar: period presets, filters, compare, export (Excel/PDF), print preview as a separate action (DESIGN_SYSTEM principle 7).
- **C6.2 Summary before detail.** KPI or totals strip first, then grouped detail with subtotal rows and a grand total (Zoho aging, Daftra P&L).
- **C6.3 Drill-down.** Every amount links to the ledger lines that produced it (Zoho blue amounts). AWJ can drill to the journal entry and then the source document.
- **C6.4 Selection statistics footer.** Selecting cells shows Count / Sum / Avg / Min / Max, plus a "Rows: x of y / Filtered" counter (BC). Cheap to build and high value for accountants.
- **C6.5 Saved report configurations** (a view equals filters + grouping + columns), same model as C1.4. Scheduling and email are a later step (Zoho shows "Report has been scheduled").
- **C6.6 Period columns.** Comparative periods appear as columns (Daftra quarters). Column headers state the full range.
- **C6.7 "Customize report"** opens as a side sheet with the report's own parameters (Zoho), not a generic filter builder. Example: aging buckets as count × days.
- **C6.8 Accounting display rules.**
  - Negatives get a sign and red together (AWJ: "السالب أحمر مع إشارة"). Choose between parentheses (Daftra, accounting convention) and a minus (BC) per report family, as a documented policy.
  - Currency sign only on totals or the column header, not every cell (Daftra), using `𞸁`.

### Not adopted / caution
- **Centred printed-style title blocks on screen** (Zoho P&L) push the analysis below the fold. AWJ principle 7 keeps the A4-style layout for "معاينة التقرير" only.
- **Blue link colour for every amount** competes with AWJ's single brand colour. Show drill-down affordance on hover/focus with an underline, not colour on every number.
- **Currency text "ج.م" / "ر.س"** (Daftra, Daftra POS) is forbidden in AWJ UI. Use `U+20C1` via `formatRiyal` only.
- **Charts** (Zoho chart view, Foodics KPI sparklines) are optional, not the default report body.

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 7. POS (نقطة البيع)

### External Evidence

**Daftra POS, Arabic RTL** (marketing mockup, [`daftra-pos-cart-ar-1440`](a3/daftra-pos-cart-ar-1440.jpg), https://www.daftra.com/برنامج-إدارة-نقاط-البيع/)
- The **cart is on the right** (RTL start). The product grid is on the left.
- Top of the cart:
  - **Multiple parked orders as tabs** ("#26 09:23 ص", "#27 09:43 ص", "#28 09:52 ص") with "»" scrolling and a green "+" for a new order.
  - The customer row (name + phone) carries a loyalty-points chip ("★ 2500 (150.00)").
- Cart lines:
  - Quantity and unit at the far right, then the item name plus SKU/serial ("س.ن 256332560071") and a "السعر:" sub-line. Discount appears as a sub-line ("الخصم: 200.00" with "-200.00").
  - The **line amount sits at the far left**.
- Totals block: المجموع الفرعي، الضرائب، الخصم، الشحن. Next to it "العناصر 12" and "الإجمالي: 6,119.00" in large green. Amounts carry a riyal-sign glyph.
- **Line action bar:** الكمية (active) · % الخصم ▾ · السعر · delete (red icon). Below it a full-width green "**الدفع**" button with a "▾" split.
- Product side:
  - Search "ابحث عن المنتجات بالاسم أو الرمز" with a barcode/scan icon, plus "جميع الفئات" and "المنتجات ▾" selectors.
  - Coloured category tabs: العروض، أجهزة لابتوب، الشاشات، الطابعات، الإكسسوارات.
  - Product tiles with image, name and price.
- [`daftra-pos-totals-ar-800`](a3/daftra-pos-totals-ar-800.jpg) (handheld terminal): "تفاصيل الطلب" with المجموع الفرعي 2,200.00 ر.س، الخصم -10.00، الضرائب: الضرائب العددية 100.00، ضريبة القيمة المضافة 500.00، **المبلغ المستحق: 2,790.00 ر.س**.

**Daftra POS docs** (text)
- https://docs.daftra.com/tutorial/إنشاء-فاتورة-من-شاشة-البيع/:
  - Tap products to add them. The bottom buttons are الكمية، السعر، خصم$ (amount)، خصم% (percent)، الشحن، إزالة. Then "عملية دفع" (payment) → "تأكيد".
  - "Barcode scanners can add products directly; scanning the same barcode again increases its quantity."
  - Default customer "POS Client"; a customer can be added or selected from an icon at the top.
- https://docs.daftra.com/tutorial/غلق-جلسة-البيع/: **session close is separate from confirmation.**
  - Closing stops sales.
  - Confirmation shows one row per payment method with **المبلغ المتوقع / المبلغ المستلم / الفرق** (shortage/overage) and, for cash only, "مسلم إلي" (a treasury or an employee, who must enter a password).
  - Confirmation creates the entries, for example Dr الصندوق / Cr عهدة الموظف (الكاشير) 115.00.
  - Non-cash amounts go to the treasury or bank linked to the payment method.

**Shopify POS** (product render, https://shopify.dev/docs/api/pos-ui-extensions/latest/targets)
- [`shopify-pos-cart-1440`](a3/shopify-pos-cart-1440.jpg) (iPad, LTR):
  - A left icon rail. A **search field with a barcode-scanner icon inside it**.
  - Product tiles with stock-count badges ("36", "32"). Action tiles: Add custom sale, Manage discounts, Ship all items, Attribute staff, Save draft, Email to customer, Add gift card, "+ Add tile".
  - Cart on the right: "Cart", "Select all", "•••", a trash icon, "Add customer", and lines with checkbox, thumbnail, name, variant and price.
  - Selecting a line opens a bottom sheet with a quantity stepper (trash · 1 · +) and Apply custom discount, Attribute staff, Ship item, Manage taxes, View details.
- [`shopify-pos-postpurchase-1440`](a3/shopify-pos-postpurchase-1440.jpg) (after payment): "Print" and "Gift receipt" buttons; "More actions": Add customer +, Add note +; a full-width primary "Done". The cart summary shows Subtotal $40.00, Taxes $4.00 and **Total $44.00** in larger type.

### Implications for AWJ (candidates)
- **C7.1 Layout (RTL).** Cart pane at the start (right), catalogue at the end (left), as in Daftra. Cart totals and the pay button are pinned at the bottom of the cart pane. The pay button is the single largest touch target.
- **C7.2 Scan-first search.** One field accepts a barcode or name/SKU, with a scan affordance inside it (Shopify, Daftra). A repeat scan increments quantity (Daftra). Scanner input works without focus juggling.
- **C7.3 Line editing.** Select a line, then use a contextual action bar or sheet: quantity stepper, price (permission-gated), discount amount or percent, remove (Daftra + Shopify).
- **C7.4 Parked orders as tabs** with time stamps (Daftra) to serve several customers at once.
- **C7.5 Payment step.** Split tender by payment method, "المبلغ المستحق" prominent, change due. The receipt screen offers طباعة / إرسال / إيصال هدية and a clear "تم" that starts the next sale (Shopify post-purchase).
- **C7.6 Session close and confirm as two steps** (Daftra): expected vs received vs difference per payment method, with a cash handover target. This maps to AWJ `PosSession` and cash/treasury accounts. The resulting entries go through `LedgerService` only.
- **C7.7 Touch sizing.** Tiles and action buttons at touch size (≥44–48 px). This is a separate density mode from back-office tables.

### Not adopted / caution
- **Colour-coded category tabs and a green total/pay button** (Daftra) conflict with "one brand colour". A candidate POS exception: the pay button may use the brand primary. Semantic green stays for success only.
- **Product photos** are optional per tenant (60+ activities). Many retail and fuel tenants work text-and-SKU only.
- **"ر.س" text** (Daftra handheld) is forbidden. Use `𞸁`.
- **Daftra "إلغاء تأكيد" deletes the confirmation entries** ("فتُحذف قيود تأكيد الجلسة"). In AWJ, un-confirming must produce reversing entries, not deletions (immutability rule).
- **Free price editing at POS** must be permission-gated and policy-controlled (configurable-policies rule). Daftra documents restricting it as an FAQ.

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## 8. Destructive confirmations (تأكيد الإجراءات الهدّامة)

### External Evidence

**Primer: Delete scenario pattern** ([`primer-delete-friction-1440`](a3/primer-delete-friction-1440.jpg), https://primer.style/product/scenario-patterns/delete/)
- "**Match friction to the cost of a mistake.**"
  - Do: "Place high-impact deletions in a danger zone within settings, and keep low-impact deletions inline or in a contextual menu."
  - Do: "Use type-to-confirm for org-wide or repo-wide impact, a simple dialog for single resources, and no confirmation for reversible actions."
  - Do: "Reserve type-to-confirm for irreversible actions with wide blast radius."
- "**Prefer reversibility over confirmation**": offer an undo window, and "For high-value resources with dependencies, offer a reversible 'Disable' step alongside permanent 'Delete'."
- "**Make the consequences clear**":
  - "Name what's affected and whether it's permanent, like 'Delete label?'". Don't use "Are you sure?".
  - Label the button with the action ("Delete repository"), never "Yes", "OK" or "Confirm". The one exception is type-to-confirm: "I understand, delete this project".
  - "Say 'Remove' when the thing still exists elsewhere, and 'Delete' when it's permanently destroyed."
- Implementation:
  - `role="alertdialog"`. The danger button pairs colour with a clear label.
  - A loading state on confirm. After deleting the page's main resource, redirect to the parent list.
  - "When a deletion fails, keep the dialog open and show a Banner variant='critical' inside it."
  - "Don't add a visible success banner by default".

**Primer: ConfirmationDialog** (live demo opened by clicking "Delete product")
- [`primer-confirm-danger-1440`](a3/primer-confirm-danger-1440.jpg): a small dialog with the title "Delete product", a close ×, the body "Are you sure you want to delete this product? This action cannot be undone.", and "Cancel" + "Delete" (red text) at the bottom end.
- [`primer-confirm-danger-390`](a3/primer-confirm-danger-390.jpg): the same dialog at nearly full width on mobile; buttons stay side by side.
- Guidelines text (https://primer.style/product/components/confirmation-dialog/guidelines/):
  - The danger example is titled "Delete repository?" with `confirmButtonContent="Delete repository"`. Its body reads: "This will permanently delete the "my-repo" repository, including all files, commit history, and issues. This action cannot be undone."
  - "When not to use": low-risk or easily undone actions, and frequent actions ("this creates fatigue").
  - The demo's own copy is generic ("Are you sure…"), which contradicts the scenario guidance. Note this when citing the demo.

**Carbon: Dialogs pattern** (text, https://carbondesignsystem.com/building-blocks/core/patterns/dialogs)
- "Both the title and the button should reflect the action that will occur. If the action is destructive or irreversible then use a transactional danger modal."
- "Use descriptive words for the actions like Add, Delete, Save and avoid vague words like Done or OK."
- "One modal should never trigger another modal."

**Material 3: Dialogs** ([`m3-dialog-buttons-rtl-390`](a3/m3-dialog-buttons-rtl-390.jpg), https://m3.material.io/components/dialogs/guidelines)
- "Buttons are aligned to the trailing edge… The confirmation button is always closest to the edge."
- "**Button alignment responds automatically for right-to-left languages, where the confirmation button is aligned to the left edge.**"
- "Disable confirming actions until a choice is made. Dismissive actions are never disabled."

**Shopify index-table** (text): bulk delete modal with heading "**Delete 2 puzzles?**", body "Are you sure you want to delete the selected puzzles? This action cannot be undone.", primary "Delete" in `tone="critical"` and secondary "Cancel". Completion feedback is a Toast ("2 puzzles archived").

**Zoho Books** (real product)
- Delete text: payments must be deleted first. "Once you delete an invoice, you will not be able to retrieve it again." The confirm button is labelled "**Delete it**". A Pro Tip suggests Void instead.
- [`zoho-confirm-writeoff-1440`](a3/zoho-confirm-writeoff-1440.jpg): the "Invoice Write Off" dialog requires a date (calendar) and "**Reason***" ("Payment not received"). Buttons: "Write it off" (red) and "Cancel". Void also asks for a reason ("Void it").

**Daftra** (text, https://docs.daftra.com/tutorial/حذف-الفواتير-التجريبية-والبدء-من-جديد/)
- Bulk delete → "ستظهر رسالة تأكيد، اضغط نعم".
- Deleted invoices go to a **recycle bin for 90 days**. "حذف نهائي" from the bin "لا يمكن التراجع عنه".
- Blocked deletions show specific messages, for example:
  - «لا يمكن حذف فاتورة رقم ### لارتباطها بمرتجعات أو إشعارات دائنة أو إشعارات مدينة. يرجى حذف المستندات المرتبطة أولاً.»
  - «لا يمكنك إضافة أو تعديل أو مسح حركة في هذا اليوم ####، ضمن فترة مقفلة».
- With Saudi e-invoicing enabled, an issued invoice cannot be deleted; the remedy is a credit note or return.

### Implications for AWJ (candidates)
- **C8.1 Friction tiers.**

  | Tier | Applies to | Confirmation |
  |---|---|---|
  | T0 | Reversible, low impact (remove a filter chip, unlink a tag) | None; undo toast |
  | T1 | Single draft record (delete draft invoice) | Simple dialog: "حذف المسودة INV-…؟" plus the consequence line, and a "حذف المسودة" button |
  | T2 | Posted or accounting-affecting actions (cancel a posted invoice, reverse a journal entry, write-off) | Dialog naming the effect ("سيُنشأ قيد عكسي بتاريخ …"), with a **required reason** (Zoho) and an action-named button ("إلغاء الفاتورة بقيد عكسي") |
  | T3 | Irreversible, wide blast radius (close a fiscal year, delete a branch or warehouse, purge, change ZATCA scope, reset numbering) | **Typed confirmation**: type the document number, branch name or a fixed phrase, with an explicit summary of affected records |

- **C8.2 Wording rules (AR/EN).**
  - The title is a question naming the object ("حذف العميل «شركة …»؟"). The body states what happens and whether it can be undone. The button repeats the verb.
  - Never «نعم» / «موافق» / OK, contrary to Daftra's «نعم».
  - Use «إزالة» for unlinking and «حذف» for destroying (Primer remove vs delete).
- **C8.3 Blocked-delete messages** name the blocker and the next step (Daftra's messages are a good model). Example: «لا يمكن حذف المنتج لوجود حركات مخزون. عطّله بدلاً من ذلك.» This aligns with AWJ's existing "disable instead of delete when used" rules (PaymentMethod, settlement types).
- **C8.4 Disable before delete** for referenced master data (Primer "Disable" alongside "Delete").
- **C8.5 Dialog mechanics.**
  - `role="alertdialog"`, with initial focus on the dismissive action for T2/T3.
  - Confirm-button loading state. Errors are shown inside the dialog without closing it (Primer).
  - Never stack dialogs (Carbon).
  - In RTL the confirming button sits at the dialog's trailing (left) edge (M3). Mobile uses a near-full-width dialog or a bottom sheet.
- **C8.6 Feedback.** Removal from the list, or a redirect to the parent list, plus a polite live-region announcement. A toast only when the result is off-screen (Primer, Shopify).

### Not adopted / caution
- **Daftra «اضغط نعم»** generic confirmations are explicitly rejected by Primer and Carbon guidance.
- **Recycle bin with restore for accounting documents** (Daftra 90 days): in AWJ posted documents are never deleted, so a bin applies, if ever, only to drafts and master data. Restore semantics would need a separate decision.
- **Deleting invoices together with their journal entries** (Daftra, Zoho) is forbidden under AWJ's immutability rule. Cancellation is a reversal.
- **Red text-only "Delete" buttons** (Primer demo, Shopify header) must keep the explicit verb label, because colour cannot be the only signal (AWJ principle 4).

---

> **AWJ Decision:** see A4 §2–§5 (rules, patterns, and «Not adopted»).

## Cross-cutting RTL observations (ملاحظات RTL)

- Only the Arabic sources (Daftra, Foodics) show real RTL product layout. All design-system references are LTR. Every placement rule taken from them must be mirrored by **logical** direction (start/end), not copied by physical side.
- M3 is the only reference that states mirroring explicitly, for dialog button alignment.
- The Daftra and Foodics Arabic mockups use **Western Arabic digits** (1,988; 6,119.00) with comma thousands separators inside Arabic UI.
- Numbers are **not consistently aligned** across the Arabic mockups: right in the P&L table cells, left in POS cart lines and KPI rows. AWJ should set one documented rule per context (table cells vs label/value pairs). See section 1, caution 4.
- Primer's DataTable text about alignment in "right-to-left writing systems" is ambiguous as written. Do not cite it as an RTL rule.

## Sources not reached or not used, and why

| Source | Result | Note |
|---|---|---|
| SAP Fiori Design Guidelines (experience.sap.com/fiori-design-web) | **Blocked**: the headless browser received "Access Denied" (Akamai edge, ref #18.ccddc017…) after a redirect to sap.com/design-system/… | Not retried or circumvented. List Report and Object Page floorplans remain unverified in this phase. |
| Odoo documentation (odoo.com/documentation/18.0/…) | **Blocked**: HTTP 403 to headless Chromium for the search and POS pages | Not circumvented. |
| Shopify Help Center (help.shopify.com POS manual) | **HTTP 403** | Used shopify.dev POS UI extension renders instead. |
| polaris.shopify.com | Redirects to shopify.dev "Polaris references" | Used the shopify.dev App Home templates and compositions, which is the current location. |
| Atlassian Design System patterns | `/patterns/empty-state` returned 404, and `/patterns` redirected to the Rovo UI overview | Not explored further; Carbon and Primer covered states. |
| Microsoft Business Central docs | Reachable, but most pages are text-only (icons only) and several guessed URLs returned 404 | Only `analysis-mode` had UI screenshots. Other BC facts are from page text. |
| Daftra help centre | Reachable; the articles visited had no product screenshots (only a generic default image) | Used Arabic article text, plus marketing mockups from daftra.com for visuals. |
| Square POS, Toast, Stripe docs | Reachable | Square's checkout image is marketing (customer tap-to-pay) and was dropped; Square's register image was not located in a carousel; Toast and Stripe images were generic and not used. |
| Material 3 Lists | Page rendered almost no text headless | Not used. |
| Zoho Books index pages | No images; individual articles do have screenshots | Articles used. |

## Screenshot index (40 files, [`a3/`](a3/))

| Pattern | Files |
|---|---|
| 1 List / DataTable | shopify-list-index-1440 · shopify-list-indextable-390 · carbon-list-toolbar-1440 · carbon-list-search-1440 · carbon-list-batchactions-1440 · carbon-list-pagination-1440 · primer-list-numbers-right-1440 · primer-list-pagination-1440 |
| 2 Forms | carbon-form-anatomy-1440 · carbon-dialog-validate-1440 · primer-form-errors-1440 · primer-form-submit-blocked-1440 · primer-saving-sections-1440 · m3-dialog-basic-vs-fullscreen-1440 · shopify-detail-template-390 · shopify-settings-template-390 |
| 3 Document detail | zoho-detail-splitview-1440 · shopify-detail-template-1440 · shopify-detail-template-390 |
| 4 States | carbon-empty-table-1440 · carbon-error-system-1440 · primer-loading-states-1440 · primer-degraded-banner-1440 · shopify-list-index-1440 |
| 5 Settings | zoho-settings-orgprofile-1440 · shopify-settings-template-1440 · shopify-settings-template-390 · primer-saving-sections-1440 |
| 6 Reports | bc-report-analysis-overview-1440 · bc-report-analysis-totalsrow-1440 · zoho-report-customize-1440 · zoho-report-aging-1440 · zoho-report-aging-filters-1440 · daftra-report-pnl-ar-1440 · foodics-report-kpi-ar-1440 |
| 7 POS | daftra-pos-cart-ar-1440 · daftra-pos-totals-ar-800 · shopify-pos-cart-1440 · shopify-pos-postpurchase-1440 |
| 8 Destructive | primer-delete-friction-1440 · primer-confirm-danger-1440 · primer-confirm-danger-390 · zoho-confirm-writeoff-1440 · m3-dialog-buttons-rtl-390 |

The extracted page text used for the textual facts is kept in `a3/probe/*.txt` and `a3/text/*.txt` (Daftra articles in `text/daftra-articles.txt` and `text/daftra-pos.txt`).
