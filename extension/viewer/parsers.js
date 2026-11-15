// Structure file parsers: XYZ / extended XYZ, VASP (POSCAR, CONTCAR, XDATCAR), CIF / mmCIF, PDB, XSF, MOL/SDF.
//
// Every parser returns { format, frames } where each frame is
//   { numbers: Int16Array(N), labels: string[]|null, positions: Float64Array(3N),
//     cell: [[ax,ay,az],[bx,by,bz],[cx,cy,cz]] | null, pbc: [bool,bool,bool],
//     info: {key: value}, props: [{ name, dim, values }] }
// Lattice vectors are rows. Positions are Cartesian, in Å.

import { atomicNumber } from './elements.js';

export function parseStructure(text, name = '') {
  const lower = name.toLowerCase().replace(/\.gz$/, '');
  const base = lower.split('/').pop();
  let format = null;
  if (/\.(xyz|extxyz|exyz)$/.test(base)) format = 'xyz';
  else if (/\.(pdb|ent)$/.test(base)) format = 'pdb';
  else if (/\.(cif|mcif|mmcif)$/.test(base)) format = 'cif';
  else if (/\.(vasp|poscar|contcar)$/.test(base) || /(poscar|contcar|xdatcar)/.test(base)) format = 'vasp';
  else if (/\.xsf$/.test(base)) format = 'xsf';
  else if (/\.(mol|sdf)$/.test(base)) format = 'sdf';
  if (!format) format = sniffFormat(text);
  const parser = { xyz: parseXYZ, pdb: parsePDB, cif: parseCIF, vasp: parseVASP, xsf: parseXSF, sdf: parseSDF }[format];
  if (!parser) throw new Error('Unknown file format (supported: xyz / extxyz / pdb / cif / POSCAR / xsf / sdf)');
  const result = parser(text);
  if (!result.frames.length || !result.frames[0].numbers.length) throw new Error(`Parsed as ${format}, but no atoms were found`);
  return result;
}

export function sniffFormat(text) {
  const head = text.slice(0, 20000);
  const lines = head.split(/\r?\n/);
  const first = (lines[0] || '').trim();
  if (/^\d+$/.test(first)) return 'xyz';
  if (/^\s*data_/m.test(head) && /_(cell_length|atom_site)/.test(head)) return 'cif';
  if (/^(ATOM  |HETATM|CRYST1|MODEL )/m.test(head)) return 'pdb';
  if (/^\s*(PRIMVEC|PRIMCOORD|CRYSTAL|SLAB|POLYMER|ANIMSTEPS)\b/m.test(head) || /^\s*ATOMS\s*$/m.test(head)) return 'xsf';
  if (/V[23]000/.test(head)) return 'sdf';
  const num = (s) => (s || '').trim().split(/\s+/).filter(Boolean);
  if (num(lines[1]).length >= 1 && !isNaN(parseFloat(lines[1])) && [2, 3, 4].every((k) => num(lines[k]).length === 3)) return 'vasp';
  return null;
}

// ---------------------------------------------------------------- helpers

function makeFrame(numbers, positions, extra = {}) {
  return {
    numbers: Int16Array.from(numbers),
    labels: extra.labels || null,
    positions: Float64Array.from(positions),
    cell: extra.cell || null,
    pbc: extra.pbc || (extra.cell ? [true, true, true] : [false, false, false]),
    info: extra.info || {},
    props: extra.props || [],
  };
}

const num = (s) => parseFloat(String(s).replace(/\(\d+\)$/, '')); // strip CIF uncertainty "1.234(5)"

export function cellFromParameters(a, b, c, alpha, beta, gamma) {
  const d = Math.PI / 180;
  const ca = Math.cos(alpha * d), cb = Math.cos(beta * d), cg = Math.cos(gamma * d), sg = Math.sin(gamma * d);
  const cx = cb;
  const cy = (ca - cb * cg) / sg;
  const cz = Math.sqrt(Math.max(0, 1 - cx * cx - cy * cy));
  const clean = (x) => (Math.abs(x) < 1e-10 ? 0 : x);
  return [
    [a, 0, 0],
    [b * cg, b * sg, 0],
    [c * cx, c * cy, c * cz],
  ].map((v) => v.map(clean));
}

