# تقرير التنفيذ — PR-4: Hybrid / Adaptive POS Interaction

**التاريخ:** 2026-08-28  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-4 فوق PR #542 (Foundation) وPR #545 (Keyboard) وPR #547 (Touch UX)

---

## 1. PR number

[#549](https://github.com/safwan5001-source/Nebrax/pull/549)

## 2. branch

`cursor/pos-hybrid-adaptive-2ebb`

> سياسة Cloud Agent فرضت البادئة `cursor/` واللاحقة `-2ebb` بدل اسم حر.

## 3. base SHA

`cc1bbe7fe3bdc5db6d6451ddb998c4fe5e6210f0` — `main` بعد دمج PR #547

## 4. HEAD SHA

تنفيذ الكود: `b03cbbfdd7a71adea4d8b8a97263bf0fdc88519d`  
رأس الفرع (يشمل هذا التقرير) يُحدَّث مع كل commit توثيقي؛ القيمة المعتمدة للمراجعة هي `git rev-parse HEAD` على `cursor/pos-hybrid-adaptive-2ebb`.

## 5. changed files

### جديد

```
web/src/components/pos/interactions/pos-input-modality.ts
web/src/components/pos/interactions/pos-input-modality.test.ts
web/src/components/pos/interactions/pos-hybrid-modality.test.ts
docs/reports/PR-549-pos-hybrid-adaptive-interaction-report.md
```

### محدّث

```
web/src/app/(pos)/pos/page.tsx
web/src/components/pos/interactions/use-pos-keyboard-active.ts
web/src/components/pos/interactions/use-pos-keyboard-active.test.ts
web/src/components/pos/interactions/use-pos-barcode-scanner.ts
web/src/components/pos/interactions/use-pos-barcode-scanner.test.ts
web/src/components/pos/interactions/use-pos-focus-manager.test.ts
web/src/components/pos/interactions/shortcut-registry.test.ts
```

لا ملفات Laravel / API / migrations.

## 6. summary

طُبّقت طبقة وسيلة إدخال واحدة (`keyboard` | `pointer` | `scanner`) تقرأها حلقات التحديد واستعادة التركيز والماسح. أحرف إسفين الباركود لم تعد تقلب الواجهة إلى Keyboard Mode. أول مفتاح تنقّل حقيقي يعيد وضع الكيبورد فوراً. تحسينات الجوال محدودة: إخفاء تلميح F4 تحت `lg`، `safe-area` للشريط السفلي، وحشوة حتى لا يقطع زر السلة العائم آخر صف منتجات.

لا شاشات أوضاع منفصلة، لا إعدادات تفاعل، لا تغيير خريطة اختصارات، لا تغيير عتبات الماسح، لا Backend.

## 7. exact interaction policy implemented

مصدر الحقيقة: [`pos-input-modality.ts`](../../web/src/components/pos/interactions/pos-input-modality.ts) عبر `usePosKeyboardActive`.

| الحدث | `lastInput` | `keyboardActive` | `shouldRestorePosFocus` |
|--------|-------------|------------------|-------------------------|
| سهم / Tab / Esc / Delete / F2–F9 / Ctrl\|Alt\|Meta / +/- الكمية | `keyboard` | `true` | `true` |
| `pointerdown` (touch / mouse / pen) | `pointer` | `false` | `false` |
| نمو مخزن الماسح أو اكتمال المسح | `scanner` | `false` | `false` |
| حرف قابل للطباعة أو `Enter` على جذر الصفحة | لا تغيير | لا تغيير | حسب القيمة السابقة |

تفاصيل:

1. **بعد لمس/ماوس:** لا حلقات تحديد، لا سحب تركيز إلى البحث بعد إغلاق حوار.
2. **أول مفتاح تنقّل:** يعيد Keyboard Power Mode من الضغطة الأولى (لا حاجة لضغطة تمهيدية).
3. **بعد مسح باركود:** الماسح مستقل؛ لا يُصنَّف ككيبورد؛ لا يسرق التركيز من حقل/حوار (الحراسة القائمة: `enabled: step === 'sale' && !dialogOpen` + `isPosEditableTarget`).
4. **بعد إغلاق حوار:** `restoreFocusAfterUi` يستدعي `restoreFocusSafe` فقط إذا `lastInput === 'keyboard'`. سلوك Esc لم يُغيَّر.
5. **التعايش:** تنقّل المنتجات/السلة ما زال مربوطاً بـ `desktopKeyboardNav` (`min-width: 1024px`). مستمع الماسح واحد على `window` عبر ref. لا متجر عام ولا Context جديد.
6. **الافتراضي:** Adaptive/Hybrid تلقائي. لا enum إعدادات `auto|touch|keyboard`.

## 8. what was intentionally NOT changed

- Laravel / API / migrations / RBAC / الاشتراكات
- checkout، الضرائب، الإجماليات، الخصم، تخصيص الدفع، ZATCA، المخزون، الوردية
- `shortcut-registry.ts` (خريطة F2/F4/F6/F7/F8/F9 وCtrl+N وCtrl+Shift+O وEsc)
- عتبات الماسح `POS_SCANNER_MIN_LENGTH` / `POS_SCANNER_MAX_GAP_MS`
- `components/ui/dialog.tsx` ونظام التصميم العام
- شاشة Touch مستقلة أو Keyboard مستقلة
- Settings UI لتفضيل التفاعل، ولا persistence
- Bottom sheet للسلة، إعادة بناء topbar، تبويب متصفح جديد (PR-5)
- لا قيد محاسبي جديد

## 9. test results

| الملف | التغطية |
|-------|---------|
| `pos-input-modality.test.ts` | مفاتيح التنقّل مقابل أحرف الماسح؛ استعادة التركيز للكيبورد فقط |
| `use-pos-keyboard-active.test.ts` | pointer يطفئ الحلقات؛ أول سهم يعيد الكيبورد؛ أحرف/Enter لا تقلب الوضع؛ `markScanner` |
| `use-pos-barcode-scanner.test.ts` | نشاط الماسح عند النمو والاكتمال؛ لا نشاط في حقل/تعطيل؛ ref بعد rerender |
| `pos-hybrid-modality.test.ts` | مسح بعد لمس لا يفعّل الكيبورد؛ السهم يعيده؛ خريطة الاختصارات ثابتة |
| `use-pos-focus-manager.test.ts` | لا فرض تركيز بعد pointer/scanner |
| `shortcut-registry.test.ts` | تجميد مفاتيح الربط |
| `use-pos-keyboard-shortcuts.test.ts` | حراسة الحوار والدفع كما هي |
| تنقّل السلة/المنتجات | لم يُكسر |

`npm run test`: **882** اختباراً في **151** ملفاً — كلها خضراء.

`npm run lint`: غير متاح كأمر مستقل غير تفاعلي بإعداد ESLint للمشروع؛ `next build` يتضمّن فحص الأنواع ونجح.

## 10. build result

`npm run build`: **ناجح** (Next.js 15.5.19، TypeScript OK).

## 11. visual/responsive verification status

**لم تُشغَّل معاينة متصفّح لنقطة البيع.** المسار `/pos` محمي بجلسة كاشير وبوابة وردية، والبيئة لا تملك بيانات دخول تشغيلية.

لم يُفحص بصرياً:

- 1366×768 / 1024×768 / 834×1194 / 390×844
- RTL + dark على جهاز حقيقي

ما يمكن تأكيده من الكود دون تخمين بصري:

- تلميح F4: `hidden lg:block` (كان `sm:block`)
- الشريط السفلي: `pb-[env(safe-area-inset-bottom)]`
- شبكة المنتجات: `pb-16 lg:pb-0` عند وجود سلة
- لا توكنات hex خام ولا تدرجات في هذا التغيير

## 12. risks

- تصنيف `+`/`-`/`=` كتنقّل كيبورد قد يُظهر حلقات إذا وُجدت هذه الرموز في باركود غير قياسي (نادر في التجزئة السعودية EAN/UPC).
- الكتابة البطيئة خارج الحقول ما زالت تمر على مخزن الماسح ثم تُهمل؛ كل حرف يعلّم `scanner` — مقصود حتى لا تُفعَّل حلقات الكيبورد من أحرف عابرة.
- `Enter` لا يفعّل Keyboard Mode؛ إضافة منتج بـ Enter بعد تحديد بالكيبورد تعمل لأن الوضع يكون `keyboard` مسبقاً من الأسهم.

## 13. follow-ups

1. **PR-5** — بدء البيع في تبويب متصفح مستقل (خارج النطاق هنا).
2. شاشة إعدادات أسلوب التفاعل (`auto|touch|keyboard`) إن طُلبت لاحقاً — ليست ضرورية اليوم.
3. Bottom sheet / درج سلة للجوال إن رُغب بوصول أوضح من FAB — يحتاج بنية أوسع.
4. تحقق بصري يدوي على جلسة كاشير حقيقية عبر الـ viewports أعلاه.
5. كاميرا باركود للجوال — خارج نطاق طبقات التفاعل الحالية.

## 14. confirmation

- no backend changes
- no API changes
- no financial logic changes
- no shortcut map changes
- no production deployment
- no merge

---

## روابط

- **PR:** https://github.com/safwan5001-source/Nebrax/pull/549
- **PR #547 (Touch):** https://github.com/safwan5001-source/Nebrax/pull/547
- **PR #545 (Keyboard):** https://github.com/safwan5001-source/Nebrax/pull/545
- **PR #542 (Foundation):** https://github.com/safwan5001-source/Nebrax/pull/542
- **Base:** `cc1bbe7fe3bdc5db6d6451ddb998c4fe5e6210f0`
- **HEAD (كود):** `b03cbbfdd7a71adea4d8b8a97263bf0fdc88519d`

---

*تم إنشاء هذا التقرير آلياً بعد اكتمال تنفيذ PR-4 — Nebrax Cloud Agent.*
