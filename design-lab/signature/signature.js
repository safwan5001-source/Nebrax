/* AWJ Signature V3 — extension of the Unified UX Foundation (Design Lab only).
   Same shell, navigation, behavioural components, accounting rules and status semantics as Phase 1:
   this file only adds two proof pages (enterprise dashboard, long sales invoice fixtures), draft
   recovery, the wordmark and lab state. Visual identity lives entirely in signature.css (L4 packs).
   Loaded BEFORE foundation/foundation.js (frozen copy of the Unified UX Foundation runtime this lab depends on), which reads window.FX_EXT. Synthetic data only. */
(() => {
const Q = new URLSearchParams(location.search);
const EMBED = Q.has('embed');
const RECOVERY_KEY = 'awj-v3-unsaved-sales';

/* ------------------------------------------------------------------ devices (real widths requested for V3) */
const DEVICES = {
  phoneS:{ w:320, h:640, l:'320' }, phone:{ w:390, h:844, l:'390' }, phoneL:{ w:430, h:932, l:'430' },
  tablet:{ w:768, h:1024, l:'768' }, tabletW:{ w:834, h:1194, l:'834' }, laptop:{ w:1366, h:768, l:'1366' },
  desktop:{ w:1920, h:1080, l:'1920' }, ultra:{ w:2560, h:1080, l:'2560' }, wide:{ w:null, h:900, l:'100%' },
};

/* ------------------------------------------------------------------ icons (same 24px outline grammar as the foundation set) */
const ICONS = {
  trendUp:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trendDown:'<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  wallet:'<path d="M3 7.5h15.5A2.5 2.5 0 0 1 21 10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7.5 15 4v3.5"/><circle cx="16.5" cy="14" r="1.1"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  percent:'<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="17" r="2.4"/>',
  landmark:'<path d="M3 21h18M5.5 21v-9M18.5 21v-9M10 21v-9M14 21v-9"/><path d="m12 3 9 5.5H3z"/>',
  chart:'<path d="M3 21h18"/><path d="M6 17V11M11 17V6M16 17v-4M21 17V9"/>',
  droplet:'<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>',
  activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  table:'<path d="M3 5h18v14H3z"/><path d="M3 10h18M3 15h18M9 5v14"/>',
};

/* ------------------------------------------------------------------ i18n for the new pages */
const AR = {
  g_home:'الرئيسية', dash:'لوحة التحكم', dashT:'لوحة التحكم المالية', dashSub:'كل الفروع · فترة نوفمبر 2026 مفتوحة · آخر مزامنة 10:42',
  today:'الثلاثاء، 10 نوفمبر 2026', demoData:'بيانات تجريبية', quick:'إجراءات سريعة',
  qaSales:'فاتورة مبيعات', qaPurch:'فاتورة مشتريات', qaReceipt:'سند قبض', qaPermit:'إذن مخزني', qaShift:'وردية المحطة',
  kpis:'المؤشرات المالية', kRev:'الإيرادات · الشهر حتى اليوم', kCash:'النقد والبنوك', kAR:'الذمم المدينة', kAP:'مستحق للموردين خلال 7 أيام', kMargin:'هامش الربح الإجمالي', kVat:'ضريبة القيمة المضافة المستحقة',
  vsOct:'مقارنة بالفترة نفسها من أكتوبر', vsWeek:'منذ بداية الأسبوع', nAccounts:'5 حسابات', overdue:'متأخر', bills:'6 فواتير موردين', pts:'نقطة', vatDue:'الربع الرابع · الإقرار حتى 31 يناير 2027',
  attn:'يحتاج انتباهك', attnSub:'مرتّب حسب الأثر المالي',
  a1:'4 فواتير متأخرة أكثر من 30 يوماً', a1m:'أقدمها 46 يوماً · مؤسسة الخليج الحديثة للتجارة', a1b:'عرض وتذكير',
  a2:'وردية بانتظار الاعتماد', a2m:'محطة الجبيل الصناعية · وردية الصباح · فرق نقدي 120.00', a2b:'مراجعة',
  a3:'صنفان تحت حد الطلب', a3m:'مستودع الجبيل · كابل نحاسي، دهان إيبوكسي', a3b:'عرض المخزون',
  a4:'3 مسودات فواتير منذ أكثر من 7 أيام', a4m:'لم تُرحَّل بعد؛ لا أثر محاسبياً لها', a4b:'فتح',
  a5:'فترة أكتوبر 2026 ما زالت مفتوحة', a5m:'أقفلها بعد مراجعة تسويات البنوك', a5b:'قائمة الإقفال',
  cash:'التدفق النقدي', cashSub:'آخر 6 أشهر · المقبوضات والمدفوعات', cin:'مقبوضات', cout:'مدفوعات', net:'الصافي', partial:'حتى اليوم', asTable:'عرض البيانات كجدول', month:'الشهر',
  m6:'يونيو', m7:'يوليو', m8:'أغسطس', m9:'سبتمبر', m10:'أكتوبر', m11:'نوفمبر',
  aging:'أعمار الذمم المدينة', agingSub:'إجمالي 2,184,600.00', ag0:'غير مستحقة', ag1:'1–30 يوماً', ag2:'31–60 يوماً', ag3:'61–90 يوماً', ag4:'أكثر من 90',
  branches:'أداء الفروع اليوم', brName:'الفرع', brSales:'المبيعات', brInv:'الفواتير', brAvg:'متوسط الفاتورة', brMargin:'الهامش', brTotal:'الإجمالي',
  br_dmm:'الرئيسي — الدمام', br_jbl:'الجبيل', br_khb:'الخبر',
  stations:'محطات الوقود اليوم', stSub:'تقديرات تشغيلية من العدادات — ليست فواتير', liters:'لتر', estSales:'مبيعات تقديرية', tankLow:'خزان الديزل 38٪', tanksOk:'الخزانات ضمن الحدود',
  sJbl:'محطة الجبيل الصناعية', sDmm:'محطة الدمام الشمالية', sKhb:'محطة الخبر',
  shOpen:'وردية مفتوحة', shWait:'بانتظار الاعتماد', shDone:'الورديات معتمدة',
  recent:'أحدث المستندات', viewAll:'عرض الكل',
  recoveredT:'استعدنا تعديلاتك غير المحفوظة', recoveredP:'حُفظت محلياً تلقائياً قبل إغلاق الصفحة ({at}). لم تُرحَّل ولم تُحفظ كمسودة بعد.', keep:'متابعة', discard:'تجاهلها والعودة لآخر حفظ',
  notOnLab3:'غير متاح في نموذج المختبر',
};
const EN = {
  g_home:'Home', dash:'Dashboard', dashT:'Financial dashboard', dashSub:'All branches · November 2026 period open · Synced 10:42',
  today:'Tuesday, 10 November 2026', demoData:'Sample data', quick:'Quick actions',
  qaSales:'Sales invoice', qaPurch:'Purchase invoice', qaReceipt:'Receipt voucher', qaPermit:'Stock permit', qaShift:'Station shift',
  kpis:'Financial indicators', kRev:'Revenue · month to date', kCash:'Cash & banks', kAR:'Receivables', kAP:'Payables due in 7 days', kMargin:'Gross margin', kVat:'VAT payable',
  vsOct:'vs same period in October', vsWeek:'since start of week', nAccounts:'5 accounts', overdue:'Overdue', bills:'6 supplier bills', pts:'pts', vatDue:'Q4 · return due 31 Jan 2027',
  attn:'Needs your attention', attnSub:'Ordered by financial impact',
  a1:'4 invoices overdue by 30+ days', a1m:'Oldest 46 days · Modern Gulf Trading Est.', a1b:'Review & remind',
  a2:'Shift awaiting approval', a2m:'Jubail Industrial station · Morning shift · cash variance 120.00', a2b:'Review',
  a3:'2 items below reorder level', a3m:'Jubail warehouse · copper cable, epoxy paint', a3b:'View stock',
  a4:'3 draft invoices older than 7 days', a4m:'Not posted; no accounting effect yet', a4b:'Open',
  a5:'October 2026 period is still open', a5m:'Close it after bank reconciliations', a5b:'Close checklist',
  cash:'Cash flow', cashSub:'Last 6 months · receipts and payments', cin:'Receipts', cout:'Payments', net:'Net', partial:'to date', asTable:'Show data as a table', month:'Month',
  m6:'Jun', m7:'Jul', m8:'Aug', m9:'Sep', m10:'Oct', m11:'Nov',
  aging:'Receivables aging', agingSub:'Total 2,184,600.00', ag0:'Not due', ag1:'1–30 days', ag2:'31–60 days', ag3:'61–90 days', ag4:'90+ days',
  branches:'Branch performance today', brName:'Branch', brSales:'Sales', brInv:'Invoices', brAvg:'Avg. invoice', brMargin:'Margin', brTotal:'Total',
  br_dmm:'Main — Dammam', br_jbl:'Jubail', br_khb:'Khobar',
  stations:'Fuel stations today', stSub:'Operational estimates from meters — not invoices', liters:'L', estSales:'Est. sales', tankLow:'Diesel tank 38%', tanksOk:'Tanks within limits',
  sJbl:'Jubail Industrial station', sDmm:'Dammam North station', sKhb:'Khobar station',
  shOpen:'Shift open', shWait:'Awaiting approval', shDone:'Shifts approved',
  recent:'Latest documents', viewAll:'View all',
  recoveredT:'We recovered your unsaved changes', recoveredP:'Saved locally before the page closed ({at}). Not posted and not saved as a draft yet.', keep:'Continue', discard:'Discard and return to the last save',
  notOnLab3:'Not available in the lab prototype',
};

/* ------------------------------------------------------------------ dashboard data (halalas; synthetic) */
const KPI = [
  { k:'kRev', icon:'chart', v:128493075, delta:'+12.4%', good:true, note:'vsOct', spark:[38,41,40,46,44,49,52,51,55,58,57,63] },
  { k:'kCash', icon:'wallet', v:341270520, delta:'−2.1%', good:false, note:'vsWeek', sub:'nAccounts', spark:[62,64,61,66,68,67,65,69,70,68,66,64] },
  { k:'kAR', icon:'users', v:218460000, overdue:73230000, spark:[51,50,53,55,54,57,56,58,60,59,62,61] },
  { k:'kAP', icon:'truck', v:64218000, sub:'bills', spark:[30,34,31,29,35,33,36,32,34,37,35,38] },
  { k:'kMargin', icon:'percent', pct:'31.8%', delta:'+1.2', good:true, unit:'pts', spark:[27,28,28,29,30,29,30,31,30,31,31,32] },
  { k:'kVat', icon:'landmark', v:18739410, sub:'vatDue', spark:[10,12,13,15,14,16,17,18,18,19,20,21] },
];
const CASH = [['m6',241000000,202000000],['m7',258000000,221000000],['m8',233000000,240000000],['m9',279000000,236000000],['m10',302000000,251000000],['m11',146000000,119000000]];
const AGING = [['ag0',145230000,'ok'],['ag1',34585000,'info'],['ag2',19800000,'warn'],['ag3',11220000,'neg'],['ag4',7625000,'neg2']];
const BRANCHES = [['br_dmm',4825040,31,294],['br_jbl',6183015,38,331],['br_khb',2241000,17,278]];
const STATIONS = [['sJbl',18420,4236600,'wait',38],['sDmm',12960,2980800,'open',74],['sKhb',8115,1866450,'done',81]];

/* ------------------------------------------------------------------ long-invoice fixtures */
function makeLines(api, n) {
  if (n <= 3) return api.newDoc('sales').lines;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2, 3, 4, 5, 6, 7][i % 8];
    const qtyM = p === 7 ? 1000 : (((i * 7) % 23) + 1) * (p === 6 ? 10000 : 1000);
    out.push({ id: i + 1, p, qtyM, price: api.PROD[p].price, disc: i % 6 === 0 ? 2500 : 0 });
  }
  return out;
}
function buildDocs(S, api) {
  const n = Number(S.lines) || 3;
  const D = api.newDoc('sales'); D.lines = makeLines(api, n);
  if (S.scenario === 'errors' && D.lines.length >= 3) {
    const a = D.lines[Math.min(4, D.lines.length - 1)], b = D.lines[Math.min(11, D.lines.length - 2)];
    a.bad = { qty: true }; a.raw = { qty: '12x' };
    b.bad = { price: true }; b.raw = { price: '1.234' };
    D.showErrs = true; D.dirty = true;
  }
  S.docs.sales = D; S._built = `${n}|${S.scenario}`;
}

