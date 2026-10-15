import { contrastRatio as c } from '/home/user/Nebrax/web/scripts/generate-awj-tokens.mjs';
export const T = { bg:'#1E3A8A', fg:'#FFFFFF', muted:'#DCE5FB', line:'#3D5AA6', hover:'#2E4A98', active:'#425FAB', activeFg:'#FFFFFF', shadow:'inset 0 0 0 1px #8FA9E8', apex:'#A9C4FF', fieldBg:'#142B6B', fieldLine:'#8FA9E0', ring:'#FFFFFF', brand:'#A9C4FF' };
const t=T; const rows=[
 ['fg/shell',t.fg,t.bg,4.5],['muted/shell',t.muted,t.bg,4.5],['muted/hover',t.muted,t.hover,4.5],['muted/active',t.muted,t.active,4.5],['fg/hover',t.fg,t.hover,4.5],['active-fg/active-bg',t.activeFg,t.active,4.5],
 ['apex TEXT/shell',t.apex,t.bg,4.5],['apex TEXT/hover',t.apex,t.hover,4.5],['apex RAIL/active',t.apex,t.active,3],['apex RAIL/shell',t.apex,t.bg,3],
 ['field fg/field',t.fg,t.fieldBg,4.5],['field muted/field',t.muted,t.fieldBg,4.5],['field line/field',t.fieldLine,t.fieldBg,3],
 ['ring/shell',t.ring,t.bg,3],['ring/hover',t.ring,t.hover,3],['ring/active',t.ring,t.active,3],['ring/field',t.ring,t.fieldBg,3],['brandmark/shell',t.brand,t.bg,3],
 ['active-border(8FA9E8)/active',  '#8FA9E8', t.active, 1.5]];
for (const [l,a,b,m] of rows) { const r=c(a,b); console.log((r>=m?' ✓ ':' ✗ ')+l.padEnd(24),a,b,r.toFixed(2),'min',m); }
console.log('SEP shell→hover',c(t.bg,t.hover).toFixed(2),'hover→active',c(t.hover,t.active).toFixed(2),'shell→active',c(t.bg,t.active).toFixed(2));
console.log('ID  vsInk',c(t.bg,'#0E1A31').toFixed(2),'vsDesk',c(t.bg,'#07090C').toFixed(2),'vsPaper',c(t.bg,'#1C1F28').toFixed(2),'vsLightShell',c(t.bg,'#1E40AF').toFixed(2));
console.log('muted vs fg hierarchy: muted/shell',c(t.muted,t.bg).toFixed(2),'fg/shell',c(t.fg,t.bg).toFixed(2));
