/* Functional audit for prototype.html — Codex review notes on PR #2098.
   Run: NODE_PATH=$(npm root -g) node functional-audit.js   (requires Playwright + Chromium)
   
   Runs at desktop and phone viewports. Exit code 1 on any failure. */
const {chromium}=require('playwright');
const URL='file://'+require('path').resolve(__dirname,'..')+'/prototype.html';
let fails=0,passes=0;
const ok=(c,m,x)=>{if(c){passes++;console.log('  ok  ',m)}else{fails++;console.log('  FAIL',m,x===undefined?'':JSON.stringify(x))}};
const VIEWPORTS=[['desktop 1280x800',{width:1280,height:800},{}],['phone 390x844',{width:390,height:844},{isMobile:true,hasTouch:true,deviceScaleFactor:2}]];

async function open(b,vp,extra){
  const c=await b.newContext({viewport:vp,...extra});const p=await c.newPage();const errs=[];
  p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(URL);await p.waitForTimeout(150);
  const click=async s=>{await p.locator(s+':visible').first().click();await p.waitForTimeout(40)}; // table on desktop, cards on phone
  const erp=async()=>{await click('[data-act="app"][data-id="erp"]')};
  const station=async()=>{await click('[data-act="app"][data-id="station"]')};
  const page_=async id=>{await p.locator(`[data-act="erp-page"][data-id="${id}"]:visible`).first().click();await p.waitForTimeout(40)}; // sidebar on desktop, chips on phone
  const body=()=>p.evaluate(()=>document.body.innerText);
  return {c,p,errs,click,erp,station,page_,body};
}
/* Record a new fill through the real station wizard (owner o1, tanker t1, nozzle p1-1). */
async function recordFill(h,litres,paper){
  const {p,click}=h;
  await h.station();
  await p.evaluate(()=>{S.st.view=null;S.st.wiz=null;S.st.tab='home';render()});
  await click('[data-act="wiz-start"]');
  await click('[data-act="wiz-owner"][data-id="o1"]');
  await click('[data-act="wiz-tanker"][data-id="t1"]');
  await click('[data-act="wiz-next"]');
  await click('[data-act="wiz-noz"][data-id="p1-1"]');
  await click('[data-act="wiz-next"]');
  await p.fill('#lit',String(litres));await p.fill('#pap',paper);await p.waitForTimeout(40);
  await click('[data-act="wiz-next"]');
  await click('[data-act="wiz-save"]');await p.waitForTimeout(1400);
  return p.evaluate(()=>S.st.view==='success'&&FILLS.length);
}
const rows=async p=>p.evaluate(()=>[...document.querySelectorAll('.app-erp table tbody tr')].map(tr=>[...tr.cells].map(c=>c.innerText.trim())));
const num=s=>Number(String(s).replace(/[^0-9.]/g,''));

