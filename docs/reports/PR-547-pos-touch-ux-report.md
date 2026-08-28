# تقرير التنفيذ — PR-3: POS Touch UX

**التاريخ:** 2026-08-28  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-3 Touch UX (فوق PR #542 Interaction Foundation وPR #545 Keyboard Power Mode)

---

## 1. ملخص تنفيذي

تم تحسين أهداف اللمس والمسافات والوضوح في واجهة POS الحالية — **بدون** إعادة تصميم، **بدون** تغيير منطق مالي أو API، **بدون** إلغاء Keyboard Power Mode أو الماسح.

| البند | القيمة |
|--------|--------|
| **Pull Request** | [#547](https://github.com/safwan5001-source/Nebrax/pull/547) |
| **الحالة** | مفتوح إلى `main` — **غير مدموج** |
| **الفرع** | `cursor/pos-touch-ux-2ebb` |
| **HEAD SHA** | `d86772b8b66f2aa384646704ac6efdb6d679eecd` |
| **الأساس (base)** | `main` بعد دمج PR #545 (`01e38813`) |

> **ملاحظة تسمية الفرع:** المهمة اقترحت `feat/pos-touch-ux`؛ سياسة Cloud Agent فرضت `cursor/pos-touch-ux-2ebb`.

---

## 2. تحسينات اللمس

- الحد الأدنى المستهدف ~44–48px (`min-h-11` / `min-h-12` / `min-h-14` لـ CTA الدفع).
- `touch-manipulation` على الأهداف المتكررة لإزالة تأخير النقر المزدوج.
- حالة `active:` خفيفة من توكنات `primary-soft` / `border-primary` — بلا glow أو bounce أو scale.
- `hover:` بقي للماوس؛ الإجراء الأساسي لا يعتمد عليه.
- لا long-press، لا swipe-to-delete، لا لوحة أرقام جديدة للدفع.

---

## 3. بطاقة المنتج

مصدر العرض: [`web/src/components/pos/pos-product-tile.tsx`](web/src/components/pos/pos-product-tile.tsx)

- كامل البطاقة `button` يستدعي `addProduct` القائم (الضغط المتكرر يزيد الكمية كما كان).
- زر المفضلة: `min-h-11 min-w-11` مع `stopPropagation` حتى لا يضيف المنتج.
- `aria-selected` يبقى مشروطاً بـ `keyboardActive` من PR-2.
- الصورة ونسبتها وfallback `PosProductImage` لم تتغير.

---

## 4. التصنيفات

- الشريط الأفقي (جوال/تابلت): `touch-pan-x`، padding أوضح، `w-[76px]`، هدف صورة `h-11`.
- الشريط العمودي (سطح المكتب): `min-h-12` للحبة كاملة؛ الحالة النشطة `border-primary bg-primary-soft`.
- لا carousel ولا pagination.

---

## 5. سطور السلة

[`web/src/components/pos/pos-cart-line-controls.tsx`](web/src/components/pos/pos-cart-line-controls.tsx)

- السطر نفسه selectable عبر `onClick`/`onFocus` → `setSelectedLineKey` + `focusZone('cart')`.
- Quantity: `[-] [qty] [+]` بحجم `min-h-12 min-w-12` → `setQty` / `setQtyFromInput` القائمين.
- Delete: `min-h-12` مع `ms-2` و`stopPropagation` → `remove()` → `PosAuditReasonDialog` (لا حذف مباشر).
- وحدة القياس `min-h-10`؛ سعر/خصم `h-11`.
- زر الدفع: `min-h-14` + `disabled:pointer-events-none`؛ تلميح `F9` مخفي تحت `lg`.
- Hold / Note / Customer: `min-h-11` ثانوية.

---

## 6. Numeric Editor

[`web/src/components/pos/pos-numeric-editor.tsx`](web/src/components/pos/pos-numeric-editor.tsx)

- لم يُعد بناؤه. أزرار اللوحة `min-h-12` + `active:`.
- Cancel / Clear / Apply: `min-h-11`، وCancel مفصول بصرياً عن Apply.
- قواعد الرقم و`appliedRef` (منع double-apply) كما هي.
- **`show_onscreen_numeric_keypad` يبقى `false` افتراضياً** (سياسة مستأجر قائمة).

---

## 7. شاشة الدفع

[`web/src/components/pos/pos-payment.tsx`](web/src/components/pos/pos-payment.tsx)

- بطاقة الطريقة قابلة للنقر لتحديدها؛ حقل المبلغ `min-h-12`.
- المبالغ السريعة `min-h-11`.
- Confirm في footer وحده؛ الرجوع في الرأس.
- حراسة: `if (paying || !canConfirm || loading) return` قبل `onConfirm`.
- `disabled:pointer-events-none disabled:cursor-not-allowed`.
- لا keypad جديد هنا. لا تغيير عقد `onConfirm`.

---

## 8. Topbar والحوارات

- [`pos-topbar.tsx`](web/src/components/pos/pos-topbar.tsx): held / recent / session / overflow `min-h-11`. قائمة المزيد القائمة لم تُستبدل.
- [`pos-dialog.tsx`](web/src/components/pos/pos-dialog.tsx): إغلاق `min-h-11 min-w-11` و`max-h-[calc(100dvh-2rem)]`. Escape كما في الحوار العام.
- حوارات POS (عميل، معلّق، audit، سلات، ملاحظة، إغلاق وردية، مرتجع/استبدال/إيصال): تستخدم `PosDialog`؛ أزرار أساسية/ثانوية `min-h-11`.

> **تصحيح مراجعة:** `components/ui/dialog` العام أُعيد كما كان. تحسينات اللمس للحوار لم تُطبَّق على ERP.

---

## 9. تعايش اللمس والكيبورد والماسح

[`use-pos-keyboard-active.ts`](web/src/components/pos/interactions/use-pos-keyboard-active.ts)

| السلوك | التنفيذ |
|--------|---------|
| حلقات التحديد | تُطفأ عند أي `pointerdown` (`keyboardActive=false`) |
| `lastInput` / `isPointerSession` | من `pointerType` دون تصنيف جهاز دائم |
| `restoreFocusAfterUi` | لا يستدعي `restoreFocusSafe` بعد pointer |
| الماسح | لم يُمس؛ لا `scanCode` من tap المنتج |
| الاختصارات | سجل PR #545 كما هو |
| العودة للكيبورد | أول `keydown` يعيد `keyboardActive` فوراً |

---

## 10. الملفات المتغيّرة (18 ملفاً)

### جديد

```
web/src/components/pos/pos-product-tile.tsx (+ .test.tsx)
web/src/components/pos/pos-cart-line-controls.tsx (+ .test.tsx)
web/src/components/pos/interactions/use-pos-keyboard-active.test.ts
web/src/components/ui/dialog.test.tsx
```

### محدّث

```
web/src/app/(pos)/pos/page.tsx
web/src/components/pos/interactions/use-pos-keyboard-active.ts
web/src/components/pos/interactions/use-pos-focus-manager.test.ts
web/src/components/pos/pos-payment.tsx (+ .test.tsx)
web/src/components/pos/pos-numeric-editor.tsx (+ .test.tsx)
web/src/components/pos/pos-topbar.tsx
web/src/components/pos/customer-picker.tsx
web/src/components/pos/pos-held-sales-dialog.tsx
web/src/components/pos/pos-audit-reason-dialog.tsx
web/src/components/ui/dialog.tsx
```

**إحصاء diff:** +730 / −142 سطر.

---

## 11. الاختبارات

| الملف | التغطية |
|-------|---------|
| `use-pos-keyboard-active.test.ts` | pointer يطفئ الحلقات؛ touch ثم keydown؛ mouse/pen؛ `shouldRestorePosFocus` |
| `use-pos-focus-manager.test.ts` | تعايش: لا فرض تركيز البحث بعد pointer |
| `pos-product-tile.test.tsx` | tap يضيف؛ التكرار؛ المفضلة لا تضيف؛ `aria-selected` |
| `pos-cart-line-controls.test.tsx` | تحديد السطر؛ +/- → callbacks؛ delete → `onRemove` لا splice |
| `pos-numeric-editor.test.tsx` | أهداف اللوحة؛ Cancel؛ double-apply القائم |
| `pos-payment.test.tsx` | اختيار طريقة باللمس؛ confirm معطّل/paying inert |
| `dialog.test.tsx` | إغلاق باللمس + Escape |
| اختبارات PR-1/PR-2 في `interactions/` | خضراء دون تعديل اختصارات |

### نتائج الفحوص

| الفحص | النتيجة |
|-------|---------|
| `npm run test` | **864** اختباراً في **149** ملفاً — **كلها خضراء** |
| `npm run build` | **ناجح** (يتضمن TypeScript check) |
| `npm run lint` | **N/A** — لا ESLint config غير تفاعلي (نفس PR-2) |
| Web CI (`web build`) | **pass** |
| PHP CI (`sqlite` + `pgsql`) | **pass** |
| Vercel Preview | **fail بيئي** — `Deployment rate limited — retry in 24 hours` (حد حساب Vercel، ليس خطأ بناء) |
| GitHub required checks | **0 فشل مطلوب** — Vercel ليس فحصاً إلزامياً |

---

## 12. التحقق اليدوي / المتصفّح

**لم يُشغَّل معاينة متصفّح لنقطة البيع.** البيئة لا تملك جلسة كاشير مصادَقة، و`/pos` محمي ببوابة وردية.

ما تم التحقق منه منطقياً/بالاختبارات:

- RTL/LTR: لم تُمس خصائص منطقية (`start`/`end`)؛ شبكة المنتجات كما هي.
- Light/Dark: توكنات `primary` / `primary-soft` / `border` فقط.
- Mobile layout القائم (`mobileTab`، bottom nav، FAB) لم يُكسر تخطيطه.
- Viewports (1366×768، 1024×768، 834×1194، 390×844): **لم تُفحص بصرياً في متصفح**. لا ادّعاء فحص بصري.

---

## 13. نطاق محفوظ (لم يُمس)

- Backend / Laravel / migrations / API
- Checkout / taxes / totals / discounts / payment allocation
- ZATCA / inventory posting / sessions backend
- Audit contracts (مسار `remove()` القائم فقط)
- اختصارات PR #545
- Hybrid / Interaction settings / Command palette
- تفعيل keypad افتراضياً

**لا قيد محاسبي جديد.**

---

## 14. خارج النطاق (مسجّل فقط — لم يُصلَح)

1. **`page.tsx` monolith** — ما زال كبيراً؛ الاستخراج presentational فقط (`PosProductTile` / qty controls).
2. **`Dialog` close `aria-label` ثابت «إغلاق»** — سابق لهذه PR؛ يظهر حتى في واجهة إنجليزية.
3. **حوارات متكدّسة + Esc** — سلوك قائم قبل PR-3.
4. **Ctrl+N / Ctrl+Shift+O في Chrome** — من PR-2؛ البدائل `Ctrl+Alt+N/O` ما زالت قائمة.
5. **لا كاميرا باركود** ولا لوحة أرقام لشاشة الدفع.
6. تغيير `Dialog` المشترك — **صُحّح:** الحوار العام أُعيد كما كان؛ اللمس عبر `PosDialog` فقط.

---

## 15. المراحل اللاحقة (خارج PR-3)

- PR-4 — Hybrid / Adaptive Interaction
- PR-5 — Start Sale in dedicated browser tab
- Interaction Style settings / shortcut customization UI

---

## 16. روابط

- **PR:** https://github.com/safwan5001-source/Nebrax/pull/547
- **PR #545 (Keyboard):** https://github.com/safwan5001-source/Nebrax/pull/545
- **PR #542 (Foundation):** https://github.com/safwan5001-source/Nebrax/pull/542
- **Commit:** `d86772b8b66f2aa384646704ac6efdb6d679eecd`

---

*تم إنشاء هذا التقرير آلياً بعد اكتمال تنفيذ PR-3 — Nebrax Cloud Agent.*
