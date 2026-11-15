// Atom Viewer — 3D viewer page (runs inside the docked iframe, or as a standalone tab).
// Entry point for data: loadBytes(name, ArrayBuffer). Everything file-derived is shown with textContent.

import * as THREE from '../vendor/three/three.module.js';
import { TrackballControls } from '../vendor/three/TrackballControls.js';
import { parseStructure } from './parsers.js';
import { symbolOf, colorOf, covalentRadius, isNonMetal } from './elements.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const embedded = window.parent !== window;
const parentOrigin = (() => {
  const m = location.hash.match(/origin=([^&]+)/);
  const o = m ? decodeURIComponent(m[1]) : '*';
  return !o || o === 'null' ? '*' : o;
})();
if (embedded) document.body.classList.add('embedded');

// ------------------------------------------------------------------ settings

const DEFAULTS = {
  atomScale: 0.5, showBonds: true, metalBonds: false, bondTol: 1.1, bondRadius: 0.13,
  showCell: true, wrap: false, na: 1, nb: 1, nc: 1, light: false, ortho: false,
};
const PERSISTED = ['atomScale', 'showBonds', 'metalBonds', 'bondTol', 'bondRadius', 'showCell', 'light', 'ortho'];
const settings = { ...DEFAULTS };
const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage?.local;

async function loadSettings() {
  try {
    const saved = hasChromeStorage
      ? (await chrome.storage.local.get('svSettings')).svSettings
      : JSON.parse(localStorage.getItem('svSettings') || 'null');
    if (saved) for (const k of PERSISTED) if (k in saved) settings[k] = saved[k];
  } catch {
    /* defaults */
  }
}
function saveSettings() {
  const out = Object.fromEntries(PERSISTED.map((k) => [k, settings[k]]));
  try {
    if (hasChromeStorage) chrome.storage.local.set({ svSettings: out });
    else localStorage.setItem('svSettings', JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ three.js setup

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.domElement.tabIndex = 0;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1e5);
persp.up.set(0, 0, 1);
ortho.up.set(0, 0, 1);
let camera = persp;
let orthoHalfH = 10;
let sceneRadius = 10;

scene.add(new THREE.AmbientLight(0xffffff, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
scene.add(keyLight, keyLight.target);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
scene.add(fillLight, fillLight.target);

const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.0 });
const bondMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.0 });
const selMat = new THREE.MeshBasicMaterial({ color: 0xffcf33, transparent: true, opacity: 0.38, depthWrite: false });
const cellMat = new THREE.LineBasicMaterial({ color: 0x9aa3b2 });

const sphereGeos = {};
function sphereGeo(count) {
  const level = count < 6000 ? 'hi' : count < 40000 ? 'mid' : 'lo';
  const seg = { hi: [28, 18], mid: [14, 10], lo: [8, 6] }[level];
  return (sphereGeos[level] ||= new THREE.SphereGeometry(1, seg[0], seg[1]));
}
const cylGeos = {};
function cylGeo(count) {
  const level = count < 20000 ? 'hi' : 'lo';
  return (cylGeos[level] ||= new THREE.CylinderGeometry(1, 1, 1, level === 'hi' ? 14 : 6, 1, true));
}

let controls = makeControls();
function makeControls() {
  const c = new TrackballControls(camera, renderer.domElement);
  c.rotateSpeed = 3.2;
  c.zoomSpeed = 1.6;
  c.panSpeed = 0.9;
  c.staticMoving = true;
  c.keys = ['', '', '']; // keep A/B/C free for view shortcuts
  c.addEventListener('change', requestRender);
  c.handleResize();
  return c;
}

// ------------------------------------------------------------------ state

let data = null; // { format, frames }
let fileName = '';
let frameIndex = 0;
let display = null; // { pos, z, src, img, count, cell }
let atomsMesh = null;
let bondsMesh = null;
let selMesh = null;
let cellLines = null;
let selection = []; // [{ src, img: [ia, ib, ic] }]
const hidden = new Set();
let dirty = true;
let playing = false;
let lastStep = 0;
const FPS = 12;

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function requestRender() {
  dirty = true;
}

// ------------------------------------------------------------------ geometry building

const atomRadius = (z) => Math.max(0.18, covalentRadius(z) * settings.atomScale);
const frame = () => data.frames[frameIndex];

