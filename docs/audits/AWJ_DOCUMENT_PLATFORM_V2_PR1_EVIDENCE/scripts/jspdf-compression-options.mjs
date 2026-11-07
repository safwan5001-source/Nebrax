import { jsPDF } from '/home/user/Nebrax/web/node_modules/jspdf/dist/jspdf.node.min.js';
import fs from 'node:fs';
const png = fs.readFileSync(process.argv[2]);
const url = 'data:image/png;base64,' + png.toString('base64');
console.log('source png bytes', png.length);
for (const [label, ctor, comp] of [['default','',undefined],['ctor compress only',true,undefined],['FAST',false,'FAST'],['MEDIUM',false,'MEDIUM'],['SLOW',false,'SLOW'],['compress+FAST',true,'FAST'],['compress+SLOW',true,'SLOW']]) {
  const pdf = new jsPDF({ unit: 'mm', format: [210, 297], compress: ctor === '' ? undefined : ctor });
  pdf.addImage(url, 'PNG', 0, 0, 210, 297, undefined, comp);
  const out = pdf.output('arraybuffer');
  console.log(label.padEnd(20), (out.byteLength/1e6).toFixed(2), 'MB');
}