function fracToCart(f, cell) {
  return [
    f[0] * cell[0][0] + f[1] * cell[1][0] + f[2] * cell[2][0],
    f[0] * cell[0][1] + f[1] * cell[1][1] + f[2] * cell[2][1],
    f[0] * cell[0][2] + f[1] * cell[1][2] + f[2] * cell[2][2],
  ];
}

function parseBool(s) {
  return /^(t|true|1)$/i.test(String(s).trim());
}

// ---------------------------------------------------------------- XYZ / extended XYZ

/** Parse an extxyz comment line into key → raw string value (true for bare keys). */
export function parseKeyValues(line) {
  const out = {};
  const re = /\s*("(?:[^"\\]|\\.)*"|[^\s=]+)\s*(?:=\s*("(?:[^"\\]|\\.)*"|\{[^}]*\}|\[[^\]]*\]|\S+))?/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m[0].trim() === '') break;
    const unq = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s);
    const key = unq(m[1]);
    let val = m[2] === undefined ? true : unq(m[2]);
    if (typeof val === 'string' && /^[{[].*[}\]]$/.test(val)) val = val.slice(1, -1).replace(/,/g, ' ').trim();
    out[key] = val;
  }
  return out;
}

function parsePropertiesSpec(spec) {
  if (typeof spec !== 'string') return null;
  const parts = spec.split(':');
  if (parts.length % 3 !== 0) return null;
  const cols = [];
  for (let i = 0; i < parts.length; i += 3) cols.push({ name: parts[i], type: parts[i + 1].toUpperCase(), dim: parseInt(parts[i + 2], 10) || 1 });
  return cols;
}

function parseXYZ(text) {
  const lines = text.split(/\r?\n/);
  const frames = [];
  let i = 0;
  let extended = false;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    if (!/^\d+$/.test(t.split(/\s+/)[0])) {
      if (frames.length) break; // trailing junk after the last frame
      throw new Error(`XYZ: line ${i + 1} is not an atom count: "${t.slice(0, 40)}"`);
    }
    const n = parseInt(t, 10);
    const comment = lines[i + 1] ?? '';
    const kv = parseKeyValues(comment);
    const latticeKey = Object.keys(kv).find((k) => k.toLowerCase() === 'lattice');
    const propsKey = Object.keys(kv).find((k) => k.toLowerCase() === 'properties');
    if (latticeKey || propsKey) extended = true;
    let cols = parsePropertiesSpec(kv[propsKey]) || [
      { name: 'species', type: 'S', dim: 1 },
      { name: 'pos', type: 'R', dim: 3 },
    ];
    let cell = null;
    if (latticeKey) {
      const v = String(kv[latticeKey]).trim().split(/\s+/).map(Number);
      if (v.length === 9 && v.every(Number.isFinite)) cell = [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
    }
    let pbc = cell ? [true, true, true] : [false, false, false];
    if (kv.pbc !== undefined) {
      const p = String(kv.pbc).trim().split(/\s+/);
      if (p.length === 3) pbc = p.map(parseBool);
      else if (p.length === 1) pbc = [0, 1, 2].map(() => parseBool(p[0]));
    }

    const numbers = new Int16Array(n);
    const positions = new Float64Array(3 * n);
    const labels = new Array(n);
    const extra = cols
      .filter((c) => !['species', 'pos', 'positions', 'z'].includes(c.name.toLowerCase()))
      .map((c) => ({ ...c, values: new Array(n * c.dim) }));
    const hasSpecies = cols.some((c) => c.name.toLowerCase() === 'species');
    for (let a = 0; a < n; a++) {
      const line = lines[i + 2 + a];
      if (line === undefined) throw new Error(`XYZ: file ends in the middle of frame ${frames.length + 1}`);
      const tok = line.trim().split(/\s+/);
      let k = 0;
      for (const c of cols) {
        const lname = c.name.toLowerCase();
        if (lname === 'species') {
          labels[a] = tok[k];
          numbers[a] = atomicNumber(tok[k]);
        } else if (lname === 'z' && !hasSpecies) {
          numbers[a] = parseInt(tok[k], 10) || 0;
          labels[a] = tok[k];
        } else if (lname === 'pos' || lname === 'positions') {
          positions[3 * a] = parseFloat(tok[k]);
          positions[3 * a + 1] = parseFloat(tok[k + 1]);
          positions[3 * a + 2] = parseFloat(tok[k + 2]);
        } else if (lname !== 'z') {
          const e = extra.find((x) => x.name === c.name);
          for (let d = 0; d < c.dim; d++) {
            const raw = tok[k + d];
            e.values[a * c.dim + d] = c.type === 'R' ? parseFloat(raw) : c.type === 'I' ? parseInt(raw, 10) : c.type === 'L' ? parseBool(raw) : raw;
          }
        }
        k += c.dim;
      }
    }
    const info = {};
    for (const [key, val] of Object.entries(kv)) {
      if (key === latticeKey || key === propsKey || key === 'pbc' || val === true) continue;
      info[key] = val;
    }
    if (!extended && comment.trim() && !Object.keys(info).length) info.comment = comment.trim();
    frames.push(makeFrame(numbers, positions, { labels, cell, pbc, info, props: extra }));
    i += n + 2;
  }
  return { format: extended ? 'extxyz' : 'xyz', frames };
}