function invert3(c) {
  const [a, b, d] = c;
  const det = a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0]);
  if (Math.abs(det) < 1e-12) return null;
  return [
    [(b[1] * d[2] - b[2] * d[1]) / det, (a[2] * d[1] - a[1] * d[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * d[0] - b[0] * d[2]) / det, (a[0] * d[2] - a[2] * d[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * d[1] - b[1] * d[0]) / det, (a[1] * d[0] - a[0] * d[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
}

function wrapped(f) {
  const inv = invert3(f.cell);
  if (!inv) return f.positions;
  const c = f.cell;
  const out = new Float64Array(f.positions.length);
  for (let i = 0; i < f.positions.length; i += 3) {
    const p = [f.positions[i], f.positions[i + 1], f.positions[i + 2]];
    const s = [0, 1, 2].map((d) => p[0] * inv[0][d] + p[1] * inv[1][d] + p[2] * inv[2][d]);
    for (let d = 0; d < 3; d++) if (f.pbc[d]) s[d] -= Math.floor(s[d]);
    for (let d = 0; d < 3; d++) out[i + d] = s[0] * c[0][d] + s[1] * c[1][d] + s[2] * c[2][d];
  }
  return out;
}

function supercellReps(f) {
  if (!f.cell) return [1, 1, 1];
  return [settings.na, settings.nb, settings.nc].map((r, d) => (f.pbc[d] ? Math.min(10, Math.max(1, r | 0)) : 1));
}

function buildDisplay(f) {
  const n = f.numbers.length;
  const reps = supercellReps(f);
  const base = f.cell && settings.wrap ? wrapped(f) : f.positions;
  const total = n * reps[0] * reps[1] * reps[2];
  const pos = new Float32Array(total * 3);
  const z = new Int16Array(total);
  const src = new Int32Array(total);
  const img = new Int8Array(total * 3);
  let m = 0;
  const c = f.cell;
  for (let ia = 0; ia < reps[0]; ia++)
    for (let ib = 0; ib < reps[1]; ib++)
      for (let ic = 0; ic < reps[2]; ic++) {
        const sh = c ? [0, 1, 2].map((d) => ia * c[0][d] + ib * c[1][d] + ic * c[2][d]) : [0, 0, 0];
        for (let i = 0; i < n; i++) {
          if (hidden.has(f.numbers[i])) continue;
          pos[3 * m] = base[3 * i] + sh[0];
          pos[3 * m + 1] = base[3 * i + 1] + sh[1];
          pos[3 * m + 2] = base[3 * i + 2] + sh[2];
          z[m] = f.numbers[i];
          src[m] = i;
          img[3 * m] = ia;
          img[3 * m + 1] = ib;
          img[3 * m + 2] = ic;
          m++;
        }
      }
  return { pos, z, src, img, count: m, reps };
}

function ensureInstanced(mesh, geo, mat, count) {
  if (mesh && mesh.geometry === geo && mesh.instanceMatrix.count >= count) {
    mesh.count = count;
    return mesh;
  }
  if (mesh) {
    scene.remove(mesh);
    mesh.dispose();
  }
  const cap = Math.max(1, Math.ceil(count * 1.25));
  const nm = new THREE.InstancedMesh(geo, mat, cap);
  nm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nm.setColorAt(0, tmpC.set(0xffffff));
  nm.count = count;
  nm.frustumCulled = false;
  scene.add(nm);
  return nm;
}

function updateAtoms() {
  const d = display;
  atomsMesh = ensureInstanced(atomsMesh, sphereGeo(d.count), atomMat, d.count);
  for (let i = 0; i < d.count; i++) {
    const r = atomRadius(d.z[i]);
    tmpM.makeScale(r, r, r).setPosition(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]);
    atomsMesh.setMatrixAt(i, tmpM);
    atomsMesh.setColorAt(i, tmpC.setHex(colorOf(d.z[i])));
  }
  atomsMesh.instanceMatrix.needsUpdate = true;
  atomsMesh.instanceColor.needsUpdate = true;
  atomsMesh.boundingSphere = null;
  requestRender();
}

function computeBonds(d) {
  if (!settings.showBonds || d.count < 2) return new Int32Array(0);
  const tol = settings.bondTol;
  const covR = new Float32Array(d.count);
  const nonmetal = new Uint8Array(d.count);
  let maxR = 0;
  let lo = [Infinity, Infinity, Infinity];
  for (let i = 0; i < d.count; i++) {
    covR[i] = covalentRadius(d.z[i]);
    nonmetal[i] = isNonMetal(d.z[i]) ? 1 : 0;
    if (covR[i] > maxR) maxR = covR[i];
    for (let k = 0; k < 3; k++) if (d.pos[3 * i + k] < lo[k]) lo[k] = d.pos[3 * i + k];
  }
  const cutoff = 2 * maxR * tol;
  const inv = 1 / cutoff;
  const grid = new Map();
  const key = (x, y, zz) => x * 73856093 + y * 19349663 + zz * 83492791;
  const cellOf = new Int32Array(d.count * 3);
  for (let i = 0; i < d.count; i++) {
    const cx = Math.floor((d.pos[3 * i] - lo[0]) * inv);
    const cy = Math.floor((d.pos[3 * i + 1] - lo[1]) * inv);
    const cz = Math.floor((d.pos[3 * i + 2] - lo[2]) * inv);
    cellOf[3 * i] = cx;
    cellOf[3 * i + 1] = cy;
    cellOf[3 * i + 2] = cz;
    const k = key(cx, cy, cz);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  const pairs = [];
  const LIMIT = 3e6;
  for (let i = 0; i < d.count && pairs.length < LIMIT; i++) {
    const xi = d.pos[3 * i], yi = d.pos[3 * i + 1], zi = d.pos[3 * i + 2];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(key(cellOf[3 * i] + dx, cellOf[3 * i + 1] + dy, cellOf[3 * i + 2] + dz));
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            if (!settings.metalBonds && !nonmetal[i] && !nonmetal[j]) continue;
            const ex = d.pos[3 * j] - xi, ey = d.pos[3 * j + 1] - yi, ez = d.pos[3 * j + 2] - zi;
            const d2 = ex * ex + ey * ey + ez * ez;
            const lim = (covR[i] + covR[j]) * tol;
            if (d2 < lim * lim && d2 > 0.16) pairs.push(i, j);
          }
        }
  }
  return Int32Array.from(pairs);
}

function setHalfBond(mesh, idx, ax, ay, az, bx, by, bz, z) {
  tmpV.set(bx - ax, by - ay, bz - az);
  const len = tmpV.length();
  tmpQ.setFromUnitVectors(Y_AXIS, tmpV.divideScalar(len || 1));
  tmpV2.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  tmpS.set(settings.bondRadius, len, settings.bondRadius);
  mesh.setMatrixAt(idx, tmpM.compose(tmpV2, tmpQ, tmpS));
  mesh.setColorAt(idx, tmpC.setHex(colorOf(z)));
}

function updateBonds() {
  const d = display;
  const pairs = computeBonds(d);
  const nb = pairs.length / 2;
  if (!nb) {
    if (bondsMesh) bondsMesh.count = 0;
    requestRender();
    return;
  }
  bondsMesh = ensureInstanced(bondsMesh, cylGeo(nb), bondMat, nb * 2);
  const p = d.pos;
  for (let k = 0; k < nb; k++) {
    const i = pairs[2 * k], j = pairs[2 * k + 1];
    const mx = (p[3 * i] + p[3 * j]) / 2, my = (p[3 * i + 1] + p[3 * j + 1]) / 2, mz = (p[3 * i + 2] + p[3 * j + 2]) / 2;
    setHalfBond(bondsMesh, 2 * k, p[3 * i], p[3 * i + 1], p[3 * i + 2], mx, my, mz, d.z[i]);
    setHalfBond(bondsMesh, 2 * k + 1, p[3 * j], p[3 * j + 1], p[3 * j + 2], mx, my, mz, d.z[j]);
  }
  bondsMesh.instanceMatrix.needsUpdate = true;
  bondsMesh.instanceColor.needsUpdate = true;
  bondsMesh.boundingSphere = null;
  requestRender();
}

function updateCell() {
  if (cellLines) {
    scene.remove(cellLines);
    cellLines.geometry.dispose();
    cellLines = null;
  }
  const f = data && frame();
  if (!f || !f.cell || !settings.showCell) return requestRender();
  const [a, b, c] = f.cell.map((v) => new THREE.Vector3(...v));
  const o = new THREE.Vector3();
  const P = (i, j, k) => o.clone().addScaledVector(a, i).addScaledVector(b, j).addScaledVector(c, k);
  const edges = [];
  for (const [p, q] of [
    [[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1]],
    [[1, 0, 0], [1, 1, 0]], [[1, 0, 0], [1, 0, 1]], [[0, 1, 0], [1, 1, 0]],
    [[0, 1, 0], [0, 1, 1]], [[0, 0, 1], [1, 0, 1]], [[0, 0, 1], [0, 1, 1]],
    [[1, 1, 0], [1, 1, 1]], [[1, 0, 1], [1, 1, 1]], [[0, 1, 1], [1, 1, 1]],
  ]) {
    edges.push(P(...p), P(...q));
  }
  cellLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges), cellMat);
  scene.add(cellLines);
  requestRender();
}

function displayIndexOf(sel) {
  const d = display;
  for (let i = 0; i < d.count; i++) {
    if (d.src[i] === sel.src && d.img[3 * i] === sel.img[0] && d.img[3 * i + 1] === sel.img[1] && d.img[3 * i + 2] === sel.img[2]) return i;
  }
  return -1;
}

function updateSelection() {
  const idx = selection.map(displayIndexOf);
  selection = selection.filter((_, k) => idx[k] >= 0);
  const live = idx.filter((i) => i >= 0);
  if (!selMesh) {
    selMesh = new THREE.InstancedMesh(sphereGeo(0), selMat, 4);
    selMesh.frustumCulled = false;
    selMesh.renderOrder = 2;
    scene.add(selMesh);
  }
  selMesh.count = live.length;
  live.forEach((i, k) => {
    const r = atomRadius(display.z[i]) * 1.3 + 0.12;
    tmpM.makeScale(r, r, r).setPosition(display.pos[3 * i], display.pos[3 * i + 1], display.pos[3 * i + 2]);
    selMesh.setMatrixAt(k, tmpM);
  });
  selMesh.instanceMatrix.needsUpdate = true;
  renderMeasure(live);
  requestRender();
}

// ------------------------------------------------------------------ labels / measurement

const fmt = (x, d = 3) => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(d)) : String(x));

