# تقرير التنفيذ — PR-9: POS Session & Cart Recovery

**التاريخ:** 2026-08-29  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-9 فوق أحدث `main` بعد دمج #559 (`d0e30dec`)

---

## 1. Audit + Gap Matrix

| Existing | Missing | Risk | Change |
|----------|---------|------|--------|
| `usePosActiveCarts` + مفتاح نطاق كامل | schema / TTL / scope داخل الحمولة | لقطة تالفة أو قديمة | `pos-cart-snapshot` v1 |
| استعادة multi-cart | toast استعادة | صمت بعد refresh | toast مرة واحدة |
| `GET /pos-sessions?mine=1` | revalidate عند visibility/online | بيع على جلسة مغلقة | `revalidateSession` |
| مؤشر شبكة في topbar | لا يمنع checkout | دفع offline | `usePosNetworkStatus` + تعطيل CTA |
| PR #559 attempt in-memory | ضياع المفتاح بعد crash؛ سلة مباعة قد تبقى | بيع مكرر / سلة مباعة تعود | `pendingAttempt` + `markSaleClearedSync` |
| `step=payment` غير مُخزَّن | — | — | بقي كما هو (لا auto-submit) |
| Held sales خادمي | — | نظام موازٍ | لم يُمس |
| لا endpoint استعادة سلة | — | — | **لا endpoint جديد** |

## 2. Recovery contract

- **Active session:** استعادة عبر `mine=1` فقط؛ عند الإغلاق عن بُعد → `sessionInvalid` + بوابة فتح وردية؛ بلا فتح تلقائي.
- **Unsold cart:** لقطة محلية بعد تحقق v/TTL/scope؛ ليست مدفوعة؛ شاشة الدفع لا تُستعاد كتنفيذ.
- **pendingAttempt:** يُحقن عبر `adopt()` عند التأكيد فقط لنفس `cartId` (عقد #559).
- **Multi-cart:** نفس البنية؛ بلا duplication.
- **Safety:** mismatch → مسح آمن؛ لا توكنات؛ الخادم حارس الأسعار عند checkout.

## 3. Why no financial side effect

- لا تغيير في `LedgerService` / VAT / مخزون / ترقيم / ZATCA / `PosService` محاسبياً.
- لا جدول مبيعات موازٍ ولا offline queue.
- اللقطة UX فقط؛ `POST /pos/checkout` يبقى المصدر المالي مع `idempotency_key` من #559.
- مسح sync بعد النجاح يمنع إعادة السلة المباعة دون إنشاء قيد.

## 4. Files changed (أبرزها)

**جديد:** `web/src/lib/pos-active-cart.ts`, `pos-cart-snapshot.ts`, `pos-network-status.ts`, اختبارات، `web/e2e/pos-session-cart-recovery.spec.ts`, هذا التقرير.

**محدّث:** `use-pos-active-carts.ts`, `pos/page.tsx`, `pos-payment.tsx`, `pos-topbar.tsx`, `pos-checkout-attempt.ts`, `ar.json`/`en.json`.

## 5. Tests

**محلياً (2026-08-29):**
- vitest: `pos-cart-snapshot` + `pos-checkout-attempt` + `use-pos-active-carts` → 17 passed
- vitest: `pos-topbar` + `pos-payment` → 7 passed
- `npm run build` → success
- Playwright desktop: `e2e/pos-session-cart-recovery.spec.ts` → passed

**Visual QA:** `docs/visual-qa/pr-9/` (RTL light/dark، mobile 390، restored، offline، closed session)

## 6. Known limitations

- لا استعادة سلة من جهاز آخر (لا SoT سلة حيّة على الخادم).
- ليس offline-first؛ offline يعطّل الدفع فقط.
- `pendingAttempt` TTL ساعتان؛ بعده مفتاح جديد عند إعادة الدفع يدوياً.
- لا service worker / sync engine (خارج النطاق).

## 7. Explicit

**NO MERGE / NO DEPLOY**
