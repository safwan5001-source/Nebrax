const {chromium}=require('playwright');
const S=require('path').resolve(__dirname,'..')+'/';
const sizes=[['SE 375x667',375,667,336],['13mini 375x812',375,812,336],['14 390x844',390,844,336],['ProMax 430x932',430,932,350],['land 844x390',844,390,200],['landMax 932x430',932,430,200]];
let fails=0;const ok=(c,m,x)=>{if(!c){fails++;console.log('  FAIL',m,x||'')}};
const PAGE=`
window.__geo=(sel)=>{const r=e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom}};return [...document.querySelectorAll(sel)].map(e=>({e,r:r(e)}))};
window.__overlaps=(rootSel)=>{const root=document.querySelector(rootSel);if(!root)return [];const vis=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&b.width>1&&b.height>1&&!e.classList.contains('sr')&&!e.closest('.sr')};
 const els=[...root.querySelectorAll('button,input:not([type=file]):not([type=checkbox]),select,textarea,label.btn,a')].filter(vis);const out=[];
 for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i],b=els[j];if(a.contains(b)||b.contains(a))continue;const A=a.getBoundingClientRect(),B=b.getBoundingClientRect();const w=Math.min(A.right,B.right)-Math.max(A.left,B.left),h=Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top);if(w>3&&h>3){
  // ignore pairs where one is clipped out of the scroll viewport
  const sc=a.closest('.scroll,.sheet-in');const sb=sc?sc.getBoundingClientRect():null;if(sb&&(A.bottom<sb.top||A.top>sb.bottom||B.bottom<sb.top||B.top>sb.bottom))continue;out.push((a.dataset.act||a.id||a.tagName)+' x '+(b.dataset.act||b.id||b.tagName))}}return out};
`;
(async()=>{const b=await chromium.launch();
for(const [name,w,h,kb] of sizes){
 console.log('###',name);
 for(const scheme of ['light','dark']){
  const c=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2,isMobile:true,hasTouch:true,colorScheme:scheme});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+S+'prototype.html');await p.addScriptTag({content:PAGE});await p.waitForTimeout(200);
  const click=async s=>{await p.click(s);await p.waitForTimeout(60)};
  // A. geometry on wizard step 1
  await click('[data-act="wiz-start"]');
  const g=await p.evaluate(()=>{const ph=document.querySelector('.phone').getBoundingClientRect(),sc=document.querySelector('.scroll').getBoundingClientRect(),foot=document.querySelector('.foot').getBoundingClientRect(),bar=document.querySelector('.bar').getBoundingClientRect();return {phoneL:ph.left,phoneR:innerWidth-ph.right,phoneB:innerHeight-ph.bottom,scrollH:sc.height,footB:innerHeight-foot.bottom,bar:bar.height,doc:document.documentElement.scrollHeight-innerHeight,bodyScroll:document.body.scrollHeight-innerHeight}});
  ok(g.phoneL<=1&&g.phoneR<=1,`${scheme}: app fills width (no dark side bands)`,JSON.stringify(g));
  ok(g.footB<=1,`${scheme}: footer at bottom edge`,JSON.stringify(g));
  ok(g.doc<=1&&g.bodyScroll<=1,`${scheme}: document not scrollable`,JSON.stringify(g));
  ok(g.scrollH>=(h<500?70:300),`${scheme}: scroll area usable (${Math.round(g.scrollH)}px)`);
  if(scheme==='dark')console.log('  step1 bar',Math.round(g.bar),'scrollArea',Math.round(g.scrollH));
  // B. overlaps + scroll reset on step change
  ok((await p.evaluate(()=>window.__overlaps('.app'))).length===0,`${scheme}: no control overlap step1`,JSON.stringify(await p.evaluate(()=>window.__overlaps('.app'))));
  await click('[data-act="wiz-owner"][data-id="o1"]');await p.evaluate(()=>{document.querySelector('.scroll').scrollTop=9999});
  await click('[data-act="wiz-next"]');
  ok((await p.evaluate(()=>document.querySelector('.scroll').scrollTop))===0,`${scheme}: next step starts at top`);
  await click('[data-act="wiz-noz"][data-id="p2-1"]');await p.evaluate(()=>{document.querySelector('.scroll').scrollTop=9999});await click('[data-act="wiz-next"]');
  ok((await p.evaluate(()=>document.querySelector('.scroll').scrollTop))===0,`${scheme}: step 3 starts at top`);
  // C. keyboard: shrink viewport, focus liters, must be visible between header and footer
  await p.setViewportSize({width:w,height:h-kb>150?h-kb:150});await p.waitForTimeout(150);
  await p.focus('#lit');await p.waitForTimeout(700);
  const k=await p.evaluate(()=>{const i=document.getElementById('lit').getBoundingClientRect(),sc=document.querySelector('.scroll').getBoundingClientRect(),foot=document.querySelector('.foot').getBoundingClientRect(),top=document.querySelector('.st-top').getBoundingClientRect();return {vh:innerHeight,inTop:i.top,inBot:i.bottom,scT:sc.top,scB:sc.bottom,footB:foot.bottom,docScroll:window.scrollY,hdrTop:top.top}});
  ok(k.footB<=k.vh+1&&k.hdrTop>=-1&&k.docScroll===0,`${scheme}: keyboard keeps header & footer in view, no document pan`,JSON.stringify(k));
  ok(k.inTop>=k.scT-1&&k.inBot<=k.scB+1||k.scB-k.scT<k.inBot-k.inTop+4,`${scheme}: focused input visible above keyboard`,JSON.stringify(k));
  await p.setViewportSize({width:w,height:h});await p.waitForTimeout(150);
  // D. shift screen + close sheet
  await p.evaluate(()=>{});await p.reload();await p.addScriptTag({content:PAGE});await p.waitForTimeout(200);
  await click('.st-nav [data-id="shift"]');await click('[data-act="demo-diff"]');
  ok((await p.evaluate(()=>window.__overlaps('.app'))).length===0,`${scheme}: no overlap on shift screen`,JSON.stringify(await p.evaluate(()=>window.__overlaps('.app'))));
  await p.evaluate(()=>{document.querySelector('.scroll').scrollTop=99999});
  const bt=await p.evaluate(()=>{const sc=document.querySelector('.scroll'),kids=[...sc.querySelectorAll('.st-body > *')].filter(e=>e.getBoundingClientRect().height>1),last=kids[kids.length-1].getBoundingClientRect(),nav=document.querySelector('.st-nav').getBoundingClientRect();return {lastB:last.bottom,navT:nav.top}});
  ok(bt.lastB<=bt.navT+1,`${scheme}: shift screen bottom content clears the nav`,JSON.stringify(bt));
  await click('[data-act="shift-review"]');
  ok((await p.evaluate(()=>window.__overlaps('.sheet-in'))).length===0,`${scheme}: no overlap in close sheet`,JSON.stringify(await p.evaluate(()=>window.__overlaps('.sheet-in'))));
  const sh=await p.evaluate(()=>{const s=document.querySelector('.sheet-in'),r=s.getBoundingClientRect();return {t:r.top,b:r.bottom,vh:innerHeight,sh:s.scrollHeight,ch:s.clientHeight,ov:getComputedStyle(s).overflowY}});
  ok(sh.t>=-1&&sh.b<=sh.vh+1,`${scheme}: close sheet inside viewport`,JSON.stringify(sh));
  ok(sh.sh<=sh.ch+1||sh.ov==='auto',`${scheme}: close sheet scrollable when taller than screen`);
  // keyboard on sheet textarea
  await p.setViewportSize({width:w,height:h-kb>150?h-kb:150});await p.waitForTimeout(150);await p.focus('#cnote');await p.waitForTimeout(700);
  const q=await p.evaluate(()=>{const t=document.getElementById('cnote').getBoundingClientRect(),s=document.querySelector('.sheet-in').getBoundingClientRect();return {tt:t.top,tb:t.bottom,st:s.top,sb:s.bottom,vh:innerHeight}});
  ok(q.sb<=q.vh+1&&q.st>=-1,`${scheme}: sheet stays inside shrunk viewport`,JSON.stringify(q));
  ok(q.tt>=q.st-1&&q.tb<=q.sb+1,`${scheme}: note field visible inside the sheet`,JSON.stringify(q));
  if(scheme==='dark'&&name.startsWith('14'))await p.screenshot({path:__dirname+'/L-sheet-kb.png'});
  await p.setViewportSize({width:w,height:h});await p.waitForTimeout(100);
  if(scheme==='dark')await p.screenshot({path:S+`L-${name.split(' ')[0]}-sheet.png`});
  // E. back navigation restores list scroll
  await p.reload();await p.addScriptTag({content:PAGE});await p.waitForTimeout(200);
  await click('.st-nav [data-id="fills"]');await click('[data-act="st-filter"][data-id="month"]');
  await p.evaluate(()=>{document.querySelector('.scroll').scrollTop=120});const before=await p.evaluate(()=>document.querySelector('.scroll').scrollTop);
  if(before>0){await click('.fcard');await click('[data-act="st-back"]');
   const after=await p.evaluate(()=>document.querySelector('.scroll').scrollTop);ok(Math.abs(after-before)<=2,`${scheme}: list scroll restored after detail/back`,`${before}->${after}`)}
  ok(errs.length===0,`${scheme}: no page errors`,errs.join('|'));
  await c.close()}}