function atomLabel(i) {
  const d = display;
  const im = [d.img[3 * i], d.img[3 * i + 1], d.img[3 * i + 2]];
  const imTxt = im.some((x) => x) ? ` [${im.join(',')}]` : '';
  const f = frame();
  const lab = f.labels && f.labels[d.src[i]];
  const extra = lab && lab !== symbolOf(d.z[i]) ? ` (${lab})` : '';
  return `${symbolOf(d.z[i])} #${d.src[i]}${extra}${imTxt}`;
}

function atomDetails(i) {
  const d = display;
  const p = [d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]];
  const lines = [`${atomLabel(i)}   (${p.map((x) => x.toFixed(3)).join(', ')}) Å`];
  const props = frame().props
    .map((pr) => {
      const v = pr.values.slice(d.src[i] * pr.dim, (d.src[i] + 1) * pr.dim).map((x) => (typeof x === 'boolean' ? (x ? 'T' : 'F') : fmt(x, 4)));
      return `${pr.name}=${pr.dim > 1 ? `(${v.join(', ')})` : v[0]}`;
    })
    .join('  ');
  if (props) lines.push(props);
  return lines.join('\n');
}

function vecOf(i) {
  return new THREE.Vector3(display.pos[3 * i], display.pos[3 * i + 1], display.pos[3 * i + 2]);
}

