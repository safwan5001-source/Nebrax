# تقرير التنفيذ — PR-2: POS Keyboard Power Mode

**التاريخ:** 2026-08-28  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-2 Keyboard Power Mode (فوق PR #542 Interaction Foundation)

---

## 1. ملخص تنفيذي

تم تنفيذ **Keyboard Power Mode** فوق طبقة التفاعل المدمجة في PR #542، لتمكين الكاشير من تنفيذ أغلب تدفق البيع اليومي بلوحة المفاتيح والماوس — **بدون** إعادة تصميم POS، **بدون** تغيير منطق مالي أو API، **بدون** backend أو migration.

| البند | القيمة |
|--------|--------|
| **Pull Request** | [#545](https://github.com/safwan5001-source/Nebrax/pull/545) |
| **الحالة** | مفتوح إلى `main` — **غير مدموج** |
| **الفرع** | `cursor/pos-keyboard-power-mode-2ebb` |
| **HEAD SHA** | `e42f47c4fef7ce09a4f6fd0e6a98d977e3a0b125` |
| **الأساس (base)** | `main` بعد دمج PR #542 (`ad31b65b`) |

> **ملاحظة تسمية الفرع:** المهمة اقترحت `feat/pos-keyboard-power-mode`؛ سياسة Cloud Agent فرضت `cursor/pos-keyboard-power-mode-2ebb`.

---

## 2. نقطة البداية (Audit)

- PR #542 مدمج في `main` — طبقة `web/src/components/pos/interactions/` موجودة.
- **Bug مؤكد قبل PR-2:** F8 كان ينفّذ `setCart((c) => c.slice(0, -1))` ويتجاوز `remove()` / `PosAuditReasonDialog`.
- **Mismatch Esc:** واجهة الدفع تستخدم `requestPaymentCancel` بينما Esc من الكيبورد كان يستدعي `setStep('sale')` مباشرة.
- السجل القديم: مفاتيح F-function فقط، بلا modifiers ولا context guards.

---

## 3. الاختصارات النهائية

مصدر الحقيقة: [`web/src/components/pos/interactions/shortcut-registry.ts`](web/src/components/pos/interactions/shortcut-registry.ts)

| ID | الاختصار (عرض الشريط) | الإجراء | Footer |
|----|------------------------|---------|--------|
| `customer` | F2 | فتح اختيار العميل | نعم |
| `search` | F4 | تركيز حقل البحث | نعم |
| `heldSales` | F6 | فتح المبيعات المعلّقة | نعم |
| `holdSale` | F7 | تعليق البيع الحالي | نعم |
| `delete` | F8 | حذف السطر المحدد (مسار رقابي) | نعم |
| `payment` | F9 | فتح شاشة الدفع **فقط** (لا إتمام) | نعم |
| `newCart` | Ctrl+N | سلة جديدة | نعم |
| `openCarts` | Ctrl+Shift+O | قائمة السلات المفتوحة | نعم |
| `back` | Esc | رجوع من الدفع → `requestPaymentCancel` | نعم |

### بدائل المتصفح (في السجل، غير ظاهرة في الشريط)

| الاختصار | السبب |
|----------|--------|
| **Ctrl+Alt+N** | `Ctrl+N` قد يفتح نافذة متصفح جديدة في Chrome (غير قابل للـ override) |
| **Ctrl+Alt+O** | `Ctrl+Shift+O` قد يفتح مدير الإشارات المرجعية في Chrome |

### مفاتيح الترجمة الجديدة (`next-intl`)

| المفتاح | العربية | English |
|---------|---------|---------|
| `sc_held` | المبيعات المعلّقة | Held sales |
| `sc_hold` | تعليق البيع | Hold sale |
| `sc_new_cart` | سلة جديدة | New cart |
| `sc_open_carts` | السلات المفتوحة | Open carts |

---

## 4. تنقل لوحة المفاتيح (Keyboard Navigation)

### 4.1 البحث → النتائج

1. **F4** → تركيز حقل البحث.
2. المستخدم يكتب.
3. **ArrowDown** من البحث → أول منتج ظاهر (`focusZone('products')`).
4. **Enter** في البحث → السلوك الحالي محفوظ (مسح/إدخال barcode عبر `scanCode`).
5. **Esc** من البحث → `blur` فقط، **بدون** مسح النص تلقائياً.

### 4.2 شبكة المنتجات

- **ArrowRight / Left / Up / Down** — تنقل هندسي responsive (`grid-navigation.ts`) بلا عدّ أعمدة ثابت.
- **RTL:** الاتجاه الأفقي معكوس منطقياً (`locale === 'ar'`).
- **Enter** — إضافة المنتج المحدد (نفس `addProduct` بالنقر).
- **الحافة الأفقية** — انتقال إلى منطقة السلة (آخر سطر).
- **Visual:** `aria-selected` + `ring-primary/40` فقط عند `keyboardActive` (لا تأثير على اللمس).

### 4.3 السلة

- **ArrowUp / ArrowDown** — التنقل بين السطور.
- **+ / =** — زيادة كمية السطر المحدد.
- **- / _** — تقليل الكمية (حد أدنى 1).
- **Delete / F8** — `remove(selectedLineKey)` → `sensitiveAction` → `PosAuditReasonDialog`.
- **Fallback F8:** إن لم يُحدَّد سطر → آخر سطر (عبر `remove` الرقابي، لا `slice` مباشر).
- **إضافة barcode:** لا سرقة focus ولا انتقال تلقائي لمنطقة السلة.

---

## 5. Focus Zones

API في [`use-pos-focus-manager.ts`](web/src/components/pos/interactions/use-pos-focus-manager.ts):

| المنطقة | السلوك |
|---------|--------|
| `search` | `focusSearch()` |
| `products` | تركيز زر المنتج المحدد |
| `cart` | تركيز سطر السلة المحدد |
| `restoreFocusSafe()` | يرفض السحب من input قابل للتحرير أو `[role="dialog"]` |

**استعادة التركيز بعد:**

- إغلاق اختيار العميل
- تعليق بيع ناجح
- استرجاع بيع معلّق
- إلغاء الدفع (بعد تأكيد السبب)
- نجاح checkout

---

## 6. حماية الماسح / الدفع / الحوارات

### 6.1 Barcode Scanner Priority

- `usePosBarcodeScanner({ enabled: step === 'sale' && !dialogOpen })`
- عند التعطيل: لا buffer ولا callback.
- F-keys وCtrl shortcuts وArrow keys **لا** تدخل buffer الماسح (اختبار صريح).
- المفاتيح الوظيفية ليست `key.length === 1` فلا تُجمَّع كباركود.

### 6.2 Dialog Safety

[`pos-interaction-context.ts`](web/src/components/pos/interactions/pos-interaction-context.ts) — `isPosDialogOpen()` يفحص:

- `pickerOpen`, `retrieveOpen`, `returnOpen`, `exchangeOpen`
- `recentInvoicesOpen`, `openCartsOpen`, `clearCartOpen`, `noteOpen`
- `sensitiveActionOpen`, `closeOpen`, `unsavedExitOpen`
- `sessionGateOpen` (`sessionReady && !session`)

عند `dialogOpen === true`:

- اختصارات البيع والتنقل **محجوبة**.
- **Esc** لا يُلتقط من shortcut hook → يبقى لـ [`Dialog`](web/src/components/ui/dialog.tsx).

### 6.3 Payment Safety

- **F9:** يفتح الدفع فقط إن `cart.length > 0 && step === 'sale'`.
- **لا** shortcut لإتمام الدفع النهائي.
- أثناء `step === 'payment'`: الماسح معطّل، اختصارات السلة/المنتجات محجوبة.
- **Esc:** `requestPaymentCancel` (مسار رقابي عند وجود بنود).

---

## 7. Touch / Mobile

- تنقل الكيبoard: `enabled` فقط عند `min-width: 1024px` (`desktopKeyboardNav`).
- `keyboardActive`: حلقات التحديد تظهر بعد أول `keydown`، تُخفى عند `pointerdown`.
- `PosShortcuts`: `hidden lg:flex` — بدون تغيير layout الجوال.

---

## 8. الملفات المتغيّرة (22 ملفاً)

### جديد (9 ملفات مصدر + 5 اختبارات)

```
web/src/components/pos/interactions/
├── pos-interaction-context.ts (+ .test.ts)
├── grid-navigation.ts (+ .test.ts)
├── use-pos-product-navigation.ts (+ .test.ts)
├── use-pos-cart-navigation.ts (+ .test.ts)
└── use-pos-keyboard-active.ts
```

### محدّث

```
web/src/components/pos/interactions/
├── shortcut-registry.ts (+ .test.ts)
├── use-pos-keyboard-shortcuts.ts (+ .test.ts)
├── use-pos-barcode-scanner.ts (+ .test.ts)
└── use-pos-focus-manager.ts (+ .test.ts)

web/src/app/(pos)/pos/page.tsx
web/src/components/pos/pos-shortcuts.tsx (+ .test.ts)
web/src/messages/ar.json
web/src/messages/en.json
```

**إحصاء diff:** +1136 / −198 سطر.

---

## 9. الاختبارات

### جديد / محدّث (35+ في interactions)

| الملف | التغطية |
|-------|---------|
| `shortcut-registry.test.ts` | IDs، modifiers، i18n، عدم تكرار bindings |
| `use-pos-keyboard-shortcuts.test.ts` | F2–F9، Ctrl+N/O، حجب dialog/payment |
| `use-pos-barcode-scanner.test.ts` | `enabled: false`، F-keys، regression |
| `grid-navigation.test.ts` | RTL/LTR، up/down/left/right |
| `use-pos-product-navigation.test.ts` | Enter، ArrowDown من البحث |
| `use-pos-cart-navigation.test.ts` | arrows، +/-، Delete → callback |
| `pos-interaction-context.test.ts` | dialog/payment guards |
| `use-pos-focus-manager.test.ts` | zones، restoreFocusSafe |
| `pos-shortcuts.test.tsx` | 9 اختصارات footer × لغتين |

### نتائج الفحوص

| الفحص | النتيجة |
|-------|---------|
| `npm run test` | **848** اختباراً في **145** ملفاً — **كلها خضراء** |
| `npm run build` | **ناجح** (يتضمن TypeScript check) |
| `npm run lint` | **N/A** — لا ESLint config (يطلب إعداداً تفاعلياً) |
| Web CI (`web build`) | **pass** |
| PHP CI (`sqlite` + `pgsql`) | **pass** |
| Vercel Preview | **pass** |
| GitHub mergeable | **MERGEABLE** — بلا تعارضات |

---

## 10. نطاق محفوظ (لم يُمس)

- Backend / Laravel
- Migrations
- API contracts
- Checkout / taxes / totals / discounts / payment allocation
- ZATCA / inventory / sessions backend
- Returns / exchange business logic
- Audit event contracts (استُخدم المسار القائم فقط)
- Touch Mode / Hybrid / Interaction settings UI
- Command palette / shortcut customization

**لا قيد محاسبي جديد** — لا جدول للمراجعة قبل الدمج.

---

## 11. إصلاحات تفاعلية (Regression fixes)

| قبل PR-2 | بعد PR-2 |
|----------|----------|
| F8 → `slice(-1)` مباشرة | F8 → `remove()` → `PosAuditReasonDialog` |
| Esc من الدفع → `setStep('sale')` | Esc → `requestPaymentCancel()` |
| لا حجب للماسح أثناء الدفع | `enabled: false` أثناء payment/dialog |
| اختصارات مكررة بين hook و PosShortcuts | سجل واحد `POS_SHORTCUT_BINDINGS` |

---

## 12. ملاحظات خارج النطاق (مسجّلة فقط — لم تُصلَح)

1. **لا اختصار للمرتجعات** — F6 للمبيعات المعلّقة فقط؛ المرتجعات من الشريط العلوي.
2. **`page.tsx` monolith** — ~1584 سطر؛ التغيير wiring فقط (~120 سطر)، لا refactor واسع.
3. **`Dialog` stacked Esc** — عند تكدّس حوارات، Esc قد يغلق أكثر من واحد (سلوك قائم قبل PR-2).
4. **Ctrl+N / Ctrl+Shift+O في Chrome** — قد لا يعملان في متصفح سطح المكتب؛ البدائل `Ctrl+Alt+N/O` متاحة.

---

## 13. المراحل اللاحقة (خارج PR-2)

- PR-3 — Touch UX
- PR-4 — Hybrid / Adaptive Interaction
- PR-5 — Start Sale in dedicated browser tab
- Interaction Style settings / shortcut customization UI

---

## 14. روابط

- **PR:** https://github.com/safwan5001-source/Nebrax/pull/545
- **PR #542 (Foundation):** https://github.com/safwan5001-source/Nebrax/pull/542
- **Commit:** `e42f47c4fef7ce09a4f6fd0e6a98d977e3a0b125`

---

*تم إنشاء هذا التقرير آلياً بعد اكتمال تنفيذ PR-2 — Nebrax Cloud Agent.*
