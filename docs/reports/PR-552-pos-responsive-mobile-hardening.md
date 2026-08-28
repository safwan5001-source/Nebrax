# تقرير التنفيذ — PR-6: POS Responsive & Mobile Hardening

**التاريخ:** 2026-08-28  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-6 فوق `main` بعد دمج PR #550 ثم #551 أثناء التنفيذ

---

## 1. PR number

[#552](https://github.com/safwan5001-source/Nebrax/pull/552)

## 2. branch

`cursor/pos-responsive-mobile-hardening-2ebb`

> سياسة Cloud Agent فرضت البادئة `cursor/` واللاحقة `-2ebb`.

## 3. base SHA

نقطة الانطلاق: `a8dd3476f060eb3875c4e8f86c3ba67946b01fa6` — `main` بعد #550 وقبل #551.

أثناء التنفيذ دُمج [#551](https://github.com/safwan5001-source/Nebrax/pull/551) في `main` (`e9585fe1`). دُمج `origin/main` في هذا الفرع بلا تعارض على ملفات البيع. لم يُنسَخ إصلاح `auth.ts` / `ui/dialog.tsx`.

## 4. HEAD SHA

يُثبَّت في commit التوثيق بعد هذا الملف. التنفيذ الوظيفي + الاختبارات + اللقطات في الفرع نفسه.

## 5. changed files

### جديد

```
web/src/lib/pos-responsive.ts
web/src/lib/__tests__/pos-responsive.test.ts
web/e2e/pos-responsive-mobile.spec.ts
docs/reports/PR-552-pos-responsive-mobile-hardening.md
docs/visual-qa/pr-552/*.png
```

### محدّث (قشرة البيع فقط)

```
web/src/app/(pos)/pos/page.tsx
web/src/components/pos/pos-dialog.tsx
web/src/components/pos/pos-dialog.test.tsx
web/src/components/pos/pos-topbar.tsx
web/src/components/pos/pos-topbar.test.tsx
web/src/components/pos/pos-return-dialog.tsx
web/src/components/pos/pos-exchange-dialog.tsx
web/src/components/pos/pos-recent-invoices-dialog.tsx
```

لم يُعدَّل في هذا PR (ما عدا دمج #551 من main): `web/src/lib/auth.ts`، `web/src/components/ui/dialog.tsx`، `interactions/`، `pos-workspace.ts`.

لا ملفات Laravel / API / migrations / RBAC.

## 6. overlap audit with open PRs

| PR | الحالة وقت التنفيذ | التداخل |
|----|---------------------|---------|
| [#551](https://github.com/safwan5001-source/Nebrax/pull/551) | دُمج في `main` أثناء العمل (`e9585fe1`) | `auth.ts` (كسر حلقة `/pos/audit/*`) و`ui/dialog.tsx` (حوارات ERP/التدقيق). شاشة البيع تستخدم `PosDialog` لا `Dialog` العام. **لم ننسخ الإصلاحين.** بعد الدمج يتعايشان: تدقيق ERP عبر `ui/dialog`، بيع عبر `PosDialog`. |
| #544 ZATCA وغيره | خارج `/pos` البيعي | لا |

لا تعارض ملفات مع إصلاح #551. اختبار العزل يؤكّد أن `page.tsx` لا يستورد `ui/dialog` وأن `auth.ts` لا يعرف `PosDialog`.

## 7. layout architecture before/after

**قبل:** `lg+` ثلاثي سلة/منتجات/أقسام. تحت `lg` تبويب جوال + FAB + شريط سفلي — بما فيه 768/834.

**بعد:**

| العرض | التخطيط |
|-------|---------|
| `< md` (390/430) | تبويب منتجات/سلة + FAB + شريط سفلي + `safe-area` |
| `md`–تحت-`lg` (768–1023) | عمودان سلة `minmax(280px,340px)` + منتجات. بلا FAB ولا شريط سفلي. تصنيفات أفقية `lg:hidden` |
| `lg+` (1024+) | الثلاثي القائم حرفياً + شريط اختصارات |

مصدر الصفوف: `web/src/lib/pos-responsive.ts`. لا حالة سلة ثانية ولا مكتبة Sheet.

## 8. mobile behavior

- شريط أضيق (`min-h-14` + `safe-area-top`)، نقطة اتصال بجانب العنوان، فرع/وردية في فيض القائمة.
- الفواتير الأخيرة والمعلّقة: أيقونات من `md`، ومن `DropdownItem` تحت `md` **بنفس الـ callbacks**.
- بحث `h-11`، تصنيفات `flex-nowrap` أفقية، شبكة `grid-cols-2`.
- السلة بالتبويب + FAB. CTA الدفع يبقى في لوحة السلة.
- إلغاء الدفع ما زال يمرّ عبر `PosAuditReasonDialog` (لا bypass).

## 9. tablet behavior

768 و834: السلة والمنتجات ظاهران معاً، الشريط السفلي وFAB مخفيان، شريط الأقسام الأفقي ظاهر، عمود 148px غير ظاهر. أزرار الكمية والإجمالي لا تُقصّ في عمود 280–340px.

## 10. desktop regression status

1280 و1440: ثلاثي قائم، F4 ظاهر، شريط الاختصارات ظاهر، «العودة للنظام» زر، بلا شريط ERP. LTR على 1440 سليم.

## 11. keyboard regression

لا تعديل على `shortcut-registry` أو `use-pos-keyboard-shortcuts`. F4 / الأسهم / F9 / Esc تُفحص في Playwright على 1440. Esc أثناء الدفع يفتح حوار التدقيق القائم (سلوك سابق).

## 12. touch regression

أهداف الإغلاق 44px في `PosDialog` محفوظة. أزرار السلة `min-h-11`/`min-h-12`. لا تغيير على `pos-cart-line-controls` أو `pos-product-tile`.

## 13. scanner regression

لا تعديل على `use-pos-barcode-scanner` أو عتباته. اختبارات الماسح (13) خضراء.

## 14. dialog/sheet changes

`PosDialog` فقط: overlay ثابت، `max-h-[calc(100dvh-2rem)]`، رأس `shrink-0`، جسم `overflow-y-auto min-w-0` + `data-testid="pos-dialog-body"`. حوارات المرتجع/الاستبدال/آخر الفواتير: `max-w-[min(...,calc(100vw-2rem))]`.

لا Sheet جديد. `components/ui/dialog.tsx` بقي من اختصاص #551.

## 15. accessibility changes

- `aria-label` للاتصال على الجوال.
- عناصر القائمة `role="menuitem"` للفواتير/المعلّقة تحت العرض الضيق.
- حوار `aria-modal` يبقى؛ الجسم يتمرّر بدل خروج المحتوى من الـ viewport.
- `nav_more` لم يُوسَّع: الفيض في الـ topbar يغطي الإجراءات الثانوية.

## 16. tests + exact counts

| الملف | التغطية |
|-------|---------|
| `pos-responsive.test.ts` (4) | شبكة md/lg، FAB/nav، ألواح التبويب، عزل auth/dialog |
| `pos-dialog.test.tsx` (3) | إغلاق 44px + Esc + رأس/جسم قابل للتمرير |
| `pos-topbar.test.tsx` (3) | حارس العودة + فيض الفواتير/المعلّقة يستدعي نفس callbacks |
| `pos-workspace.test.ts` (7) | بلا انحدار: `target="_blank"` وحارس السلة |
| interactions PR-1–4 | لم تُعدَّل وبقيت خضراء |
| `pos-responsive-mobile.spec.ts` | مصفوفة المقاسات أدناه |

`npm run test`: **902** اختباراً في **155** ملفاً — كلها خضراء (بعد دمج #551: +2 في `auth.test.ts`).

Playwright (محلي، desktop project): **1 passed** — `e2e/pos-responsive-mobile.spec.ts`.

## 17. build result

`npm run build`: **ناجح** (Next.js 15.5.19، TypeScript OK).

## 18. Playwright matrix

| المقاس | الاتجاه/المظهر | النتيجة |
|--------|----------------|---------|
| 390×844 | RTL light | نجح — شبكة، شريط سفلي، بلا overflow |
| 390×844 | RTL dark | نجح |
| 430×932 | LTR EN light | نجح — FAB بعد إضافة صنف |
| 768×1024 | RTL | نجح — split بلا FAB/nav |
| 834×1194 | RTL | نجح — split |
| 1280×800 | RTL | نجح — ثلاثي + F4 + شريط اختصارات |
| 1440×900 | LTR EN + RTL | نجح — F4/أسهم/F9/Esc |

تفاعلات: إضافة صنف، سلة/+/-، دفع، حوار تدقيق الإلغاء داخل الـ viewport، منتقي عميل، فيض «آخر الفواتير»، بلا overflow أفقي، بلا شريط ERP.

## 19. visual QA screenshots list

المسار: `docs/visual-qa/pr-552/`

| اللقطة | ماذا تُظهر |
|--------|-------------|
| `mobile-390-ar-rtl-light.png` | جوال فاتح: شريط مضغوط، شبكة عمودين، شريط سفلي |
| `mobile-390-ar-rtl-dark.png` | الجوال الداكن |
| `mobile-390-cart-open.png` | تبويب السلة وCTA الدفع و+/- |
| `mobile-390-payment.png` | شاشة الدفع مع `safe-area` للتذييل |
| `mobile-390-more-menu.png` | فيض الإجراءات (فواتير/معلّقة/وردية) + FAB السلة |
| `tablet-768-ar-rtl.png` | عمودان سلة+منتجات |
| `tablet-834-ar-rtl.png` | تابلت split بلا شريط سفلي |
| `desktop-1440-ar-rtl.png` | الثلاثي + اختصارات |
| `desktop-1440-en-ltr.png` | المرآة الإنجليزية |

مؤشر Next.js الدائري «N» يظهر في وضع التطوير فقط، ليس جزءاً من قشرة POS.

## 20. known limitations

- إلغاء الدفع من سلة غير فارغة ما زال يفتح `PosAuditReasonDialog`. معاينة `mockApi` لا تقدّم `/pos/reason-codes` بقيم؛ التأكيد المعطّل حتى اختيار سبب — سلوك تدقيق قائم لا يُتجاوز في هذا PR.
- Esc أثناء حوار التدقيق يعيد إطلاق اختصار `back` فيفتح الحوار مجدداً (عقد اختصارات PR-2، خارج النطاق). الإغلاق يتم بزر «إغلاق».
- التابلت landscape غير مغطى بلقطة مستقلة؛ 834×1194 portrait يغطي العرض المستهدف.
- اختبار Playwright ليس جزءاً من Web CI (CI: Vitest + `next build`).
- لم يُختبر Safari على iPhone حقيقي في هذه البيئة.

## 21. explicit statement

- no backend/API/DB/RBAC changes
- no financial/accounting logic changes
- no shortcut/scanner/session accounting changes
- no merge to `main` by this agent
- no production deploy

---

## روابط

- **PR:** https://github.com/safwan5001-source/Nebrax/pull/552
- **PR #551 (عزل):** https://github.com/safwan5001-source/Nebrax/pull/551
- **PR #550 (مساحة مستقلة):** https://github.com/safwan5001-source/Nebrax/pull/550
- **Base الأصلي:** `a8dd3476f060eb3875c4e8f86c3ba67946b01fa6`
- **main بعد #551:** `e9585fe1`

---

*تم إنشاء هذا التقرير آلياً بعد اكتمال تنفيذ PR-6 — Nebrax Cloud Agent.*
