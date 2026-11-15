import { readFileSync } from 'node:fs';
import { parseStructure } from '../extension/viewer/parsers.js';
import { SYMBOLS, symbolOf, colorOf, covalentRadius } from '../extension/viewer/elements.js';
const [file] = process.argv.slice(2);
const r = parseStructure(readFileSync(file, 'utf8'), file);
const f = r.frames[0];
const counts = {};
for (const z of f.numbers) counts[symbolOf(z)] = (counts[symbolOf(z)] || 0) + 1;
console.log(r.format, 'frames', r.frames.length, 'N', f.numbers.length, counts);
console.log('cell', JSON.stringify(f.cell), 'pbc', f.pbc, 'info', JSON.stringify(f.info).slice(0, 200));
console.log('props', f.props.map(p => `${p.name}[${p.dim}] e.g. ${p.values.slice(0, p.dim).join(' ')}`));
console.log('first pos', Array.from(f.positions.slice(0, 3)), 'last pos', Array.from(f.positions.slice(-3)));
// fractional range check
if (f.cell) {
  const c = f.cell; const det = c[0][0]*(c[1][1]*c[2][2]-c[1][2]*c[2][1]) - c[0][1]*(c[1][0]*c[2][2]-c[1][2]*c[2][0]) + c[0][2]*(c[1][0]*c[2][1]-c[1][1]*c[2][0]);
  const inv = [[(c[1][1]*c[2][2]-c[1][2]*c[2][1])/det, (c[0][2]*c[2][1]-c[0][1]*c[2][2])/det, (c[0][1]*c[1][2]-c[0][2]*c[1][1])/det],
               [(c[1][2]*c[2][0]-c[1][0]*c[2][2])/det, (c[0][0]*c[2][2]-c[0][2]*c[2][0])/det, (c[0][2]*c[1][0]-c[0][0]*c[1][2])/det],
               [(c[1][0]*c[2][1]-c[1][1]*c[2][0])/det, (c[0][1]*c[2][0]-c[0][0]*c[2][1])/det, (c[0][0]*c[1][1]-c[0][1]*c[1][0])/det]];
  const lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9];
  for (let i=0;i<f.numbers.length;i++){ const p=[f.positions[3*i],f.positions[3*i+1],f.positions[3*i+2]];
    for (let d=0; d<3; d++){ const s = p[0]*inv[0][d]+p[1]*inv[1][d]+p[2]*inv[2][d]; lo[d]=Math.min(lo[d],s); hi[d]=Math.max(hi[d],s);} }
  console.log('frac range', lo.map(x=>x.toFixed(3)), hi.map(x=>x.toFixed(3)));
}
