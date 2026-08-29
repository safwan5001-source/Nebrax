# تقرير التنفيذ — PR-7: POS Interaction Mode Settings

**التاريخ:** 2026-08-28  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-7 فوق أحدث `main` بعد دمج #552 ثم #553/#555

---

## 1. PR number

[#557](https://github.com/safwan5001-source/Nebrax/pull/557)

## 2. branch

`cursor/pos-interaction-mode-settings-2ebb`

> سياسة Cloud Agent فرضت البادئة `cursor/` واللاحقة `-2ebb`.

## 3. base SHA

`c3873acc6877c9640a19700f8675ff2ec59b105b` — `origin/main` بعد دمج #552 (PR-6) ثم #553 و#555.

## 4. final HEAD SHA

`ccd3993c1f658b6be76e0577d0caacbd37fd51a4` — Visual QA + التقرير + مرشّح console في Playwright.

تنفيذ القشرة الأولى: `9fd3c4f00ebd6c33f86b1ff8af2924bc70d182a7`.

## 5. changed files

### جديد

```
web/src/lib/pos-interaction-policy.ts
web/src/lib/__tests__/pos-interaction-policy.test.ts
web/e2e/pos-interaction-mode.spec.ts
docs/reports/PR-557-pos-interaction-mode-settings.md
docs/visual-qa/pr-557/*.png
```

### محدّث

```
app/Support/PosSettings.php
app/Http/Controllers/Api/SalesConfigController.php
tests/Feature/SalesConfigTest.php
web/src/app/(app)/pos/settings/configuration/page.tsx
web/src/app/(app)/pos/settings/configuration/page.test.tsx
web/src/app/(pos)/pos/page.tsx
web/src/components/pos/pos-shortcuts.tsx
web/src/components/pos/pos-shortcuts.test.tsx
web/src/lib/mock-data.ts
web/src/messages/ar.json
web/src/messages/en.json
```

لم يُعدَّل: `web/src/lib/auth.ts`، `web/src/components/ui/dialog.tsx`، `shortcut-registry.ts`، `use-pos-barcode-scanner.ts` (العتبات)، تخطيط PR-6 في `pos-responsive.ts`.

## 6. audit findings

لا يوجد وضع تفاعل مخزَّن قبل هذا PR. التشغيل الفعلي كان طبقة PR-4 التكيفية (`PosInputModality` من آخر حدث) + تلميحات اختصارات `lg:flex` + `desktopKeyboardNav` عبر `min-width: 1024px`.

أقرب حقل قائم: `show_onscreen_numeric_keypad` — بقي كما هو وليس وضع تفاعل.

لا مصدر إعدادات موازٍ. لا PR مفتوح كان يعدّل `sales_config.pos` وقت التنفيذ (#553 شريط/RBAC).

## 7. existing settings reused

قسم تهيئة نقاط البيع القائم: [`web/src/app/(app)/pos/settings/configuration/page.tsx`](web/src/app/(app)/pos/settings/configuration/page.tsx). بطاقة الـ hub `desktop` («قريباً») لم تُمس.

صلاحيات القراءة/الكتابة كما هي: `invoices.view` + تطبيق `sales.pos` / `company.manage`.

## 8. persistence / source of truth

مصدر واحد: JSON المستأجر `tenants.settings['sales_config']['pos']['interaction_mode']` عبر `GET/PUT /sales-config/pos`.

- دمج الخادم: `PosSettings::group()` يملأ الافتراض `AUTO` عند الغياب.
- قيمة مخزَّنة غير صالحة تُعاد `AUTO` عند القراءة.
- PUT يرفض أي قيمة خارج `AUTO|TOUCH|KEYBOARD_MOUSE|HYBRID`.
- ليست localStorage منتجاً، وليست لكل مستخدم/جهاز.
- في التجربة (demo) يُعاد حقن `mockSalesConfig.pos` من `sessionStorage` حتى يبقى PUT عبر إعادة تحميل الصفحة داخل جلسة Playwright — نفس المصدر لا مخزن ثانٍ للإنتاج.

## 9. enum / values

| القيمة | العربية | الإنجليزية |
|--------|---------|------------|
| `AUTO` | تلقائي (موصى به، الافتراضي) | Auto (Recommended) |
| `TOUCH` | لمس | Touch |
| `KEYBOARD_MOUSE` | لوحة مفاتيح وماوس | Keyboard & Mouse |
| `HYBRID` | هجين | Hybrid |

## 10. resolver behavior

[`web/src/lib/pos-interaction-policy.ts`](web/src/lib/pos-interaction-policy.ts):

- `parsePosInteractionMode` → قيمة غير صالحة/قديمة = `AUTO`
- `resolvePosInteractionPolicy(mode, { viewport, lastModality })` ينتج:
  - `allowKeyboardPowerMode`
  - `preferTouchTargets`
  - `adaptiveModality`
  - `showShortcutHints`
  - `restoreKeyboardFocus`
  - `scannerEnabled: true` دائماً

`viewport` من كسور PR-6: `<768` هاتف، `768–1023` تابلت، `≥1024` سطح مكتب.

## 11. Auto behavior

تكيّف يحترم العرض: على الهاتف يميل للمس حتى مع لوحة مفاتيح (لا حلقات Power Mode ولا استعادة تركيز ولا شريط اختصارات). على سطح المكتب يتبع آخر وسيط إدخال (لوحة → حلقات واستعادة؛ مؤشر/ماسح → بدون حلقات) مع تلميحات الاختصارات عند `lg`. الماسح لا يفعّل Keyboard Power Mode.

## 12. Touch behavior

لا حلقات Keyboard Power Mode، لا استعادة تركيز بعد الحوار، لا شريط اختصارات ولا تلميح F4 في البحث. Tab/Esc والاختصارات المسجَّلة والماسح واللمس تبقى. أهداف اللمس من PR-6 كما هي.

## 13. Keyboard & Mouse behavior

تلميحات الشريط وF4 على سطح المكتب. الاختصارات (F4/F8/F9…) مسجَّلة كما كانت. لا تُفرض `keyboardActive` بعد المؤشر. الماسح يعمل. المؤشر غير معطّل.

## 14. Hybrid behavior

يتبع آخر وسيط إدخال حتى على العروض الضيقة: لمس → pointer (لا حلقات)، لوحة → keyboard (حلقات)، ماسح → scanner دون تحويل الواجهة إلى لوحة. هذا ما يميّزه عن AUTO على الهاتف.

## 15. scanner regression

البوابة بقيت `policy.scannerEnabled && step === 'sale' && !dialogOpen`. `policy.scannerEnabled` دائماً `true`. عتبات `POS_SCANNER_MIN_LENGTH = 3` و`POS_SCANNER_MAX_GAP_MS = 80` لم تُمس. Playwright يؤكّد `data-scanner-enabled="on"` في كل وضع.

## 16. keyboard regression

سجل [`shortcut-registry.ts`](web/src/components/pos/interactions/shortcut-registry.ts) مجمَّد. الشريط يُخفى/يُظهر حسب السياسة فقط. اختبارات `use-pos-keyboard-active` و`pos-hybrid-modality` و`shortcut-registry` خضراء.

## 17. responsive regression

[`pos-responsive.ts`](web/src/lib/pos-responsive.ts) لم يُعدَّل. اختبارات `pos-responsive.test.ts` خضراء. كسور md/lg كما هي.

## 18. settings UX

قسم «أسلوب التفاعل» في أعلى صفحة التهيئة: `fieldset` + `input type="radio"` حقيقية، هدف `min-h-11` (44px)، شارة «موصى به» على Auto بلا صندوق ملوّن، توكنات فقط، RTL/LTR، فاتح/داكن. الحفظ عبر PUT القائم.

## 19. accessibility

دلالات radio أصلية داخل label، `aria-describedby` لكل وصف، حلقة تركيز `focus-visible:ring-primary/40`، لا اعتماد على اللون وحده (شارة نصية + حدود primary). أهداف لمس ≥44px.

## 20. tests exact counts

Vitest المحلي: **158 ملفاً، 932 اختباراً، كلها خضراء.**

منها لهذه المهمة تقريباً:

- `pos-interaction-policy.test.ts`: 9
- `configuration/page.test.tsx`: 17 (كان 14 + 3 جديدة)
- `pos-shortcuts.test.tsx`: 3 (كان 2 + 1)

اختبارات تفاعل POS السابقة (ماسح، اختصارات، هجين، مساحة العمل، قشرة متجاوبة) خضراء.

PHP: غير متاح في هذه البيئة (`php` غير مثبّت). `SalesConfigTest` يُشغَّل في CI.

## 21. build

`npm run build` (Next.js 15.5.19) أخضر.

## 22. Playwright

`npx playwright test e2e/pos-interaction-mode.spec.ts --project=desktop`

- حفظ Touch ثم reload → القيمة ثابتة
- `/pos` يطبّق TOUCH (لا شريط اختصارات، الماسح on)
- KEYBOARD_MOUSE: شريط ظاهر + F4 يركّز البحث
- HYBRID: لمس → `data-keyboard-power=off` ثم ArrowDown → `on`
- AUTO: تلميحات على 1440، تُخفى على 390 مع `data-prefer-touch=on`
- لقطات إعدادات AR فاتح/داكن، EN، جوال 390

**1 passed (desktop).**

## 23. visual QA

`docs/visual-qa/pr-557/`

- `settings-ar-rtl-light.png`
- `settings-ar-rtl-dark.png`
- `settings-en-ltr-light.png`
- `settings-mobile-390.png`
- `pos-touch-desktop.png`
- `pos-keyboard-mouse-desktop.png`
- `pos-hybrid-desktop.png`

## 24. migrations / API changes

لا migration. لا جدول جديد.

تغيير API إعدادات فقط (غير مالي):

- مفتاح `interaction_mode` داخل `sales_config.pos`
- تحقق PUT: `in:AUTO,TOUCH,KEYBOARD_MOUSE,HYBRID`
- GET يملأ `AUTO` للمستأجر القائم بلا المفتاح

لا تغيير على فواتير/مدفوعات/قيود/ZATCA.

## 25. known limitations

- الإعداد على مستوى المستأجر لا لكل جهاز/مستخدم (لا مخزن كهذا اليوم).
- تلميح F9 على زر الدفع نفسه يبقى ظاهراً في وضع اللمس؛ الشريط السفلي الكامل هو ما تُخفيه السياسة.
- PHP غير مشغَّل محلياً في هذه البيئة؛ الاعتماد على CI لـ `SalesConfigTest`.
- بقاء demo عبر `sessionStorage` خاص بتجربة الواجهة فقط، لا يمس الإنتاج.

## 26. no merge / no deploy

لم يُدمج الفرع. لم يُنشر.