(async()=>{const b=await chromium.launch();
for(const [name,vp,extra] of VIEWPORTS){
 console.log('###',name);

 /* ── Thread 6 (open): operational litres report must follow live fills; settlement stays frozen ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await h.erp();await h.page_('reports');await click('[data-act="rep"][data-id="r1"]');
  let r=await rows(p);const base=r.find(x=>/Askar|عسكر/.test(x[0]));
  ok(base&&num(base[1])===3&&num(base[2])===10000,'baseline: Askar 3 fills / 10,000 L',base);
  // approve Askar's settlement through the UI
  await h.page_('owners');await click('[data-act="erp-open"][data-id="o1"]');await click('[data-act="erp-tab"][data-id="settle"]');
  await click('[data-act="stl-approve"]');await click('[data-act="dlg-confirm"]');
  const frozen=await p.evaluate(()=>JSON.stringify({snap:S.erp.snap.o1,rows:S.erp.snapRows.o1,st:S.erp.settle.o1}));
  const stmtBefore=await p.evaluate(()=>{S.erp.toast=null;S.erp.tab='statement';render();const t=document.querySelector('.erp-pg').innerText;S.erp.tab='settle';render();return t});
  ok(JSON.parse(frozen).st==='approved','settlement approved');
  // new 100 L fill AFTER approval, in the station app
  const n=await recordFill(h,100,'9001');ok(n===6,'new fill recorded after approval (FILLS=6)',n);
  await h.erp();await h.page_('reports');await click('[data-act="rep"][data-id="r1"]');
  r=await rows(p);const after=r.find(x=>/Askar|عسكر/.test(x[0]));
  ok(after&&num(after[1])===4,'report: fills count is 4',after);
  ok(after&&num(after[2])===10100,'report: litres is 10,100 (live fills, not frozen snapshot)',after);
  // consistency with the other operational views
  await click('[data-act="rep"][data-id="r2"]');r=await rows(p);
  const tankerSum=r.filter(x=>/Askar|عسكر/.test(x[1])).reduce((a,x)=>a+num(x[2]),0);
  ok(tankerSum===10100,'per-tanker report agrees (10,100 L for Askar)',tankerSum);
  await h.page_('owners');await click('[data-act="erp-open"][data-id="o1"]');
  ok(/10,?100/.test(await p.evaluate(()=>document.querySelector('.stats .stat .v').innerText)),'owner overview "litres this month" = 10,100');
  await h.page_('owners');r=await rows(p);const ownRow=r.find(x=>/Askar|عسكر/.test(x[0]));
  ok(ownRow&&num(ownRow[5])===10100,'owners list "month litres" = 10,100 (live fills)',ownRow);
  await click('[data-act="erp-open"][data-id="o1"]');
  // settlement data and printable statement unchanged
  const frozen2=await p.evaluate(()=>JSON.stringify({snap:S.erp.snap.o1,rows:S.erp.snapRows.o1,st:S.erp.settle.o1}));
  ok(frozen2===frozen,'approved snapshot (totals + rows) unchanged');
  const stmtAfter=await p.evaluate(()=>{S.erp.toast=null;S.erp.tab='statement';render();const t=document.querySelector('.erp-pg').innerText;S.erp.tab='settle';render();return t});
  ok(stmtAfter===stmtBefore,'approved statement text unchanged');
  ok(await p.evaluate(()=>calc('o1').liters)===10000,'calc() still returns the frozen 10,000 L for settlement');
  ok(h.errs.length===0,'no page errors',h.errs);await h.c.close();}


 /* ── Thread 7: commission inputs accept Arabic-Indic digits (and the Arabic decimal mark) ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await h.erp();await click('[data-act="erp-open"][data-id="o1"]');await click('[data-act="erp-tab"][data-id="settle"]');
  const net0=await p.evaluate(()=>calc('o1').net);
  await p.fill('#cmPct','٥');await p.waitForTimeout(60);
  ok(await p.evaluate(()=>calc('o1').commission)===1000&&await p.evaluate(()=>calc('o1').net)===net0,'Arabic digit ٥ = 5% commission (not zero)',await p.evaluate(()=>calc('o1')));
  await p.fill('#cmPct','٢٫٥');await p.waitForTimeout(60);
  ok(await p.evaluate(()=>calc('o1').commission)===500,'Arabic decimal ٢٫٥ = 2.5% commission',await p.evaluate(()=>calc('o1').commission));
  await click('[data-act="cm-mode"][data-id="manual"]');await p.fill('#cmMan','١٠٠٠');await p.waitForTimeout(60);
  ok(await p.evaluate(()=>calc('o1').commission)===1000,'Arabic digits ١٠٠٠ manual commission = 1,000 (not zero)',await p.evaluate(()=>calc('o1').commission));
  ok(h.errs.length===0,'no page errors',h.errs);await h.c.close();}

 /* ── Thread 8: printable statement reconciles after payout (net − paid = due) ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await h.erp();await click('[data-act="erp-open"][data-id="o1"]');await click('[data-act="erp-tab"][data-id="settle"]');
  await click('[data-act="stl-approve"]');await click('[data-act="dlg-confirm"]');
  await click('[data-act="stl-pay"]');await click('[data-act="dlg-confirm"]');
  const st=await p.evaluate(()=>{S.erp.toast=null;S.erp.tab='statement';render();const l=[...document.querySelectorAll('.stmt .calc .ln')].map(e=>e.innerText.replace(/\s+/g,' ').trim());return {l,c:calc('o1')}});
  ok(st.c.paid===4000&&st.c.due===0&&st.c.net===4000,'payout recorded: net 4,000, paid 4,000, due 0',st.c);
  ok(st.l.length===4&&/4,?000/.test(st.l[1])&&/4,?000/.test(st.l[2])&&/\b0\b|0\.00|٠/.test(st.l[3]),'printable statement shows commission, net, paid and due lines',st.l);
  ok(h.errs.length===0,'no page errors',h.errs);await h.c.close();}

 /* ── Thread 1: add owner → settlement tab must not throw ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await h.erp();await h.page_('owners');
  await p.evaluate(()=>{S.erp.dlg={k:'owner',v:{name:'Test Owner',phone:'0500000009'},errs:{}};render()});
  await click('[data-act="dlg-save"]');
  const id=await p.evaluate(()=>OWN[OWN.length-1].id);
  await click(`[data-act="erp-open"][data-id="${id}"]`);await click('[data-act="erp-tab"][data-id="settle"]');
  ok(h.errs.length===0&&/Commission|العمولة/.test(await h.body()),'new owner → settlement tab opens without errors',h.errs);await h.c.close();}

 /* ── Threads 2/5: approval freezes commission inputs and statement rows ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await h.erp();await click('[data-act="erp-open"][data-id="o1"]');await click('[data-act="erp-tab"][data-id="settle"]');
  await click('[data-act="stl-approve"]');await click('[data-act="dlg-confirm"]');
  ok(await p.evaluate(()=>document.getElementById('cmPct').disabled),'commission input disabled after approval');
  const net=await p.evaluate(()=>calc('o1').net);
  await p.evaluate(()=>{COMM.o1.pct=10});ok(await p.evaluate(()=>calc('o1').net)===net,'approved net unaffected by commission change');
  // attribute a pending receipt after approval → statement rows/totals stay equal to snapshot
  await p.evaluate(()=>{COL.find(c=>c.id==='PAY-3020').oid='o1'});
  const st=await p.evaluate(()=>{S.erp.tab='statement';render();const rows=document.querySelectorAll('.app-erp table tbody tr').length;return {rows,snapCl:S.erp.snapRows.o1.cl.length}});
  ok(st.snapCl===2,'statement rows snapshot holds 2 collections (not 3)',st);
  ok(h.errs.length===0,'no page errors',h.errs);await h.c.close();}

 /* ── Thread 3: no payout for non-positive balance ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await h.erp();await click('[data-act="erp-open"][data-id="o2"]');await click('[data-act="erp-tab"][data-id="settle"]');
  await click('[data-act="stl-approve"]');await click('[data-act="dlg-confirm"]');
  ok((await p.evaluate(()=>calc('o2').net))<0,'Sultan balance is negative');
  ok(await p.locator('[data-act="stl-pay"]').count()===0,'no payout button for negative balance');
  await p.evaluate(()=>ACTS['stl-pay']());ok(await p.evaluate(()=>S.erp.dlg===null),'payout handler refuses non-positive balance');
  ok(await p.evaluate(()=>S.erp.settle.o2)==='approved','debt retained (state stays approved)');await h.c.close();}

 /* ── Thread 4: close permission preserved while typing readings ── */
 {const h=await open(b,vp,extra);const {p,click}=h;
  await p.evaluate(()=>{S.role='noclose';S.st.tab='shift';render()});
  await p.evaluate(()=>{NOZ.forEach(z=>{S.st.shift.close[z.id]=String(z.open+1)});render()});
  const dis=async()=>p.evaluate(()=>{const b=document.querySelector('[data-act="shift-review"]');return b?b.disabled:'absent'});
  ok((await dis())===true||(await dis())==='absent','role without close permission: review button disabled / absent');
  await p.evaluate(()=>{ACTS['shift-review']&&ACTS['shift-review']()});
  ok(await p.evaluate(()=>S.st.shift.state)==='open','role without close permission cannot close via handler');
  await p.evaluate(()=>{S.role='seller';render()});
  ok((await dis())===false,'seller with valid readings: review enabled');
  ok(h.errs.length===0,'no page errors',h.errs);await h.c.close();}
}
await b.close();
console.log(`\n${passes} passed, ${fails} failed`);process.exit(fails?1:0);
})();