// ---------------------------------------------------------------- VASP

function parsePoscarHeader(lines, i) {
  const comment = (lines[i] || '').trim();
  const scaleTok = (lines[i + 1] || '').trim().split(/\s+/).map(Number);
  let cell = [2, 3, 4].map((k) => (lines[i + k] || '').trim().split(/\s+/).slice(0, 3).map(Number));
  if (cell.some((v) => v.length !== 3 || v.some((x) => !Number.isFinite(x)))) throw new Error('POSCAR: cannot read the lattice vectors');
  if (scaleTok.length === 3) {
    cell = cell.map((v) => v.map((x, d) => x * scaleTok[d]));
  } else {
    let s = scaleTok[0];
    if (s < 0) {
      const [a, b, c] = cell;
      const vol = Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]));
      s = Math.cbrt(-s / vol);
    }
    cell = cell.map((v) => v.map((x) => x * s));
  }
  let k = i + 5;
  let symbols = null;
  let tok = (lines[k] || '').trim().split(/\s+/);
  if (tok.length && isNaN(parseInt(tok[0], 10))) {
    symbols = tok.map((s) => s.split('/')[0].replace(/_.*$/, '')); // "Fe_pv" / "Fe/abc123" in newer POTCAR labels
    k++;
    tok = (lines[k] || '').trim().split(/\s+/);
  }
  const counts = tok.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
  if (!symbols) {
    const fromComment = comment.split(/\s+/).filter((s) => atomicNumber(s) > 0 && /^[A-Z][a-z]?$/.test(s));
    symbols = fromComment.length === counts.length ? fromComment : counts.map(() => 'X');
  }
  return { comment, cell, symbols, counts, next: k + 1 };
}

function poscarNumbers(symbols, counts) {
  const numbers = [];
  const labels = [];
  counts.forEach((c, s) => {
    for (let j = 0; j < c; j++) {
      numbers.push(atomicNumber(symbols[s]));
      labels.push(symbols[s]);
    }
  });
  return { numbers, labels };
}