function renderMeasure(live) {
  const box = $('measure');
  if (!live.length) {
    box.hidden = true;
    return;
  }
  const P = live.map(vecOf);
  const lines = live.map((i, k) => `${k + 1}: ${atomLabel(i)}`);
  if (P.length >= 2) lines.push(`Distance 1–2: ${P[0].distanceTo(P[1]).toFixed(4)} Å`);
  if (P.length >= 3) {
    lines.push(`Distance 2–3: ${P[1].distanceTo(P[2]).toFixed(4)} Å`);
    const u = P[0].clone().sub(P[1]), v = P[2].clone().sub(P[1]);
    lines.push(`Angle 1–2–3: ${THREE.MathUtils.radToDeg(u.angleTo(v)).toFixed(2)}°`);
  }
  if (P.length === 4) {
    const b1 = P[1].clone().sub(P[0]), b2 = P[2].clone().sub(P[1]), b3 = P[3].clone().sub(P[2]);
    const n1 = b1.clone().cross(b2), n2 = b2.clone().cross(b3);
    const m1 = n1.clone().cross(b2.clone().normalize());
    const ang = Math.atan2(m1.dot(n2), n1.dot(n2));
    lines.push(`Dihedral 1–2–3–4: ${THREE.MathUtils.radToDeg(ang).toFixed(2)}°`);
  }
  box.textContent = lines.join('\n');
  box.hidden = false;
}

// ------------------------------------------------------------------ legend / header / frames

function updateLegend() {
  const f = frame();
  const counts = new Map();
  for (const z of f.numbers) counts.set(z, (counts.get(z) || 0) + 1);
  const legend = $('legend');
  legend.replaceChildren();
  for (const z of [...counts.keys()].sort((a, b) => a - b)) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (hidden.has(z) ? ' off' : '');
    chip.title = 'Click to show / hide';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = `#${colorOf(z).toString(16).padStart(6, '0')}`;
    const sym = document.createElement('span');
    sym.textContent = symbolOf(z);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(counts.get(z));
    chip.append(dot, sym, n);
    chip.addEventListener('click', () => {
      if (hidden.has(z)) hidden.delete(z);
      else hidden.add(z);
      refreshFrame();
    });
    legend.append(chip);
  }
}

function updateHeader() {
  $('name').textContent = fileName || 'Atom Viewer';
  document.title = fileName ? `${fileName} — Atom Viewer` : 'Atom Viewer';
  if (!data) {
    $('meta').textContent = '';
    return;
  }
  const f = frame();
  const parts = [data.format, `${f.numbers.length} atoms`];
  if (data.frames.length > 1) parts.push(`${data.frames.length} frames`);
  if (f.cell) parts.push(`pbc ${f.pbc.map((p) => (p ? 'T' : 'F')).join('')}`);
  $('meta').textContent = parts.join(' · ');
}

