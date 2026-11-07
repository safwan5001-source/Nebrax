import type { FuelHelpArticle } from './types';

/** أدلة استلام الوقود وقراءات الخزانات والرصيد الافتتاحي. مأخوذة من شاشات تطبيق «محطات أَوْج» وعقودها الفعلية. */
export const FUEL_STOCK_ARTICLES: readonly FuelHelpArticle[] = [
  {
    slug: 'fuel-receiving',
    category: 'receivingStock',
    title: { ar: 'استلام الوقود من المورد', en: 'Receive fuel from a supplier' },
    summary: { ar: 'أنشئ مسودة استلام بسند المورد وكمياته، ثم يعتمدها المخوَّل لإدخالها إلى المخزون.', en: 'Create a delivery draft with the supplier note and quantities; an authorised user then approves it to add the stock.' },
    keywords: { ar: 'استلام وقود مورد ناقلة سند تسليم مسودة اعتماد كمية مرسلة مستلمة مخزون خزان', en: 'receiving fuel supplier tanker delivery note draft approve dispatched received quantity stock tank' },
    minutes: 6,
    audiences: ['supervisor', 'manager'],
    surface: 'both',
    overview: {
      ar: 'يمرّ الاستلام بمرحلتين: مسودة ثم اعتماد. الحفظ كمسودة لا يغيّر مخزون المحطة ولا يُدخل تكلفة. الاعتماد وحده يُضيف الكمية المستلمة إلى مخزون المحطة ويسجّل قيمتها، ولا يمكن التراجع عنه.',
      en: 'A delivery has two stages: draft, then approval. Saving a draft changes no station stock and takes no cost. Only approval adds the received quantity to station stock and records its value, and it cannot be undone.',
    },
    permissions: ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve', 'fuel.reading.record'],
    permissionsNote: { ar: 'العرض: fuel.delivery.view. الإنشاء: fuel.delivery.create. الاعتماد: fuel.delivery.approve. تسجيل قراءات الخزان ضمن الاستلام: fuel.reading.record. تظهر شاشة «الاستلام» لمن يملك أيّاً من صلاحيات الاستلام.', en: 'View: fuel.delivery.view. Create: fuel.delivery.create. Approve: fuel.delivery.approve. Tank readings within a delivery: fuel.reading.record. The Receiving screen shows for anyone holding any receiving permission.' },
    procedures: [
      {
        title: { ar: 'إنشاء مسودة استلام', en: 'Create a delivery draft' },
        steps: [
          { ar: 'افتح «الاستلام» واضغط «استلام جديد».', en: 'Open Receiving and press "New receiving".' },
          { ar: 'الخطوة «المورد والخزان»: اختر المورد (يمكنك البحث بالاسم) والخزان النشط. يلزم أن تكون المحطة مرتبطة بمخزن.', en: 'Step "Supplier and tank": choose the supplier (you can search by name) and the active tank. The station must be linked to a warehouse.' },
          { ar: 'اكتب «رقم سند المورد» المطبوع على سند التسليم؛ إلزامي ولا يُخلط برقم الاستلام الداخلي FD-، ويمنع تكرار السند نفسه.', en: 'Enter the "Supplier note number" printed on the delivery note; it is mandatory, differs from the internal FD- number, and prevents entering the same note twice.' },
          { ar: 'الخطوة «الكميات والقيمة»: اكتب الكمية المرسلة والكمية المستلمة باللتر (حتى 3 منازل عشرية، والمستلمة أكبر من صفر)، ورقم الناقلة واسم السائق إن توفرا.', en: 'Step "Quantities": enter the dispatched and received litres (up to 3 decimals, received above zero), plus the tanker number and driver name if known.' },
          { ar: 'الخطوة «قراءات الخزان» اختيارية: سجّل قراءة ما قبل التفريغ وما بعده ليطابق التطبيق ارتفاع الخزان مع المستلم.', en: 'Step "Tank readings" is optional: record readings before and after unloading so the app can compare the tank rise with the received quantity.' },
          { ar: 'راجع التنبيهات (المستلم أكبر/أقل من المرسل، أو ارتفاع الخزان يختلف عن المستلم) ثم اضغط «حفظ كمسودة».', en: 'Review the warnings (received above/below dispatched, or tank rise differs from received) then press "Save as draft".' },
          { ar: 'في خطوة «سند المورد» صوّر السند أو أرفق ملفه (PDF/JPG/PNG، حتى 10 ميغابايت للملف و5 ملفات في المرة) واضغط الرفع. المرفق اختياري.', en: 'In the "Supplier note" step, photograph the note or attach its file (PDF/JPG/PNG, up to 10 MB per file and 5 files at a time) and upload. The attachment is optional.' },
        ],
      },
      {
        title: { ar: 'اعتماد الاستلام', en: 'Approve the delivery' },
        steps: [
          { ar: 'افتح الاستلام من قائمة «الاستلام» وتأكد من خلاصة الجاهزية: التكلفة مسجَّلة، رقم السند، مرفق السند.', en: 'Open the delivery from the Receiving list and check the readiness summary: cost recorded, note number, note attachment.' },
          { ar: 'لا يفعَّل الاعتماد قبل تسجيل التكلفة (يسجّلها المخوَّل مالياً، انظر دليل التكلفة).', en: 'Approval is not enabled before the cost is recorded (an authorised finance user records it; see the cost guide).' },
          { ar: 'اضغط «اعتماد الاستلام» وراجع البيانات في نافذة التأكيد؛ الملاحظة اختيارية.', en: 'Press "Approve receiving" and review the data in the confirmation dialog; the note is optional.' },
          { ar: 'اضغط «تأكيد الاعتماد». يظهر «تم اعتماد الاستلام» وتُضاف الكمية إلى مخزون المحطة.', en: 'Press "Confirm approval". "Receiving approved" appears and the quantity is added to station stock.' },
        ],
      },
    ],
    fields: [
      { name: { ar: 'رقم الاستلام الداخلي (FD-…)', en: 'Internal receiving number (FD-…)' }, description: { ar: 'يولّده النظام. ليس رقم سند المورد.', en: 'Generated by the system. It is not the supplier note number.' } },
      { name: { ar: 'الكمية المرسلة / المستلمة', en: 'Dispatched / received quantity' }, description: { ar: 'فرق النقل = المستلم − المرسل. المستلم هو ما يُضاف للمخزون عند الاعتماد.', en: 'Transit variance = received − dispatched. The received quantity is what is added to stock on approval.' } },
      { name: { ar: 'ارتفاع الخزان مقابل المستلم', en: 'Tank rise vs received' }, description: { ar: 'يُحسب من قراءتي قبل/بعد التفريغ عند تسجيلهما معاً.', en: 'Computed from the before/after readings when both are recorded.' } },
      { name: { ar: 'حالة الاستلام', en: 'Receiving status' }, description: { ar: 'مسودة أو معتمد. التصفية بالحالة وبحالة التكلفة (بانتظار التكلفة / مسجَّلة) وبالتاريخ، وبحث برقم السند أو FD- أو المورد.', en: 'Draft or approved. Filter by status, cost state (awaiting / recorded), and date, and search by note number, FD-, or supplier.' } },
    ],
    problems: [
      { problem: { ar: 'أدخل رقم سند المورد (إلزامي).', en: 'Enter the supplier note number (mandatory).' }, fix: { ar: 'اكتب الرقم المطبوع على سند المورد لا رقم FD-.', en: 'Enter the number printed on the supplier’s note, not the FD- number.' } },
      { problem: { ar: 'هذه المحطة بلا مخزن مرتبط.', en: 'This station has no linked warehouse.' }, fix: { ar: 'يربط مسؤول المحطة مخزناً بالمحطة قبل الاستلام.', en: 'The station manager must link a warehouse to the station first.' } },
      { problem: { ar: 'قراءة ما بعد الاستلام أقل من قبله.', en: 'The after-receiving reading is lower than before.' }, fix: { ar: 'غير ممكن بعد التفريغ؛ راجع القراءتين.', en: 'Impossible after unloading; recheck both readings.' } },
      { problem: { ar: 'انقطع الاتصال أثناء الحفظ.', en: 'The connection dropped while saving.' }, fix: { ar: 'اضغط «إعادة المحاولة»: المفتاح نفسه لا ينشئ استلاماً مكرراً. أو افتح القائمة وتحقق.', en: 'Press "Retry": the same key will not create a duplicate. Or open the list and check.' } },
      { problem: { ar: 'اعتمادك لا يقبله النظام.', en: 'The system will not accept my approval.' }, fix: { ar: 'إن كنت من أنشأ المسودة وسياسة المحطة تشترط معتمداً مختلفاً، يعتمدها زميل مخوَّل.', en: 'If you created the draft and the station policy requires a different approver, a colleague with approval permission must approve it.' } },
      { problem: { ar: 'اعتماد الاستلام يتطلب صلاحية الاعتماد.', en: 'Approving needs the approval permission.' }, fix: { ar: 'اطلبها من مسؤول إدارة الموظفين.', en: 'Ask someone with staff management to grant it.' } },
    ],
    notes: [
      { ar: 'الاستلام المعتمد لا يُعدَّل ولا يُحذف، ولا تُعدَّل تكلفته. النسخة التشغيلية المطبوعة بلا أسعار؛ المالية للمخوَّلين بالتكلفة فقط.', en: 'An approved delivery cannot be edited or deleted, nor can its cost. The printed operational copy carries no prices; the financial copy is only for those cleared for cost.' },
    ],
    screens: [
      { label: { ar: 'الاستلامات', en: 'Receiving' }, appHref: '/fuel-stations/ops/receiving', erpHref: '/fuel-stations/receiving' },
      { label: { ar: 'استلام جديد', en: 'New receiving' }, appHref: '/fuel-stations/ops/receiving/new' },
    ],
    related: ['fuel-receiving-costs', 'fuel-tank-readings', 'fuel-opening-balance'],
  },
  {
    slug: 'fuel-receiving-costs',
    category: 'receivingStock',
    title: { ar: 'تسجيل تكلفة الاستلام', en: 'Record a delivery’s cost' },
    summary: { ar: 'سجّل التكلفة الفعلية للمسودات قبل اعتمادها، ولا يرى التكلفة إلا من يملك صلاحيتها.', en: 'Record the actual cost of draft deliveries before they are approved; only users with cost permission see it.' },
    keywords: { ar: 'تكلفة استلام بانتظار التكلفة تسجيل تصحيح مالية سعر شراء', en: 'cost receiving awaiting cost record correct finance purchase price' },
    minutes: 3,
    audiences: ['manager'],
    surface: 'app',
    overview: {
      ar: 'التكلفة تُسجَّل من المخوَّلين مالياً وليس من موظف المحطة. تسجيلها لا يغيّر المخزون؛ الاعتماد وحده يُدخلها أساساً لتكلفة المخزون. يمكن تصحيحها قبل الاعتماد، وبعد الاعتماد تُقفل.',
      en: 'Cost is recorded by finance-authorised users, not station attendants. Recording it does not change stock; only approval adopts it as the stock cost basis. It can be corrected before approval and is locked after.',
    },
    permissions: ['fuel.delivery.cost.record', 'products.view_cost'],
    permissionsNote: { ar: 'يلزم المفتاحان معاً (أو fuel_stations.manage القديم مع products.view_cost). من لا يملكهما لا يرى أي مبلغ تكلفة.', en: 'Both keys are required (or the legacy fuel_stations.manage with products.view_cost). Without them no cost amount is shown.' },
    procedures: [
      {
        title: { ar: 'تسجيل التكلفة', en: 'Record the cost' },
        steps: [
          { ar: 'افتح «الاستلام» ثم «الاستلامات بانتظار التكلفة» لرؤية المسودات الناقصة.', en: 'Open Receiving, then "Deliveries awaiting cost" to see drafts that lack it.' },
          { ar: 'افتح المسودة المطلوبة واكتب «تكلفة الاستلام الفعلية الإجمالية» بالريال (موجبة، حتى منزلتين عشريتين).', en: 'Open the draft and enter the "Total actual receiving cost" in riyals (positive, up to two decimals).' },
          { ar: 'اضغط «تسجيل التكلفة» وراجع نافذة التأكيد، ثم «تأكيد التسجيل».', en: 'Press "Record cost", review the confirmation dialog, then press "Confirm".' },
          { ar: 'لتصحيح قيمة قبل الاعتماد استعمل «تصحيح تكلفة الاستلام».', en: 'To correct a value before approval use "Correct receiving cost".' },
        ],
      },
    ],
    fields: [
      { name: { ar: 'حالة التكلفة', en: 'Cost state' }, description: { ar: 'مسجَّلة أو بانتظار التكلفة. موظف المحطة يرى فقط عبارة «سجّلت المالية تكلفة هذا الاستلام» دون المبلغ.', en: 'Recorded or awaiting cost. A station attendant only sees "Finance recorded this delivery’s cost" without the amount.' } },
    ],
    problems: [
      { problem: { ar: 'تسجيل التكلفة يتطلب صلاحية مالية مخصصة.', en: 'Recording cost needs a dedicated finance permission.' }, fix: { ar: 'اطلب fuel.delivery.cost.record مع products.view_cost.', en: 'Ask for fuel.delivery.cost.record together with products.view_cost.' } },
      { problem: { ar: 'تكلفة غير صالحة.', en: 'Invalid cost.' }, fix: { ar: 'أدخل مبلغاً موجباً بمنزلتين عشريتين كحد أقصى.', en: 'Enter a positive amount with at most two decimals.' } },
      { problem: { ar: 'الاستلام معتمد: التكلفة مقفلة.', en: 'The delivery is approved: its cost is locked.' }, fix: { ar: 'لا تعديل بعد الاعتماد.', en: 'No edits after approval.' } },
    ],
    screens: [{ label: { ar: 'الاستلامات بانتظار التكلفة', en: 'Deliveries awaiting cost' }, appHref: '/fuel-stations/ops/receiving/costs' }],
    related: ['fuel-receiving'],
  },
  {
    slug: 'fuel-tank-readings',
    category: 'receivingStock',
    title: { ar: 'مراقبة الخزانات وتسجيل قراءاتها', en: 'Monitor tanks and record their readings' },
    summary: { ar: 'تابع آخر قياس لكل خزان وسجّل قراءة مستقلة، بما فيها القراءات المتأخرة بموافقة أو تخويل.', en: 'Follow each tank’s last measurement and record a stand-alone reading, including late readings under approval or authorisation.' },
    keywords: { ar: 'خزان قراءة مستوى قياس مسطرة ATG سعة امتلاء قراءة متأخرة بتاريخ سابق موافقة سياسة', en: 'tank reading level dipstick gauge ATG capacity fill late reading back-dated approval policy' },
    minutes: 6,
    audiences: ['operator', 'supervisor', 'manager'],
    surface: 'both',
    overview: {
      ar: 'شاشة «الخزانات» تعرض لكل خزان آخر قياس والوقت المنقضي ونسبة الامتلاء والمتاح، مع تنبيهات تشغيلية. الكمية المعروضة آخر قياس لا رصيداً حالياً. تسجيل القراءة المستقلة تشغيلي فقط: لا ينشئ حركة مخزون ولا يغيّر التكلفة ولا يعتمد تسوية.',
      en: 'The Tanks screen shows each tank’s last measurement, elapsed time, fill percentage, and available volume, with operational flags. The quantity shown is the last measurement, not a current balance. Recording a stand-alone reading is operational only: it creates no stock movement, changes no cost, and approves no reconciliation.',
    },
    permissions: ['fuel_stations.view', 'fuel.reading.record', 'fuel.reading.late.record', 'fuel.reading.late.approve', 'fuel.governance.manage', 'fuel_stations.manage'],
    permissionsNote: { ar: 'مراقبة المستويات: fuel_stations.view. تسجيل قراءة: fuel.reading.record. القراءة بتاريخ سابق: الطلب من صاحب fuel.reading.record، والموافقة fuel.reading.late.approve، أو التسجيل المباشر fuel.reading.late.record حسب السياسة. تعديل السياسة يتطلب fuel_stations.manage مع fuel.governance.manage معاً.', en: 'Level monitoring: fuel_stations.view. Recording: fuel.reading.record. Back-dated readings: requested by holders of fuel.reading.record, approved with fuel.reading.late.approve, or recorded directly with fuel.reading.late.record per policy. Editing the policy needs fuel_stations.manage and fuel.governance.manage together.' },
    procedures: [
      {
        title: { ar: 'تسجيل قراءة خزان', en: 'Record a tank reading' },
        steps: [
          { ar: 'افتح «الخزانات» واضغط «فتح الخزان» للخزان المطلوب.', en: 'Open Tanks and press "Open tank" for the tank you need.' },
          { ar: 'في «تسجيل قراءة» اختر نوع القراءة (قياس يدوي، أو قراءة ATG مُدخلة يدوياً) ثم المصدر: مسطرة القياس، مؤشر الخزان، شاشة جهاز ATG، أو أخرى.', en: 'Under "Record a reading" choose the type (manual measurement or an ATG value keyed in by hand) and the source: dipstick, tank gauge, ATG console screen, or other.' },
          { ar: 'اكتب «الكمية المقاسة» باللتر (أرقام 0–9 وحتى ثلاث منازل عشرية، ولا تتجاوز سعة الخزان) وملاحظة اختيارية.', en: 'Enter the "Measured quantity" in litres (digits 0–9, up to three decimals, not above tank capacity) and an optional note.' },
          { ar: 'راجع المعاينة: النسبة والمتاح والفرق عن آخر قراءة من النوع نفسه.', en: 'Check the preview: percentage, available volume, and the difference from the last reading of the same type.' },
          { ar: 'اضغط «مراجعة وحفظ» ثم «حفظ القراءة». يُختم الوقت بوقت الخادم، وتُسجَّل باسمك، ولا تُعدَّل ولا تُحذف بعد الحفظ.', en: 'Press "Review and save", then "Save reading". The time is stamped by the server, it is recorded under your name, and it cannot be edited or deleted after saving.' },
        ],
      },
      {
        title: { ar: 'قراءة بتاريخ سابق', en: 'A back-dated reading' },
        steps: [
          { ar: 'في شاشة الخزان فعّل «تسجيل بتاريخ سابق» (يظهر فقط إن سمحت سياسة المحطة لك).', en: 'On the tank screen turn on "Record with an earlier date" (shown only if the station policy allows you).' },
          { ar: 'اختر «وقت القياس الفعلي» بتوقيت المحطة، ولا يتجاوز الحد الأقصى للتأخير (قبل X ساعة من الآن).', en: 'Choose the "Actual measurement time" in station time, within the maximum delay (X hours before now).' },
          { ar: 'اكتب سبب التأخير (إلزامي أو اختياري حسب السياسة).', en: 'Enter the delay reason (mandatory or optional per policy).' },
          { ar: 'بسياسة «بموافقة المشرف» اضغط «مراجعة وإرسال طلب الموافقة»: تبقى القراءة طلباً ولا تدخل السجل ولا تغيّر آخر قراءة. بسياسة «مستخدم مخوّل» تُسجَّل مباشرة.', en: 'Under the "Supervisor approval" policy press "Review and send for approval": the reading stays a request and does not enter the log or change the last reading. Under "Authorised user" it is recorded directly.' },
        ],
      },
      {
        title: { ar: 'البتّ في طلبات القراءات المتأخرة (المشرف)', en: 'Decide late-reading requests (supervisor)' },
        steps: [
          { ar: 'من «الخزانات» افتح «طلبات القراءات المتأخرة» وصفِّ حسب الحالة.', en: 'From Tanks open "Late-reading requests" and filter by status.' },
          { ar: 'راجع وقت القياس ومقدار التأخير ومقدِّم الطلب.', en: 'Review the measurement time, the delay, and the requester.' },
          { ar: 'اضغط «اعتماد» ثم «تأكيد الاعتماد»، أو «رفض» واكتب سبب الرفض (إلزامي).', en: 'Press "Approve" then "Confirm approval", or "Reject" and enter the rejection reason (mandatory).' },
        ],
      },
      {
        title: { ar: 'ضبط سياسة القراءات المتأخرة (الإدارة)', en: 'Set the late-reading policy (management)' },
        steps: [
          { ar: 'افتح «الإدارة» ثم «سياسة القراءات بتاريخ سابق».', en: 'Open Manage, then "Back-dated reading policy".' },
          { ar: 'اختر السياسة: منع (الافتراضي)، بموافقة المشرف، أو مستخدم مخوّل.', en: 'Choose the policy: Deny (default), Supervisor approval, or Authorised user.' },
          { ar: 'حدّد الحد الأقصى للتأخير بالساعات وإلزام ذكر السبب، واكتب سبب التغيير للتدقيق.', en: 'Set the maximum delay in hours and whether a reason is mandatory, and enter the change reason for the audit log.' },
          { ar: 'اضغط «حفظ السياسة» وأكّد. لإلغاء إعداد المحطة واعتماد إعداد المؤسسة اضغط «العودة إلى إعداد المؤسسة».', en: 'Press "Save policy" and confirm. To drop the station setting and use the organisation’s, press "Back to organisation setting".' },
        ],
      },
    ],
    fields: [
      { name: { ar: 'الامتلاء / المتاح / السعة', en: 'Fill / Available / Capacity' }, description: { ar: 'تُحسب من آخر قياس مقارنةً بقيم الخزان المعتمدة. «السعة الآمنة» و«الحد الأدنى» و«المخزون غير القابل للسحب» تأتي من إعداد الخزان ولا يُخترع حدّ غيرها.', en: 'Computed from the last measurement against the tank’s approved values. Safe capacity, minimum level, and non-withdrawable stock come from the tank setup; no other limit is invented.' } },
      { name: { ar: 'أعلام المراجعة', en: 'Review flags' }, description: { ar: 'أعلى من السعة، فوق السعة الآمنة، دون الحد الأدنى، دون المخزون غير القابل للسحب.', en: 'Above capacity, above safe capacity, below minimum level, below non-withdrawable stock.' } },
      { name: { ar: 'قِدم القراءة', en: 'Reading age' }, description: { ar: 'يُعدّ القياس قديماً بعد المدة التي تضبطها المحطة. إن لم تُضبط تُعرض أعمار القراءات بلا حكم.', en: 'A measurement counts as stale after the time the station sets. If it is not set, ages are shown without a verdict.' } },
    ],
    problems: [
      { problem: { ar: 'الكمية أعلى من سعة الخزان.', en: 'The quantity is above the tank capacity.' }, fix: { ar: 'راجع القياس وأعد المحاولة؛ لا تحفظ قراءة تتجاوز السعة.', en: 'Recheck the measurement; do not save a reading that exceeds capacity.' } },
      { problem: { ar: 'ليست لديك صلاحية تسجيل القراءات.', en: 'You do not have permission to record readings.' }, fix: { ar: 'يمكنك الاطلاع على المستوى والسجل فقط؛ اطلب fuel.reading.record.', en: 'You can only view level and history; ask for fuel.reading.record.' } },
      { problem: { ar: 'الوقت قريب من الآن؛ أوقف خيار التأريخ.', en: 'The time is close to now; turn off the back-dating option.' }, fix: { ar: 'سجّل قراءة عادية بوقت الخادم.', en: 'Record a normal reading stamped with server time.' } },
      { problem: { ar: 'الوقت أبعد من الحد المسموح.', en: 'The time is beyond the allowed limit.' }, fix: { ar: 'تُرفض حتى بموافقة المشرف؛ لا مسار لتجاوز الحد من التطبيق.', en: 'It is rejected even with supervisor approval; there is no way around the limit in the app.' } },
      { problem: { ar: 'لا يمكنك البتّ في طلبك بنفسك.', en: 'You cannot decide your own request.' }, fix: { ar: 'يقرّره مشرف آخر مخوّل.', en: 'Another authorised supervisor decides it.' } },
      { problem: { ar: 'لم نجد هذه القراءة في السجل بعد انقطاع الاتصال.', en: 'The reading is not in the log after a dropped connection.' }, fix: { ar: 'لم تُحفظ؛ أعد الإرسال بأمان، فالمفتاح نفسه يمنع التكرار.', en: 'It was not saved; resend safely, the same key prevents duplicates.' } },
    ],
    notes: [
      { ar: 'قراءة ATG في التطبيق قيمة تنقلها يدوياً من شاشة الجهاز. لا يوجد اتصال مباشر بأجهزة القياس الآلي، والتطبيق لا يدّعي ذلك.', en: 'An ATG reading in the app is a value you copy by hand from the device screen. There is no direct link to automatic gauges and the app does not claim one.' },
      { ar: 'لا سياسة افتراضية تُطبَّق تلقائياً: الافتراضي «منع» حتى يضبطها مسؤول مخوّل.', en: 'No policy is applied automatically: the default is Deny until an authorised manager sets it.' },
    ],
    screens: [
      { label: { ar: 'الخزانات', en: 'Tanks' }, appHref: '/fuel-stations/ops/tanks' },
      { label: { ar: 'طلبات القراءات المتأخرة', en: 'Late-reading requests' }, appHref: '/fuel-stations/ops/tanks/requests' },
      { label: { ar: 'سياسة القراءات بتاريخ سابق', en: 'Back-dated reading policy' }, appHref: '/fuel-stations/ops/manage/reading-policy' },
    ],
    related: ['fuel-receiving', 'fuel-tanks-pumps-nozzles'],
  },
  {
    slug: 'fuel-opening-balance',
    category: 'receivingStock',
    title: { ar: 'الرصيد الافتتاحي للوقود', en: 'Opening fuel balance' },
    summary: { ar: 'أدخل كميات الخزانات وتكلفة اللتر عند بدء استخدام النظام لمحطة لا تاريخ لها، ثم اعتمدها.', en: 'Enter tank quantities and cost per litre when starting a station that has no history, then approve.' },
    keywords: { ar: 'رصيد افتتاحي وقود خزانات كمية تكلفة لتر معالج حساب حقوق ملكية اعتماد مسودة', en: 'opening balance fuel tanks quantity cost per litre wizard equity account approve draft' },
    minutes: 6,
    audiences: ['manager'],
    surface: 'app',
    overview: {
      ar: 'معالج من ثلاث خطوات: الخزانات والكميات، التكلفة والإعدادات، المراجعة والاعتماد. يؤسّس رصيد الوقود لمخزن محطة فارغ وبلا تاريخ فقط. اعتماده يضيف المخزون ويسجّل قيداً محاسبياً واحداً متوازناً، ولا يُعدَّل بعد ذلك.',
      en: 'A three-step wizard: tanks and quantities, cost and settings, review and approval. It establishes fuel stock only for an empty station warehouse with no history. Approval adds stock and posts one balanced accounting entry, and cannot be edited afterwards.',
    },
    permissions: ['fuel_stations.manage', 'products.view_cost', 'fuel.delivery.cost.record', 'fuel.governance.manage', 'accounts.view'],
    permissionsNote: { ar: 'المسودة: fuel_stations.manage. التكلفة: products.view_cost مع fuel.delivery.cost.record (أو manage). الاعتماد: fuel.governance.manage مع products.view_cost. اختيار الحساب يحتاج accounts.view. بلا صلاحية التكلفة تُحفظ المسودة دون تكلفة وتكملها الجهة المالية.', en: 'Draft: fuel_stations.manage. Cost: products.view_cost with fuel.delivery.cost.record (or manage). Approval: fuel.governance.manage with products.view_cost. Choosing the account needs accounts.view. Without cost permission the draft is saved without cost and finance completes it.' },
    procedures: [
      {
        title: { ar: 'إعداد الرصيد الافتتاحي', en: 'Set up the opening balance' },
        steps: [
          { ar: 'افتح «الإدارة» ثم «الرصيد الافتتاحي للوقود» (إن كانت الميزة غير مفعّلة تظهر «غير متاح»).', en: 'Open Manage, then "Opening fuel balance" (if the feature is off you will see "Unavailable").' },
          { ar: 'الخطوة 1: اكتب الكمية باللتر في كل خزان فيه وقود، واترك الخزان الفارغ بلا قيمة. لا تتجاوز السعة.', en: 'Step 1: enter litres in every tank holding fuel and leave empty tanks blank. Do not exceed capacity.' },
          { ar: 'الخطوة 2: اختر تاريخ الرصيد (ليس في المستقبل)، واكتب تكلفة اللتر لكل نوع وقود بالريال (حتى منزلتين).', en: 'Step 2: choose the balance date (not in the future) and enter the cost per litre for each fuel type in riyals (up to two decimals).' },
          { ar: 'اختر «حساب الأرصدة الافتتاحية» من حسابات حقوق الملكية النشطة، وحدّد حفظه لهذه المحطة أو لكل المحطات.', en: 'Choose the "Opening balances account" from active equity accounts, and save it for this station or all stations.' },
          { ar: 'الخطوة 3: راجع الكميات والقيمة والقيد المحاسبي (تظهر التكاليف والقيد لمن يملك صلاحية التكلفة فقط) وعالج أي «نقاط تمنع الاعتماد».', en: 'Step 3: review quantities, value, and the accounting entry (costs and entry show only to those with cost permission) and resolve any blockers.' },
          { ar: 'اضغط «اعتمد الآن» ثم أكّد. يُضاف المخزون ويُسجَّل القيد.', en: 'Press "Approve now" and confirm. Stock is added and the entry posted.' },
        ],
      },
    ],
    problems: [
      { problem: { ar: 'يوجد رصيد قائم / حركات سابقة لهذا النوع في المحطة.', en: 'There is an existing balance / earlier movements for this type in the station.' }, fix: { ar: 'الرصيد الافتتاحي لا يصلح هنا؛ استخدم الجرد أو الاستلام.', en: 'An opening balance does not apply; use stocktaking or receiving.' } },
      { problem: { ar: 'حساب الأرصدة الافتتاحية غير معيَّن.', en: 'The opening-balances account is not set.' }, fix: { ar: 'اختر حساباً من حقوق الملكية النشطة في الخطوة 2.', en: 'Choose an active equity account in step 2.' } },
      { problem: { ar: 'تكلفة اللتر غير مسجَّلة / التكلفة صفر.', en: 'Cost per litre is missing / zero.' }, fix: { ar: 'أدخل التكلفة. التكلفة صفر تتطلب «السماح بتكلفة صفر» في الخيارات المتقدمة، لوقود وصل دون مقابل فقط.', en: 'Enter the cost. A zero cost needs "Allow zero cost" in advanced options, for fuel received free of charge only.' } },
      { problem: { ar: 'كمية تتجاوز سعة الخزان / السعة الآمنة.', en: 'Quantity exceeds tank capacity / safe capacity.' }, fix: { ar: 'صحّح الكمية.', en: 'Correct the quantity.' } },
      { problem: { ar: 'يلزم أن يعتمد شخص آخر.', en: 'Another person must approve.' }, fix: { ar: 'سياسة المحطة تشترط معتمداً غير المنشئ؛ مسودتك محفوظة ويفتحها زميل مخوَّل.', en: 'Station policy requires a different approver; your draft is saved and an authorised colleague can open and approve it.' } },
      { problem: { ar: 'تغيّر فرع المحطة أو مخزنها / نوع وقود الخزان.', en: 'The station branch, warehouse, or tank’s fuel type changed.' }, fix: { ar: 'ابدأ مستنداً جديداً.', en: 'Start a new document.' } },
    ],
    notes: [
      { ar: 'القيد المحاسبي: مدين مخزون الوقود، دائن حساب الأرصدة الافتتاحية المختار. يظهر للمخوَّلين فقط في المراجعة.', en: 'The accounting entry: debit fuel inventory, credit the chosen opening-balances account. It is shown only to authorised users in the review step.' },
    ],
    screens: [{ label: { ar: 'الرصيد الافتتاحي للوقود', en: 'Opening fuel balance' }, appHref: '/fuel-stations/ops/opening-balance' }],
    related: ['fuel-receiving', 'fuel-tanks-pumps-nozzles'],
  },
];