function parseVASP(text) {
  const lines = text.split(/\r?\n/);
  let h = parsePoscarHeader(lines, 0);
  let { numbers, labels } = poscarNumbers(h.symbols, h.counts);
  const n = numbers.length;
  const frames = [];
  let k = h.next;

  // XDATCAR: "Direct configuration= N" blocks (header may repeat for variable-cell runs)
  if (lines.slice(k, k + 3).some((l) => /configuration/i.test(l))) {
    while (k < lines.length) {
      const l = lines[k] || '';
      if (/configuration/i.test(l)) {
        const cart = /^\s*c/i.test(l);
        const pos = new Float64Array(3 * n);
        for (let a = 0; a < n; a++) {
          const t = (lines[k + 1 + a] || '').trim().split(/\s+/).map(Number);
          const p = cart ? t : fracToCart(t, h.cell);
          pos.set(p.slice(0, 3), 3 * a);
        }
        frames.push(makeFrame(numbers, pos, { labels, cell: h.cell, info: { step: l.replace(/.*=/, '').trim() } }));
        k += n + 1;
      } else if (l.trim() && k + 7 < lines.length) {
        h = parsePoscarHeader(lines, k);
        k = h.next;
      } else {
        k++;
      }
    }
    return { format: 'XDATCAR', frames };
  }

  let mode = (lines[k] || '').trim();
  let selective = false;
  if (/^s/i.test(mode)) {
    selective = true;
    k++;
    mode = (lines[k] || '').trim();
  }
  const cart = /^[ck]/i.test(mode);
  k++;
  const pos = new Float64Array(3 * n);
  const fixed = selective ? new Array(3 * n) : null;
  let trailingLabels = [];
  for (let a = 0; a < n; a++) {
    const t = (lines[k + a] || '').trim().split(/\s+/);
    if (t.length < 3) throw new Error('POSCAR: not enough coordinate lines');
    const v = t.slice(0, 3).map(Number);
    pos.set(cart ? v.map((x) => x * 1) : fracToCart(v, h.cell), 3 * a);
    if (selective) for (let d = 0; d < 3; d++) fixed[3 * a + d] = t[3 + d] || '';
    const lab = t[selective ? 6 : 3];
    if (lab && atomicNumber(lab) > 0) trailingLabels.push(lab);
  }
  if (h.symbols.every((s) => s === 'X') && trailingLabels.length === n) {
    numbers = trailingLabels.map(atomicNumber);
    labels = trailingLabels;
  }
  if (cart) {
    // Cartesian coordinates are scaled by the same factor as the lattice
    const s = Math.abs(parseFloat(lines[1]));
    if (s > 0 && s !== 1 && (lines[1] || '').trim().split(/\s+/).length === 1 && parseFloat(lines[1]) > 0) {
      for (let j = 0; j < pos.length; j++) pos[j] *= s;
    }
  }
  const props = fixed ? [{ name: 'selective_dynamics', dim: 3, type: 'S', values: fixed }] : [];
  frames.push(makeFrame(numbers, pos, { labels, cell: h.cell, info: h.comment ? { comment: h.comment } : {}, props }));
  return { format: 'POSCAR', frames };
}

// ---------------------------------------------------------------- CIF

function tokenizeCIF(text) {
  const tokens = [];
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.startsWith(';')) {
      const buf = [line.slice(1)];
      li++;
      while (li < lines.length && !lines[li].startsWith(';')) buf.push(lines[li++]);
      tokens.push({ v: buf.join('\n').trim(), q: true });
      continue;
    }
    let p = 0;
    while (p < line.length) {
      const ch = line[p];
      if (ch === ' ' || ch === '\t') {
        p++;
      } else if (ch === '#') {
        break;
      } else if (ch === "'" || ch === '"') {
        let e = p + 1;
        while (e < line.length && !(line[e] === ch && (e + 1 >= line.length || /\s/.test(line[e + 1])))) e++;
        tokens.push({ v: line.slice(p + 1, e), q: true });
        p = e + 1;
      } else {
        let e = p;
        while (e < line.length && !/\s/.test(line[e])) e++;
        tokens.push({ v: line.slice(p, e), q: false });
        p = e;
      }
    }
  }
  return tokens;
}

function parseCIFBlocks(text) {
  const tokens = tokenizeCIF(text);
  const blocks = [];
  let cur = null;
  let i = 0;
  const newBlock = (name) => {
    cur = { name, tags: {}, loops: [] };
    blocks.push(cur);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    const lv = t.v.toLowerCase();
    if (!t.q && lv.startsWith('data_')) {
      newBlock(t.v.slice(5));
      i++;
    } else if (!t.q && lv === 'loop_') {
      if (!cur) newBlock('');
      i++;
      const names = [];
      while (i < tokens.length && !tokens[i].q && tokens[i].v.startsWith('_')) names.push(tokens[i++].v.toLowerCase());
      const rows = [];
      let row = [];
      while (i < tokens.length) {
        const x = tokens[i];
        const xl = x.v.toLowerCase();
        if (!x.q && (x.v.startsWith('_') || xl === 'loop_' || xl.startsWith('data_') || xl.startsWith('save_'))) break;
        row.push(x.v);
        if (row.length === names.length) {
          rows.push(row);
          row = [];
        }
        i++;
      }
      cur.loops.push({ names, rows });
    } else if (!t.q && t.v.startsWith('_')) {
      if (!cur) newBlock('');
      const v = tokens[i + 1];
      cur.tags[lv] = v ? v.v : '';
      i += 2;
    } else {
      i++;
    }
  }
  return blocks;
}

