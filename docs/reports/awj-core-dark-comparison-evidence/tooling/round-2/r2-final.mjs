import { contrastRatio as c } from '/home/user/Nebrax/web/scripts/generate-awj-tokens.mjs';
const INK='#0E1A31', DESK='#07090C', PAPER='#1C1F28', LIGHT='#1E40AF';
export const SETS = {
  C: { 'shell-bg':'#152B59','shell-fg':'#FFFFFF','shell-fg-muted':'#C0CEEB','shell-line':'#2E4A82','shell-hover':'#203A72','shell-active-bg':'#2D4D91','shell-active-fg':'#FFFFFF','shell-active-shadow':'inset 0 0 0 1px #5C7FCB','shell-apex':'#8FB4FF','shell-field-bg':'#0E2048','shell-field-line':'#7C97D6','shell-focus-ring':'#8FB4FF','shell-brandmark-bg':'#4F8CFF' },
  M: { 'shell-bg':'#1E3A8A','shell-fg':'#FFFFFF','shell-fg-muted':'#D0DBF7','shell-line':'#3D5AA6','shell-hover':'#2A4695','shell-active-bg':'#3D5AA6','shell-active-fg':'#FFFFFF','shell-active-shadow':'inset 0 0 0 1px #7F9FE3','shell-apex':'#A9C4FF','shell-field-bg':'#142B6B','shell-field-line':'#8FA9E0','shell-focus-ring':'#A9C4FF','shell-brandmark-bg':'#A9C4FF' },
};
if (process.argv[1].endsWith('r2-final.mjs')) {
 for (const [n,t] of Object.entries(SETS)) {
  const bg=t['shell-bg'],hv=t['shell-hover'],ac=t['shell-active-bg'],ap=t['shell-apex'],fb=t['shell-field-bg'],mu=t['shell-fg-muted'],fg=t['shell-fg'],rg=t['shell-focus-ring'];
  const rows=[
   ['fg / shell',fg,bg,4.5],['muted / shell',mu,bg,4.5],['muted / hover',mu,hv,4.5],['muted / active',mu,ac,4.5],['fg / active (selected)',t['shell-active-fg'],ac,4.5],['fg / hover',fg,hv,4.5],
   ['apex TEXT / shell',ap,bg,4.5],['apex TEXT / hover',ap,hv,4.5],['apex RAIL / active',ap,ac,3],['apex RAIL / shell',ap,bg,3],
   ['field: fg / field',fg,fb,4.5],['field: muted / field',mu,fb,4.5],['field: line / field',t['shell-field-line'],fb,3],
   ['focus ring / shell',rg,bg,3],['focus ring / hover',rg,hv,3],['focus ring / field',rg,fb,3],['focus ring / active',rg,ac,3],['brandmark / shell',t['shell-brandmark-bg'],bg,3]];
  console.log('=====',n,bg);
  for (const [l,a,b,m] of rows) { const r=c(a,b); console.log((r>=m?' ✓ ':' ✗ ')+l.padEnd(26),a,b,r.toFixed(2),'min',m); }
  console.log('  SEPARATION shell→hover',c(bg,hv).toFixed(2),'| hover→active',c(hv,ac).toFixed(2),'| shell→active',c(bg,ac).toFixed(2));
  console.log('  IDENTITY  vs Ink-Dark #0E1A31',c(bg,INK).toFixed(2),'| vs Core Light #1E40AF',c(bg,LIGHT).toFixed(2),'| GLARE vs desk',c(bg,DESK).toFixed(2),'| vs paper',c(bg,PAPER).toFixed(2));
 }
}