// ERP dialogs at several heights
for(const [name,w,h,kb] of sizes){const c=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2,isMobile:true,hasTouch:true});const p=await c.newPage();await p.goto('file://'+S+'prototype.html');await p.addScriptTag({content:PAGE});await p.waitForTimeout(150);
 await p.click('[data-act="app"][data-id="erp"]');await p.waitForTimeout(80);await p.click('[data-act="dlg"][data-id="owner"]');await p.waitForTimeout(80);
 const ov=await p.evaluate(()=>window.__overlaps('.sheet-in'));ok(ov.length===0,`ERP dialog ${name}: no overlap`,JSON.stringify(ov));
 const g=await p.evaluate(()=>{const s=document.querySelector('.sheet-in').getBoundingClientRect();return {t:s.top,b:s.bottom,vh:innerHeight}});ok(g.t>=-1&&g.b<=g.vh+1,`ERP dialog ${name}: inside viewport`,JSON.stringify(g));
 await p.setViewportSize({width:w,height:h-kb>150?h-kb:150});await p.waitForTimeout(100);await p.focus('#name');await p.waitForTimeout(700);
 const k=await p.evaluate(()=>{const i=document.getElementById('name').getBoundingClientRect(),s=document.querySelector('.sheet-in').getBoundingClientRect();return {it:i.top,ib:i.bottom,st:s.top,sb:s.bottom,vh:innerHeight}});ok(k.it>=k.st-1&&k.ib<=k.sb+1&&k.sb<=k.vh+1,`ERP dialog ${name}: field visible with keyboard`,JSON.stringify(k));
 if(name.startsWith('SE'))await p.screenshot({path:__dirname+'/L-erp-dlg-kb.png'});
 await c.close()}
console.log(fails?`LAYOUT FAILS: ${fails}`:'LAYOUT ALL OK');await b.close()})();