function parseSymop(op) {
  const rows = op.toLowerCase().replace(/\s+/g, '').split(',');
  if (rows.length !== 3) return null;
  return rows.map((expr) => {
    const r = { x: 0, y: 0, z: 0, t: 0 };
    for (const term of expr.match(/[+-]?[^+-]+/g) || []) {
      const sign = term.startsWith('-') ? -1 : 1;
      const body = term.replace(/^[+-]/, '');
      const v = body.match(/[xyz]/);
      if (v) {
        let coef = body.replace(/[xyz*]/g, '');
        coef = coef === '' ? 1 : coef.includes('/') ? Number(coef.split('/')[0]) / Number(coef.split('/')[1]) : Number(coef);
        r[v[0]] += sign * coef;
      } else {
        r.t += sign * (body.includes('/') ? Number(body.split('/')[0]) / Number(body.split('/')[1]) : Number(body));
      }
    }
    return r;
  });
}

function loopWith(block, tag) {
  return block.loops.find((l) => l.names.includes(tag));
}

function parseCIF(text) {
  const blocks = parseCIFBlocks(text);
  const block =
    blocks.find((b) => b.loops.some((l) => l.names.includes('_atom_site_fract_x') || l.names.includes('_atom_site.fract_x'))) ||
    blocks.find((b) => b.loops.some((l) => l.names.includes('_atom_site.cartn_x') || l.names.includes('_atom_site_cartn_x')));
  if (!block) throw new Error('CIF: no _atom_site loop found');
  const tag = (...names) => {
    for (const n of names) if (block.tags[n] !== undefined) return block.tags[n];
    return undefined;
  };

  // macromolecular CIF: Cartesian coordinates
  const cartLoop = loopWith(block, '_atom_site.cartn_x') || loopWith(block, '_atom_site_cartn_x');
  if (cartLoop && !loopWith(block, '_atom_site_fract_x') && !loopWith(block, '_atom_site.fract_x')) {
    const col = (n) => cartLoop.names.indexOf(n);
    const pick = (...ns) => ns.map(col).find((x) => x >= 0) ?? -1;
    const cx = pick('_atom_site.cartn_x', '_atom_site_cartn_x');
    const cy = pick('_atom_site.cartn_y', '_atom_site_cartn_y');
    const cz = pick('_atom_site.cartn_z', '_atom_site_cartn_z');
    const ce = pick('_atom_site.type_symbol', '_atom_site_type_symbol');
    const cl = pick('_atom_site.label_atom_id', '_atom_site.auth_atom_id', '_atom_site_label');
    const cm = pick('_atom_site.pdbx_pdb_model_num');
    const models = new Map();
    for (const r of cartLoop.rows) {
      const key = cm >= 0 ? r[cm] : '1';
      if (!models.has(key)) models.set(key, { numbers: [], positions: [], labels: [] });
      const m = models.get(key);
      m.numbers.push(atomicNumber(ce >= 0 ? r[ce] : r[cl]));
      m.positions.push(num(r[cx]), num(r[cy]), num(r[cz]));
      m.labels.push(cl >= 0 ? r[cl] : '');
    }
    const frames = [...models.values()].map((m) => makeFrame(m.numbers, m.positions, { labels: m.labels }));
    return { format: 'mmCIF', frames };
  }

  const a = num(tag('_cell_length_a', '_cell.length_a'));
  const b = num(tag('_cell_length_b', '_cell.length_b'));
  const c = num(tag('_cell_length_c', '_cell.length_c'));
  const al = num(tag('_cell_angle_alpha', '_cell.angle_alpha') ?? 90);
  const be = num(tag('_cell_angle_beta', '_cell.angle_beta') ?? 90);
  const ga = num(tag('_cell_angle_gamma', '_cell.angle_gamma') ?? 90);
  if (![a, b, c].every(Number.isFinite)) throw new Error('CIF: missing cell parameters (_cell_length_*)');
  const cell = cellFromParameters(a, b, c, al, be, ga);

  const symTags = ['_symmetry_equiv_pos_as_xyz', '_space_group_symop_operation_xyz', '_space_group_symop.operation_xyz'];
  let ops = [];
  for (const t of symTags) {
    const l = loopWith(block, t);
    if (l) {
      ops = l.rows.map((r) => parseSymop(r[l.names.indexOf(t)])).filter(Boolean);
      break;
    }
    if (block.tags[t]) ops = [parseSymop(block.tags[t])].filter(Boolean);
  }
  if (!ops.length) ops = [parseSymop('x,y,z')];

  const loop = loopWith(block, '_atom_site_fract_x') || loopWith(block, '_atom_site.fract_x');
  const col = (...ns) => ns.map((n) => loop.names.indexOf(n)).find((x) => x >= 0) ?? -1;
  const fx = col('_atom_site_fract_x', '_atom_site.fract_x');
  const fy = col('_atom_site_fract_y', '_atom_site.fract_y');
  const fz = col('_atom_site_fract_z', '_atom_site.fract_z');
  const fe = col('_atom_site_type_symbol', '_atom_site.type_symbol');
  const fl = col('_atom_site_label', '_atom_site.label');
  const fo = col('_atom_site_occupancy', '_atom_site.occupancy');

  const numbers = [];
  const positions = [];
  const labels = [];
  const occ = [];
  const seen = new Set();
  const key = (f) => f.map((x) => ((Math.round(x * 1000) % 1000) + 1000) % 1000).join(',');
  for (const r of loop.rows) {
    const f0 = [num(r[fx]), num(r[fy]), num(r[fz])];
    if (!f0.every(Number.isFinite)) continue;
    const label = fl >= 0 ? r[fl] : '';
    const z = atomicNumber(fe >= 0 && r[fe] !== '?' && r[fe] !== '.' ? r[fe] : label);
    for (const op of ops) {
      const f = op.map((o) => {
        const v = o.x * f0[0] + o.y * f0[1] + o.z * f0[2] + o.t;
        return v - Math.floor(v + 1e-6);
      });
      const k = key(f);
      if (seen.has(k)) continue;
      seen.add(k);
      numbers.push(z);
      positions.push(...fracToCart(f, cell));
      labels.push(label);
      occ.push(fo >= 0 ? num(r[fo]) : 1);
    }
  }
  const info = {};
  const sg = tag('_symmetry_space_group_name_h-m', '_space_group_name_h-m_alt', '_space_group.name_h-m_alt');
  if (sg) info.spacegroup = sg;
  const formula = tag('_chemical_formula_sum', '_chemical_formula.sum');
  if (formula) info.formula = formula;
  if (block.name) info.data = block.name;
  const props = occ.some((o) => o !== 1) ? [{ name: 'occupancy', dim: 1, type: 'R', values: occ }] : [];
  return { format: 'CIF', frames: [makeFrame(numbers, positions, { labels, cell, info, props })] };
}

