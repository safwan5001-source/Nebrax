/* =============================================================================
   AWJ Unified UX Foundation — Phase 1 (Design Lab only)
   One shell, one set of reference components, four proof screens.
   Prototype data only · integer halalas · no API · no production routes.
   Component names mirror web/src (PageHeader, DataTable, LineGrid, TotalsDock,
   Money, StatusBadge/statusMeta, Field, Dialog/Sheet/Confirm, EmptyState…).
   ========================================================================== */
(() => {
'use strict';

/* ------------------------------------------------------------------ icons */
const P = {
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  cart:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h3l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h8.5a1.5 1.5 0 0 0 1.4-1.1L21.5 7H6.4"/>',
  truck:'<path d="M2 6h12v10H2z"/><path d="M14 9h4l4 4v3h-8"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  box:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  ledger:'<path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h12"/><path d="M8 8h7"/>',
  idcard:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 14h3"/>',
  fuel:'<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M3 21h13"/><path d="M7 7h5v4H7z"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8.5L19 5"/>',
  cog:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  flask:'<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevS:'<path d="m15 6-6 6 6 6"/>',  // points toward reading start in LTR; mirrored by .dir-icon in RTL
  chevE:'<path d="m9 6 6 6-6 6"/>',
  back:'<path d="M19 12H5M12 19l-7-7 7-7"/>',
  sort:'<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>', check:'<path d="M20 6 9 17l-5-5"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  circle:'<circle cx="12" cy="12" r="7"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  printer:'<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8M8 21v-7h8v7"/>',
  send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  building:'<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M8 7h4M8 11h4M8 15h4M3 21h18"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  hash:'<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  arrowIn:'<path d="M12 5v14M5 12l7 7 7-7"/>', arrowOut:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  keyboard:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
};
/** Directional icons (back, chevrons) mirror in RTL — one component, not scattered rotate-180. */
const DIRECTIONAL = new Set(['chevS', 'chevE', 'back']);
Object.assign(P, (window.FX_EXT || {}).icons || {});
const ic = (n, cls = '') => `<svg class="${cls}${DIRECTIONAL.has(n) ? ' dir-icon' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

/* ------------------------------------------------------------------ i18n */
const T = {
  ar: {
    company:'شركة نبراس الطموح', product:'أَوْج ERP', lab:'مختبر الأساس',
    g_sales:'المبيعات', g_purch:'المشتريات', g_inv:'المخزون', g_parties:'العملاء والموردون', g_fin:'الحسابات والمالية', g_hr:'الموارد البشرية', g_ops:'التشغيل', g_fuel:'محطات الوقود', g_set:'الإعدادات', g_lab:'مختبر الأساس',
    home:'نظرة عامة', salesInv:'فاتورة مبيعات', salesList:'فواتير المبيعات', quotes:'عروض الأسعار', creditNotes:'الإشعارات الدائنة',
    purchInv:'فاتورة مشتريات', purchOrders:'أوامر الشراء', suppliers:'الموردون', stock:'أرصدة المخزون', permits:'الأذون المخزنية', stocktaking:'الجرد',
    customers:'العملاء', statements:'كشوف الحساب', journal:'القيود اليومية', accounts:'دليل الحسابات', treasury:'الخزائن والبنوك', expenses:'المصروفات',
    employees:'الموظفون', payroll:'مسيّر الرواتب', workorders:'أوامر الشغل', shift:'وردية المحطة', stations:'المحطات', tanks:'الخزانات',
    taxSettings:'إعدادات الضرائب', roles:'الأدوار والصلاحيات', reports:'التقارير',
    kit:'مكتبة المكوّنات', numbers:'مختبر الأرقام (M2)', rules:'قواعد الأرقام والإجراءات', identity:'طبقة الهوية',
    search:'ابحث أو نفّذ أمراً…', searchShort:'بحث', create:'إنشاء', inbox:'الوارد', menu:'القائمة', notOnLab:'هذه الوحدة غير ممثّلة في المختبر',
    branch:'الفرع', period:'الفترة', allBranches:'كل الفروع', periodOpen:'نوفمبر 2026 · مفتوحة', periodLocked:'مقفلة', ctxTitle:'سياق العمل',
    br_dmm:'الدمام', br_jbl:'الجبيل', br_khb:'الخبر', brChanged:'تغيّر الفرع النشط',
    priority:'الأولوية', all:'الكل', inbox1:'وردية الجبيل الصناعية بانتظار اعتمادك', inbox1d:'فرق نقدي −35.00 مع سبب مسجّل', inbox2:'3 فواتير تجاوزت 60 يوماً', inbox2d:'أكبرها لشركة الواحة بقيمة 148,920.00', inbox3:'أسمنت بورتلاندي تحت حد الطلب في الجبيل', inbox3d:'الرصيد 40 كيس · حد الطلب 120', open:'فتح', snooze:'تأجيل',
    newSales:'فاتورة مبيعات', newPurch:'فاتورة مشتريات', newReceipt:'سند قبض', newPermit:'إذن مخزني',
    cmdNav:'انتقال', cmdCreate:'إنشاء', cmdAct:'إجراءات', cmdCust:'العملاء', cmdProd:'المنتجات', scopeCust:'عملاء', scopeProd:'منتجات', scopeAct:'إجراءات', navigate:'تنقّل', run:'تنفيذ', close:'إغلاق', noResults:'لا نتائج',
    toggleMode:'تبديل الفاتح/الداكن', toggleLang:'English', toggleDensity:'تبديل الكثافة', shortcuts:'اختصارات لوحة المفاتيح',
    // overview
    ovTitle:'الأساس الموحّد — المرحلة 1', ovDesc:'قشرة واحدة، ومكوّنات مرجعية واحدة، وأربع شاشات إثبات تستعملها كلها دون نسخ خاصة.', ovProof:'شاشات الإثبات', ovRef:'المراجع', ovNav:'نموذج التنقّل في هذا العرض',
    wc_compact:'ضيّق < 600', wc_medium:'متوسط 600–1199', wc_large:'كبير ≥ 1200', nm_compact:'شريط سفلي · لوح واحد · أوراق سفلية', nm_medium:'شريط أيقوني + لوحة مجموعة · لوح واحد · أوراق جانبية', nm_large:'شريط جانبي كامل · لوحان (قائمة + معاينة)', current:'الحالي',
    // page header / actions
    more:'المزيد', print:'طباعة', duplicate:'نسخ', deleteDraft:'حذف المسودة', saveDraft:'حفظ المسودة', preview:'معاينة', post:'اعتماد وترحيل', postShort:'ترحيل', back:'رجوع',
    draft:'مسودة', posted:'مرحّلة', paidSt:'مسددة', unsaved:'تغييرات غير محفوظة', saved:'محفوظة', savedAt:'حُفظت 10:42',
    // document
    customer:'العميل', supplier:'المورد', invDate:'تاريخ الفاتورة', dueDate:'الاستحقاق', priceList:'قائمة الأسعار', plStd:'قائمة أسعار الجملة', ref:'مرجع العميل', supRef:'رقم فاتورة المورد', whIn:'مستودع الاستلام', change:'تغيير', pick:'ابحث بالاسم أو الرقم الضريبي',
    lines:'البنود', item:'الصنف', qty:'الكمية', unit:'الوحدة', price:'السعر', cost:'التكلفة', discount:'الخصم', vat:'الضريبة', lineTotal:'الإجمالي', addLine:'إضافة بند', addHint:'Alt+N أو Enter في آخر بند', derived:'محسوب',
    sub:'المجموع قبل الضريبة', disc:'الخصم', vat15:'ضريبة القيمة المضافة 15%', grand:'الإجمالي المستحق', grandP:'إجمالي المورد', detail:'تفصيل',
    errSummary:'صحّح {n} حقول قبل الترحيل', errQty:'كمية غير صالحة — أرقام فقط بثلاث منازل كحد أقصى', errAmt:'مبلغ غير صالح — أرقام فقط بمنزلتين كحد أقصى', errCust:'اختر العميل', errSup:'اختر المورد', errSupRef:'أدخل رقم فاتورة المورد', errNoLines:'أضف بنداً واحداً على الأقل بكمية وسعر أكبر من صفر',
    lockedPeriodT:'تاريخ الفاتورة داخل فترة مقفلة', lockedPeriodP:'سبتمبر 2026 مقفلة. لن يُقبل الترحيل بهذا التاريخ؛ اختر تاريخاً في فترة مفتوحة أو اطلب فتح الفترة.', postDisabledLocked:'الترحيل معطّل: التاريخ في فترة مقفلة',
    confirmPostT:'ترحيل الفاتورة؟', confirmPostP:'سيُنشأ القيد التالي. الفاتورة المرحّلة لا تُعدَّل؛ التصحيح بإشعار.', illus:'معاينة توضيحية — لا يوجد تشغيل تجريبي في الخادم اليوم', account:'الحساب', debit:'مدين', credit:'دائن', total:'المجموع', cancel:'رجوع',
    acc1130:'العملاء', acc4110:'إيرادات المبيعات', acc2120:'ضريبة المخرجات', acc1140:'المخزون', acc1150:'ضريبة المدخلات', acc2110:'الموردون',
    toastSaved:'حُفظت المسودة', toastPosted:'رُحّلت · القيد متوازن', toastDeleted:'حُذفت المسودة',
    deleteT:'حذف المسودة؟', deleteP:'ستُحذف البنود والملاحظات نهائياً. لا أثر محاسبي لأن المسودة لم تُرحَّل.', leaveT:'مغادرة دون حفظ؟', leaveP:'لديك تغييرات غير محفوظة في هذا المستند.', leave:'مغادرة دون حفظ', stay:'البقاء', saveLeave:'حفظ ثم مغادرة',
    salesNote:'فاتورة آجلة · ZATCA مبسّطة عند الترحيل', purchNote:'فاتورة شراء آجلة · تدخل المخزون عند الترحيل',
    diffTitle:'ما يختلف بين مستندي البيع والشراء (والباقي مشترك حرفياً)', diff1:'الطرف: عميل ↔ مورد', diff2:'السعر ↔ التكلفة، ورقم فاتورة المورد إلزامي', diff3:'القيد: مدين 1130 / دائن 4110 + 2120 ↔ مدين 1140 + 1150 / دائن 2110',
    // inventory
    invTitle:'أرصدة المخزون', invDesc:'كل المستودعات · وحدات الصرف', viewCost:'يرى التكلفة', viewCostHint:'محاكاة صلاحية products.view_cost — الأعمدة تُحذف من الصفحة لا تُخفى', warehouse:'المستودع', allWh:'كل المستودعات', wh_dmm:'الرئيسي — الدمام', wh_jbl:'الجبيل', wh_khb:'الخبر',
    sku:'الرمز', category:'التصنيف', onHand:'الرصيد', reorder:'حد الطلب', avgCost:'متوسط التكلفة', value:'القيمة', status:'الحالة',
    st_ok:'متوفر', st_low:'تحت حد الطلب', st_out:'نفد', views:'العرض', v_all:'كل الأصناف', v_low:'تحت حد الطلب — الجبيل', v_mod:'(معدّل)', saveView:'حفظ العرض',
    footCount:'{n} صنف', footValue:'قيمة المطابِق للفلتر (من الخادم)', footNoCost:'القيمة غير معروضة بلا صلاحية التكلفة',
    byWh:'الرصيد حسب المستودع', moves:'آخر الحركات', mvIn:'وارد', mvOut:'صادر', issue:'إذن صرف', transfer:'تحويل', openFull:'فتح الصفحة',
    selected:'محدد', exportSel:'تصدير', countSel:'جرد المحدد', clearSel:'إلغاء التحديد',
    // kit
    kitDesc:'مكوّنات مرجعية تطابق مكوّنات web/src الحالية (الاسم والعقد)، مع ما يُقترح إضافته.', k_actions:'الأزرار والإجراءات', k_status:'سجل الحالات (statusMeta)', k_msgs:'طبقات الرسائل', k_form:'عقد الحقل (Field) وتوقيت التحقق', k_dialogs:'الحوارات والأوراق', k_states:'الحالات: تحميل · فراغ · لا نتائج · خطأ', k_table:'الجدول المالي المرجعي (DataTable)',
    disabledWhy:'معطّل لأن الفترة مقفلة', busy:'جارٍ الحفظ…', primary:'أساسي', secondary:'ثانوي', ghost:'خفيف', danger:'هدّام',
    domain:'المجال', meaning:'المعنى', badge:'العرض',
    sectionWarn:'المخزون غير كافٍ لبندين', sectionWarnD:'سيُرحَّل بكمية سالبة إن سمحت سياسة المخزون؛ راجع الكميات.', sectionErr:'تعذّر الترحيل', sectionErrD:'الحساب 1150 معطّل. فعّله من دليل الحسابات ثم أعد المحاولة.', sectionInfo:'الإجمالي من الخادم', sectionInfoD:'الأرقام في التذييل تغطي كل الصفوف المطابقة للفلتر، لا الصفحة المعروضة فقط.',
    showToast:'إظهار Toast نجاح', showBanner:'إظهار شريط عام', bannerTxt:'صيانة مجدولة الليلة 01:00–02:00. الترحيل متاح حتى 00:45.', dismiss:'إغلاق',
    fName:'اسم العميل', fVat:'الرقم الضريبي', fVatHint:'15 رقماً يبدأ وينتهي بـ 3', fLimit:'حد الائتمان', fCode:'رقم العميل', fCodeHint:'يُولَّد تلقائياً', fCurrency:'العملة', fCurrencyWhy:'معطّل: عملة المنشأة مقفلة بعد أول قيد', fSave:'حفظ العميل', fReq:'مطلوب', fVatErr:'الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3', fNameErr:'أدخل اسم العميل', fLimitErr:'مبلغ غير صالح', fOk:'حُفظ العميل',
    timingNote:'النموذج القصير يتحقق عند مغادرة الحقل؛ إدخال البنود الطويل يتحقق عند Enter/الحفظ مع ملخص أخطاء.',
    openConfirm:'حوار تأكيد هدّام', openBlocking:'حوار فشل حاجب', openSheet:'ورقة جانبية', blockingT:'تعذّر ترحيل الفاتورة', blockingP:'الفترة «سبتمبر 2026» مقفلة. لم يُنشأ أي قيد ولم يُستهلك أي رقم ZATCA.', blockingOk:'فهمت', sheetT:'ورقة جانبية', sheetP:'تُستعمل للمعاينة والإنشاء السريع؛ تصبح ورقة سفلية على الجوال.',
    loading:'جارٍ التحميل…', emptyT:'لا توجد فواتير بعد', emptyP:'أنشئ أول فاتورة مبيعات وستظهر هنا.', noResT:'لا نتائج مطابقة', noResP:'لا شيء يطابق «{q}». غيّر البحث أو امسح الفلاتر.', errT:'تعذّر تحميل البيانات', errP:'انقطع الاتصال بالخادم. لم يتغيّر شيء؛ أعد المحاولة.', retry:'إعادة المحاولة', clearF:'مسح الفلاتر',
    invList:'فواتير المبيعات', number:'الرقم', date:'التاريخ', due:'الاستحقاق', totalCol:'الإجمالي', paid:'المسدَّد', balance:'المتبقي', st_unpaid:'غير مسددة', st_partial:'مسددة جزئياً', st_paid:'مسددة', st_overdue:'متأخرة', st_draft:'مسودة', st_cancelled:'ملغاة',
    footInvTot:'إجمالي المتبقي للمطابِق (من الخادم)', remind:'تذكير',
    // numbers lab
    nlDesc:'مقارنة تفاعلية لمحاذاة المبالغ قبل قرار M2. كل لوحة تقيس موضع الفاصلة العشرية في كل صف وتحكم: مصطفّة أم لا.', nlA:'A · الحالي: نهاية منطقية (text-end)', nlB:'B · المقترح: محاذاة فيزيائية لليمين', nlC:'C · بديل: عمودان (صحيح | كسور)', nlNeg:'أرقام سالبة', nlSym:'رمز الريال', nlFont:'الخط', fMono:'Plex Mono', fSans:'Plex Sans (جدولي)', fProp:'خط النظام (أرقام نسبية)', nlGuides:'خطوط الفاصلة', nlSpread:'انحراف الفاصلة', aligned:'مصطفّة', misaligned:'غير مصطفّة', nlSummary:'الخلاصة الحية', nlRec:'المقترح للمراجعة: B بشرط أرقام جدولية (Plex Mono وPlex Sans Arabic جدولية). مع خط بأرقام نسبية يفشل B وينجح C فقط. القرار للمالك.', amount:'المبلغ', rowLbl:'البيان',
    r1:'مبيعات نقدية', r2:'مبيعات آجلة', r3:'خدمة توصيل', r4:'مرتجع', r5:'تسوية صفرية', r6:'دفعة مقدمة', r7:'خصم مسموح به', rT:'الإجمالي',
    // rules
    rulesDesc:'قواعد ملزمة لكل وحدة، مع مثال حي لكل قاعدة.', rNum:'الأرقام والمبالغ', rAct:'الإجراءات', rule:'القاعدة', example:'مثال', source:'المصدر',
    // identity
    idDesc:'كيف تتوسّع الهوية دون كسر v3: الأسماء الدلالية مجمّدة، وحزمة الهوية تغيّر قيماً من قائمة مسموحة فقط، ويتحقق مدقّق العقد من كل حزمة في الوضعين.', idLayers:'طبقات التوكنز', idPack:'حزمة الهوية', idContract:'مدقّق العقد (حي)', idCheck:'الفحص', idReq:'المطلوب', idLight:'فاتح', idDark:'داكن', idVerdict:'الحكم', accepted:'مقبولة', rejected:'مرفوضة', locked:'مقفلة', openL:'مفتوحة', overrides:'يغيّر {a} رمزاً مسموحاً · {l} رمزاً مقفلاً',
    L0:'L0 قيم أولية', L0d:'سلالم اللون، الخطوط، الزوايا، الظلال، الحركة', L1:'L1 دلالي (v3)', L1d:'--awj-* — الأسماء مجمّدة', L2:'L2 سمة (v3)', L2d:'13 رمزاً للقشرة: Default · Ink · Core', L3:'L3 وضع العمل (v3)', L3d:'Ledger · Floor · Studio', L4:'L4 حزمة هوية (مقترح M10)', L4d:'تغيّر قيماً من قائمة مسموحة فقط',
    pk_base:'v3 الأساسي', pk_brass:'عينة: نحاس', pk_fayrouz:'عينة: فيروز', pk_invalid:'عينة غير صالحة',
    // shift
    shiftTitle:'وردية الصباح · محطة الجبيل الصناعية', shiftSince:'منذ 06:00 · البائع: فهد العتيبي', shiftOpen:'مفتوحة', postureNote:'وضع Floor: نفس المكوّنات، مفاتيح الوضع فقط (لمس 44 · حقل 48 · إجراء 56 · صف 48)',
    opening:'عداد الافتتاح', closing:'عداد الإغلاق', liters:'اللترات', estSales:'مبيعات تقديرية', nextStep:'الخطوة التالية', nextT:'سجّل قراءات الإغلاق', nextP:'بقيت {n} من 4 فوهات. القراءة لا تُعدَّل بعد الحفظ.', start:'ابدأ', fix:'صحّح القراءة', saveReadings:'حفظ القراءات', readingsSaved:'حُفظت القراءات', errBelow:'أقل من عداد الافتتاح', shiftTotal:'إجمالي تقديري للوردية', partial:'جزئي — فوهات بلا قراءة', estNote:'تقدير تشغيلي من العدادات × سعر اللتر الفعّال؛ ليس فواتير ولا تحصيلاً.', enterReading:'أدخل القراءة', p91:'بنزين 91', p95:'بنزين 95', diesel:'ديزل', pump:'مضخة',
    demoToast:'إجراء توضيحي في المختبر',
  },
  en: {
    company:'Nebras Al Tumouh Co.', product:'AWJ ERP', lab:'Foundation lab',
    g_sales:'Sales', g_purch:'Purchasing', g_inv:'Inventory', g_parties:'Customers & suppliers', g_fin:'Accounting & finance', g_hr:'People', g_ops:'Operations', g_fuel:'Fuel stations', g_set:'Settings', g_lab:'Foundation lab',
    home:'Overview', salesInv:'Sales invoice', salesList:'Sales invoices', quotes:'Quotations', creditNotes:'Credit notes',
    purchInv:'Purchase invoice', purchOrders:'Purchase orders', suppliers:'Suppliers', stock:'Stock levels', permits:'Stock permits', stocktaking:'Stocktaking',
    customers:'Customers', statements:'Statements', journal:'Journal entries', accounts:'Chart of accounts', treasury:'Cash & bank', expenses:'Expenses',
    employees:'Employees', payroll:'Payroll', workorders:'Work orders', shift:'Station shift', stations:'Stations', tanks:'Tanks',
    taxSettings:'Tax settings', roles:'Roles & permissions', reports:'Reports',
    kit:'Component kit', numbers:'Numbers lab (M2)', rules:'Number & action rules', identity:'Identity layer',
    search:'Search or run a command…', searchShort:'Search', create:'Create', inbox:'Inbox', menu:'Menu', notOnLab:'This module is not represented in the lab',
    branch:'Branch', period:'Period', allBranches:'All branches', periodOpen:'Nov 2026 · open', periodLocked:'locked', ctxTitle:'Work context',
    br_dmm:'Dammam', br_jbl:'Jubail', br_khb:'Khobar', brChanged:'Active branch changed',
    priority:'Priority', all:'All', inbox1:'Jubail Industrial shift awaits your approval', inbox1d:'Cash variance −35.00 with a logged reason', inbox2:'3 invoices past 60 days', inbox2d:'Largest is Al Waha at 148,920.00', inbox3:'Portland cement below reorder in Jubail', inbox3d:'On hand 40 bags · reorder at 120', open:'Open', snooze:'Snooze',
    newSales:'Sales invoice', newPurch:'Purchase invoice', newReceipt:'Receipt', newPermit:'Stock permit',
    cmdNav:'Go to', cmdCreate:'Create', cmdAct:'Actions', cmdCust:'Customers', cmdProd:'Products', scopeCust:'Customers', scopeProd:'Products', scopeAct:'Actions', navigate:'Navigate', run:'Run', close:'Close', noResults:'No results',
    toggleMode:'Toggle light/dark', toggleLang:'العربية', toggleDensity:'Toggle density', shortcuts:'Keyboard shortcuts',
    ovTitle:'Unified foundation — Phase 1', ovDesc:'One shell, one set of reference components, and four proof screens that all use them with no private copies.', ovProof:'Proof screens', ovRef:'References', ovNav:'Navigation model for this view',
    wc_compact:'Compact < 600', wc_medium:'Medium 600–1199', wc_large:'Large ≥ 1200', nm_compact:'Bottom bar · one pane · bottom sheets', nm_medium:'Icon rail + group panel · one pane · side sheets', nm_large:'Full sidebar · two panes (list + peek)', current:'Current',
    more:'More', print:'Print', duplicate:'Duplicate', deleteDraft:'Delete draft', saveDraft:'Save draft', preview:'Preview', post:'Approve & post', postShort:'Post', back:'Back',
    draft:'Draft', posted:'Posted', paidSt:'Paid', unsaved:'Unsaved changes', saved:'Saved', savedAt:'Saved 10:42',
    customer:'Customer', supplier:'Supplier', invDate:'Invoice date', dueDate:'Due date', priceList:'Price list', plStd:'Wholesale price list', ref:'Customer reference', supRef:'Supplier invoice no.', whIn:'Receiving warehouse', change:'Change', pick:'Search by name or VAT number',
    lines:'Lines', item:'Item', qty:'Qty', unit:'Unit', price:'Price', cost:'Cost', discount:'Discount', vat:'VAT', lineTotal:'Total', addLine:'Add line', addHint:'Alt+N or Enter on the last line', derived:'Derived',
    sub:'Subtotal', disc:'Discount', vat15:'VAT 15%', grand:'Total due', grandP:'Supplier total', detail:'Breakdown',
    errSummary:'Fix {n} fields before posting', errQty:'Invalid quantity — numbers only, up to 3 decimals', errAmt:'Invalid amount — numbers only, up to 2 decimals', errCust:'Choose a customer', errSup:'Choose a supplier', errSupRef:'Enter the supplier invoice number', errNoLines:'Add at least one line with a quantity and price above zero',
    lockedPeriodT:'Invoice date is in a locked period', lockedPeriodP:'September 2026 is locked. Posting with this date will be rejected; pick a date in an open period or ask to reopen it.', postDisabledLocked:'Posting disabled: date is in a locked period',
    confirmPostT:'Post invoice?', confirmPostP:'This creates the entry below. A posted invoice cannot be edited; corrections use a note.', illus:'Illustrative preview — the backend has no dry-run today', account:'Account', debit:'Debit', credit:'Credit', total:'Total', cancel:'Back',
    acc1130:'Accounts receivable', acc4110:'Sales revenue', acc2120:'Output VAT', acc1140:'Inventory', acc1150:'Input VAT', acc2110:'Accounts payable',
    toastSaved:'Draft saved', toastPosted:'Posted · entry balanced', toastDeleted:'Draft deleted',
    deleteT:'Delete draft?', deleteP:'Lines and notes will be removed permanently. No accounting effect because the draft was never posted.', leaveT:'Leave without saving?', leaveP:'You have unsaved changes in this document.', leave:'Leave without saving', stay:'Stay', saveLeave:'Save and leave',
    salesNote:'Credit invoice · simplified ZATCA on posting', purchNote:'Credit purchase · enters inventory on posting',
    diffTitle:'What differs between the sales and purchase documents (the rest is literally shared)', diff1:'Party: customer ↔ supplier', diff2:'Price ↔ cost; supplier invoice number is required', diff3:'Entry: Dr 1130 / Cr 4110 + 2120 ↔ Dr 1140 + 1150 / Cr 2110',
    invTitle:'Stock levels', invDesc:'All warehouses · issue units', viewCost:'Can see cost', viewCostHint:'Simulates products.view_cost — columns are removed from the page, not hidden', warehouse:'Warehouse', allWh:'All warehouses', wh_dmm:'Main — Dammam', wh_jbl:'Jubail', wh_khb:'Khobar',
    sku:'SKU', category:'Category', onHand:'On hand', reorder:'Reorder at', avgCost:'Avg cost', value:'Value', status:'Status',
    st_ok:'In stock', st_low:'Below reorder', st_out:'Out of stock', views:'View', v_all:'All items', v_low:'Below reorder — Jubail', v_mod:'(modified)', saveView:'Save view',
    footCount:'{n} items', footValue:'Value of matching rows (from server)', footNoCost:'Value hidden without the cost permission',
    byWh:'On hand by warehouse', moves:'Recent movements', mvIn:'In', mvOut:'Out', issue:'Issue permit', transfer:'Transfer', openFull:'Open page',
    selected:'selected', exportSel:'Export', countSel:'Count selected', clearSel:'Clear selection',
    kitDesc:'Reference components matching the current web/src components (name and contract), plus what is proposed.', k_actions:'Buttons & actions', k_status:'Status registry (statusMeta)', k_msgs:'Message tiers', k_form:'Field contract & validation timing', k_dialogs:'Dialogs & sheets', k_states:'States: loading · empty · no results · error', k_table:'Reference financial table (DataTable)',
    disabledWhy:'Disabled because the period is locked', busy:'Saving…', primary:'Primary', secondary:'Secondary', ghost:'Ghost', danger:'Destructive',
    domain:'Domain', meaning:'Meaning', badge:'Display',
    sectionWarn:'Insufficient stock for 2 lines', sectionWarnD:'Will post with negative quantity if the inventory policy allows it; review quantities.', sectionErr:'Posting failed', sectionErrD:'Account 1150 is inactive. Activate it in the chart of accounts, then retry.', sectionInfo:'Totals come from the server', sectionInfoD:'Footer figures cover every row matching the filter, not just the visible page.',
    showToast:'Show success toast', showBanner:'Show system banner', bannerTxt:'Scheduled maintenance tonight 01:00–02:00. Posting available until 00:45.', dismiss:'Dismiss',
    fName:'Customer name', fVat:'VAT number', fVatHint:'15 digits, starts and ends with 3', fLimit:'Credit limit', fCode:'Customer code', fCodeHint:'Generated automatically', fCurrency:'Currency', fCurrencyWhy:'Disabled: company currency locks after the first entry', fSave:'Save customer', fReq:'Required', fVatErr:'VAT number is 15 digits starting and ending with 3', fNameErr:'Enter the customer name', fLimitErr:'Invalid amount', fOk:'Customer saved',
    timingNote:'Short forms validate on blur; long line entry validates on Enter/save with an error summary.',
    openConfirm:'Destructive confirm', openBlocking:'Blocking failure', openSheet:'Side sheet', blockingT:'Invoice could not be posted', blockingP:'Period “September 2026” is locked. No entry was created and no ZATCA counter was used.', blockingOk:'Got it', sheetT:'Side sheet', sheetP:'Used for peek and quick create; becomes a bottom sheet on phones.',
    loading:'Loading…', emptyT:'No invoices yet', emptyP:'Create your first sales invoice and it will appear here.', noResT:'No matching results', noResP:'Nothing matches “{q}”. Change the search or clear filters.', errT:'Data could not load', errP:'The server connection dropped. Nothing changed; try again.', retry:'Try again', clearF:'Clear filters',
    invList:'Sales invoices', number:'Number', date:'Date', due:'Due', totalCol:'Total', paid:'Paid', balance:'Balance', st_unpaid:'Unpaid', st_partial:'Partly paid', st_paid:'Paid', st_overdue:'Overdue', st_draft:'Draft', st_cancelled:'Cancelled',
    footInvTot:'Balance of matching rows (from server)', remind:'Remind',
    nlDesc:'Interactive amount-alignment comparison before decision M2. Each panel measures the decimal point position in every row and judges whether they line up.', nlA:'A · current: logical end (text-end)', nlB:'B · proposed: physical right alignment', nlC:'C · alternative: two columns (integer | fraction)', nlNeg:'Negative numbers', nlSym:'Riyal sign', nlFont:'Font', fMono:'Plex Mono', fSans:'Plex Sans (tabular)', fProp:'System UI (proportional figures)', nlGuides:'Decimal guides', nlSpread:'Decimal spread', aligned:'Aligned', misaligned:'Misaligned', nlSummary:'Live summary', nlRec:'Proposed for review: B, provided figures are tabular (Plex Mono and Plex Sans Arabic are). With a proportional-figure font B fails and only C holds. The owner decides.', amount:'Amount', rowLbl:'Line',
    r1:'Cash sales', r2:'Credit sales', r3:'Delivery service', r4:'Return', r5:'Zero adjustment', r6:'Advance payment', r7:'Discount allowed', rT:'Total',
    rulesDesc:'Binding rules for every module, each with a live example.', rNum:'Numbers & amounts', rAct:'Actions', rule:'Rule', example:'Example', source:'Source',
    idDesc:'How identity extends without breaking v3: semantic names are frozen, an identity pack only changes allow-listed values, and a contract checker validates every pack in both modes.', idLayers:'Token layers', idPack:'Identity pack', idContract:'Contract checker (live)', idCheck:'Check', idReq:'Required', idLight:'Light', idDark:'Dark', idVerdict:'Verdict', accepted:'Accepted', rejected:'Rejected', locked:'Locked', openL:'Open', overrides:'Changes {a} allowed tokens · {l} locked tokens',
    L0:'L0 primitives', L0d:'colour ramps, fonts, radius, shadow, motion', L1:'L1 semantic (v3)', L1d:'--awj-* — names frozen', L2:'L2 theme (v3)', L2d:'13 shell tokens: Default · Ink · Core', L3:'L3 posture (v3)', L3d:'Ledger · Floor · Studio', L4:'L4 identity pack (proposed M10)', L4d:'changes allow-listed values only',
    pk_base:'v3 base', pk_brass:'Sample: brass', pk_fayrouz:'Sample: fayrouz', pk_invalid:'Invalid sample',
    shiftTitle:'Morning shift · Jubail Industrial station', shiftSince:'Since 06:00 · Attendant: Fahad Al-Otaibi', shiftOpen:'Open', postureNote:'Floor posture: same components, posture keys only (touch 44 · control 48 · action 56 · row 48)',
    opening:'Opening meter', closing:'Closing meter', liters:'Liters', estSales:'Estimated sales', nextStep:'Next step', nextT:'Record closing readings', nextP:'{n} of 4 nozzles left. A reading cannot be edited once saved.', start:'Start', fix:'Fix reading', saveReadings:'Save readings', readingsSaved:'Readings saved', errBelow:'Below the opening meter', shiftTotal:'Estimated shift total', partial:'Partial — nozzles without readings', estNote:'Operational estimate from meters × effective liter price; not invoices and not collections.', enterReading:'Enter reading', p91:'Gasoline 91', p95:'Gasoline 95', diesel:'Diesel', pump:'Pump',
    demoToast:'Illustrative action in the lab',
  },
};
/* Extension point (Signature V3 lab). Absent ⇒ behaviour is byte-for-byte the Phase 1 foundation. */
const EXT = window.FX_EXT || {};
Object.assign(T.ar, {
  lineN:'البند {n}', linesCount:'{n} بنداً', linesErr:'بها أخطاء ({n})', linesAll:'كل البنود', linesFind:'ابحث في البنود (صنف أو رمز)', linesNoMatch:'لا بنود مطابقة. البيانات محفوظة؛ امسح البحث لعرض كل البنود.',
  lcDraftC:'قابلة للتعديل · بلا قيد', lcPostedC:'قيد نهائي · ZATCA', lcPaidC:'مسدّدة بالكامل',
  afterPostT:'بعد الترحيل', afterPost1:'يُنشأ قيد متوازن أعلاه ويُربط بالفاتورة', afterPost2:'تُصدر بيانات ZATCA (تسلسل ICV والختم) ولا يُعاد استعمالها', afterPost3:'لا تُعدّل الفاتورة؛ التصحيح بإشعار دائن', draftNote:'الحفظ كمسودة لا يُنشئ قيداً ولا يُصدر بيانات ZATCA، وتبقى قابلة للتعديل أو الحذف.',
});
Object.assign(T.en, {
  lineN:'Line {n}', linesCount:'{n} lines', linesErr:'With errors ({n})', linesAll:'All lines', linesFind:'Find in lines (item or SKU)', linesNoMatch:'No matching lines. Data is kept; clear the search to show every line.',
  lcDraftC:'Editable · no entry', lcPostedC:'Final entry · ZATCA', lcPaidC:'Fully paid',
  afterPostT:'After posting', afterPost1:'The balanced entry above is created and linked to the invoice', afterPost2:'ZATCA data (ICV sequence and stamp) is issued and never reused', afterPost3:'The invoice cannot be edited; corrections use a credit note', draftNote:'Saving a draft creates no entry and issues no ZATCA data; it stays editable or deletable.',
});
if (EXT.i18n) { Object.assign(T.ar, EXT.i18n.ar || {}); Object.assign(T.en, EXT.i18n.en || {}); }
let L = T.ar; const t = (k, v = {}) => String(L[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');

/* ------------------------------------------------------------------ money (integer halalas; same contract as web/src/lib/money.ts) */
const RIYAL = '⃁';
const grp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** <Money>: always LTR-isolated; fraction dimmed; sign + colour for negatives; symbol after the number. */
function money(h, o = {}) {
  if (h === null || h === undefined || !Number.isFinite(h)) return '<span class="m">—</span>';
  const neg = h < 0, a = Math.abs(Math.trunc(h));
  return `<span class="m${neg ? ' neg' : ''}" dir="ltr">${neg ? '-' : ''}${grp(Math.floor(a / 100))}<span class="fr">.${String(a % 100).padStart(2, '0')}</span>${o.sym === false ? '' : `<span class="sym">${RIYAL}</span>`}</span>`;
}
const plain = (h) => { const a = Math.abs(h); return `${h < 0 ? '-' : ''}${grp(Math.floor(a / 100))}.${String(a % 100).padStart(2, '0')}`; };
const moneyOutcome = (h) => { const a = Math.abs(h); return `${h < 0 ? '-' : ''}${grp(Math.floor(a / 100))}<span class="fr">.${String(a % 100).padStart(2, '0')}</span><span class="sym">${RIYAL}</span>`; };
const qtyFmt = (m, scale = 3) => { const d = 10 ** scale, i = Math.floor(Math.abs(m) / d), f = Math.abs(m) % d; return `${m < 0 ? '-' : ''}${grp(i)}${f ? '.' + String(f).padStart(scale, '0').replace(/0+$/, '') : ''}`; };
const AR = /[٠-٩۰-۹]/g;
const normDigits = (s) => String(s).replace(AR, (d) => String((d.charCodeAt(0) & 0xF) % 10)).replace(/[٫]/g, '.').replace(/[٬،]/g, ',');
function toMinor(str, scale = 2) { const s = normDigits(str).replace(/,/g, '').trim(); if (s === '') return 0; if (!/^\d*(\.\d*)?$/.test(s)) return null; const [i, f = ''] = s.split('.'); if (f.length > scale) return null; return Number(i || '0') * 10 ** scale + Number((f + '0'.repeat(scale)).slice(0, scale)); }
const fromMinor = (m, scale) => { const d = 10 ** scale, i = Math.floor(m / d), f = m % d; return f ? `${i}.${String(f).padStart(scale, '0').replace(/0+$/, '')}` : String(i); };
const divRound = (a, b) => Math.floor((2 * a + b) / (2 * b));
const lineCalc = (l) => { const sub = divRound(l.qtyM * l.price, 1000), net = Math.max(0, sub - l.disc), vat = divRound(net * 15, 100); return { sub, net, vat, total: net + vat }; };
const totals = (lines) => lines.reduce((s, l) => { const c = lineCalc(l); s.sub += c.sub; s.disc += Math.min(l.disc, c.sub); s.net += c.net; s.vat += c.vat; s.total += c.total; return s; }, { sub:0, disc:0, net:0, vat:0, total:0 });

/* ------------------------------------------------------------------ statusMeta — one registry for every module */
const STATUS = {
  invoice: { draft:['neutral','circle','st_draft'], cancelled:['danger','x','st_cancelled'], unpaid:['info','info','st_unpaid'], partial:['progress','clock','st_partial'], paid:['done','check','st_paid'], overdue:['attention','alert','st_overdue'] },
  stock: { ok:['done','check','st_ok'], low:['attention','alert','st_low'], out:['danger','x','st_out'] },
  document: { draft:['neutral','circle','draft'], posted:['done','check','posted'] },
};
const statusBadge = (domain, key, extra = '') => { const [m, i, l] = STATUS[domain][key]; const pill = (m === 'attention' || m === 'danger') ? ' pill' : ''; return `<span class="st st-${m}${pill}">${ic(i)}${t(l)}${extra}</span>`; };

/* ------------------------------------------------------------------ data (prototype only) */
const TODAY = '2026-11-10';
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const CUST = [
  { id:'c1', ar:'شركة الواحة للمقاولات المحدودة', en:'Al Waha Contracting Co.', vat:'310045218900003' },
  { id:'c2', ar:'مؤسسة الخليج الحديثة للتجارة', en:'Modern Gulf Trading Est.', vat:'300218774500003' },
  { id:'c3', ar:'مصنع الجبيل للبلاستيك', en:'Jubail Plastics Factory', vat:'311187420600003' },
  { id:'c4', ar:'مستشفى الظهران التخصصي', en:'Dhahran Specialist Hospital', vat:'300554127800003' },
  { id:'c5', ar:'شركة أفق الخبر العقارية', en:'Khobar Horizon Real Estate', vat:'301776540200003' },
];
const SUPP = [
  { id:'s1', ar:'شركة الزامل للتوريدات الصناعية', en:'Zamil Industrial Supplies', vat:'300987654300003' },
  { id:'s2', ar:'مصنع الخليج للكابلات', en:'Gulf Cables Factory', vat:'310112233400003' },
  { id:'s3', ar:'شركة دهانات الشرق', en:'Eastern Paints Co.', vat:'302334455600003' },
  { id:'s4', ar:'مؤسسة أدوات السلامة', en:'Safety Tools Est.', vat:'311998877600003' },
];
const PROD = [
  { sku:'PVC-4-6M', ar:'أنبوب PVC ضغط عالٍ 4 بوصة — 6م', en:'PVC pressure pipe 4in — 6m', cat:{ar:'سباكة',en:'Plumbing'}, u:{ar:'قطعة',en:'pc'}, price:8500, cost:6120, stock:{dmm:420, jbl:96, khb:150}, reorder:120 },
  { sku:'CBL-3X25', ar:'كابل نحاسي معزول 3×2.5مم — لفة 100م', en:'Insulated copper cable 3×2.5mm — 100m', cat:{ar:'كهرباء',en:'Electrical'}, u:{ar:'لفة',en:'roll'}, price:41200, cost:33850, stock:{dmm:64, jbl:22, khb:0}, reorder:30 },
  { sku:'BRK-63-3P', ar:'قاطع كهربائي 63 أمبير ثلاثي', en:'63A 3-pole circuit breaker', cat:{ar:'كهرباء',en:'Electrical'}, u:{ar:'قطعة',en:'pc'}, price:13800, cost:10125, stock:{dmm:210, jbl:75, khb:48}, reorder:60 },
  { sku:'EPX-20L', ar:'دهان إيبوكسي صناعي — 20 لتر', en:'Industrial epoxy paint — 20L', cat:{ar:'دهانات',en:'Paints'}, u:{ar:'جالون',en:'pail'}, price:36500, cost:28780, stock:{dmm:35, jbl:0, khb:12}, reorder:20 },
  { sku:'VLV-BR-2', ar:'محبس كروي نحاسي 2 بوصة', en:'Brass ball valve 2in', cat:{ar:'سباكة',en:'Plumbing'}, u:{ar:'قطعة',en:'pc'}, price:6450, cost:4410, stock:{dmm:540, jbl:180, khb:260}, reorder:150 },
  { sku:'GLV-SAFE', ar:'قفازات سلامة جلدية (12 زوج)', en:'Leather safety gloves (12 pairs)', cat:{ar:'سلامة',en:'Safety'}, u:{ar:'علبة',en:'box'}, price:9600, cost:6240, stock:{dmm:88, jbl:41, khb:19}, reorder:40 },
  { sku:'CMT-50', ar:'أسمنت بورتلاندي — كيس 50كجم', en:'Portland cement — 50kg bag', cat:{ar:'مواد بناء',en:'Building materials'}, u:{ar:'كيس',en:'bag'}, price:1875, cost:1490, stock:{dmm:1800, jbl:40, khb:620}, reorder:120 },
  { sku:'SRV-DLV-JB', ar:'خدمة توصيل إلى الموقع — الجبيل', en:'Site delivery — Jubail', cat:{ar:'خدمات',en:'Services'}, u:{ar:'رحلة',en:'trip'}, price:51750, cost:0, stock:null, reorder:0 },
];
const WH = ['dmm', 'jbl', 'khb'];
let seed = 20261110; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const INV = (() => { const r = []; for (let i = 0; i < 30; i++) { const c = CUST[Math.floor(rnd() * CUST.length)]; const date = addDays(TODAY, -Math.floor(rnd() * 90)); const total = Math.round((150000 + rnd() * rnd() * 18500000) / 5) * 5; const x = rnd(); let doc = 'posted', paid = 0; if (x < .4) paid = total; else if (x < .62) paid = Math.round(total * (.2 + rnd() * .5) / 100) * 100; r.push({ c, date, due:addDays(date, 30), total, paid, doc }); } r.sort((a, b) => b.date.localeCompare(a.date)); r.forEach((v, i) => { v.no = `INV-2026-${String(436 - i).padStart(4, '0')}`; if (i < 2) { v.doc = 'draft'; v.paid = 0; } if (i === 9) v.doc = 'cancelled'; }); return r; })();
const invStatus = (v) => v.doc === 'draft' ? 'draft' : v.doc === 'cancelled' ? 'cancelled' : v.paid >= v.total ? 'paid' : v.due < TODAY ? 'overdue' : v.paid > 0 ? 'partial' : 'unpaid';
const MOVES = { 'CMT-50':[['out',-120000,'2026-11-09','PRM-1182'],['in',600000,'2026-11-04','PUR-0512'],['out',-80000,'2026-11-02','INV-2026-0431']], default:[['out',-12000,'2026-11-08','INV-2026-0434'],['in',60000,'2026-11-01','PUR-0507'],['out',-6000,'2026-10-29','INV-2026-0428']] };
const NOZ = [
  { id:'N1', pump:1, prod:'p91', color:'#2E7D32', open:284512370, close:null, price:218 },
  { id:'N2', pump:1, prod:'p95', color:'#C62828', open:198004120, close:199122450, price:233 },
  { id:'N3', pump:2, prod:'diesel', color:'#F9A825', open:412887040, close:null, price:166 },
  { id:'N4', pump:2, prod:'diesel', color:'#F9A825', open:377120930, close:null, price:166 },
];

/* ------------------------------------------------------------------ state */
const snapDoc = (D) => { const c = JSON.parse(JSON.stringify({ ...D, saved: undefined })); c.dirty = false; c.showErrs = false; return c; };
const newDoc = (kind) => ({
  kind, party: kind === 'sales' ? CUST[0] : SUPP[0], date: TODAY, due: addDays(TODAY, 30), ref: kind === 'sales' ? 'PO-77812' : '', wh: 'dmm', dirty: false, errs: {}, showErrs: false, comboOpen: false, comboQ: '', comboIdx: 0,
  lines: kind === 'sales'
    ? [{ id:1, p:0, qtyM:120000, price:8500, disc:0 }, { id:2, p:1, qtyM:14000, price:41200, disc:0 }, { id:3, p:7, qtyM:1000, price:51750, disc:5000 }]
    : [{ id:1, p:6, qtyM:600000, price:1490, disc:0 }, { id:2, p:2, qtyM:60000, price:10125, disc:0 }, { id:3, p:3, qtyM:20000, price:28780, disc:15000 }],
});
const S = {
  route:'home', device:'laptop', mode:'light', theme:'default', identity:'base', amt:'a', lang:'ar', density:'regular', demo:'ready',
  branch:'jbl', overlay:null, toasts:[], banner:false, seq:10,
  docs:{ sales:newDoc('sales'), purchase:newDoc('purchase') },
  inv:{ q:'', st:'all', wh:'all', view:'all', sort:{k:'sku', d:'asc'}, sel:new Set(), peek:null, costPerm:true, active:null },
  kit:{ q:'', st:'all', sort:{k:'no', d:'desc'}, page:0, sel:new Set(), form:{ name:'', vat:'', limit:'', touched:{}, errs:{} }, busy:false },
  num:{ neg:true, sym:true, font:'mono', guides:true },
  readings:{}, gSeq:false,
};
if (EXT.state) Object.assign(S, EXT.state);
const STORE = EXT.storageKey || 'awj-foundation', PKEYS = ['route','device','mode','theme','identity','amt','lang','density', ...(EXT.persistKeys || [])];
if (EXT.persist !== false) try { const sv = JSON.parse(localStorage.getItem(STORE) || '{}'); PKEYS.forEach(k => { if (sv[k]) S[k] = sv[k]; }); } catch (e) {}
EXT.init?.(S);
if (innerWidth < 560) S.device = 'wide';
const persist = () => { if (EXT.persist === false) return; try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(PKEYS.map(k => [k, S[k]])))); } catch (e) {} };
const nm = (o) => o ? (S.lang === 'ar' ? o.ar : o.en) : '';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

/* ------------------------------------------------------------------ navigation model */
const NAV = [
  ['g_sales','cart',[['salesInv','sales'],['salesList',null],['quotes',null],['creditNotes',null]]],
  ['g_purch','truck',[['purchInv','purchase'],['purchOrders',null],['suppliers',null]]],
  ['g_inv','box',[['stock','inventory'],['permits',null],['stocktaking',null]]],
  ['g_parties','users',[['customers',null],['statements',null]]],
  ['g_fin','ledger',[['journal',null],['accounts',null],['treasury',null],['expenses',null]]],
  ['g_hr','idcard',[['employees',null],['payroll',null]]],
  ['g_ops','building',[['workorders',null]]],
  ['g_fuel','fuel',[['shift','shift'],['stations',null],['tanks',null]]],
  ['g_set','cog',[['taxSettings',null],['roles',null],['reports',null]]],
  ['g_lab','flask',[['home','home'],['kit','kit'],['numbers','numbers'],['rules','rules'],['identity','identity']]],
];
const ROUTES = ['home','kit','numbers','rules','sales','purchase','inventory','shift','identity'];
if (EXT.nav) EXT.nav(NAV, ROUTES);
const groupOf = (route) => NAV.find(([, , items]) => items.some(([, r]) => r === route)) || NAV[NAV.length - 1];
const routeLabel = (r) => ({ home:'home', kit:'kit', numbers:'numbers', rules:'rules', sales:'salesInv', purchase:'purchInv', inventory:'stock', shift:'shift', identity:'identity', ...(EXT.routeLabels || {}) })[r];
const DEVICES = { phone:{ w:390, h:844, l:'جوال 390' }, tablet:{ w:834, h:1112, l:'لوحي عمودي 834' }, tabletL:{ w:1194, h:834, l:'لوحي أفقي 1194' }, laptop:{ w:1366, h:860, l:'محمول 1366' }, wide:{ w:null, h:920, l:'عريض' } };
if (EXT.devices) { Object.keys(DEVICES).forEach(k => delete DEVICES[k]); Object.assign(DEVICES, EXT.devices); }
const windowClass = () => { const w = app.clientWidth; return w < 600 ? 'compact' : w < 1200 ? 'medium' : 'large'; };

/* ------------------------------------------------------------------ shell */
function shell(content) {
  const [gKey] = groupOf(S.route);
  const home = EXT.homeRoute || 'home';
  const side = `<div class="side">${EXT.brand ? EXT.brand('side', API) : `<div class="brand"><span class="mk" aria-hidden="true">${S.lang === 'ar' ? 'أ' : 'A'}</span><div style="min-width:0"><b>${t('company')}</b><span>${t('product')}</span></div></div>`}
    <nav class="nav-scroll" aria-label="${t('menu')}">${NAV.map(([g, icn, items]) => `<div class="nav-grp">${t(g)}${g === 'g_lab' ? '<span class="tag-lab" style="font-size:9.5px">LAB</span>' : ''}</div>${items.map(([k, r]) => `<button type="button" class="nav-a" data-route="${r || ''}" data-label="${k}" ${r === S.route ? 'aria-current="page"' : ''}>${ic(r === S.route || g !== 'g_lab' ? icn : 'flask')}<span class="lbl">${t(k)}</span></button>`).join('')}`).join('')}</nav></div>`;
  const rail = `<nav class="rail" aria-label="${t('menu')}">${EXT.brand ? EXT.brand('rail', API) : `<span class="mk" aria-hidden="true">${S.lang === 'ar' ? 'أ' : 'A'}</span>`}${NAV.map(([g, icn]) => `<button type="button" class="rail-b" data-group="${g}" aria-current="${g === gKey}" title="${t(g)}">${ic(icn)}<span class="lbl">${t(g)}</span></button>`).join('')}</nav>`;
  const brChip = `<button type="button" class="ctx-chip" data-act="context" aria-haspopup="dialog">${ic('building')}<span class="hide-c">${t('branch')}:</span> <b>${t('br_' + S.branch)}</b></button>`;
  const periodChip = `<span class="ctx-chip hide-m" data-locked="false"><span class="dot"></span>${t('period')}: <b>${t('periodOpen')}</b></span>`;
  const crumbs = `<nav class="crumbs" aria-label="breadcrumb"><span class="hide-c">${t(gKey)}</span>${ic('chevS', 'hide-c')}<b>${t(routeLabel(S.route))}</b></nav>`;
  const ctx = `<header class="ctx">${crumbs}<span class="grow"></span><button type="button" class="cmd-trigger" data-act="palette">${ic('search')}<span class="t">${t('search')}</span><span class="kbd">Ctrl K</span></button>${brChip}${periodChip}<button type="button" class="ibtn hide-c" data-act="inbox">${ic('bell')}<span class="sr">${t('inbox')} · ${S.lang === 'ar' ? '3 غير مقروءة' : '3 unread'}</span><span class="count" aria-hidden="true">3</span></button><button type="button" class="avatar hide-c" data-act="usermenu"><span aria-hidden="true">${S.lang === 'ar' ? 'سد' : 'SD'}</span><span class="sr">${S.lang === 'ar' ? 'قائمة المستخدم' : 'User menu'}</span></button></header>`;
  const bbar = `<nav class="bbar" aria-label="${t('menu')}"><button type="button" data-route="${home}" aria-current="${S.route === home}">${ic('home')}<span>${t('home')}</span></button><button type="button" data-act="palette">${ic('search')}<span>${t('searchShort')}</span></button><button type="button" class="make" data-act="create" aria-label="${t('create')}"><span class="c">${ic('plus')}</span></button><button type="button" data-act="inbox">${ic('bell')}<span class="count">3</span><span>${t('inbox')}</span></button><button type="button" data-act="navsheet" aria-current="${S.route !== home}">${ic('menu')}<span>${t('menu')}</span></button></nav>`;
  const banner = S.banner ? `<div class="banner" role="status">${ic('alert')}<span class="grow">${t('bannerTxt')}</span><button type="button" class="btn ghost" data-act="banner-off" style="height:28px">${t('dismiss')}</button></div>` : '';
  return `<div class="fx-shell"><aside class="nav">${side}${rail}</aside>${ctx}<main class="main" id="main" tabindex="-1">${banner}${content}</main>${bbar}</div><div class="toasts" aria-live="polite" id="toasts"></div>${overlay()}`;
}

/* ------------------------------------------------------------------ shared building blocks */
/** PageHeader — eyebrow · title · description · status · actions (1 primary + ≤2 secondary + overflow) */
function pageHeader({ eyebrow = '', title, desc = '', status = '', primary = '', secondary = [], overflow = [] }) {
  const ov = overflow.length ? `<span class="menu-wrap"><button type="button" class="btn" data-act="menu" data-menu="pg" aria-haspopup="menu" aria-expanded="${S.overlay?.menu === 'pg'}">${ic('more')}<span class="hide-c">${t('more')}</span></button>${S.overlay?.menu === 'pg' ? `<ul class="menu" role="menu" style="inset-inline-end:0;top:100%">${overflow.map(o => `<li role="none"><button type="button" role="menuitem" class="${o.danger ? 'danger' : ''}" data-act="${o.act}">${ic(o.icon)}${t(o.label)}</button></li>`).join('')}</ul>` : ''}</span>` : '';
  return `<header class="ph"><div style="min-width:0">${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}${status ? ` <span style="font-size:13px;vertical-align:3px;margin-inline-start:6px">${status}</span>` : ''}</h1>${desc ? `<p class="desc">${desc}</p>` : ''}</div><div class="acts">${secondary.join('')}${ov}${primary}</div></header>`;
}
const stateBlock = (kind, q = '') => kind === 'loading'
  ? `<div class="panel-b" role="status" aria-busy="true" aria-label="${t('loading')}">${Array.from({ length: 6 }, (_, i) => `<div style="display:flex;gap:12px;margin:12px 0"><div class="sk" style="width:${16 + (i * 7) % 18}%"></div><div class="sk" style="width:${28 + (i * 11) % 28}%"></div><div class="sk" style="width:14%;margin-inline-start:auto"></div></div>`).join('')}</div>`
  : kind === 'empty' ? `<div class="state">${ic('file')}<h3>${t('emptyT')}</h3><p>${t('emptyP')}</p><button class="btn primary" type="button" data-route="sales">${ic('plus')}${t('newSales')}</button></div>`
  : kind === 'nores' ? `<div class="state">${ic('search')}<h3>${t('noResT')}</h3><p>${t('noResP', { q: esc(q) })}</p><button class="btn" type="button" data-act="clear-filters">${t('clearF')}</button></div>`
  : `<div class="state err" role="alert">${ic('alert')}<h3>${t('errT')}</h3><p>${t('errP')}</p><button class="btn primary" type="button" data-act="retry">${t('retry')}</button></div>`;

/* ------------------------------------------------------------------ pages: overview */
function pageHome() {
  const wc = app.clientWidth ? windowClass() : 'large';
  const proofs = [['sales','salesInv','cart'],['purchase','purchInv','truck'],['inventory','stock','box'],['shift','shift','fuel']];
  const refs = [['kit','kit','layers'],['numbers','numbers','hash'],['rules','rules','sliders'],['identity','identity','flask']];
  const card = ([r, k, i]) => `<button type="button" class="panel" data-route="${r}" style="display:flex;gap:12px;align-items:center;padding:14px;text-align:start;cursor:pointer">${ic(i).replace('<svg', '<svg width="22" height="22" style="color:var(--awj-action-primary);flex:none"')}<span><b style="display:block">${t(k)}</b></span></button>`;
  return `<div class="page">${pageHeader({ eyebrow: `<span class="tag-lab">Phase 1 · LAB</span>`, title: t('ovTitle'), desc: t('ovDesc') })}
  <section aria-labelledby="ov-p"><h2 id="ov-p" style="font-size:14px;margin:0 0 8px">${t('ovProof')}</h2><div class="grid4">${proofs.map(card).join('')}</div></section>
  <section aria-labelledby="ov-r"><h2 id="ov-r" style="font-size:14px;margin:0 0 8px">${t('ovRef')}</h2><div class="grid4">${refs.map(card).join('')}</div></section>
  <section aria-labelledby="ov-n"><h2 id="ov-n" style="font-size:14px;margin:0 0 8px">${t('ovNav')}</h2><div class="navmodel">${['compact','medium','large'].map(c => `<div class="nm" data-on="${c === wc}"><b>${t('wc_' + c)}${c === wc ? ` · <span style="color:var(--awj-action-primary)">${t('current')}</span>` : ''}</b>${t('nm_' + c)}</div>`).join('')}</div></section></div>`;
}

/* ------------------------------------------------------------------ pages: component kit */
function kitTable() {
  const K = S.kit, q = normDigits(K.q).trim().toLowerCase();
  let rows = INV.filter(v => (K.st === 'all' || invStatus(v) === K.st) && (!q || v.no.toLowerCase().includes(q) || v.c.ar.includes(q) || v.c.en.toLowerCase().includes(q)));
  const dir = K.sort.d === 'asc' ? 1 : -1, val = (v) => ({ no:v.no, c:nm(v.c), date:v.date, total:v.total, bal: v.doc === 'posted' ? v.total - v.paid : 0 })[K.sort.k];
  rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), S.lang)) * dir; });
  const PAGE = 8, pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (K.page >= pages) K.page = pages - 1;
  const view = rows.slice(K.page * PAGE, K.page * PAGE + PAGE);
  const balTot = rows.reduce((s, v) => s + (v.doc === 'posted' ? v.total - v.paid : 0), 0); // stands in for the server aggregate
  const chips = ['all','overdue','unpaid','partial','paid','draft'].map(k => `<button type="button" class="chip" data-kst="${k}" aria-pressed="${K.st === k}">${t(k === 'all' ? 'all' : 'st_' + k)} <span class="c">${k === 'all' ? INV.length : INV.filter(v => invStatus(v) === k).length}</span></button>`).join('');
  const th = (k, l, cls = '') => { const s = K.sort.k === k ? (K.sort.d === 'asc' ? 'ascending' : 'descending') : 'none'; return `<th class="${cls}" aria-sort="${s}"><button type="button" data-ksort="${k}">${t(l)}${ic('sort')}</button></th>`; };
  let body;
  if (S.demo !== 'ready') body = stateBlock(S.demo);
  else if (!rows.length) body = stateBlock('nores', K.q);
  else body = `<div class="tscroll cardable" tabindex="0" role="region" aria-label="${t('invList')}"><table class="dt"><thead><tr><th class="c-chk"><input type="checkbox" data-ksel="all" aria-label="select all" ${view.every(v => K.sel.has(v.no)) ? 'checked' : ''}></th>${th('no','number')}${th('c','customer')}${th('date','date','p2')}${th('total','totalCol','c-amt p3')}${th('bal','balance','c-amt')}<th>${t('status')}</th></tr></thead><tbody>${view.map(v => `<tr aria-selected="${K.sel.has(v.no)}"><td class="c-chk"><input type="checkbox" data-ksel="${v.no}" aria-label="${v.no}" ${K.sel.has(v.no) ? 'checked' : ''}></td><td><span class="docno">${v.no}</span></td><td><div class="two"><b>${esc(nm(v.c))}</b><span class="num">${v.c.vat}</span></div></td><td class="num p2">${fmtDate(v.date)}</td><td class="c-amt p3">${money(v.total)}</td><td class="c-amt">${v.doc === 'posted' ? money(v.total - v.paid) : '<span class="muted">—</span>'}</td><td>${statusBadge('invoice', invStatus(v))}</td></tr>`).join('')}</tbody></table></div>
    <div class="mlist">${view.map(v => `<div class="mcard"><div class="r"><b>${esc(nm(v.c))}</b>${statusBadge('invoice', invStatus(v))}</div><dl class="kv"><dt>${t('number')}</dt><dd class="num">${v.no}</dd><dt>${t('date')}</dt><dd class="num">${fmtDate(v.date)}</dd><dt>${t('totalCol')}</dt><dd class="c-amt">${money(v.total)}</dd><dt>${t('balance')}</dt><dd class="c-amt">${v.doc === 'posted' ? money(v.total - v.paid) : '—'}</dd></dl></div>`).join('')}</div>
    <div class="dt-foot"><span class="tot"><span>${t('footCount', { n: rows.length })}</span><span>·</span><span>${t('footInvTot')}:</span><b>${money(balTot)}</b></span><span class="pager"><button type="button" data-kpage="-1" ${K.page === 0 ? 'disabled' : ''} aria-label="prev">${ic('chevS')}</button><span class="num">${K.page + 1}/${pages}</span><button type="button" data-kpage="1" ${K.page >= pages - 1 ? 'disabled' : ''} aria-label="next">${ic('chevE')}</button></span></div>`;
  return `<section class="panel dt-wrap"><div class="panel-h"><h2>${t('k_table')}</h2><span class="sub">DataTable · ListToolbar · Pagination</span></div>
    <div class="fbar"><label class="srch">${ic('search')}<input class="inp" id="kq" type="search" placeholder="${t('searchShort')}" aria-label="${t('searchShort')}" value="${esc(K.q)}"></label><div class="chips" role="group" aria-label="${t('status')}">${chips}</div></div>
    <div class="urlstate" aria-label="URL">?status=${K.st}${K.q ? '&q=' + encodeURIComponent(K.q) : ''}&sort=${K.sort.k}.${K.sort.d}&page=${K.page + 1}</div>
    ${K.sel.size ? `<div class="bulk" role="region" aria-label="bulk"><b class="num">${K.sel.size}</b> ${t('selected')}<span class="grow"></span><button class="btn" type="button" data-act="toast-remind">${ic('send')}${t('remind')}</button><button class="btn" type="button" data-act="kit-clearsel">${t('clearSel')}</button></div>` : ''}${body}</section>`;
}
function kitForm() {
  const F = S.kit.form, e = F.errs;
  const fld = (id, label, input, { req = false, hint = '', err = '' } = {}) => `<div class="field"><label for="${id}">${t(label)}${req ? ` <span class="req" aria-hidden="true">*</span><span class="sr">${t('fReq')}</span>` : ''}</label>${input}${hint ? `<span class="hint" id="${id}-h">${t(hint)}</span>` : ''}${err ? `<span class="err" id="${id}-e">${ic('alert')}${t(err)}</span>` : ''}</div>`;
  const desc = (id, hint, err) => [hint ? id + '-h' : '', err ? id + '-e' : ''].filter(Boolean).join(' ');
  return `<section class="panel"><div class="panel-h"><h2>${t('k_form')}</h2><span class="sub">Field · FormAlert</span></div><div class="panel-b" style="display:flex;flex-direction:column;gap:14px">
    <p class="note" style="margin:0">${ic('info')}${t('timingNote')}</p>
    ${F.summary ? `<div class="err-summary" role="alert" tabindex="-1" id="kf-sum"><b>${t('errSummary', { n: Object.keys(e).length })}</b><ul>${Object.keys(e).map(k => `<li><button type="button" class="lnk" data-focus="#kf-${k}">${t(e[k])}</button></li>`).join('')}</ul></div>` : ''}
    <form class="fields" style="--cols:3" id="kform" novalidate>
      ${fld('kf-name', 'fName', `<input class="inp" id="kf-name" data-kf="name" value="${esc(F.name)}" aria-required="true" ${e.name ? 'aria-invalid="true"' : ''} aria-describedby="${desc('kf-name', '', e.name)}">`, { req: true, err: e.name })}
      ${fld('kf-vat', 'fVat', `<input class="inp num" id="kf-vat" data-kf="vat" inputmode="numeric" value="${esc(F.vat)}" aria-required="true" ${e.vat ? 'aria-invalid="true"' : ''} aria-describedby="${desc('kf-vat', 'fVatHint', e.vat)}">`, { req: true, hint: 'fVatHint', err: e.vat })}
      ${fld('kf-limit', 'fLimit', `<input class="inp n" id="kf-limit" data-kf="limit" inputmode="decimal" dir="ltr" value="${esc(F.limit)}" ${e.limit ? 'aria-invalid="true"' : ''} aria-describedby="${desc('kf-limit', '', e.limit)}">`, { err: e.limit })}
      ${fld('kf-code', 'fCode', `<input class="inp num" id="kf-code" value="C-00418" readonly aria-readonly="true" aria-describedby="kf-code-h">`, { hint: 'fCodeHint' })}
      ${fld('kf-cur', 'fCurrency', `<select class="sel" id="kf-cur" disabled aria-describedby="kf-cur-h"><option>SAR</option></select>`, { hint: 'fCurrencyWhy' })}
      <div class="field" style="justify-content:flex-end"><button type="submit" class="btn primary" ${S.kit.busy ? 'aria-busy="true" disabled' : ''}>${S.kit.busy ? t('busy') : t('fSave')}</button></div>
    </form></div></section>`;
}
function pageKit() {
  const statusRows = [['invoice',['draft','unpaid','partial','paid','overdue','cancelled']],['stock',['ok','low','out']],['document',['draft','posted']]];
  return `<div class="page">${pageHeader({ eyebrow: `<span class="tag-lab">LAB</span>`, title: t('kit'), desc: t('kitDesc') })}
  <div class="grid2">
    <section class="panel"><div class="panel-h"><h2>${t('k_actions')}</h2><span class="sub">Button · ActionGroup</span></div><div class="panel-b" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="demo">${t('primary')}</button><button class="btn" type="button" data-act="demo">${t('secondary')}</button><button class="btn ghost" type="button" data-act="demo">${t('ghost')}</button><button class="btn danger" type="button" data-act="confirm-delete">${t('danger')}</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="button" aria-disabled="true" aria-describedby="why1" data-act="noop">${t('postShort')}</button><span class="hint muted" id="why1" style="font-size:12px">${ic('lock').replace('<svg', '<svg width="12" height="12"')} ${t('disabledWhy')}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" aria-busy="true">${t('busy')}</button></div>
    </div></section>
    <section class="panel"><div class="panel-h"><h2>${t('k_status')}</h2><span class="sub">statusMeta · StatusBadge</span></div><div class="panel-b"><table class="rules"><thead><tr><th>${t('domain')}</th><th>${t('badge')}</th></tr></thead><tbody>${statusRows.map(([d, ks]) => `<tr><td class="num">${d}</td><td style="display:flex;flex-wrap:wrap;gap:6px 12px">${ks.map(k => statusBadge(d, k)).join('')}</td></tr>`).join('')}</tbody></table></div></section>
  </div>
  <section class="panel"><div class="panel-h"><h2>${t('k_msgs')}</h2><span class="sub">Field error · Section · Toast · Banner · Dialog</span></div><div class="panel-b" style="display:flex;flex-direction:column;gap:10px">
    <div class="msg warn" role="status">${ic('alert')}<div><b>${t('sectionWarn')}</b>${t('sectionWarnD')}</div></div>
    <div class="msg err" role="alert">${ic('x')}<div><b>${t('sectionErr')}</b>${t('sectionErrD')}</div></div>
    <div class="msg info">${ic('info')}<div><b>${t('sectionInfo')}</b>${t('sectionInfoD')}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-act="toast-ok">${t('showToast')}</button><button class="btn" type="button" data-act="banner-on">${t('showBanner')}</button></div>
  </div></section>
  ${kitForm()}
  <section class="panel"><div class="panel-h"><h2>${t('k_dialogs')}</h2><span class="sub">Dialog · Sheet · ConfirmDialog</span></div><div class="panel-b" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-act="confirm-delete">${t('openConfirm')}</button><button class="btn" type="button" data-act="blocking">${t('openBlocking')}</button><button class="btn" type="button" data-act="sheet-demo">${t('openSheet')}</button></div></section>
  <section class="panel"><div class="panel-h"><h2>${t('k_states')}</h2><span class="sub">LoadingState · EmptyState · ErrorState</span></div><div class="grid4" style="padding:12px">${['loading','empty','nores','error'].map(k => `<div class="panel" style="overflow:hidden">${stateBlock(k, 'INV-9999').replace('padding:44px 20px', '')}</div>`).join('')}</div></section>
  ${kitTable()}</div>`;
}

/* ------------------------------------------------------------------ pages: numbers lab (M2) */
const NUM_ROWS = [['r1', 1173000], ['r2', 338238], ['r3', 51763], ['r4', -125000], ['r5', 0], ['r6', 125000000], ['r7', -4750]];
function numPanel(dir, mode) {
  const N = S.num;
  const rows = NUM_ROWS.filter(([, v]) => N.neg || v >= 0);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  const cell = (v) => {
    if (mode === 'c') { const a = Math.abs(v), neg = v < 0; return `<td class="val mode-c guide"><div class="split-num${neg ? ' neg' : ''}"><span class="i">${neg ? '-' : ''}${grp(Math.floor(a / 100))}</span><span class="f">.${String(a % 100).padStart(2, '0')}</span>${N.sym ? `<span class="s">${RIYAL}</span>` : '<span></span>'}</div></td>`; }
    return `<td class="val mode-${mode} guide">${money(v, { sym: N.sym })}</td>`;
  };
  const label = { a:'nlA', b:'nlB', c:'nlC' }[mode];
  return `<section class="panel numpanel" data-np="${dir}-${mode}" data-font="${N.font}" dir="${dir}" lang="${dir === 'rtl' ? 'ar' : 'en'}"><div class="panel-h"><h2>${dir.toUpperCase()} · ${t(label)}</h2><span class="verdict" data-verdict></span></div>
    <table class="numtable"><thead><tr><th style="text-align:start">${t('rowLbl')}</th><th class="mode-${mode}" style="${mode === 'a' ? 'text-align:end' : 'text-align:right'}">${t('amount')}</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${t(k)}</td>${cell(v)}</tr>`).join('')}<tr style="font-weight:700"><td>${t('rT')}</td>${cell(total)}</tr></tbody></table>
    <div class="panel-b" style="padding:8px 12px"><span class="spread" data-spread></span></div></section>`;
}
function pageNumbers() {
  const N = S.num;
  const seg = (key, opts) => `<div class="chips wrap" role="group">${opts.map(([v, l]) => `<button type="button" class="chip" data-num="${key}" data-v="${v}" aria-pressed="${String(N[key]) === String(v)}">${t(l)}</button>`).join('')}</div>`;
  return `<div class="page">${pageHeader({ eyebrow: `<span class="tag-lab">M2 · ${S.lang === 'ar' ? 'غير معتمد' : 'not approved'}</span>`, title: t('numbers'), desc: t('nlDesc') })}
  <section class="panel"><div class="panel-b" style="display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center">
    <span style="display:flex;flex-wrap:wrap;min-width:0;gap:8px;align-items:center"><span class="muted" style="font-size:12.5px">${t('nlNeg')}</span>${seg('neg', [[true, 'all'], [false, 'st_ok']]).replace(t('st_ok'), S.lang === 'ar' ? 'موجبة فقط' : 'Positive only').replace('>' + t('all') + '<', '>' + (S.lang === 'ar' ? 'مع السالبة' : 'With negatives') + '<')}</span>
    <span style="display:flex;flex-wrap:wrap;min-width:0;gap:8px;align-items:center"><span class="muted" style="font-size:12.5px">${t('nlSym')}</span>${seg('sym', [[true, 'all'], [false, 'x']]).replace('>' + t('all') + '<', '>' + RIYAL + '<').replace('>x<', '>' + (S.lang === 'ar' ? 'بدون' : 'None') + '<')}</span>
    <span style="display:flex;flex-wrap:wrap;min-width:0;gap:8px;align-items:center"><span class="muted" style="font-size:12.5px">${t('nlFont')}</span>${seg('font', [['mono', 'fMono'], ['sans', 'fSans'], ['prop', 'fProp']])}</span>
  </div></section>
  <section class="panel"><div class="panel-h"><h2>${t('nlSummary')}</h2></div><div class="panel-b"><table class="rules" id="nl-summary"><thead><tr><th></th><th>RTL</th><th>LTR</th></tr></thead><tbody>${['a','b','c'].map(m => `<tr><th scope="row" style="background:transparent;font-weight:600">${t({ a:'nlA', b:'nlB', c:'nlC' }[m])}</th><td data-sum="rtl-${m}">…</td><td data-sum="ltr-${m}">…</td></tr>`).join('')}</tbody></table><p class="note" style="margin:10px 0 0">${ic('info')}${t('nlRec')}</p></div></section>
  <div class="numlab">${['a','b','c'].map(m => numPanel('rtl', m) + numPanel('ltr', m)).join('')}</div></div>`;
}
/** Measures the x position of each decimal point; returns spread in px. Used by the page and by tests. */
function measureNumbers() {
  const out = {};
  app.querySelectorAll('[data-np]').forEach(panel => {
    const xs = [...panel.querySelectorAll('td.val')].map(td => { const f = td.querySelector('.fr, .f'); if (!f || !f.firstChild) return null; const r = document.createRange(); r.setStart(f.firstChild, 0); r.setEnd(f.firstChild, 1); return r.getBoundingClientRect().left; }).filter(x => x !== null);
    const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0, pass = spread <= 0.75;
    out[panel.dataset.np] = { spread: Math.round(spread * 10) / 10, pass, n: xs.length };
    const v = panel.querySelector('[data-verdict]'); v.className = 'verdict ' + (pass ? 'pass' : 'fail'); v.textContent = pass ? '✓ ' + t('aligned') : '✕ ' + t('misaligned');
    panel.querySelector('[data-spread]').textContent = `${t('nlSpread')}: ${out[panel.dataset.np].spread}px · n=${xs.length}`;
    panel.querySelectorAll('.decline').forEach(n => n.remove());
    if (S.num.guides && xs.length) { const tb = panel.querySelector('.numtable'), pr = tb.getBoundingClientRect(); xs.forEach(x => { const d = document.createElement('i'); d.className = 'decline'; d.style.left = (x - pr.left) + 'px'; d.style.top = '36px'; d.style.bottom = '0'; tb.style.position = 'relative'; tb.appendChild(d); }); }
    const s = app.querySelector(`[data-sum="${panel.dataset.np}"]`); if (s) s.innerHTML = `<span class="verdict ${pass ? 'pass' : 'fail'}" style="font-size:12px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--awj-status-${pass ? 'positive' : 'negative'}-bg);color:var(--awj-status-${pass ? 'positive' : 'negative'}-fg)">${pass ? '✓' : '✕'} ${out[panel.dataset.np].spread}px</span>`;
  });
  return out;
}

/* ------------------------------------------------------------------ pages: rules */
function pageRules() {
  const num = [
    ['حساب بالهللات كأعداد صحيحة؛ العرض وحده يحوّل إلى ريال', 'Compute in integer halalas; only display converts to riyals', `<span class="num">1150050 → </span>${money(1150050)}`, 'CLAUDE.md'],
    ['كل مبلغ عبر <Money> معزول الاتجاه', 'Every amount through <Money>, direction-isolated', money(-125000), 'Apple HIG · [code] 22/559'],
    ['المحاذاة: قرار M2 (انظر مختبر الأرقام)', 'Alignment: decision M2 (see numbers lab)', `<button class="btn ghost" type="button" data-route="numbers" style="height:28px">${t('numbers')}</button>`, 'Fiori · [measured]'],
    ['الرمز ⃁ بعد الرقم · السالب لون + إشارة · الصفر 0.00 · غير المنطبق —', 'Sign ⃁ after the number · negative = colour + sign · zero 0.00 · n/a —', `${money(0)} &nbsp; ${money(-4750)} &nbsp; <span class="muted">—</span>`, 'DESIGN_SYSTEM.md'],
    ['لا اختصار في الجداول والمستندات؛ في مؤشرات لوحة التحكم فقط مع القيمة الكاملة', 'No abbreviations in tables/documents; KPIs only, with the full value available', `<span title="1,120,485.00" aria-label="1,120,485.00 ⃁" class="num">1.12M ${RIYAL}</span>`, 'Polaris'],
    ['الإجمالي من الخادم مع تسمية ما يغطيه', 'Totals from the server, labelled with their scope', `<span class="muted" style="font-size:12px">${t('footInvTot')}</span>`, 'Fiori · Ant · CLAUDE.md'],
    ['أرقام لاتينية دائماً؛ الإدخال يقبل العربية ويحوّلها', 'Latin digits always; input accepts Arabic-Indic and converts', `<span class="num">١٢٣٫٥ → ${fromMinor(toMinor('١٢٣٫٥', 2), 2)}</span>`, '[code] formatting.ts'],
    ['الكمية بمنازل الوحدة (حتى 3) والوحدة عمود/لاحقة', 'Quantity at unit precision (≤3) with the unit as suffix/column', `<span class="num">${qtyFmt(1250)}</span> <span class="muted">${S.lang === 'ar' ? 'لفة' : 'roll'}</span>`, 'v3 DATA_GRID §7'],
    ['التواريخ وأرقام المستندات معزولة LTR وبمحاذاة البداية', 'Dates and document numbers LTR-isolated, start-aligned', `<span class="num">10/11/2026</span> · <span class="docno">INV-2026-0437</span>`, 'v3'],
  ];
  const act = [
    ['زر أساسي واحد لكل صفحة/مجموعة', 'One primary action per page/group', `<button class="btn primary" type="button" data-act="demo" style="height:30px">${t('postShort')}</button>`, 'Ant · Polaris'],
    ['الفعل الهدّام يُؤكَّد، والزر يكرر فعل العنوان', 'Destructive actions confirm; the button repeats the title verb', `<button class="btn danger" type="button" data-act="confirm-delete" style="height:30px">${t('deleteDraft')}</button>`, 'Fluent'],
    ['المعطّل يشرح السبب؛ «للقراءة» ليس «معطّلاً»', 'Disabled explains why; read-only is not disabled', `<span class="muted" style="font-size:12px">${t('disabledWhy')}</span>`, 'Carbon · Fluent'],
    ['زر الإرسال يتعطّل أثناء الطلب (منع التكرار)', 'Submit disables while pending (no double submit)', `<button class="btn primary" type="button" aria-busy="true" style="height:30px">${t('busy')}</button>`, 'Stripe Apps'],
    ['Toast للنجاح فقط، ولا يحمل رقم مستند يحتاجه المستخدم', 'Toast for success only, never carrying a document number the user needs', `<button class="btn" type="button" data-act="toast-ok" style="height:30px">${t('showToast')}</button>`, 'Fiori'],
    ['تغيير غير محفوظ يُحمى عند المغادرة؛ Ctrl S يحفظ المسودة', 'Unsaved changes are guarded on leave; Ctrl S saves the draft', `<span class="kbd">Ctrl S</span>`, 'Stripe · [code]'],
    ['الاختصارات بالمفتاح الفيزيائي (event.code) لتعمل مع لوحة المفاتيح العربية', 'Shortcuts bound to physical keys (event.code) to work on Arabic layouts', `<span class="kbd">Ctrl K</span> <span class="kbd">G</span><span class="kbd">S</span>`, 'Linear · [inference]'],
    ['لا إجراء بالتحويم وحده ولا بالسحب وحده', 'No hover-only or drag-only actions', '—', 'WCAG 2.5.7 · Polaris'],
  ];
  const tbl = (rows) => `<table class="rules"><thead><tr><th>${t('rule')}</th><th>${t('example')}</th><th class="hide-c">${t('source')}</th></tr></thead><tbody>${rows.map(([ar, en, ex, src]) => `<tr><td>${esc(S.lang === 'ar' ? ar : en)}</td><td class="ex">${ex}</td><td class="hide-c muted" style="font-size:12px">${src}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="page">${pageHeader({ eyebrow: `<span class="tag-lab">LAB</span>`, title: t('rules'), desc: t('rulesDesc') })}<section class="panel"><div class="panel-h"><h2>${t('rNum')}</h2></div><div class="tscroll">${tbl(num)}</div></section><section class="panel"><div class="panel-h"><h2>${t('rAct')}</h2></div><div class="tscroll">${tbl(act)}</div></section></div>`;
}

/* ------------------------------------------------------------------ pages: document workspace (sales + purchase share every component) */
const LOCKED_BEFORE = '2026-10-01'; // periods before October 2026 are locked (lab data)
function docErrors(D) {
  const e = {};
  if (!D.party) e.party = D.kind === 'sales' ? 'errCust' : 'errSup';
  if (D.kind === 'purchase' && !D.ref.trim()) e.ref = 'errSupRef';
  if (!D.lines.some(l => !Object.values(l.bad || {}).some(Boolean) && l.qtyM > 0 && l.price > 0)) e.lines = 'errNoLines';
  D.lines.forEach(l => { Object.entries(l.bad || {}).forEach(([f, b]) => { if (b) e[`l${l.id}-${f}`] = f === 'qty' ? 'errQty' : 'errAmt'; }); });
  return e;
}
const lineVal = (l, f) => l.raw?.[f] !== undefined ? l.raw[f] : f === 'qty' ? fromMinor(l.qtyM, 3) : fromMinor(f === 'price' ? l.price : l.disc, 2);
function lineRow(D, l, i, visible = true) {
  const p = PROD[l.p], c = lineCalc(l), priceKey = D.kind === 'sales' ? 'price' : 'cost';
  const inp = (f, w) => `<td data-l="${t(f === 'price' ? priceKey : f === 'disc' ? 'discount' : 'qty')}" style="width:${w}px"><input class="inp n" id="${D.kind}-l${l.id}-${f}" data-lf="${f}" data-doc="${D.kind}" inputmode="decimal" value="${esc(lineVal(l, f))}" aria-label="${t(f === 'price' ? priceKey : f === 'disc' ? 'discount' : 'qty')} ${i + 1}" ${l.bad?.[f] ? 'aria-invalid="true"' : ''}></td>`;
  return `<tr data-line="${l.id}"${visible ? '' : ' hidden'}><td class="hide-c num muted">${i + 1}</td><td class="pr" data-l="${t('item')}"><select class="sel" id="${D.kind}-l${l.id}-p" data-lf="p" data-doc="${D.kind}" aria-label="${t('item')} ${i + 1}">${PROD.filter(x => D.kind === 'sales' || x.stock).map(x => `<option value="${PROD.indexOf(x)}" ${PROD.indexOf(x) === l.p ? 'selected' : ''}>${esc(nm(x))}</option>`).join('')}</select><small>${p.sku}</small></td>${inp('qty', 96)}<td class="hide-c muted" style="width:60px">${nm(p.u)}</td>${inp('price', 116)}${inp('disc', 100)}<td class="ro c-amt" data-l="${t('vat')}" data-lt="vat">${ic('lock', 'lock')}${plain(c.vat)}</td><td class="ro c-amt" data-l="${t('lineTotal')}" data-lt="total" style="font-weight:600">${ic('lock', 'lock')}${plain(c.total)}</td><td class="del" style="width:44px"><button type="button" class="ibtn" data-del="${l.id}" data-doc="${D.kind}" aria-label="delete line ${i + 1}">${ic('trash')}</button></td></tr>`;
}
function docPage(kind) {
  const D = S.docs[kind], tot = totals(D.lines), errs = D.showErrs ? docErrors(D) : {}, nerr = Object.keys(errs).length;
  const locked = D.date < LOCKED_BEFORE;
  const partyList = kind === 'sales' ? CUST : SUPP;
  const party = D.party
    ? `<div class="party"><div style="min-width:0"><b>${esc(nm(D.party))}</b><br><span class="num">${D.party.vat}</span></div><button type="button" class="btn ghost" data-act="party-change" data-doc="${kind}">${t('change')}</button></div>`
    : `<div style="position:relative"><input class="inp" id="${kind}-party" role="combobox" aria-expanded="${D.comboOpen}" aria-controls="${kind}-plist" aria-autocomplete="list" data-party="${kind}" placeholder="${t('pick')}" value="${esc(D.comboQ)}" autocomplete="off" ${errs.party ? `aria-invalid="true" aria-describedby="${kind}-party-e"` : ''}>${D.comboOpen ? `<ul class="menu" id="${kind}-plist" role="listbox" style="inset-inline:0;top:100%">${partyList.filter(c => !D.comboQ || c.ar.includes(D.comboQ) || c.en.toLowerCase().includes(D.comboQ.toLowerCase()) || c.vat.includes(normDigits(D.comboQ))).map((c, i) => `<li role="none"><button type="button" role="option" aria-selected="${i === D.comboIdx}" data-pick="${c.id}" data-doc="${kind}"><span style="display:flex;flex-direction:column;align-items:flex-start"><b style="font-weight:500">${esc(nm(c))}</b><span class="num muted" style="font-size:11.5px">${c.vat}</span></span></button></li>`).join('') || `<li class="muted" style="padding:8px">${t('noResults')}</li>`}</ul>` : ''}</div>${errs.party ? `<span class="err" id="${kind}-party-e">${ic('alert')}${t(errs.party)}</span>` : ''}`;
  const facts = `<div class="fields" style="--cols:4">
    <div class="field span2"><label for="${kind}-party">${t(kind === 'sales' ? 'customer' : 'supplier')} <span class="req" aria-hidden="true">*</span></label>${party}</div>
    <div class="field"><label for="${kind}-date">${t('invDate')}</label><input class="inp" type="date" id="${kind}-date" data-hf="date" data-doc="${kind}" value="${D.date}" ${locked ? `aria-invalid="true" aria-describedby="${kind}-lock"` : ''}></div>
    <div class="field"><label for="${kind}-due">${t('dueDate')}</label><input class="inp" type="date" id="${kind}-due" data-hf="due" data-doc="${kind}" value="${D.due}"></div>
    ${kind === 'sales'
      ? `<div class="field"><label for="sales-pl">${t('priceList')}</label><select class="sel" id="sales-pl"><option>${t('plStd')}</option></select></div><div class="field"><label for="sales-ref">${t('ref')}</label><input class="inp" id="sales-ref" data-hf="ref" data-doc="sales" value="${esc(D.ref)}"></div>`
      : `<div class="field"><label for="purchase-wh">${t('whIn')}</label><select class="sel" id="purchase-wh" data-hf="wh" data-doc="purchase">${WH.map(w => `<option value="${w}" ${w === D.wh ? 'selected' : ''}>${t('wh_' + w)}</option>`).join('')}</select></div><div class="field"><label for="purchase-ref">${t('supRef')} <span class="req" aria-hidden="true">*</span></label><input class="inp num" id="purchase-ref" data-hf="ref" data-doc="purchase" value="${esc(D.ref)}" ${errs.ref ? 'aria-invalid="true" aria-describedby="purchase-ref-e"' : ''}>${errs.ref ? `<span class="err" id="purchase-ref-e">${ic('alert')}${t('errSupRef')}</span>` : ''}</div>`}
    <div class="field span2"><span class="label">${t('branch')}</span><div class="ro-val">${ic('building')}${t('br_' + S.branch)}</div></div></div>`;
  const lerr = new Set(D.lines.filter(l => Object.values(l.bad || {}).some(Boolean)).map(l => l.id)), lq = (D.lq || '').trim().toLowerCase(), onlyErr = D.lf === 'err' && lerr.size > 0;
  const shown = (l) => (!onlyErr || lerr.has(l.id)) && (!lq || nm(PROD[l.p]).toLowerCase().includes(lq) || PROD[l.p].sku.toLowerCase().includes(lq));
  const nShown = D.lines.filter(shown).length, tall = D.lines.length > 10;
  const lbar = `<div class="lines-bar"><span class="cnt num">${t('linesCount', { n: D.lines.length })}</span>${lerr.size ? `<span class="chips" role="group" aria-label="${t('lines')}"><button type="button" class="chip" data-act="lines-filter" data-doc="${kind}" data-v="all" aria-pressed="${!onlyErr}">${t('linesAll')}</button><button type="button" class="chip warn" data-act="lines-filter" data-doc="${kind}" data-v="err" aria-pressed="${onlyErr}">${ic('alert')}${t('linesErr', { n: lerr.size })}</button></span>` : ''}${tall ? `<label class="srch lfind">${ic('search')}<input class="inp" id="${kind}-lq" data-lq="${kind}" type="search" placeholder="${t('linesFind')}" aria-label="${t('linesFind')}" value="${esc(D.lq || '')}"></label>` : ''}</div>`;
  const lines = `${lbar}<div class="tscroll${tall ? ' tall' : ''}"${tall ? ` tabindex="0" role="region" aria-label="${t('lines')}"` : ''}><table class="lines"><thead><tr><th class="hide-c">#</th><th>${t('item')}</th><th class="c-amt">${t('qty')}</th><th class="hide-c">${t('unit')}</th><th class="c-amt">${t(kind === 'sales' ? 'price' : 'cost')}</th><th class="c-amt">${t('discount')}</th><th class="c-amt">${t('vat')}</th><th class="c-amt">${t('lineTotal')}</th><th><span class="sr">actions</span></th></tr></thead><tbody>${D.lines.map((l, i) => lineRow(D, l, i, shown(l))).join('')}</tbody></table>${nShown ? '' : `<p class="state" style="padding:16px">${t('linesNoMatch')}</p>`}</div>
    <div style="display:flex;gap:10px;align-items:center;padding:10px 12px"><button class="btn" type="button" id="${kind}-addline" data-act="add-line" data-doc="${kind}">${ic('plus')}${t('addLine')}</button><span class="muted hide-c" style="font-size:12px">${t('addHint')}</span></div>`;
  const cells = [['sub', tot.sub], ['disc', -tot.disc], ['vat15', tot.vat]];
  const outcome = `<div class="outcome" aria-live="polite"><span class="lbl"><span>${t(kind === 'sales' ? 'grand' : 'grandP')}</span><span>${D.lines.length} ${t('lines')}</span></span><span class="amt" data-tot="total">${moneyOutcome(tot.total)}</span></div>`;
  const postDisabled = locked;
  return `<div class="page">
    <div class="doc-h"><div class="id"><span class="type">${t(kind === 'sales' ? 'salesInv' : 'purchInv')} · ${t(kind === 'sales' ? 'salesNote' : 'purchNote')}</span><h1><span class="num">${kind === 'sales' ? 'INV-2026-0437' : 'PUR-0513'}</span>${statusBadge('document', 'draft')}</h1></div>
      <ol class="lifecycle" aria-label="lifecycle"><li class="on cur" aria-current="step"><i></i><span><b>${t('draft')}</b><small>${t('lcDraftC')}</small></span></li><li><i></i><span><b>${t('posted')}</b><small>${t('lcPostedC')}</small></span></li><li><i></i><span><b>${t('paidSt')}</b><small>${t('lcPaidC')}</small></span></li></ol></div>
    <div class="cmdbar" role="toolbar" aria-label="${t('more')}"><span class="state-l"><span class="${D.dirty ? 'dirty' : 'clean'}"></span>${D.dirty ? t('unsaved') : t('savedAt')}</span><span class="grow"></span>
      <button class="btn hide-c" type="button" data-act="save-draft" data-doc="${kind}">${ic('save')}${t('saveDraft')}<span class="kbd hide-m">Ctrl S</span></button>
      <span class="menu-wrap"><button type="button" class="btn" data-act="menu" data-menu="doc" aria-label="${t('more')}" aria-haspopup="menu" aria-expanded="${S.overlay?.menu === 'doc'}">${ic('more')}<span class="hide-c">${t('more')}</span></button>${S.overlay?.menu === 'doc' ? `<ul class="menu" role="menu" style="inset-inline-end:0;top:100%"><li role="none"><button type="button" role="menuitem" data-act="save-draft" data-doc="${kind}">${ic('save')}${t('saveDraft')}</button></li><li role="none"><button type="button" role="menuitem" data-act="demo">${ic('printer')}${t('print')}</button></li><li role="none"><button type="button" role="menuitem" data-act="demo">${ic('copy')}${t('duplicate')}</button></li><li role="none"><button type="button" role="menuitem" class="danger" data-act="confirm-delete" data-doc="${kind}">${ic('trash')}${t('deleteDraft')}</button></li></ul>` : ''}</span>
      <button class="btn primary hide-c" type="button" data-act="post" data-doc="${kind}" ${postDisabled ? `aria-disabled="true" aria-describedby="${kind}-lock"` : ''}>${ic('check')}${t('post')}</button></div>
    <p class="draft-note">${ic('info')}<span>${t('draftNote')}</span></p>${EXT.docNotice ? EXT.docNotice(kind, API) : ''}
    ${locked ? `<div class="msg warn" id="${kind}-lock" role="status">${ic('lock')}<div><b>${t('lockedPeriodT')}</b>${t('lockedPeriodP')}</div></div>` : ''}
    ${nerr ? `<div class="err-summary" role="alert" tabindex="-1" id="${kind}-sum"><b>${t('errSummary', { n: nerr })}</b><ul>${Object.entries(errs).map(([k, v]) => { const m = k.match(/^l(\d+)-/), n = m ? D.lines.findIndex(l => l.id === Number(m[1])) + 1 : 0; return `<li><button type="button" class="lnk" data-focus="${k === 'party' ? '#' + kind + '-party' : k === 'ref' ? '#purchase-ref' : k === 'lines' ? '#' + kind + '-addline' : '#' + kind + '-' + k}">${n ? `<b class="num">${t('lineN', { n })}</b> · ` : ''}${t(v)}</button></li>`; }).join('')}</ul></div>` : ''}
    <section class="panel"><div class="panel-b">${facts}</div></section>
    <section class="panel"><div class="panel-h"><h2>${t('lines')}</h2><span class="sub">LineGrid</span></div>${lines}</section>
    <div class="dock"><div class="cells">${cells.map(([k, v]) => `<div class="cell"><span>${t(k)}</span><b data-tot="${k}">${money(v, { sym: false })}</b></div>`).join('')}</div>${outcome}</div>
    <div class="mbar">${outcome.replace('aria-live="polite"', '')}<button class="btn primary" type="button" data-act="post" data-doc="${kind}" ${postDisabled ? 'aria-disabled="true"' : ''}>${t('postShort')}</button></div>
    <p class="note">${ic('info')}<span><b>${t('diffTitle')}:</b> ${t('diff1')} · ${t('diff2')} · ${t('diff3')}</span></p></div>`;
}
function updateDocTotals(kind) {
  const D = S.docs[kind], tot = totals(D.lines);
  app.querySelectorAll('[data-tot]').forEach(el => { const k = el.dataset.tot; if (k === 'total') el.innerHTML = moneyOutcome(tot.total); else el.innerHTML = money(k === 'disc' ? -tot.disc : k === 'sub' ? tot.sub : tot.vat, { sym: false }); });
  D.lines.forEach(l => { const row = app.querySelector(`tr[data-line="${l.id}"]`); if (!row) return; const c = lineCalc(l); row.querySelector('[data-lt="vat"]').innerHTML = ic('lock', 'lock') + plain(c.vat); row.querySelector('[data-lt="total"]').innerHTML = ic('lock', 'lock') + plain(c.total); });
  const st = app.querySelector('.state-l'); if (st) st.innerHTML = `<span class="dirty"></span>${t('unsaved')}`;
}

/* ------------------------------------------------------------------ pages: inventory (P1 list + peek) */
const stockOf = (p, wh) => p.stock ? (wh === 'all' ? WH.reduce((s, w) => s + p.stock[w], 0) : p.stock[wh]) : null;
const stockStatus = (p, wh) => { const q = stockOf(p, wh); if (q === null) return null; const r = wh === 'all' ? p.reorder * 3 : p.reorder; return q === 0 ? 'out' : q < r ? 'low' : 'ok'; };
function invRows() {
  const I = S.inv, q = normDigits(I.q).trim().toLowerCase();
  const rows = PROD.filter(p => p.stock && (!q || p.sku.toLowerCase().includes(q) || p.ar.includes(q) || p.en.toLowerCase().includes(q)) && (I.st === 'all' || stockStatus(p, I.wh) === I.st));
  const dir = I.sort.d === 'asc' ? 1 : -1, val = (p) => ({ sku:p.sku, name:nm(p), qty:stockOf(p, I.wh), value:stockOf(p, I.wh) * p.cost })[I.sort.k];
  return rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), S.lang)) * dir; });
}
function peekPanel(p) {
  const mv = MOVES[p.sku] || MOVES.default, total = stockOf(p, 'all');
  return `<div class="peek-h"><div style="min-width:0"><span class="docno">${p.sku}</span><h3>${esc(nm(p))}</h3><div style="margin-top:6px">${statusBadge('stock', stockStatus(p, S.inv.wh))}</div></div><button type="button" class="ibtn" data-act="peek-close" aria-label="${t('close')}">${ic('x')}</button></div>
    <div class="peek-b"><div><div class="muted" style="font-size:12px;margin-bottom:8px">${t('byWh')}</div>${WH.map(w => { const qn = p.stock[w], st = qn === 0 ? 'out' : qn < p.reorder ? 'low' : 'ok'; return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:10px;align-items:center;margin-bottom:8px;font-size:13px"><div><div style="display:flex;justify-content:space-between;gap:8px"><span>${t('wh_' + w)}</span><span class="num c-amt">${qtyFmt(qn * 1000)}</span></div><div class="stockbar ${st === 'ok' ? '' : st}"><i style="width:${Math.min(100, Math.round(qn * 100 / Math.max(1, total)))}%"></i></div></div><span>${statusBadge('stock', st)}</span></div>`; }).join('')}</div>
    <dl class="kvl"><dt>${t('reorder')}</dt><dd><span class="num">${p.reorder}</span> ${nm(p.u)}</dd>${S.inv.costPerm ? `<dt>${t('avgCost')}</dt><dd class="c-amt">${money(p.cost)}</dd><dt>${t('value')}</dt><dd class="c-amt">${money(total * p.cost)}</dd>` : ''}</dl>
    <div><div class="muted" style="font-size:12px;margin-bottom:6px">${t('moves')}</div>${mv.map(([k, qm, d, ref]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--awj-border-hairline);font-size:13px"><span style="display:flex;gap:6px;align-items:center">${ic(k === 'in' ? 'arrowIn' : 'arrowOut').replace('<svg', `<svg width="14" height="14" style="color:var(--awj-status-${k === 'in' ? 'positive' : 'neutral'}-fg)"`)}${t(k === 'in' ? 'mvIn' : 'mvOut')} · <span class="docno">${ref}</span></span><span class="num">${qtyFmt(qm)} · ${fmtDate(d)}</span></div>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="demo">${t('issue')}</button><button class="btn" type="button" data-act="demo">${t('transfer')}</button></div></div>`;
}
function pageInventory() {
  const I = S.inv, rows = invRows(), cost = I.costPerm;
  const viewDefs = { all:{ st:'all', wh:'all' }, low:{ st:'low', wh:'jbl' } };
  const modified = viewDefs[I.view] && (viewDefs[I.view].st !== I.st || viewDefs[I.view].wh !== I.wh || I.q);
  const value = rows.reduce((s, p) => s + stockOf(p, I.wh) * p.cost, 0); // stands in for the server aggregate
  const chips = ['all','low','out'].map(k => `<button type="button" class="chip" data-ist="${k}" aria-pressed="${I.st === k}">${k === 'all' ? t('all') : t('st_' + k)} <span class="c">${PROD.filter(p => p.stock && (k === 'all' || stockStatus(p, I.wh) === k)).length}</span></button>`).join('');
  const th = (k, l, cls = '') => { const s = I.sort.k === k ? (I.sort.d === 'asc' ? 'ascending' : 'descending') : 'none'; return `<th class="${cls}" aria-sort="${s}"><button type="button" data-isort="${k}">${t(l)}${ic('sort')}</button></th>`; };
  let body;
  if (S.demo !== 'ready') body = stateBlock(S.demo);
  else if (!rows.length) body = stateBlock('nores', I.q);
  else body = `<div class="tscroll cardable" tabindex="0" role="region" aria-label="${t('invTitle')}"><table class="dt"><thead><tr><th class="c-chk"><input type="checkbox" data-isel="all" aria-label="select all" ${rows.every(p => I.sel.has(p.sku)) ? 'checked' : ''}></th>${th('name','item')}<th class="p3">${t('category')}</th>${th('qty','onHand','c-qty')}<th class="p2 c-qty">${t('reorder')}</th><th>${t('status')}</th>${cost ? `<th class="c-amt p3">${t('avgCost')}</th>${th('value','value','c-amt')}` : ''}</tr></thead><tbody>${rows.map(p => { const qn = stockOf(p, I.wh); return `<tr data-peek="${p.sku}" aria-selected="${I.sel.has(p.sku)}" class="${I.peek === p.sku || I.active === p.sku ? 'active' : ''}"><td class="c-chk"><input type="checkbox" data-isel="${p.sku}" aria-label="${p.sku}" ${I.sel.has(p.sku) ? 'checked' : ''}></td><td><div class="two"><b>${esc(nm(p))}</b><span class="num">${p.sku}</span></div></td><td class="p3">${nm(p.cat)}</td><td class="c-qty"><span class="num">${qtyFmt(qn * 1000)}</span> <span class="muted" style="font-size:12px">${nm(p.u)}</span></td><td class="c-qty p2"><span class="num">${I.wh === 'all' ? p.reorder * 3 : p.reorder}</span></td><td>${statusBadge('stock', stockStatus(p, I.wh))}</td>${cost ? `<td class="c-amt p3">${money(p.cost)}</td><td class="c-amt">${money(qn * p.cost)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>
    <div class="mlist">${rows.map(p => { const qn = stockOf(p, I.wh); return `<button type="button" class="mcard" data-peek="${p.sku}"><div class="r"><b>${esc(nm(p))}</b>${statusBadge('stock', stockStatus(p, I.wh))}</div><dl class="kv"><dt>${t('sku')}</dt><dd class="num">${p.sku}</dd><dt>${t('onHand')}</dt><dd class="num c-amt">${qtyFmt(qn * 1000)} ${nm(p.u)}</dd><dt>${t('reorder')}</dt><dd class="num">${I.wh === 'all' ? p.reorder * 3 : p.reorder}</dd>${cost ? `<dt>${t('value')}</dt><dd class="c-amt">${money(qn * p.cost)}</dd>` : ''}</dl></button>`; }).join('')}</div>
    <div class="dt-foot"><span class="tot"><span>${t('footCount', { n: rows.length })}</span>${cost ? `<span>·</span><span>${t('footValue')}:</span><b>${money(value)}</b>` : `<span>·</span><span class="muted">${t('footNoCost')}</span>`}</span></div>`;
  const peekP = I.peek && windowClass() === 'large' ? PROD.find(p => p.sku === I.peek) : null;
  return `<div class="page">${pageHeader({ eyebrow: t('g_inv'), title: t('invTitle'), desc: t('invDesc'),
      secondary: [`<label class="chip" style="cursor:pointer" title="${t('viewCostHint')}"><input type="checkbox" data-act="cost-perm" ${cost ? 'checked' : ''} style="accent-color:var(--awj-action-primary)"> ${t('viewCost')}</label>`],
      primary: `<button class="btn primary" type="button" data-act="demo">${ic('plus')}${t('newPermit')}</button>` })}
    <p class="perm-note">${ic('lock')}${t('viewCostHint')}</p>
    <div class="split ${peekP ? 'peeking' : ''}"><section class="panel dt-wrap">
      <div class="fbar"><label class="srch">${ic('search')}<input class="inp" id="iq" type="search" placeholder="${t('searchShort')}" aria-label="${t('searchShort')}" value="${esc(I.q)}"></label>
        <label class="view-sel"><span class="muted" style="font-size:12.5px">${t('warehouse')}</span><select class="sel" data-iwh>${['all', ...WH].map(w => `<option value="${w}" ${I.wh === w ? 'selected' : ''}>${w === 'all' ? t('allWh') : t('wh_' + w)}</option>`).join('')}</select></label>
        <label class="view-sel"><span class="muted" style="font-size:12.5px">${t('views')}</span><select class="sel" data-iview>${Object.keys(viewDefs).map(v => `<option value="${v}" ${I.view === v ? 'selected' : ''}>${t('v_' + v)}${I.view === v && modified ? ' *' : ''}</option>`).join('')}</select></label>
        <div class="chips" role="group" aria-label="${t('status')}">${chips}</div></div>
      <div class="urlstate">?view=${I.view}&status=${I.st}&wh=${I.wh}${I.q ? '&q=' + encodeURIComponent(I.q) : ''}${modified ? ` · ${t('v_mod')}` : ''}</div>
      ${I.sel.size ? `<div class="bulk"><b class="num">${I.sel.size}</b> ${t('selected')}<span class="grow"></span><button class="btn" type="button" data-act="demo">${t('countSel')}</button><button class="btn" type="button" data-act="demo">${t('exportSel')}</button><button class="btn" type="button" data-act="inv-clearsel">${t('clearSel')}</button></div>` : ''}
      ${body}</section>${peekP ? `<aside class="peek" aria-label="${esc(nm(peekP))}">${peekPanel(peekP)}</aside>` : ''}</div></div>`;
}

/* ------------------------------------------------------------------ pages: fuel shift (Floor posture) */
const readOf = (n) => S.readings[n.id] !== undefined ? S.readings[n.id] : n.close;
const shiftReady = () => { const left = NOZ.filter(n => readOf(n) === null).length, below = NOZ.filter(n => readOf(n) !== null && readOf(n) < n.open).length; return { left, below, ok: left === 0 && below === 0 }; };
function pageShift() {
  const R = shiftReady(); let total = 0, complete = true;
  const cards = NOZ.map(n => {
    const c = readOf(n), raw = S.readings[n.id + ':raw'], bad = c !== null && c < n.open, ml = c !== null && !bad ? c - n.open : null, sales = ml === null ? null : divRound(ml * n.price, 1000);
    if (sales === null) complete = false; else total += sales;
    return `<article class="panel nz"><div class="nz-h"><b>${n.id} · ${t('pump')} ${n.pump}</b><span class="prod"><i style="background:${n.color}"></i>${t(n.prod)}</span></div>
      <div class="rd"><div class="field"><label for="op-${n.id}">${t('opening')}</label><input class="inp" id="op-${n.id}" value="${fromMinor(n.open, 3)}" readonly aria-readonly="true" tabindex="-1"></div><div class="field"><label for="rd-${n.id}">${t('closing')}</label><input class="inp" id="rd-${n.id}" data-reading="${n.id}" inputmode="decimal" placeholder="${t('enterReading')}" value="${raw !== undefined ? esc(raw) : c !== null ? fromMinor(c, 3) : ''}" ${bad ? `aria-invalid="true" aria-describedby="e-${n.id}"` : ''}></div></div>
      ${bad ? `<span class="err" id="e-${n.id}" style="display:flex;gap:5px;font-size:12.5px;color:var(--awj-status-negative-fg)">${ic('alert').replace('<svg', '<svg width="13" height="13"')}${t('errBelow')}</span>` : ''}
      <div class="out"><span>${t('liters')}</span><b class="num">${ml === null ? '—' : qtyFmt(ml)}</b></div><div class="out" style="border:0;padding:0"><span>${t('estSales')}</span><b>${sales === null ? '—' : money(sales)}</b></div></article>`;
  }).join('');
  const nextBtn = R.ok ? `<button class="btn primary" type="button" data-act="save-readings">${t('saveReadings')}</button>` : `<button class="btn primary" type="button" data-act="focus-reading">${R.left ? t('start') : t('fix')}</button>`;
  return `<div class="page" data-posture="floor">${pageHeader({ eyebrow: `<span class="st st-info">${ic('circle')}${t('shiftOpen')}</span> · ${t('shiftSince')}`, title: t('shiftTitle'), desc: `<span class="tag-lab">${t('postureNote')}</span>`, primary: `<button class="btn primary hide-c" type="button" data-act="save-readings" ${R.ok ? '' : 'disabled'}>${ic('check')}${t('saveReadings')}</button>` })}
    <section class="panel next"><span class="q">${ic('fuel')}</span><span class="t"><b>${t('nextStep')}: ${t('nextT')}</b><span>${t('nextP', { n: R.left })}</span></span>${nextBtn}</section>
    <div class="nozzles">${cards}</div>
    <section class="outcome" style="border-radius:var(--awj-radius-surface)"><span class="lbl"><span>${t('shiftTotal')}</span><span>${complete ? '' : t('partial')}</span></span><span class="amt">${moneyOutcome(total)}</span></section>
    <p class="note">${ic('info')}${t('estNote')}</p></div>`;
}

/* ------------------------------------------------------------------ pages: identity layer + contract checker */
const ALLOW = new Set(['--awj-action-primary','--awj-action-primary-hover','--awj-action-primary-pressed','--awj-action-primary-fg','--awj-brand-soft','--awj-state-hover','--awj-state-selected','--awj-state-selected-edge','--awj-state-focus-ring','--awj-state-focus-halo','--awj-surface-desk','--awj-surface-outcome','--awj-outcome-rule','--awj-font-ui','--awj-font-num','--awj-radius-control','--awj-radius-surface','--awj-radius-sheet',
  '--awj-shell-bg','--awj-shell-fg','--awj-shell-fg-muted','--awj-shell-line','--awj-shell-hover','--awj-shell-active-bg','--awj-shell-active-fg','--awj-shell-active-shadow','--awj-shell-apex','--awj-shell-field-bg','--awj-shell-field-line','--awj-shell-focus-ring','--awj-shell-brandmark-bg',
  // L4 visual hooks (Signature V3 proposal): frame, panels, display type, figures, shape, hero band, wordmark
  '--awj-topbar-bg','--awj-topbar-fg','--awj-topbar-muted','--awj-topbar-line','--awj-topbar-chip-bg','--awj-topbar-field-bg','--awj-topbar-focus','--awj-panel-border','--awj-panel-shadow','--awj-panel-title-size','--awj-panel-title-weight','--awj-panel-title-tracking','--awj-panel-title-case','--awj-font-display','--awj-display-size','--awj-display-weight','--awj-display-tracking','--awj-figure-font','--awj-figure-weight','--awj-figure-size','--awj-pill-radius','--awj-icon-stroke','--awj-page-max','--awj-hero-bg','--awj-hero-fg','--awj-hero-muted','--awj-hero-line','--awj-wordmark','--awj-hero-bleed','--awj-hero-cta-bg','--awj-hero-cta-fg','--awj-kpi-gap','--awj-kpi-frame','--awj-kpi-radius','--awj-kpi-clip']);
const TRACKED = [...ALLOW, '--awj-status-positive-fg','--awj-status-negative-fg','--awj-status-warning-fg','--awj-status-info-fg','--awj-status-positive-bg','--awj-status-negative-bg','--awj-text-primary','--awj-text-secondary','--awj-text-tertiary','--awj-surface-paper','--awj-surface-band','--awj-border-control','--awj-border-hairline','--awj-row-1l','--awj-control-h'];
function probe(mode, identity, theme = 'default') { const p = document.createElement('div'); p.className = 'fx'; p.dataset.mode = mode; p.dataset.identity = identity; p.dataset.theme = theme; p.style.cssText = 'position:absolute;visibility:hidden;width:0;height:0;contain:strict'; document.body.appendChild(p); const cs = getComputedStyle(p), o = {}; TRACKED.forEach(k => o[k] = cs.getPropertyValue(k).trim()); p.remove(); return o; }
function hexOf(c) { if (!c) return null; c = c.trim(); if (c.startsWith('#')) return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c.slice(0, 7); const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b] = m[1].split(',').map(x => parseFloat(x)); return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); }
const lum = (h) => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
const ratio = (a, b) => { const x = lum(hexOf(a)), y = lum(hexOf(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const CHECKS = [
  ['text-primary / paper', '--awj-text-primary', '--awj-surface-paper', 4.5],
  ['text-secondary / paper', '--awj-text-secondary', '--awj-surface-paper', 4.5],
  ['text-tertiary / paper', '--awj-text-tertiary', '--awj-surface-paper', 4.5],
  ['action-fg / action', '--awj-action-primary-fg', '--awj-action-primary', 4.5],
  ['action (link) / paper', '--awj-action-primary', '--awj-surface-paper', 4.5],
  ['focus-ring / paper', '--awj-state-focus-ring', '--awj-surface-paper', 3],
  ['border-control / paper', '--awj-border-control', '--awj-surface-paper', 3],
  ['shell-fg / shell-bg', '--awj-shell-fg', '--awj-shell-bg', 4.5],
  ['shell-fg-muted / shell-bg', '--awj-shell-fg-muted', '--awj-shell-bg', 4.5],
  ['shell-apex / shell-bg', '--awj-shell-apex', '--awj-shell-bg', 3],
  ['positive / paper', '--awj-status-positive-fg', '--awj-surface-paper', 4.5],
  ['negative / paper', '--awj-status-negative-fg', '--awj-surface-paper', 4.5],
  ['warning / paper', '--awj-status-warning-fg', '--awj-surface-paper', 4.5],
  ['topbar-fg / topbar-bg', '--awj-topbar-fg', '--awj-topbar-bg', 4.5],
  ['topbar-muted / topbar-bg', '--awj-topbar-muted', '--awj-topbar-bg', 4.5],
  ['topbar-focus / topbar-bg', '--awj-topbar-focus', '--awj-topbar-bg', 3],
  ['hero-fg / hero-bg', '--awj-hero-fg', '--awj-hero-bg', 4.5],
  ['hero-muted / hero-bg', '--awj-hero-muted', '--awj-hero-bg', 4.5],
  ['wordmark / shell-bg', '--awj-wordmark', '--awj-shell-bg', 3],
  ['hero-cta-fg / hero-cta-bg', '--awj-hero-cta-fg', '--awj-hero-cta-bg', 4.5],
  ['text-secondary / desk', '--awj-text-secondary', '--awj-surface-desk', 4.5],
];
/** Contract: allow-list only, locked tokens untouched, contrast pairs pass — in light and dark. */
function contract(identity) {
  const res = { identity, modes: {}, accepted: true, allowedChanged: 0, lockedChanged: [] };
  for (const mode of ['light', 'dark']) {
    const base = probe(mode, 'base'), pack = probe(mode, identity);
    const changed = TRACKED.filter(k => base[k] !== pack[k]);
    const locked = changed.filter(k => !ALLOW.has(k));
    res.allowedChanged = Math.max(res.allowedChanged, changed.length - locked.length);
    locked.forEach(k => { if (!res.lockedChanged.includes(k)) res.lockedChanged.push(k); });
    const checks = CHECKS.map(([name, fg, bg, min]) => { const r = ratio(pack[fg], pack[bg]); return { name, min, r: Math.round(r * 100) / 100, pass: r >= min }; });
    res.modes[mode] = checks;
    if (locked.length || checks.some(c => !c.pass)) res.accepted = false;
  }
  return res;
}
function pageIdentity() {
  const c = contract(S.identity);
  const layers = [['L0','L0d','open'],['L1','L1d','locked'],['L2','L2d','locked'],['L3','L3d','locked'],['L4','L4d','open']];
  return `<div class="page">${pageHeader({ eyebrow: `<span class="tag-lab">M10 · ${S.lang === 'ar' ? 'مقترح' : 'proposed'}</span>`, title: t('identity'), desc: t('idDesc') })}
  <div class="grid2"><section class="panel"><div class="panel-h"><h2>${t('idLayers')}</h2></div><div class="panel-b layers">${layers.map(([k, d, s]) => `<div class="layer"><b>${t(k)}</b><span>${t(d)}</span><span class="lk ${s}">${s === 'locked' ? t('locked') : t('openL')}</span></div>`).join('')}</div></section>
  <section class="panel"><div class="panel-h"><h2>${t('idPack')}</h2><span class="sub">${t('overrides', { a: c.allowedChanged, l: c.lockedChanged.length })}</span></div><div class="panel-b" style="display:flex;flex-direction:column;gap:12px">
    <div class="chips" role="group" aria-label="${t('idPack')}">${['base','brass','fayrouz','invalid'].map(k => `<button type="button" class="chip" data-identity="${k}" aria-pressed="${S.identity === k}">${t('pk_' + k)}</button>`).join('')}</div>
    <div class="msg ${c.accepted ? 'info' : 'err'}" role="status" data-contract-verdict="${c.accepted ? 'accepted' : 'rejected'}">${ic(c.accepted ? 'check' : 'x')}<div><b>${t('idVerdict')}: ${c.accepted ? t('accepted') : t('rejected')}</b>${c.lockedChanged.length ? `<span class="num" style="display:block;font-size:12px">${c.lockedChanged.join(' · ')}</span>` : ''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="demo">${t('primary')}</button><button class="btn" type="button" data-act="demo">${t('secondary')}</button>${statusBadge('invoice', 'overdue')}${statusBadge('invoice', 'paid')}${money(-125000)}</div>
  </div></section></div>
  <section class="panel"><div class="panel-h"><h2>${t('idContract')}</h2><span class="sub">WCAG 2.2 AA · ${t(S.identity === 'base' ? 'pk_base' : 'pk_' + S.identity)}</span></div><div class="tscroll" tabindex="0" role="region" aria-label="${t('idContract')}"><table class="rules contract"><thead><tr><th>${t('idCheck')}</th><th>${t('idReq')}</th><th>${t('idLight')}</th><th>${t('idDark')}</th></tr></thead><tbody>${CHECKS.map((ch, i) => { const l = c.modes.light[i], d = c.modes.dark[i]; const cell = (x) => `<span class="verdict ${x.pass ? 'pass' : 'fail'}">${x.pass ? '✓' : '✕'} ${x.r.toFixed(2)}:1</span>`; return `<tr><td class="num">${ch[0]}</td><td class="num">≥ ${ch[3]}:1</td><td>${cell(l)}</td><td>${cell(d)}</td></tr>`; }).join('')}</tbody></table></div></section></div>`;
}

/* ------------------------------------------------------------------ overlays */
function overlay() {
  const o = S.overlay; if (!o || o.menu) return '';
  if (o.t === 'palette') return `<div class="ovl top" data-scrim>${palette()}</div>`;
  const sheet = (title, body, side = 'start') => `<div class="ovl ${windowClass() === 'compact' ? 'bottom' : side}" data-scrim><div class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-h"><h3>${title}</h3><button type="button" class="ibtn" data-act="close" aria-label="${t('close')}">${ic('x')}</button></div><div class="sheet-b">${body}</div></div></div>`;
  if (o.t === 'navsheet') return sheet(t('menu'), NAV.map(([g, icn, items]) => `<div class="sheet-grp">${t(g)}</div>${items.map(([k, r]) => `<button type="button" class="sheet-a" data-route="${r || ''}" data-label="${k}" ${r === S.route ? 'aria-current="page"' : ''}>${ic(icn)}${t(k)}</button>`).join('')}`).join(''));
  if (o.t === 'group') { const [g, icn, items] = NAV.find(n => n[0] === o.g); return sheet(t(g), items.map(([k, r]) => `<button type="button" class="sheet-a" data-route="${r || ''}" data-label="${k}" ${r === S.route ? 'aria-current="page"' : ''}>${ic(icn)}${t(k)}</button>`).join('')); }
  if (o.t === 'create') return sheet(t('create'), [['newSales','cart','sales'],['newPurch','truck','purchase'],['newReceipt','send',null],['newPermit','box',null]].map(([k, i, r]) => `<button type="button" class="sheet-a" data-route="${r || ''}" data-label="${k}">${ic(i)}${t(k)}</button>`).join(''));
  if (o.t === 'context') return sheet(t('ctxTitle'), `<div class="sheet-grp">${t('branch')}</div>${['dmm','jbl','khb'].map(b => `<button type="button" class="sheet-a" data-branch="${b}" ${S.branch === b ? 'aria-current="page"' : ''}>${ic('building')}${t('br_' + b)}</button>`).join('')}<div class="sheet-grp">${t('period')}</div><div class="sheet-a" style="cursor:default">${ic('calendar')}${t('periodOpen')}</div><div class="sheet-a" style="cursor:default;color:var(--awj-text-tertiary)">${ic('lock')}${S.lang === 'ar' ? 'سبتمبر 2026 · مقفلة' : 'Sep 2026 · locked'}</div>`);
  if (o.t === 'inbox') return sheet(t('inbox'), `<div class="tabs" role="tablist" style="padding:0;margin-bottom:6px"><button type="button" role="tab" aria-selected="true">${t('priority')} · 3</button><button type="button" role="tab" aria-selected="false" data-act="demo">${t('all')}</button></div>${[['inbox1','inbox1d','fuel','shift'],['inbox2','inbox2d','alert','kit'],['inbox3','inbox3d','box','inventory']].map(([h, d, i, r]) => `<div style="display:flex;gap:10px;padding:10px 4px;border-bottom:1px solid var(--awj-border-hairline)">${ic(i).replace('<svg', '<svg width="18" height="18" style="flex:none;color:var(--awj-status-warning-fg);margin-top:2px"')}<div style="flex:1;min-width:0"><b style="font-weight:600;font-size:13.5px">${t(h)}</b><div class="muted" style="font-size:12.5px">${t(d)}</div><div style="display:flex;gap:6px;margin-top:6px"><button class="btn primary" type="button" data-route="${r}" style="height:30px">${t('open')}</button><button class="btn ghost" type="button" data-act="demo" style="height:30px">${t('snooze')}</button></div></div></div>`).join('')}`, 'start');
  if (o.t === 'sheet-demo') return sheet(t('sheetT'), `<p style="margin:0">${t('sheetP')}</p>`);
  if (o.t === 'peek') { const p = PROD.find(x => x.sku === o.sku); return `<div class="ovl ${windowClass() === 'compact' ? 'bottom' : 'start'}" data-scrim><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(nm(p))}">${peekPanel(p)}</div></div>`; }
  const dlg = (icCls, icn, title, body, foot) => `<div class="ovl center" data-scrim><div class="dlg" role="${icCls === 'danger' ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div class="dlg-h"><span class="ic ${icCls}">${ic(icn)}</span><div><h3 id="dlg-t">${title}</h3><p id="dlg-d">${body}</p></div></div>${o.extra || ''}<div class="dlg-f">${foot}</div></div></div>`;
  if (o.t === 'confirm-delete') return dlg('danger', 'trash', t('deleteT'), t('deleteP'), `<button class="btn" type="button" data-act="close">${t('cancel')}</button><button class="btn danger" type="button" data-act="do-delete" data-doc="${o.doc || ''}">${t('deleteDraft')}</button>`);
  if (o.t === 'blocking') return dlg('danger', 'alert', t('blockingT'), t('blockingP'), `<button class="btn primary" type="button" data-act="close">${t('blockingOk')}</button>`);
  if (o.t === 'leave') return dlg('info', 'save', t('leaveT'), t('leaveP'), `<button class="btn" type="button" data-act="close">${t('stay')}</button><button class="btn" type="button" data-act="leave-go">${t('leave')}</button><button class="btn primary" type="button" data-act="leave-save">${t('saveLeave')}</button>`);
  if (o.t === 'shortcuts') return dlg('info', 'keyboard', t('shortcuts'), '', `<button class="btn primary" type="button" data-act="close">${t('close')}</button>`).replace('<p id="dlg-d"></p>', `<table class="rules" id="dlg-d" style="margin-top:8px">${[['Ctrl K', S.lang === 'ar' ? 'لوحة الأوامر' : 'Command palette'], ['G S · G P · G I · G F', S.lang === 'ar' ? 'انتقال: مبيعات · مشتريات · مخزون · وردية' : 'Go: sales · purchase · inventory · shift'], ['/', S.lang === 'ar' ? 'تركيز بحث القائمة' : 'Focus list search'], ['J / K · ↑ ↓ · Enter', S.lang === 'ar' ? 'تنقّل الصفوف وفتح المعاينة' : 'Move rows, open peek'], ['Ctrl S', t('saveDraft')], ['Ctrl Enter', t('post')], ['Alt N', t('addLine')], ['?', t('shortcuts')]].map(([k, v]) => `<tr><td><span class="kbd">${k}</span></td><td>${v}</td></tr>`).join('')}</table>`);
  if (o.t === 'post') {
    const D = S.docs[o.doc], tot = totals(D.lines);
    const rows = o.doc === 'sales'
      ? [['1130','acc1130', tot.total, 0], ['4110','acc4110', 0, tot.net], ['2120','acc2120', 0, tot.vat]]
      : [['1140','acc1140', tot.net, 0], ['1150','acc1150', tot.vat, 0], ['2110','acc2110', 0, tot.total]];
    const dr = rows.reduce((s, r) => s + r[2], 0), cr = rows.reduce((s, r) => s + r[3], 0);
    return `<div class="ovl center" data-scrim><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="dlg-h"><span class="ic info">${ic('check')}</span><div><h3 id="dlg-t">${t('confirmPostT')}</h3><p>${t('confirmPostP')}</p></div></div><div class="dlg-b"><p style="margin:0 0 8px"><span class="tag-lab">${t('illus')}</span></p><div class="tscroll" tabindex="0" role="region" aria-label="${t('confirmPostT')}"><table class="je"><thead><tr><th>${t('account')}</th><th class="c-amt">${t('debit')}</th><th class="c-amt">${t('credit')}</th></tr></thead><tbody>${rows.map(([a, k, d, c]) => `<tr><td><span class="acc">${a}</span>${t(k)}</td><td class="c-amt">${d ? money(d) : '<span class="muted">—</span>'}</td><td class="c-amt">${c ? money(c) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody><tfoot><tr><td>${t('total')}</td><td class="c-amt" data-dr="${dr}">${money(dr)}</td><td class="c-amt" data-cr="${cr}">${money(cr)}</td></tr></tfoot></table></div><div class="after-post"><b>${t('afterPostT')}</b><ul><li>${ic('check')}${t('afterPost1')}</li><li>${ic('hash')}${t('afterPost2')}</li><li>${ic('lock')}${t('afterPost3')}</li></ul></div></div><div class="dlg-f"><button class="btn" type="button" data-act="close">${t('cancel')}</button><button class="btn primary" type="button" data-act="do-post" data-doc="${o.doc}">${t('postShort')}</button></div></div></div>`;
  }
  return '';
}
const CMDS = () => [
  ...ROUTES.map(r => ({ g:'cmdNav', i:'chevE', l:t(routeLabel(r)), run:() => go(r) })),
  { g:'cmdCreate', i:'plus', l:t('newSales'), run:() => go('sales') }, { g:'cmdCreate', i:'plus', l:t('newPurch'), run:() => go('purchase') },
  { g:'cmdAct', i:'moon', l:t('toggleMode'), run:() => setMode(S.mode === 'dark' ? 'light' : 'dark') }, { g:'cmdAct', i:'globe', l:t('toggleLang'), run:() => setLang(S.lang === 'ar' ? 'en' : 'ar') },
  { g:'cmdAct', i:'sliders', l:t('toggleDensity'), run:() => { S.density = S.density === 'compact' ? 'regular' : 'compact'; sync(); } }, { g:'cmdAct', i:'keyboard', l:t('shortcuts'), run:() => { S.overlay = { t:'shortcuts' }; } },
  ...CUST.map(c => ({ g:'cmdCust', i:'users', l:nm(c), hint:c.vat, run:() => { S.kit.q = nm(c); go('kit'); } })),
  ...PROD.filter(p => p.stock).map(p => ({ g:'cmdProd', i:'box', l:nm(p), hint:p.sku, run:() => { S.inv.q = p.sku; S.inv.peek = p.sku; go('inventory'); } })),
];
/** Scoped prefixes: «ع » customers, «م » products, «> » actions (Latin c / p also accepted). */
function palScope() { const q = S.palQ || ''; const m = q.match(/^(ع|c|م|p|>)\s/i); if (!m) return { scope: null, q }; const k = m[1].toLowerCase(); return { scope: k === 'ع' || k === 'c' ? 'cmdCust' : k === 'م' || k === 'p' ? 'cmdProd' : 'cmdAct', q: q.slice(m[0].length) }; }
function palResults() { const { scope, q } = palScope(); const n = normDigits(q).trim().toLowerCase(); return CMDS().filter(c => (!scope || c.g === scope) && (!n || c.l.toLowerCase().includes(n) || (c.hint || '').toLowerCase().includes(n))); }
function palette() {
  const r = palResults(), { scope } = palScope(); S.palIdx = Math.max(0, Math.min(S.palIdx || 0, r.length - 1));
  let last = '', html = ''; r.forEach((c, i) => { if (c.g !== last) { html += `<li class="grp" role="presentation">${t(c.g)}</li>`; last = c.g; } html += `<li role="presentation"><button type="button" role="option" id="pal-${i}" data-pal="${i}" aria-selected="${i === S.palIdx}">${ic(c.i)}<span>${esc(c.l)}</span>${c.hint ? `<span class="hint num">${c.hint}</span>` : ''}</button></li>`; });
  return `<div class="pal" role="dialog" aria-modal="true" aria-label="${t('search')}"><div class="pin">${ic('search')}${scope ? `<span class="scope">${t({ cmdCust:'scopeCust', cmdProd:'scopeProd', cmdAct:'scopeAct' }[scope])}</span>` : ''}<input id="pal-q" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant="pal-${S.palIdx}" value="${esc(S.palQ || '')}" placeholder="${t('search')}" autocomplete="off"><button type="button" class="ibtn" data-act="close" aria-label="${t('close')}">${ic('x')}</button></div><ul class="plist" id="pal-list" role="listbox">${html || `<li class="state">${t('noResults')}</li>`}</ul><div class="pfoot"><span><span class="kbd">↑↓</span> ${t('navigate')}</span><span><span class="kbd">Enter</span> ${t('run')}</span><span><span class="kbd">Esc</span> ${t('close')}</span><span><span class="kbd">${S.lang === 'ar' ? 'ع' : 'c'}␣</span> ${t('scopeCust')} · <span class="kbd">${S.lang === 'ar' ? 'م' : 'p'}␣</span> ${t('scopeProd')} · <span class="kbd">&gt;␣</span> ${t('scopeAct')}</span></div></div>`;
}

/* ------------------------------------------------------------------ render + routing */
const app = document.getElementById('fx-app');
const PAGES = { home:pageHome, kit:pageKit, numbers:pageNumbers, rules:pageRules, sales:() => docPage('sales'), purchase:() => docPage('purchase'), inventory:pageInventory, shift:pageShift, identity:pageIdentity };
const API = { S, t, ic, esc, nm, money, plain, moneyOutcome, qtyFmt, grp, statusBadge, pageHeader, stateBlock, CUST, SUPP, PROD, INV, invStatus, NOZ, WH, TODAY, fmtDate, addDays, totals, lineCalc, stockOf, stockStatus, readOf, shiftReady, windowClass, render: (f) => render(f), go: (r, f) => go(r, f), toast: (m) => toast(m), persist: () => persist(), contract: (i) => contract(i), newDoc };
if (EXT.pages) Object.assign(PAGES, EXT.pages(API));
// Focus return for overlays. render() replaces the whole app, so a stored element would be detached:
// keep a stable key (id · the menu's trigger · nth [data-act]) and resolve it after rendering.
function focusKey(el) {
  if (!el || !app.contains(el)) return null;
  if (el.id) return { sel: '#' + CSS.escape(el.id) };
  const trigger = el.closest('.menu-wrap')?.querySelector('[data-act="menu"]');
  if (el.closest('.menu') && trigger?.dataset.menu) return { sel: `[data-act="menu"][data-menu="${trigger.dataset.menu}"]` };
  if (el.dataset.act) return { act: el.dataset.act, i: [...app.querySelectorAll(`[data-act="${el.dataset.act}"]`)].indexOf(el) };
  return null;
}
function restoreFocus() {
  const k = S.returnFocus; S.returnFocus = null; if (!k) return;
  const el = k.sel ? app.querySelector(k.sel) : app.querySelectorAll(`[data-act="${k.act}"]`)[k.i];
  (el || document.getElementById('main'))?.focus();
}
function render(focusSel) {
  L = T[S.lang];
  const dev = document.getElementById('device'); dev.dataset.device = S.device;
  dev.style.setProperty('--dev-w', DEVICES[S.device].w ? DEVICES[S.device].w + 'px' : '100%'); dev.style.setProperty('--dev-h', DEVICES[S.device].h + 'px');
  Object.assign(app.dataset, { mode:S.mode, theme:S.theme, identity:S.identity, amt:S.amt, density:S.density });
  app.setAttribute('dir', S.lang === 'ar' ? 'rtl' : 'ltr'); app.setAttribute('lang', S.lang);
  const scroll = document.getElementById('main')?.scrollTop || 0;
  // Keep the caret/selection of the field being edited: re-rendering replaces it, and jumping to the end would corrupt mid-field edits
  let caret = null; try { const a = document.activeElement; if (a && app.contains(a) && a.id && typeof a.selectionStart === 'number') caret = { id: a.id, s: a.selectionStart, e: a.selectionEnd, v: a.value }; } catch (e) {}
  app.innerHTML = shell(PAGES[S.route]());
  if (!S._reset) document.getElementById('main').scrollTop = scroll; S._reset = false;
  S.toasts.forEach(drawToast);
  if (S.route === 'numbers') requestAnimationFrame(() => measureNumbers());
  if (focusSel) { const el = app.querySelector(focusSel); if (el) { el.focus(); try { if (caret && el.id === caret.id && el.value === caret.v) el.setSelectionRange(caret.s, caret.e); else { const n = el.value.length; el.setSelectionRange(n, n); } } catch (e) {} } }
  else if (S.overlay?.t === 'palette') document.getElementById('pal-q')?.focus();
  else if (S.overlay && !S.overlay.menu) app.querySelector('.ovl button:not([disabled]), .ovl [role="tab"]')?.focus();
  else if (S.overlay?.menu) app.querySelector('.menu [role="menuitem"]')?.focus();
  EXT.afterRender?.(API);
  document.dispatchEvent(new CustomEvent('fx:render'));
}
function go(route, force) {
  const cur = S.docs[S.route];
  if (!force && cur && cur.dirty && route !== S.route) { S.overlay = { t:'leave', to:route }; render(); return; }
  S.route = route; S.overlay = null; S._reset = true; persist(); sync();
}
function setMode(m) { S.mode = m; persist(); sync(); }
function setLang(l) { S.lang = l; persist(); sync(); }
function toast(msg) { const id = String(++S.seq); const o = { id, msg }; S.toasts.push(o); drawToast(o); setTimeout(() => { S.toasts = S.toasts.filter(x => x.id !== id); document.getElementById('t' + id)?.remove(); }, 5000); }
function drawToast(o) { const host = document.getElementById('toasts'); if (!host || document.getElementById('t' + o.id)) return; const el = document.createElement('div'); el.className = 'toast'; el.id = 't' + o.id; el.innerHTML = ic('check') + '<span></span>'; el.querySelector('span').textContent = o.msg; host.appendChild(el); }
const focusedSelector = () => { const f = document.activeElement; if (!f || !app.contains(f)) return undefined; if (f.dataset.reading) return `[data-reading="${f.dataset.reading}"]`; return f.id ? '#' + CSS.escape(f.id) : undefined; };

/* ------------------------------------------------------------------ events */
app.addEventListener('click', (e) => {
  const el = e.target.closest('button, [data-peek], input[type=checkbox], [data-scrim], label.chip');
  if (!el) { if (S.overlay?.menu) { S.overlay = null; render(); } return; }
  if (el.matches('[data-scrim]') && e.target === el) { S.overlay = null; render(); return; }
  const d = el.dataset;
  if (el.matches('input[data-ksel]')) { const v = d.ksel; if (v === 'all') { const PAGE = 8; app.querySelectorAll('input[data-ksel]:not([data-ksel="all"])').forEach(x => el.checked ? S.kit.sel.add(x.dataset.ksel) : S.kit.sel.delete(x.dataset.ksel)); } else el.checked ? S.kit.sel.add(v) : S.kit.sel.delete(v); render(); return; }
  if (el.matches('input[data-isel]')) { const v = d.isel; if (v === 'all') invRows().forEach(p => el.checked ? S.inv.sel.add(p.sku) : S.inv.sel.delete(p.sku)); else el.checked ? S.inv.sel.add(v) : S.inv.sel.delete(v); render(); return; }
  if (el.matches('input[data-act="cost-perm"]')) { S.inv.costPerm = el.checked; render(); return; }
  if (el.matches('label.chip')) return;
  if (d.route !== undefined) { if (d.route) go(d.route); else { S.overlay = null; render(); toast(`${t(d.label)} · ${t('notOnLab')}`); } return; }
  if (d.group) { S.overlay = { t:'group', g:d.group }; render(); return; }
  if (d.branch) { S.branch = d.branch; S.overlay = null; render(); toast(`${t('brChanged')}: ${t('br_' + d.branch)}`); return; }
  if (d.identity) { S.identity = d.identity; persist(); sync(); return; }
  if (d.num) { const v = d.v === 'true' ? true : d.v === 'false' ? false : d.v; S.num[d.num] = v; render(); return; }
  if (d.kst) { S.kit.st = d.kst; S.kit.page = 0; render(); return; }
  if (d.ksort) { S.kit.sort = { k:d.ksort, d: S.kit.sort.k === d.ksort && S.kit.sort.d === 'asc' ? 'desc' : 'asc' }; render(); return; }
  if (d.kpage) { S.kit.page += Number(d.kpage); render(); return; }
  if (d.ist) { S.inv.st = d.ist; render(); return; }
  if (d.isort) { S.inv.sort = { k:d.isort, d: S.inv.sort.k === d.isort && S.inv.sort.d === 'asc' ? 'desc' : 'asc' }; render(); return; }
  if (d.peek) { openPeek(d.peek); return; }
  if (d.pal !== undefined) { const c = palResults()[Number(d.pal)]; S.overlay = null; S.palQ = ''; c?.run(); render(); return; }
  if (d.pick) { const D = S.docs[d.doc]; D.party = (d.doc === 'sales' ? CUST : SUPP).find(c => c.id === d.pick); D.comboOpen = false; D.comboQ = ''; D.dirty = true; render(); return; }
  if (d.del) { const D = S.docs[d.doc]; D.lines = D.lines.filter(l => l.id !== Number(d.del)); D.dirty = true; render(); return; }
  if (d.focus) {
    const target = app.querySelector(d.focus);
    // a line hidden by "find in lines" or the error filter cannot take focus: clear both, re-render, then focus
    if (target?.closest('[hidden]') && S.docs[target.dataset.doc]) { Object.assign(S.docs[target.dataset.doc], { lq: '', lf: 'all' }); render(d.focus); return; }
    target?.focus(); return;
  }
  const doc = d.doc ? S.docs[d.doc] : null;
  switch (d.act) {
    case 'palette': S.overlay = { t:'palette' }; S.palQ = ''; S.palIdx = 0; render(); break;
    case 'close': S.overlay = null; render(); restoreFocus(); break;
    case 'navsheet': case 'create': case 'inbox': case 'context': case 'sheet-demo': S.overlay = { t:d.act }; render(); break;
    case 'usermenu': S.overlay = { t:'shortcuts' }; render(); break;
    case 'menu': S.overlay = S.overlay?.menu === d.menu ? null : { menu:d.menu }; render(); break;
    case 'demo': S.overlay = null; render(); toast(t('demoToast')); break;
    case 'noop': break;
    case 'toast-ok': toast(t('toastSaved')); break;
    case 'toast-remind': toast(t('demoToast')); S.kit.sel.clear(); render(); break;
    case 'banner-on': S.banner = true; render(); break;
    case 'banner-off': S.banner = false; render(); break;
    case 'kit-clearsel': S.kit.sel.clear(); render(); break;
    case 'inv-clearsel': S.inv.sel.clear(); render(); break;
    case 'clear-filters': S.kit.q = ''; S.kit.st = 'all'; S.inv.q = ''; S.inv.st = 'all'; S.demo = 'ready'; sync(); break;
    case 'retry': S.demo = 'loading'; sync(); setTimeout(() => { S.demo = 'ready'; sync(); }, 800); break;
    case 'confirm-delete': S.returnFocus = focusKey(el); S.overlay = { t:'confirm-delete', doc:d.doc }; render(); break;
    case 'blocking': S.returnFocus = focusKey(el); S.overlay = { t:'blocking' }; render(); break;
    case 'do-delete': if (d.doc) { S.docs[d.doc] = newDoc(d.doc); } S.overlay = null; render(); restoreFocus(); toast(t('toastDeleted')); break;
    case 'peek-close': S.inv.peek = null; S.overlay = null; render(); break;
    case 'party-change': doc.party = null; doc.comboOpen = true; doc.dirty = true; render(`#${d.doc}-party`); break;
    case 'add-line': addLine(d.doc); break;
    case 'lines-filter': { S.docs[d.doc].lf = d.v; render(); break; }
    case 'save-draft': { const fromMenu = !!el.closest('.menu'); if (fromMenu) { S.returnFocus = focusKey(el); S.overlay = null; } saveDraft(d.doc); if (fromMenu) restoreFocus(); break; }
    case 'post': requestPost(d.doc); break;
    case 'do-post': S.docs[d.doc] = newDoc(d.doc); S.overlay = null; render(); toast(t('toastPosted')); break;
    case 'leave-go': { const to = S.overlay.to, D = S.docs[S.route]; S.docs[S.route] = D.saved ? { ...snapDoc(D.saved), saved: D.saved } : newDoc(S.route); go(to, true); break; }
    case 'leave-save': { const to = S.overlay.to, D = S.docs[S.route]; D.dirty = false; D.saved = snapDoc(D); toast(t('toastSaved')); go(to, true); break; }
    case 'save-readings': if (shiftReady().ok) toast(t('readingsSaved')); break;
    case 'focus-reading': { const n = NOZ.find(x => readOf(x) === null || readOf(x) < x.open); if (n) app.querySelector(`[data-reading="${n.id}"]`)?.focus(); break; }
  }
});
function openPeek(sku) { S.inv.active = sku; if (windowClass() === 'large') { S.inv.peek = sku; render(); } else { S.overlay = { t:'peek', sku }; render(); } }
function addLine(kind) { const D = S.docs[kind], id = Math.max(0, ...D.lines.map(l => l.id)) + 1; D.lines.push({ id, p:4, qtyM:1000, price: kind === 'sales' ? PROD[4].price : PROD[4].cost, disc:0 }); D.dirty = true; render(`#${kind}-l${id}-qty`); }
function saveDraft(kind) { const D = S.docs[kind]; D.dirty = false; D.saved = snapDoc(D); render(); toast(t('toastSaved')); }
function requestPost(kind) {
  const D = S.docs[kind];
  if (D.date < LOCKED_BEFORE) { app.querySelector(`#${kind}-lock`)?.focus?.(); toast(t('postDisabledLocked')); return; }
  D.showErrs = true; const errs = docErrors(D);
  if (Object.keys(errs).length) { render(`#${kind}-sum`); return; }
  S.returnFocus = focusKey(document.activeElement); S.overlay = { t:'post', doc:kind }; render();
}
app.addEventListener('submit', (e) => {
  if (e.target.id !== 'kform') return; e.preventDefault();
  const F = S.kit.form; F.errs = kitValidate(F, true); F.summary = Object.keys(F.errs).length > 0;
  if (F.summary) { render('#kf-sum'); return; }
  S.kit.busy = true; render(); setTimeout(() => { S.kit.busy = false; S.kit.form = { name:'', vat:'', limit:'', touched:{}, errs:{} }; render(); toast(t('fOk')); }, 700);
});
function kitValidate(F, all) {
  const e = {};
  if ((all || F.touched.name) && !F.name.trim()) e.name = 'fNameErr';
  if ((all || F.touched.vat) && !/^3\d{13}3$/.test(normDigits(F.vat))) e.vat = 'fVatErr';
  if ((all || F.touched.limit) && F.limit && toMinor(F.limit, 2) === null) e.limit = 'fLimitErr';
  return e;
}
app.addEventListener('focusout', (e) => {
  const el = e.target;
  if (el.dataset?.lf && el.dataset.lf !== 'p') { const D = S.docs[el.dataset.doc], line = D?.lines.find(l => l.id === Number(el.closest('tr')?.dataset.line)); if (line?.raw && !line.bad?.[el.dataset.lf]) delete line.raw[el.dataset.lf]; return; }
  if (!el.dataset?.kf) return;
  const F = S.kit.form; F.touched[el.dataset.kf] = true; const before = JSON.stringify(F.errs); F.errs = kitValidate(F, false);
  // Moving to the submit button: keep the new state but do not re-render — re-rendering on mousedown would replace the button and swallow the click; submit validates everything anyway.
  if (e.relatedTarget?.closest?.('#kform [type="submit"]')) return;
  if (JSON.stringify(F.errs) !== before) { const next = e.relatedTarget && app.contains(e.relatedTarget) && e.relatedTarget.id ? '#' + CSS.escape(e.relatedTarget.id) : undefined; render(next); }
});
app.addEventListener('input', (e) => {
  const el = e.target, d = el.dataset;
  if (el.id === 'kq') { S.kit.q = el.value; S.kit.page = 0; clearTimeout(S._q); S._q = setTimeout(() => render(focusedSelector()), 120); return; }
  if (el.id === 'iq') { S.inv.q = el.value; clearTimeout(S._q); S._q = setTimeout(() => render(focusedSelector()), 120); return; }
  if (el.id === 'pal-q') { S.palQ = el.value; S.palIdx = 0; render('#pal-q'); return; }
  if (d.kf) { S.kit.form[d.kf] = el.value; if (S.kit.form.errs[d.kf]) { S.kit.form.errs = kitValidate(S.kit.form, false); } return; }
  if (d.party) { const D = S.docs[d.party]; D.comboQ = el.value; D.comboOpen = true; D.comboIdx = 0; render('#' + el.id); return; }
  if (d.reading) { const id = d.reading; S.readings[id + ':raw'] = el.value; const m = toMinor(el.value, 3); S.readings[id] = el.value.trim() === '' || m === null ? null : m; clearTimeout(S._r); S._r = setTimeout(() => { if (S.route === 'shift') render(focusedSelector()); }, 350); return; }
  if (d.lq) { S.docs[d.lq].lq = el.value; clearTimeout(S._lq); S._lq = setTimeout(() => render(focusedSelector()), 140); return; }
  if (d.hf) { const D = S.docs[d.doc]; D[d.hf] = el.value; D.dirty = true; if (d.hf === 'date') render('#' + el.id); return; }
  if (d.lf) {
    const D = S.docs[d.doc], line = D.lines.find(l => l.id === Number(el.closest('tr').dataset.line)); if (!line) return; D.dirty = true;
    if (d.lf === 'p') { line.p = Number(el.value); line.price = d.doc === 'sales' ? PROD[line.p].price : PROD[line.p].cost; if (line.bad) line.bad.price = false; if (line.raw) delete line.raw.price; render('#' + el.id); return; }
    const m = toMinor(el.value, d.lf === 'qty' ? 3 : 2); line.bad = line.bad || {}; line.raw = line.raw || {};
    if (m === null) { el.setAttribute('aria-invalid', 'true'); line.bad[d.lf] = true; line.raw[d.lf] = el.value; return; }
    el.removeAttribute('aria-invalid'); line.bad[d.lf] = false; line.raw[d.lf] = el.value; // keep the text being typed ("1.") until the field is left
    if (d.lf === 'qty') line.qtyM = m; else if (d.lf === 'price') line.price = m; else line.disc = m;
    if (D.showErrs) { render('#' + el.id); return; }
    updateDocTotals(d.doc);
  }
});
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-iwh]')) { S.inv.wh = el.value; render(); }
  else if (el.matches('[data-iview]')) { S.inv.view = el.value; Object.assign(S.inv, { all:{ st:'all', wh:'all', q:'' }, low:{ st:'low', wh:'jbl', q:'' } }[el.value]); render(); }
});
app.addEventListener('keydown', (e) => {
  const el = e.target;
  if (S.overlay?.t === 'palette' && el.id === 'pal-q' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    e.preventDefault(); const r = palResults();
    if (e.key === 'ArrowDown') S.palIdx = (S.palIdx + 1) % Math.max(1, r.length); else if (e.key === 'ArrowUp') S.palIdx = (S.palIdx - 1 + r.length) % Math.max(1, r.length); else { const c = r[S.palIdx]; S.overlay = null; S.palQ = ''; c?.run(); render(); return; }
    render('#pal-q'); return;
  }
  if (el.dataset?.party) { const D = S.docs[el.dataset.party], items = app.querySelectorAll('[data-pick]'); if (e.key === 'ArrowDown') { e.preventDefault(); D.comboIdx = Math.min(items.length - 1, D.comboIdx + 1); render('#' + el.id); } else if (e.key === 'ArrowUp') { e.preventDefault(); D.comboIdx = Math.max(0, D.comboIdx - 1); render('#' + el.id); } else if (e.key === 'Enter' && items[D.comboIdx]) { e.preventDefault(); items[D.comboIdx].click(); } else if (e.key === 'Escape') { D.comboOpen = false; render('#' + el.id); } return; }
  if (el.dataset?.lf && e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const row = el.closest('tr'); if (row === row.parentElement.lastElementChild) addLine(el.dataset.doc); else row.nextElementSibling.querySelector(`[data-lf="${el.dataset.lf}"]`)?.focus(); return; }
  if (S.overlay?.menu && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) { const items = [...app.querySelectorAll('.menu [role="menuitem"]')]; const i = items.indexOf(document.activeElement); if (e.key === 'Escape') { S.overlay = null; render(); app.querySelector('[data-act="menu"]')?.focus(); } else { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } return; }
  if (S.overlay && !S.overlay.menu && e.key === 'Tab') { const f = [...app.querySelectorAll('.ovl button:not([disabled]), .ovl input, .ovl [tabindex="0"]')]; if (f.length) { const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } } }
});
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') && document.activeElement?.type !== 'checkbox';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyK') { e.preventDefault(); S.overlay = S.overlay?.t === 'palette' ? null : { t:'palette' }; S.palQ = ''; S.palIdx = 0; render(); return; }
  if (mod && e.code === 'KeyS' && S.docs[S.route]) { e.preventDefault(); saveDraft(S.route); return; }
  if (mod && e.key === 'Enter' && S.docs[S.route]) { e.preventDefault(); requestPost(S.route); return; }
  if (e.altKey && e.code === 'KeyN' && S.docs[S.route]) { e.preventDefault(); addLine(S.route); return; }
  if (e.key === 'Escape' && S.overlay) { S.overlay = null; render(); restoreFocus(); return; }
  if (typing || S.overlay) return;
  if (!(app.contains(document.activeElement) || document.activeElement === document.body)) return;
  if (S.gSeq) { S.gSeq = false; const map = { KeyS:'sales', KeyP:'purchase', KeyI:'inventory', KeyF:'shift', KeyK:'kit', KeyN:'numbers', KeyH:'home' }; if (map[e.code]) { e.preventDefault(); go(map[e.code]); } return; }
  if (e.code === 'KeyG' && !mod && !e.altKey) { S.gSeq = true; setTimeout(() => S.gSeq = false, 1200); return; }
  if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { S.overlay = { t:'shortcuts' }; render(); return; }
  if (e.code === 'Slash' && !e.shiftKey) { const s = app.querySelector('#iq, #kq'); if (s) { e.preventDefault(); s.focus(); } return; }
  if (S.route === 'inventory' && ['ArrowDown', 'ArrowUp'].includes(e.key) || S.route === 'inventory' && ['KeyJ', 'KeyK'].includes(e.code)) {
    const rows = invRows(); if (!rows.length) return; e.preventDefault(); let i = rows.findIndex(p => p.sku === S.inv.active);
    i = (e.key === 'ArrowDown' || e.code === 'KeyJ') ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1); S.inv.active = rows[i].sku; if (S.inv.peek) S.inv.peek = rows[i].sku; render();
  } else if (S.route === 'inventory' && e.key === 'Enter' && S.inv.active
    // Enter on a focused control (filter chip, sort header, nav link, menu…) keeps its own activation
    && !document.activeElement?.closest?.('button, a[href], input, select, textarea, summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"]')) { e.preventDefault(); openPeek(S.inv.active); }
});
new ResizeObserver(() => { if (S.route === 'numbers') { clearTimeout(S._rn); S._rn = setTimeout(() => measureNumbers(), 60); } if (S.route === 'home' || (S.route === 'inventory' && S.inv.peek)) { clearTimeout(S._ro); S._ro = setTimeout(() => render(), 60); } }).observe(app);

