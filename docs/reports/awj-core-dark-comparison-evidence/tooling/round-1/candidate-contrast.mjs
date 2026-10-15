import { contrastRatio as c } from '/home/user/Nebrax/web/scripts/generate-awj-tokens.mjs';
const show=(n,a,b,min)=>{const r=c(a,b);console.log(n.padEnd(46),a,b,r.toFixed(2),min?(r>=min?'✓':'✗ <'+min):'')};
const bg='#152B59', act='#243F77', hov='#1D3669';
console.log('--- B literal values from the brief');
show('white / shell-bg',  '#FFFFFF',bg,4.5);
show('white / active-bg', '#FFFFFF',act,4.5);
show('ACCENT #4F8CFF as TEXT on shell-bg',  '#4F8CFF',bg,4.5);
show('ACCENT #4F8CFF as TEXT on hover',     '#4F8CFF',hov,4.5);
show('ACCENT #4F8CFF as RAIL on active-bg','#4F8CFF',act,3);
show('ACCENT #4F8CFF as FOCUS ring on shell-bg','#4F8CFF',bg,3);
show('ACCENT #4F8CFF ring on active-bg','#4F8CFF',act,3);
console.log('--- lighter accent options for TEXT');
for (const a of ['#7FA8FF','#8FB4FF','#9DBCFF']) { show(a+' text on shell-bg',a,bg,4.5); show(a+' text on hover',a,hov,4.5); show(a+' rail on active-bg',a,act,3);}
console.log('--- muted options');
for (const m of ['#B6C6E8','#C0CEEB','#C5D3F0','#CBD9FB']) { show(m+' on shell-bg',m,bg,4.5); show(m+' on hover',m,hov,4.5); show(m+' on active-bg',m,act,4.5);}
console.log('--- field');
const fb='#0E2048'; show('white on field',  '#FFFFFF',fb,4.5); show('muted C5D3F0 on field','#C5D3F0',fb,4.5); for (const l of ['#6F8BC9','#7C97D6','#8FA9E0']) show('field-line '+l+' / field',l,fb,3);
console.log('--- reference: current A');
show('A white? dark fg #06101F / #4F8CFF','#06101F','#4F8CFF',4.5);
console.log('--- shell vs desk (structural) #07090C');
show('A shell #4F8CFF / desk','#4F8CFF','#07090C'); show('B shell #152B59 / desk','#152B59','#07090C'); show('Ink shell #0E1A31 / desk','#0E1A31','#07090C');
console.log('--- B vs Ink (distinctness)'); show('B #152B59 / Ink #0E1A31','#152B59','#0E1A31');