/* ------------------------------------------------------------------ helpers */
const spark = (vals) => {
  const max = Math.max(...vals), min = Math.min(...vals), w = 120, h = 32, step = w / (vals.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - ((v - min) / Math.max(1, max - min)) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="0,${h} ${pts} ${w},${h}" class="area"/><polyline points="${pts}" class="line"/></svg>`;
};

/* ------------------------------------------------------------------ dashboard */
function dashboard(api) {
  const { t, ic, money, statusBadge, S, esc, nm, INV, invStatus, fmtDate, grp } = api;
  const loading = S.demo === 'loading', failed = S.demo === 'error';
  const sk = (w = '60%') => `<span class="sk" style="width:${w};display:block;height:14px"></span>`;
  const kpi = (x) => `<li class="kpi" data-k="${x.k}"><div class="kpi-h">${ic(x.icon)}<span>${t(x.k)}</span></div>
    ${loading ? `<div class="kpi-v">${sk('70%')}</div>` : `<div class="kpi-v">${x.pct ? `<span class="m pct">${x.pct}</span>` : money(x.v)}</div>`}
    <div class="kpi-f">${x.delta ? `<span class="delta ${x.good ? 'good' : 'bad'}">${ic(x.delta.startsWith('+') ? 'trendUp' : 'trendDown')}<b class="num">${x.delta}</b>${x.unit ? ` ${t(x.unit)}` : ''}</span><span class="muted">${t(x.note || '')}</span>` : ''}${x.overdue ? `<span class="delta bad">${ic('alert')}${t('overdue')} <b>${money(x.overdue, { sym: false })}</b></span>` : ''}${x.sub ? `<span class="muted">${t(x.sub)}</span>` : ''}</div>
    ${loading ? '' : spark(x.spark)}</li>`;
  const att = [['neg','alert','a1',38645000,'sales'],['warn','fuel','a2',null,'shift'],['warn','box','a3',null,'inventory'],['info','file','a4',null,'sales'],['neutral','calendar','a5',null,'']];
  const attItem = ([sev, icn, k, amt, route]) => `<li class="att sev-${sev}"><span class="sev">${ic(icn)}</span><div class="tx"><b>${t(k)}</b><span>${t(k + 'm')}</span></div>${amt ? `<span class="amt">${money(amt)}</span>` : '<span class="amt"></span>'}<button type="button" class="btn sm" ${route ? `data-route="${route}"` : `data-act="v3-na"`}>${t(k + 'b')}</button></li>`;
  const maxC = Math.max(...CASH.flatMap(([, a, b]) => [a, b]));
  const cashBars = CASH.map(([m, a, b], i) => `<div class="mo${i === CASH.length - 1 ? ' cur' : ''}"><div class="pair" aria-hidden="true"><i class="in" style="--h:${(a / maxC * 100).toFixed(1)}%"></i><i class="out" style="--h:${(b / maxC * 100).toFixed(1)}%"></i></div><span class="lb">${t(m)}${i === CASH.length - 1 ? `<small>${t('partial')}</small>` : ''}</span></div>`).join('');
  const [, ci, co] = CASH[CASH.length - 1];
  const agTotal = AGING.reduce((s, x) => s + x[1], 0);
  const branchRows = BRANCHES.map(([k, sales, n, mg]) => `<tr><th scope="row">${t(k)}</th><td class="c-amt" data-l="${t('brSales')}">${money(sales)}</td><td class="c-amt num" data-l="${t('brInv')}">${n}</td><td class="c-amt" data-l="${t('brAvg')}">${money(Math.floor((2 * sales + n) / (2 * n)))}</td><td class="c-amt num" data-l="${t('brMargin')}">${(mg / 10).toFixed(1)}%</td></tr>`).join('');
  const bT = BRANCHES.reduce((s, b) => s + b[1], 0), bN = BRANCHES.reduce((s, b) => s + b[2], 0);
  const st = STATIONS.map(([k, l, est, sh, tank]) => `<li class="stn"><div class="stn-h"><b>${t(k)}</b>${sh === 'wait' ? `<span class="st st-attention pill">${ic('clock')}${t('shWait')}</span>` : sh === 'open' ? `<span class="st st-info">${ic('circle')}${t('shOpen')}</span>` : `<span class="st st-done">${ic('check')}${t('shDone')}</span>`}</div>
    <div class="stn-v"><span><small>${t('liters')}</small><b class="num">${grp(l)}</b></span><span><small>${t('estSales')}</small><b>${money(est)}</b></span></div>
    <div class="tank ${tank < 45 ? 'low' : ''}" role="img" aria-label="${tank < 45 ? t('tankLow') : t('tanksOk')}"><i style="--v:${tank}%"></i></div><small class="tank-l">${tank < 45 ? `${ic('alert')}${t('tankLow')}` : t('tanksOk')}</small></li>`).join('');
  const recent = INV.slice(0, 6).map(v => `<li class="doc"><span class="no num">${v.no}</span><span class="cu">${esc(nm(v.c))}</span><span class="dt num">${fmtDate(v.date)}</span><span class="am">${money(v.total)}</span>${statusBadge('invoice', invStatus(v))}</li>`).join('');
  if (failed) return `<div class="page dash">${hero(api)}<section class="panel">${api.stateBlock('error')}</section></div>`;
  return `<div class="page dash">${hero(api)}
  <section class="kpis" aria-labelledby="k-h"><h2 id="k-h" class="sr">${t('kpis')}</h2><ul>${KPI.map(kpi).join('')}</ul></section>
  <div class="dgrid">
    <section class="panel d-attn" aria-labelledby="att-h"><div class="panel-h"><h2 id="att-h">${t('attn')}</h2><span class="sub">${t('attnSub')}</span></div><ul class="att-l">${loading ? `<li style="padding:14px">${sk()}${sk('40%')}</li>` : att.map(attItem).join('')}</ul></section>
    <section class="panel d-cash" aria-labelledby="cash-h"><div class="panel-h"><h2 id="cash-h">${t('cash')}</h2><span class="sub">${t('cashSub')}</span></div>
      <div class="panel-b"><div class="cash-sum"><span><i class="key in"></i>${t('cin')} <b>${money(ci)}</b></span><span><i class="key out"></i>${t('cout')} <b>${money(co)}</b></span><span>${t('net')} <b>${money(ci - co)}</b></span></div>
      <div class="bars" role="img" aria-label="${t('cash')}: ${t('cashSub')}">${cashBars}</div>
      <details class="as-table"><summary>${ic('table')}${t('asTable')}</summary><div class="tscroll"><table class="mini"><thead><tr><th>${t('month')}</th><th class="c-amt">${t('cin')}</th><th class="c-amt">${t('cout')}</th><th class="c-amt">${t('net')}</th></tr></thead><tbody>${CASH.map(([m, a, b]) => `<tr><th scope="row">${t(m)}</th><td class="c-amt">${money(a)}</td><td class="c-amt">${money(b)}</td><td class="c-amt">${money(a - b)}</td></tr>`).join('')}</tbody></table></div></details></div></section>
    <section class="panel d-aging" aria-labelledby="ag-h"><div class="panel-h"><h2 id="ag-h">${t('aging')}</h2><span class="sub num">${t('agingSub')}</span></div><div class="panel-b">
      <div class="ag-bar" role="img" aria-label="${t('aging')}">${AGING.map(([k, v, c]) => `<i class="${c}" style="--w:${(v / agTotal * 100).toFixed(2)}%"></i>`).join('')}</div>
      <ul class="ag-l">${AGING.map(([k, v, c]) => `<li><i class="dot ${c}"></i><span>${t(k)}</span><b>${money(v)}</b><span class="pc num">${(v / agTotal * 100).toFixed(1)}%</span></li>`).join('')}</ul></div></section>
    <section class="panel d-branch" aria-labelledby="br-h"><div class="panel-h"><h2 id="br-h">${t('branches')}</h2></div><div class="tscroll" tabindex="0" role="region" aria-labelledby="br-h"><table class="mini br"><thead><tr><th>${t('brName')}</th><th class="c-amt">${t('brSales')}</th><th class="c-amt">${t('brInv')}</th><th class="c-amt">${t('brAvg')}</th><th class="c-amt">${t('brMargin')}</th></tr></thead><tbody>${branchRows}</tbody><tfoot><tr><th scope="row">${t('brTotal')}</th><td class="c-amt" data-l="${t('brSales')}">${money(bT)}</td><td class="c-amt num" data-l="${t('brInv')}">${bN}</td><td class="c-amt" data-l="${t('brAvg')}">${money(Math.floor((2 * bT + bN) / (2 * bN)))}</td><td></td></tr></tfoot></table></div></section>
    <section class="panel d-stn" aria-labelledby="st-h"><div class="panel-h"><h2 id="st-h">${t('stations')}</h2><span class="sub">${t('stSub')}</span></div><ul class="stn-l">${st}</ul></section>
    <section class="panel d-recent" aria-labelledby="rc-h"><div class="panel-h"><h2 id="rc-h">${t('recent')}</h2><button type="button" class="btn sm ghost" data-act="v3-na">${t('viewAll')}</button></div><ul class="doc-l">${recent}</ul></section>
  </div></div>`;
}
function hero(api) {
  const { t, ic } = api;
  const qa = [['qaSales','cart','sales',true],['qaPurch','truck','purchase'],['qaReceipt','receipt',''],['qaPermit','box','inventory'],['qaShift','fuel','shift']];
  return `<section class="hero" aria-labelledby="dash-h"><div class="hero-t"><p class="hero-e"><span>${t('today')}</span><span class="tag-lab">${t('demoData')}</span></p><h1 id="dash-h">${t('dashT')}</h1><p class="hero-s">${t('dashSub')}</p></div>
    <div class="qa" role="group" aria-label="${t('quick')}">${qa.map(([k, icn, r, primary]) => `<button type="button" class="btn${primary ? ' primary' : ''}" ${r ? `data-route="${r}"` : 'data-act="v3-na"'}>${ic(icn)}<span>${t(k)}</span></button>`).join('')}</div></section>`;
}

/* ------------------------------------------------------------------ draft recovery (errors and crashes must not lose data) */
function saveRecovery() {
  const S = window.__fx?.S; if (!S || EMBED) return;
  const D = S.docs.sales;
  try { if (D.dirty) localStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: new Date().toISOString(), doc: D })); /* keeps D.saved: discard must return to the acknowledged save */ else localStorage.removeItem(RECOVERY_KEY); } catch (e) {}
}
document.addEventListener('input', () => setTimeout(saveRecovery, 0));
document.addEventListener('click', (e) => {
  setTimeout(saveRecovery, 0);
  const b = e.target.closest?.('[data-act^="v3-"]'); if (!b || !window.__fx) return;
  const { S, API } = window.__fx;
  if (b.dataset.act === 'v3-na') API.toast(API.t('notOnLab3'));
  if (b.dataset.act === 'v3-keep') { S.recovered = null; API.render(); }
  if (b.dataset.act === 'v3-discard') { const D = S.docs.sales; S.docs.sales = D.saved ? { ...JSON.parse(JSON.stringify(D.saved)), saved: D.saved } : API.newDoc('sales'); if (S.docs.sales.lines && !D.saved) S.docs.sales.lines = makeLines(API, Number(S.lines) || 3); S.recovered = null; try { localStorage.removeItem(RECOVERY_KEY); } catch (e) {} API.render(); }
});

/* ------------------------------------------------------------------ the extension */
window.FX_EXT = {
  storageKey: 'awj-signature-v3', persist: !EMBED, persistKeys: ['lines', 'scenario'],
  homeRoute: 'dashboard', devices: DEVICES, icons: ICONS, i18n: { ar: AR, en: EN },
  state: { route: 'dashboard', identity: 'nasaq', amt: 'b', device: 'laptop', lines: '24', scenario: 'normal', recovered: null },
  routeLabels: { dashboard: 'dash' },
  nav(NAV, ROUTES) { NAV.splice(NAV.length - 1, 1); NAV.unshift(['g_home', 'home', [['dash', 'dashboard']]]); ROUTES.push('dashboard'); },
  init(S) {
    // URL state (embed / compare / tests): id, r, m, l, dn, ln, sc, st, dev
    const map = { id:'identity', r:'route', m:'mode', l:'lang', dn:'density', ln:'lines', sc:'scenario', st:'demo', dev:'device' };
    Object.entries(map).forEach(([q, k]) => { if (Q.get(q)) S[k] = Q.get(q); });
    S.amt = 'b'; // D1 (adopted): physical right alignment with tabular figures
    if (EMBED) S.device = 'wide';
    if (!['nasaq', 'liwan'].includes(S.identity)) S.identity = 'nasaq';
  },
  pages(api) {
    // fixtures need api.newDoc/PROD, so build lazily on first render
    if (api.S._built !== `${Number(api.S.lines) || 3}|${api.S.scenario}`) buildDocs(api.S, api);
    if (!EMBED) { try { const r = JSON.parse(localStorage.getItem(RECOVERY_KEY) || 'null'); if (r?.doc?.lines) { api.S.docs.sales = r.doc; api.S.recovered = r.at; } } catch (e) {} }
    return { dashboard: () => dashboard(api) };
  },
  docNotice(kind, api) {
    const S = api.S; if (kind !== 'sales' || !S.recovered) return '';
    const { t, ic } = api; const at = new Date(S.recovered); const hh = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return `<div class="msg info recovered" role="status">${ic('save')}<div><b>${t('recoveredT')}</b>${t('recoveredP', { at: hh })}<div class="rec-a"><button type="button" class="btn sm" data-act="v3-keep">${t('keep')}</button><button type="button" class="btn sm ghost" data-act="v3-discard">${t('discard')}</button></div></div></div>`;
  },
  brand(where, api) {
    const S = api.S;
    const word = S.lang === 'en' ? 'AWJ' : 'أَوْج';
    if (where === 'rail') return `<span class="wm-r" aria-hidden="true" lang="${S.lang}">${word}</span>`;
    return `<div class="brand v3"><span class="wm" lang="${S.lang}">${word}</span><span class="wm-div" aria-hidden="true"></span><div style="min-width:0"><b>${S.lang === 'en' ? 'Nebras Al Tumouh Co.' : 'شركة نبراس الطموح'}</b><span>ERP · Signature V3</span></div></div>`;
  },
  chrome(seg, api) {
    const S = api.S;
    if (S._built !== `${Number(S.lines) || 3}|${S.scenario}`) { buildDocs(S, api); S.recovered = null; }
    seg('c-id', [['nasaq', 'نَسَق · Nasaq'], ['liwan', 'ليوان · Liwan']], 'identity');
    seg('c-route', [['dashboard', 'لوحة التحكم'], ['sales', 'فاتورة مبيعات'], ['purchase', 'مشتريات'], ['inventory', 'مخزون'], ['shift', 'وردية محطة']], 'route');
    seg('c-device', Object.entries(DEVICES).filter(([k]) => k !== 'wide').map(([k, d]) => [k, d.l]), 'device');
    seg('c-mode', [['light', 'فاتح'], ['dark', 'داكن']], 'mode');
    seg('c-lang', [['ar', 'عربي'], ['en', 'EN']], 'lang');
    seg('c-density', [['regular', 'متوازن'], ['compact', 'مضغوط']], 'density');
    seg('c-lines', [['3', '3 بنود'], ['24', '24 بنداً'], ['80', '80 بنداً']], 'lines');
    seg('c-scen', [['normal', 'سليمة'], ['errors', 'بها أخطاء']], 'scenario');
    seg('c-demo', [['ready', 'جاهزة'], ['loading', 'تحميل'], ['error', 'خطأ']], 'demo');
  },
};
})();
