import { contrastRatio as c } from '/home/user/Nebrax/web/scripts/generate-awj-tokens.mjs';
const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const hex=(a)=>'#'+a.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('').toUpperCase();
const mix=(a,b,t)=>hex(rgb(a).map((x,i)=>x+(rgb(b)[i]-x)*t));
const L=(h)=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4};const [r,g,b]=rgb(h);return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
const hsl=(h)=>{let [r,g,b]=rgb(h).map(x=>x/255);const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let H=0;if(d){H=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;H=Math.round(H*60);if(H<0)H+=360}const Li=(mx+mn)/2,S=d?d/(1-Math.abs(2*Li-1)):0;return `H${H} S${Math.round(S*100)} L${Math.round(Li*100)}`};
const INK='#0E1A31', DESK='#07090C', PAPER='#1C1F28', LIGHT='#1E40AF', A='#4F8CFF';
console.log('hsl  A',hsl(A),'| Ink',hsl(INK),'| Light',hsl(LIGHT),'| B #152B59',hsl('#152B59'),'| #1E3A8A',hsl('#1E3A8A'));
// 1) hover tuning for C: keep shell #152B59, active #2D4D91, find hover between with ratios >=1.25 each side if possible
const shell='#152B59', active='#2D4D91';
console.log('\n--- C: hover options between shell and active (mix toward active)');
for (const t of [0.25,0.33,0.40,0.45,0.5]) { const h=mix(shell,active,t); console.log(t, h, 'shell→hover',c(shell,h).toFixed(2),'hover→active',c(h,active).toFixed(2),'| muted C0CEEB on hover',c('#C0CEEB',h).toFixed(2),'| apex 8FB4FF on hover',c('#8FB4FF',h).toFixed(2),'| white on hover',c('#FFFFFF',h).toFixed(2)); }
// 2) mid-blue alternatives
console.log('\n--- M candidates (shell) : identity & glare metrics');
for (const s of ['#152B59','#1A3370','#1E3A8A','#1E40AF','#2447A8']) console.log(s.padEnd(8),hsl(s).padEnd(14),'vsInk',c(s,INK).toFixed(2),'vsDesk',c(s,DESK).toFixed(2),'vsPaper',c(s,PAPER).toFixed(2),'vsLight#1E40AF',c(s,LIGHT).toFixed(2),'lum',L(s).toFixed(3),'| white',c('#FFFFFF',s).toFixed(2),'| 8FB4FF',c('#8FB4FF',s).toFixed(2),'| 4F8CFF',c('#4F8CFF',s).toFixed(2));

console.log('\n--- M = shell #1E3A8A : active / hover search (mix toward #7F9FE3)');
const ms='#1E3A8A';
for (const t of [0.12,0.16,0.20,0.24,0.28,0.32]) { const h=mix(ms,'#7F9FE3',t); console.log(t,h,'shell→x',c(ms,h).toFixed(2),'| white',c('#FFFFFF',h).toFixed(2),'| muted D0DBF7',c('#D0DBF7',h).toFixed(2),'| apex 8FB4FF',c('#8FB4FF',h).toFixed(2),'| ring 4F8CFF',c('#4F8CFF',h).toFixed(2)); }
console.log('muted candidates on #1E3A8A:',['#C5D3F0','#CBD9FB','#D0DBF7'].map(m=>m+' '+c(m,ms).toFixed(2)).join(' | '));
console.log('field for M:', ['#142B6B','#12266A','#0F2260'].map(f=>f+' white '+c('#FFFFFF',f).toFixed(2)+' muted(CBD9FB) '+c('#CBD9FB',f).toFixed(2)+' line 8FA9E0 '+c('#8FA9E0',f).toFixed(2)).join(' | '));
console.log('ring options on M shell:', '#4F8CFF',c('#4F8CFF',ms).toFixed(2),'#8FB4FF',c('#8FB4FF',ms).toFixed(2),'#FFFFFF',c('#FFFFFF',ms).toFixed(2));