/* ------------------------------------------------------------------ lab chrome */
function seg(id, items, key) { const el = document.getElementById(id); if (!el) return; el.innerHTML = items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S[key] === v}">${l}</button>`).join(''); el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S[key] = b.dataset.v; if (key === 'route') S._reset = true; persist(); sync(); }; }
function sync() {
  if (EXT.chrome) { EXT.chrome(seg, API); render(); return; }
  seg('c-route', [['home','نظرة عامة'],['kit','المكوّنات'],['numbers','الأرقام M2'],['rules','القواعد'],['sales','فاتورة مبيعات'],['purchase','فاتورة مشتريات'],['inventory','المخزون'],['shift','وردية المحطة'],['identity','الهوية']], 'route');
  seg('c-device', Object.entries(DEVICES).map(([k, d]) => [k, d.l]), 'device');
  seg('c-mode', [['light','فاتح'],['dark','داكن']], 'mode');
  seg('c-theme', [['default','Default'],['ink','Ink'],['core','Core']], 'theme');
  seg('c-identity', [['base','v3'],['brass','نحاس'],['fayrouz','فيروز'],['invalid','غير صالحة']], 'identity');
  seg('c-amt', [['a','A · الحالي'],['b','B · المقترح']], 'amt');
  seg('c-lang', [['ar','عربي'],['en','EN']], 'lang');
  seg('c-density', [['regular','متوازن'],['compact','مضغوط']], 'density');
  seg('c-demo', [['ready','جاهزة'],['loading','تحميل'],['empty','فارغة'],['error','خطأ']], 'demo');
  render();
}
sync();
window.__fx = { S, render, go, totals, lineCalc, toMinor, measureNumbers, contract, windowClass, docErrors, setMode, setLang, newDoc, API };
})();