function updateFrameBar() {
  const bar = $('frames');
  const nf = data ? data.frames.length : 0;
  const info = data ? Object.entries(frame().info) : [];
  bar.hidden = nf <= 1 && info.length === 0;
  bar.classList.toggle('single', nf <= 1);
  if (!data) return;
  const slider = $('frame-slider');
  slider.max = String(nf - 1);
  slider.value = String(frameIndex);
  $('frame-label').textContent = `${frameIndex + 1} / ${nf}`;
  const txt = info.map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v}`).join('   ');
  $('frame-info').textContent = txt;
  $('frame-info').title = txt;
}

function syncSupercellInputs() {
  const f = data && frame();
  ['na', 'nb', 'nc'].forEach((k, d) => {
    const el = $('settings').elements[k];
    el.value = String(settings[k]);
    el.disabled = !f || !f.cell || !f.pbc[d];
  });
  $('settings').elements.wrap.disabled = !f || !f.cell;
}

// ------------------------------------------------------------------ camera

function bounds() {
  const box = new THREE.Box3();
  const d = display;
  let maxR = 0;
  if (d) {
    for (let i = 0; i < d.count; i++) {
      box.expandByPoint(tmpV.set(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]));
      maxR = Math.max(maxR, atomRadius(d.z[i]));
    }
  }
  const f = data && frame();
  if (f && f.cell && settings.showCell) {
    const [a, b, c] = f.cell.map((v) => new THREE.Vector3(...v));
    for (let i = 0; i < 8; i++) {
      box.expandByPoint(new THREE.Vector3().addScaledVector(a, i & 1).addScaledVector(b, (i >> 1) & 1).addScaledVector(c, (i >> 2) & 1));
    }
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius + maxR, 2);
  return sphere;
}

function boundPoints() {
  const pts = [];
  const d = display;
  let pad = 0;
  if (d && d.count) {
    const step = Math.max(1, Math.floor(d.count / 20000));
    for (let i = 0; i < d.count; i += step) pts.push(new THREE.Vector3(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]));
    for (let i = 0; i < d.count; i++) pad = Math.max(pad, atomRadius(d.z[i]));
  }
  const f = data && frame();
  if (f && f.cell && settings.showCell) {
    const [a, b, c] = f.cell.map((v) => new THREE.Vector3(...v));
    for (let i = 0; i < 8; i++) {
      pts.push(new THREE.Vector3().addScaledVector(a, i & 1).addScaledVector(b, (i >> 1) & 1).addScaledVector(c, (i >> 2) & 1));
    }
  }
  if (!pts.length) pts.push(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
  return { pts, pad };
}

// Frame the structure as seen from `dir` (unit vector pointing from the structure to the camera).
function placeCamera(dir, up) {
  sceneRadius = bounds().radius;
  dir = dir.clone().normalize();
  up = up.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const { pts, pad } = boundPoints();
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    const q = [p.dot(right), p.dot(up), p.dot(dir)];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], q[k] - pad);
      hi[k] = Math.max(hi[k], q[k] + pad);
    }
  }
  const center = new THREE.Vector3()
    .addScaledVector(right, (lo[0] + hi[0]) / 2)
    .addScaledVector(up, (lo[1] + hi[1]) / 2)
    .addScaledVector(dir, (lo[2] + hi[2]) / 2);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
  const aspect = Math.max(0.2, persp.aspect);
  const fitH = Math.max((hi[1] - lo[1]) / 2, (hi[0] - lo[0]) / 2 / aspect, 1) * 1.1;
  const halfDepth = (hi[2] - lo[2]) / 2;
  const dist = fitH / tanHalf + halfDepth;
  persp.near = Math.max(0.01, dist / 500);
  persp.far = dist * 50 + sceneRadius * 4;
  persp.position.copy(center).addScaledVector(dir, dist);
  orthoHalfH = fitH;
  ortho.zoom = 1;
  ortho.position.copy(center).addScaledVector(dir, Math.max(dist, sceneRadius * 4));
  for (const cam of [persp, ortho]) {
    cam.up.copy(up);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
  }
  updateOrthoFrustum();
  controls.target.copy(center);
  controls.update();
  requestRender();
}

function axisVectors() {
  const f = data && frame();
  if (f && f.cell) return f.cell.map((v) => new THREE.Vector3(...v).normalize());
  return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
}

function resetView() {
  const [a, b, c] = axisVectors();
  const dir = a.clone().multiplyScalar(0.35).addScaledVector(b, -1).addScaledVector(c, 0.45);
  placeCamera(dir, orthoUp(c, dir));
}

function viewAlong(axis) {
  const v = axisVectors();
  // Camera on the +a / -b / +c side so that the other in-plane axis points right:
  // a-view shows b → right, c ↑; b-view shows a → right, c ↑; c-view shows a → right.
  const k = { a: 0, b: 1, c: 2 }[axis];
  const dir = k === 1 ? v[1].clone().negate() : v[k];
  const up = k === 2 ? orthoUp(v[1], v[0]) : v[2];
  placeCamera(dir, orthoUp(up, dir));
}

function orthoUp(up, dir) {
  const d = dir.clone().normalize();
  let u = up.clone().sub(d.clone().multiplyScalar(up.dot(d)));
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(0, 1, 0).sub(d.clone().multiplyScalar(d.y));
  return u.normalize();
}

function updateOrthoFrustum() {
  const aspect = persp.aspect || 1;
  ortho.left = -orthoHalfH * aspect;
  ortho.right = orthoHalfH * aspect;
  ortho.top = orthoHalfH;
  ortho.bottom = -orthoHalfH;
  ortho.updateProjectionMatrix();
}

function setOrtho(on) {
  const to = on ? ortho : persp;
  if (camera !== to) {
    const target = controls.target.clone();
    const dir = camera.position.clone().sub(target);
    const dist = dir.length();
    dir.normalize();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
    if (on) {
      orthoHalfH = dist * tanHalf;
      ortho.zoom = 1;
      ortho.position.copy(target).addScaledVector(dir, Math.max(dist, sceneRadius * 4));
    } else {
      const h = orthoHalfH / ortho.zoom;
      persp.position.copy(target).addScaledVector(dir, h / tanHalf);
    }
    to.up.copy(camera.up);
    to.lookAt(target);
    updateOrthoFrustum();
    camera = to;
    controls.dispose();
    controls = makeControls();
    controls.target.copy(target);
    controls.update();
  }
  settings.ortho = on;
  $('btn-ortho').classList.toggle('active', on);
  requestRender();
}

// ------------------------------------------------------------------ axes indicator

const SVG_NS = 'http://www.w3.org/2000/svg';
const axesSvg = $('axes');
const axisEls = ['#e5534b', '#4fae5a', '#539bf5'].map((color) => {
  const g = document.createElementNS(SVG_NS, 'g');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', '40');
  line.setAttribute('y1', '40');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2.5');
  line.setAttribute('stroke-linecap', 'round');
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('fill', color);
  g.append(line, text);
  axesSvg.append(g);
  return { g, line, text };
});

function updateAxes() {
  const f = data && frame();
  const vecs = axisVectors();
  const names = f && f.cell ? ['a', 'b', 'c'] : ['x', 'y', 'z'];
  const qInv = camera.quaternion.clone().invert();
  const items = vecs.map((v, k) => ({ k, p: v.clone().applyQuaternion(qInv) }));
  items.sort((u, v) => u.p.z - v.p.z);
  for (const { k, p } of items) {
    const el = axisEls[k];
    el.line.setAttribute('x2', String(40 + p.x * 24));
    el.line.setAttribute('y2', String(40 - p.y * 24));
    el.text.setAttribute('x', String(40 + p.x * 33));
    el.text.setAttribute('y', String(40 - p.y * 33));
    el.text.textContent = names[k];
    el.g.style.opacity = p.z < -0.2 ? '0.45' : '1';
    axesSvg.append(el.g); // back-to-front order
  }
}

// ------------------------------------------------------------------ render loop

function applyTheme() {
  document.body.classList.toggle('light', !!settings.light);
  document.body.classList.toggle('dark', !settings.light);
  scene.background = new THREE.Color(settings.light ? 0xffffff : 0x16181d);
  cellMat.color.set(settings.light ? 0x4a5160 : 0x9aa3b2);
  requestRender();
}

function render() {
  const target = controls.target;
  const dist = Math.max(1, camera.position.distanceTo(target));
  keyLight.position.copy(target).addScaledVector(tmpV.set(0.45, 0.65, 1).normalize().applyQuaternion(camera.quaternion), dist);
  keyLight.target.position.copy(target);
  fillLight.position.copy(target).addScaledVector(tmpV.set(-0.6, -0.3, 0.4).normalize().applyQuaternion(camera.quaternion), dist);
  fillLight.target.position.copy(target);
  renderer.render(scene, camera);
  updateAxes();
}

function loop(now) {
  requestAnimationFrame(loop);
  controls.update();
  if (playing && data && now - lastStep > 1000 / FPS) {
    lastStep = now;
    setFrame((frameIndex + 1) % data.frames.length);
  }
  if (!dirty) return;
  dirty = false;
  render();
}

new ResizeObserver(() => {
  const w = Math.max(1, stage.clientWidth);
  const h = Math.max(1, stage.clientHeight);
  renderer.setSize(w, h, false);
  persp.aspect = w / h;
  persp.updateProjectionMatrix();
  updateOrthoFrustum();
  controls.handleResize();
  requestRender();
}).observe(stage);

// ------------------------------------------------------------------ data flow

function refreshFrame({ refit = false } = {}) {
  if (!data) return;
  display = buildDisplay(frame());
  updateAtoms();
  updateBonds();
  updateCell();
  updateSelection();
  updateLegend();
  updateHeader();
  updateFrameBar();
  if (refit) resetView();
}

function setFrame(i) {
  if (!data) return;
  frameIndex = Math.max(0, Math.min(data.frames.length - 1, i));
  refreshFrame();
}

function setData(newData, name) {
  data = newData;
  fileName = name;
  frameIndex = 0;
  selection = [];
  hidden.clear();
  settings.na = settings.nb = settings.nc = 1;
  settings.wrap = false;
  playing = false;
  setPlayIcon();
  syncForm();
  syncSupercellInputs();
  showStatus('');
  refreshFrame({ refit: true });
}

async function loadBytes(name, buffer) {
  try {
    showStatus(`Parsing ${name}…`);
    fileName = name;
    updateHeader();
    let bytes = new Uint8Array(buffer);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const text = new TextDecoder().decode(bytes);
    await new Promise((r) => setTimeout(r, 0));
    const parsed = parseStructure(text, name);
    setData(parsed, name);
  } catch (err) {
    console.error(err);
    showError(`${name}\n\n${err.message || err}`);
  }
}

function showStatus(msg) {
  const el = $('status');
  el.classList.remove('error');
  el.textContent = msg;
}
function showError(msg) {
  const el = $('status');
  el.classList.add('error');
  el.textContent = msg;
}

// ------------------------------------------------------------------ picking

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(ev) {
  if (!atomsMesh || !display || !display.count) return -1;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(atomsMesh, false)[0];
  return hit && hit.instanceId !== undefined ? hit.instanceId : -1;
}

let down = null;
let hoverPending = null;
const hoverBox = $('hover');
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, button: e.button };
  hoverBox.hidden = true;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || down.button !== 0) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 4) return;
  const i = pick(e);
  if (i < 0) {
    selection = [];
  } else {
    const sel = { src: display.src[i], img: [display.img[3 * i], display.img[3 * i + 1], display.img[3 * i + 2]] };
    const at = selection.findIndex((s) => s.src === sel.src && s.img.every((x, k) => x === sel.img[k]));
    if (at >= 0) selection.splice(at, 1);
    else if (selection.length >= 4) selection = [sel];
    else selection.push(sel);
  }
  updateSelection();
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const i = pick(e);
  if (i < 0) return;
  const p = vecOf(i);
  const delta = p.clone().sub(controls.target);
  camera.position.add(delta);
  controls.target.copy(p);
  controls.update();
  requestRender();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons || !display || display.count > 60000) {
    hoverBox.hidden = true;
    return;
  }
  if (hoverPending) return;
  hoverPending = requestAnimationFrame(() => {
    hoverPending = null;
    const i = pick(e);
    if (i < 0) {
      hoverBox.hidden = true;
      return;
    }
    hoverBox.textContent = atomDetails(i);
    hoverBox.hidden = false;
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left + 14;
    const y = e.clientY - rect.top + 14;
    hoverBox.style.left = `${Math.min(x, rect.width - hoverBox.offsetWidth - 6)}px`;
    hoverBox.style.top = `${Math.min(y, rect.height - hoverBox.offsetHeight - 6)}px`;
  });
});
renderer.domElement.addEventListener('pointerleave', () => (hoverBox.hidden = true));

// ------------------------------------------------------------------ UI wiring

const form = $('settings');
function syncOutputs() {
  for (const out of form.querySelectorAll('output[data-for]')) {
    const v = settings[out.dataset.for];
    out.textContent = typeof v === 'number' ? v.toFixed(2) : String(v);
  }
}
function syncForm() {
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = String(settings[el.name]);
  }
  syncOutputs();
}

// "Reset settings": every display setting back to its default (the camera is left alone
// unless the supercell changes, which needs a re-frame).
function resetSettings() {
  const supercellChanged = settings.na !== 1 || settings.nb !== 1 || settings.nc !== 1;
  Object.assign(settings, DEFAULTS);
  hidden.clear();
  saveSettings();
  syncForm();
  syncSupercellInputs();
  applyTheme();
  setOrtho(false);
  if (data) refreshFrame({ refit: supercellChanged });
}
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('input', (e) => {
  const el = e.target;
  const k = el.name;
  if (!(k in settings)) return;
  const v = el.type === 'checkbox' ? el.checked : Number(el.value);
  if (el.type === 'number' && !(v >= 1)) return;
  settings[k] = v;
  syncOutputs();
  if (PERSISTED.includes(k)) saveSettings();
  if (k === 'light') return applyTheme();
  if (!data) return;
  if (k === 'atomScale') {
    updateAtoms();
    updateSelection();
  } else if (['showBonds', 'metalBonds', 'bondTol', 'bondRadius'].includes(k)) {
    updateBonds();
  } else if (k === 'showCell') {
    updateCell();
  } else if (['na', 'nb', 'nc', 'wrap'].includes(k)) {
    refreshFrame({ refit: k !== 'wrap' });
  }
});

$('btn-settings').addEventListener('click', () => {
  form.hidden = !form.hidden;
  $('btn-settings').classList.toggle('active', !form.hidden);
});
$('btn-reset').addEventListener('click', resetView);
$('btn-reset-settings').addEventListener('click', resetSettings);
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewAlong(b.dataset.view)));
$('btn-ortho').addEventListener('click', () => {
  setOrtho(!settings.ortho);
  saveSettings();
});
$('btn-shot').addEventListener('click', () => {
  render();
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(fileName || 'structure').replace(/\.(gz)$/i, '').replace(/\.[^.]+$/, '')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }, 'image/png');
});

function setPlayIcon() {
  $('play-icon').setAttribute('d', playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
}
function togglePlay() {
  if (!data || data.frames.length < 2) return;
  playing = !playing;
  setPlayIcon();
}
$('btn-play').addEventListener('click', togglePlay);
$('frame-slider').addEventListener('input', (e) => setFrame(Number(e.target.value)));

// panel controls (embedded mode)
let dock = 'right';
const toParent = (msg) => embedded && window.parent.postMessage(msg, parentOrigin);
$('btn-close').addEventListener('click', () => toParent({ type: 'sv:close' }));
$('btn-dock').addEventListener('click', () => toParent({ type: 'sv:dock', dock: dock === 'right' ? 'bottom' : 'right' }));
$('btn-full').addEventListener('click', () => toParent({ type: 'sv:fullscreen' }));
let fullscreenState = false;
// Re-frame the structure after the panel changes shape, keeping the current viewing direction.
function refit() {
  const dir = camera.position.clone().sub(controls.target).normalize();
  placeCamera(dir, orthoUp(camera.up, dir));
}
function applyPanelState(m) {
  const changed = (m.dock === 'bottom' ? 'bottom' : 'right') !== dock || !!m.fullscreen !== fullscreenState;
  fullscreenState = !!m.fullscreen;
  if (changed && data) setTimeout(refit, 80);
  dock = m.dock === 'bottom' ? 'bottom' : 'right';
  $('dock-icon-line').setAttribute('d', dock === 'right' ? 'M3 14h18' : 'M14 4v16');
  $('btn-dock').title = dock === 'right' ? 'Dock to bottom' : 'Dock to right';
  $('btn-full').classList.toggle('active', !!m.fullscreen);
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'r') resetView();
  else if (k === 'a' || k === 'b' || k === 'c') viewAlong(k);
  else if (k === 'o') {
    setOrtho(!settings.ortho);
    saveSettings();
  } else if (k === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') setFrame(frameIndex + 1);
  else if (e.key === 'ArrowLeft') setFrame(frameIndex - 1);
  else if (e.key === 'Escape' && !form.hidden) {
    form.hidden = true;
    $('btn-settings').classList.remove('active');
  }
});

// drag & drop a local file
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragover');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragover');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadBytes(file.name, await file.arrayBuffer());
});

// messages from content.js
window.addEventListener('message', (e) => {
  if (!embedded || e.source !== window.parent) return;
  if (parentOrigin !== '*' && e.origin !== parentOrigin) return;
  const m = e.data;
  if (!m || typeof m.type !== 'string') return;
  if (m.type === 'sv:loading') {
    fileName = String(m.name || '');
    updateHeader();
    showStatus(`Fetching ${fileName}…`);
  } else if (m.type === 'sv:load' && m.buffer instanceof ArrayBuffer) {
    loadBytes(String(m.name || 'structure'), m.buffer);
  } else if (m.type === 'sv:error') {
    fileName = String(m.name || fileName);
    updateHeader();
    showError(String(m.message || 'error'));
  } else if (m.type === 'sv:state') {
    applyPanelState(m);
  }
});

// ------------------------------------------------------------------ start

await loadSettings();
syncForm();
syncSupercellInputs();
applyTheme();
if (settings.ortho) setOrtho(true);
requestAnimationFrame(loop);
resetView();

const params = new URLSearchParams(location.search);
if (params.get('src') && location.protocol.startsWith('http')) {
  // development only: viewer.html?src=<url> when served over http
  const src = params.get('src');
  fetch(src)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((buf) => loadBytes(decodeURIComponent(src.split('/').pop()), buf))
    .catch((err) => showError(String(err.message || err)));
} else if (embedded) {
  showStatus('Loading…');
  toParent({ type: 'sv:ready' });
} else {
  showStatus('Drop a structure file here (.xyz / .extxyz / .pdb / .cif / POSCAR …)');
}

// for debugging from DevTools
window.atomViewer = { loadBytes, get data() { return data; }, setFrame, viewAlong, resetView };