// ---------------------------------------------------------------- PDB

function parsePDB(text) {
  const frames = [];
  let cell = null;
  let cur = null;
  const start = () => (cur = { numbers: [], positions: [], labels: [], res: [] });
  const finish = () => {
    if (cur && cur.numbers.length) {
      frames.push(
        makeFrame(cur.numbers, cur.positions, {
          labels: cur.labels,
          cell,
          props: [{ name: 'residue', dim: 1, type: 'S', values: cur.res }],
        }),
      );
    }
    cur = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6);
    if (rec === 'CRYST1') {
      const p = [6, 15, 24, 33, 40, 47].map((s, k) => parseFloat(line.slice(s, [15, 24, 33, 40, 47, 54][k])));
      if (p.every(Number.isFinite) && !(p[0] === 1 && p[1] === 1 && p[2] === 1)) cell = cellFromParameters(...p);
    } else if (rec === 'MODEL ') {
      finish();
      start();
    } else if (rec === 'ENDMDL') {
      finish();
    } else if (rec === 'ATOM  ' || rec === 'HETATM') {
      if (!cur) start();
      const name = line.slice(12, 16);
      let el = line.slice(76, 78).trim();
      if (!el) el = name[0] === ' ' || /\d/.test(name[0]) ? name.slice(1).trim() : name.trim();
      cur.numbers.push(atomicNumber(el.replace(/\d/g, '')));
      cur.positions.push(parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54)));
      cur.labels.push(name.trim());
      cur.res.push(`${line.slice(17, 20).trim()} ${line.slice(21, 22).trim()}${line.slice(22, 26).trim()}`.trim());
    } else if (rec.startsWith('END') && rec !== 'ENDMDL') {
      finish();
    }
  }
  finish();
  frames.forEach((f) => {
    if (cell && !f.cell) {
      f.cell = cell;
      f.pbc = [true, true, true];
    }
  });
  return { format: 'PDB', frames };
}

