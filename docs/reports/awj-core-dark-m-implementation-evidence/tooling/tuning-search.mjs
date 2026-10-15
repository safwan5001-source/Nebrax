import { contrastRatio as c } from '/home/user/Nebrax/web/scripts/generate-awj-tokens.mjs';
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const hex=a=>'#'+a.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('').toUpperCase();
const mix=(a,b,t)=>hex(rgb(a).map((x,i)=>x+(rgb(b)[i]-x)*t));
const SHELL='#1E3A8A', APEX='#A9C4FF', TOWARD='#7F9FE3', M=0.12; // safety margin over thresholds
const muteds=['#D0DBF7','#D6E0F9','#DCE5FB','#E2EAFC'];
const out=[];
for (let th=0.06; th<=0.20; th+=0.01) for (let ta=0.20; ta<=0.46; ta+=0.01) {
  const hv=mix(SHELL,TOWARD,th), ac=mix(SHELL,TOWARD,ta);
  const s_h=c(SHELL,hv), h_a=c(hv,ac), s_a=c(SHELL,ac);
  if (h_a<1.3 || s_h<1.22) continue;
  const apexHover=c(APEX,hv), rail=c(APEX,ac), whiteAct=c('#FFFFFF',ac), whiteHov=c('#FFFFFF',hv);
  if (apexHover<4.5+M || rail<3+M || whiteAct<4.5+M) continue;
  for (const mu of muteds) {
    const mAct=c(mu,ac), mHov=c(mu,hv), mSh=c(mu,SHELL);
    if (mAct<4.5+M || mHov<4.5+M || mSh>8.6) continue;
    out.push({hv,ac,mu,s_h,h_a,s_a,apexHover,rail,whiteAct,mAct,mHov,mSh});
  }
}
out.sort((a,b)=>Math.min(b.s_h,b.h_a)-Math.min(a.s_h,a.h_a) || b.s_a-a.s_a);
console.log('feasible combos:',out.length);
const seen=new Set(); let n=0;
for (const o of out) { const k=o.hv+o.ac; if (seen.has(k)) continue; seen.add(k); if (n++>=12) break;
 console.log(`hover ${o.hv} active ${o.ac} muted ${o.mu} | shell→hover ${o.s_h.toFixed(2)} hover→active ${o.h_a.toFixed(2)} shell→active ${o.s_a.toFixed(2)} | apex/hover ${o.apexHover.toFixed(2)} rail/act ${o.rail.toFixed(2)} white/act ${o.whiteAct.toFixed(2)} muted/act ${o.mAct.toFixed(2)} muted/hov ${o.mHov.toFixed(2)} muted/shell ${o.mSh.toFixed(2)}`); }
console.log('--- reference M (documented): hover #2A4695 active #3D5AA6 muted #D0DBF7');
console.log('shell→hover',c(SHELL,'#2A4695').toFixed(2),'hover→active',c('#2A4695','#3D5AA6').toFixed(2),'shell→active',c(SHELL,'#3D5AA6').toFixed(2),'apex/hover',c(APEX,'#2A4695').toFixed(2),'rail',c(APEX,'#3D5AA6').toFixed(2),'muted/act',c('#D0DBF7','#3D5AA6').toFixed(2));
console.log('--- ring options on M surfaces');
for (const r of ['#A9C4FF','#FFFFFF']) console.log(r,'shell',c(r,SHELL).toFixed(2),'hover(2A4695)',c(r,'#2A4695').toFixed(2),'active(3D5AA6)',c(r,'#3D5AA6').toFixed(2),'field(142B6B)',c(r,'#142B6B').toFixed(2));