// ---------------------------------------------------------------- XSF

function parseXSF(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  const frames = [];
  let cell = null;
  let pbc = [false, false, false];
  for (let i = 0; i < lines.length; i++) {
    const kw = lines[i].split(/\s+/)[0].toUpperCase();
    if (kw === 'CRYSTAL') pbc = [true, true, true];
    else if (kw === 'SLAB') pbc = [true, true, false];
    else if (kw === 'POLYMER') pbc = [true, false, false];
    else if (kw === 'PRIMVEC') {
      cell = [1, 2, 3].map((k) => lines[i + k].split(/\s+/).map(Number));
      i += 3;
    } else if (kw === 'PRIMCOORD') {
      const n = parseInt(lines[i + 1], 10);
      const numbers = [];
      const pos = [];
      for (let a = 0; a < n; a++) {
        const t = lines[i + 2 + a].split(/\s+/);
        numbers.push(atomicNumber(t[0]));
        pos.push(+t[1], +t[2], +t[3]);
      }
      frames.push(makeFrame(numbers, pos, { cell, pbc }));
      i += n + 1;
    } else if (kw === 'ATOMS') {
      const numbers = [];
      const pos = [];
      while (i + 1 < lines.length && /^\S+\s+[-\d.]/.test(lines[i + 1]) && atomicNumber(lines[i + 1].split(/\s+/)[0]) > 0) {
        const t = lines[++i].split(/\s+/);
        numbers.push(atomicNumber(t[0]));
        pos.push(+t[1], +t[2], +t[3]);
      }
      frames.push(makeFrame(numbers, pos, { cell, pbc: cell ? pbc : [false, false, false] }));
    }
  }
  return { format: 'XSF', frames };
}

// ---------------------------------------------------------------- MOL / SDF

function parseSDF(text) {
  const frames = [];
  for (const rec of text.split(/^\$\$\$\$\s*$/m)) {
    const lines = rec.replace(/^\s*\n/, '').split(/\r?\n/);
    if (lines.length < 4) continue;
    const numbers = [];
    const pos = [];
    const title = (lines[0] || '').trim();
    if (/V3000/.test(lines[3])) {
      let inAtoms = false;
      for (const l of lines) {
        if (/M\s+V30\s+BEGIN ATOM/.test(l)) inAtoms = true;
        else if (/M\s+V30\s+END ATOM/.test(l)) inAtoms = false;
        else if (inAtoms) {
          const t = l.trim().split(/\s+/); // M V30 idx type x y z ...
          numbers.push(atomicNumber(t[3]));
          pos.push(+t[4], +t[5], +t[6]);
        }
      }
    } else {
      const n = parseInt(lines[3].slice(0, 3), 10);
      for (let a = 0; a < n; a++) {
        const l = lines[4 + a] || '';
        pos.push(parseFloat(l.slice(0, 10)), parseFloat(l.slice(10, 20)), parseFloat(l.slice(20, 30)));
        numbers.push(atomicNumber(l.slice(31, 34).trim()));
      }
    }
    if (numbers.length) frames.push(makeFrame(numbers, pos, { info: title ? { title } : {} }));
  }
  return { format: 'SDF', frames };
}
