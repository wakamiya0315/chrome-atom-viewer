// Render the Chrome Web Store images into store/:
//   screenshot-*.png (1280x800) — the extension running on public GitHub pages (janosh/matterviz samples)
//   promo-small-440x280.png     — from tools/promo-tile.html
//
// Usage: node tools/store_assets.mjs            (needs Google Chrome and network access)
//
// Like tests/e2e.mjs, this loads a temporary copy of extension/ with host_permissions added,
// because DevTools cannot produce the user gesture that grants activeTab.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://github.com/janosh/matterviz/blob/main/src/site';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  {
    out: 'screenshot-1-right-panel.png',
    page: `${BASE}/structures/mof-issue-127.cif`,
    panel: { dock: 'right', right: 52, bottom: 45 },
    setup: `atomViewer.resetView()`,
  },
  {
    out: 'screenshot-2-measure.png',
    page: `${BASE}/structures/LiFePO4.cif`,
    panel: { dock: 'right', right: 55, bottom: 45 },
    setup: `(() => {
      const f = document.getElementById('settings');
      for (const [k, v] of [['na', 2], ['nb', 2], ['nc', 2]]) { f.elements[k].value = String(v); f.elements[k].dispatchEvent(new Event('input', { bubbles: true })); }
      // an O–P–O angle inside one PO4 tetrahedron (both O in the same cell image as the P)
      const d = atomViewer.data.frames[0];
      const pos = (i) => [d.positions[3 * i], d.positions[3 * i + 1], d.positions[3 * i + 2]];
      const dist = (i, j) => Math.hypot(...pos(i).map((x, k) => x - pos(j)[k]));
      const idx = [...d.numbers.keys()];
      for (const p of idx.filter((i) => d.numbers[i] === 15)) {
        const o = idx.filter((i) => d.numbers[i] === 8 && dist(p, i) < 1.7);
        if (o.length >= 2) { atomViewer.select([o[0], p, o[1]]); return 'P #' + p; }
      }
      return 'no intact PO4';
    })()`,
  },
  {
    out: 'screenshot-3-trajectory.png',
    page: `${BASE}/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
    panel: { dock: 'bottom', right: 42, bottom: 62 },
    setup: `(() => {
      const f = document.getElementById('settings');
      for (const [k, v] of [['na', 2], ['nb', 2]]) { f.elements[k].value = String(v); f.elements[k].dispatchEvent(new Event('input', { bubbles: true })); }
      atomViewer.setFrame(Math.floor(atomViewer.data.frames.length / 2));
      atomViewer.viewAlong('b');
    })()`,
  },
];

const ext = mkdtempSync(join(tmpdir(), 'av-store-ext-'));
cpSync(join(ROOT, 'extension'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

const profile = mkdtempSync(join(tmpdir(), 'av-store-profile-'));
const proc = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging', '--no-first-run', '--hide-scrollbars', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let id = 0;
let buf = '';
const pending = new Map();
proc.stdio[4].on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let k;
  while ((k = buf.indexOf('\0')) >= 0) {
    const d = JSON.parse(buf.slice(0, k));
    buf = buf.slice(k + 1);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.rej(new Error(d.error.message)) : p.res(d.result);
    }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  proc.stdio[3].write(JSON.stringify({ id: i, method, params, sessionId }) + '\0');
});
const evaluate = async (sessionId, expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
const targets = async () => (await send('Target.getTargets')).targetInfos;

async function shoot(session, file, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
  await sleep(600);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } }, session);
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  console.log('wrote', `store/${file}`);
}

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: ext });
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(1500);
  const sw = (await targets()).find((t) => t.type === 'service_worker' && t.url.includes(extId));
  const swSession = await attach(sw.targetId);

  for (const shot of SHOTS) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const s = await attach(targetId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, s);
    await send('Page.navigate', { url: shot.page }, s);
    await sleep(5000);
    await evaluate(swSession, `(async () => {
      await chrome.storage.local.set({ svPanel: ${JSON.stringify(shot.panel)} });
      const tab = (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(${JSON.stringify(shot.page)}));
      await openPanel(tab, { url: tab.url });
    })()`);
    await sleep(4000);
    const frameT = (await targets()).find((t) => t.type === 'iframe' && t.url.includes(extId) && t.url.includes('viewer.html'));
    const fs = await attach(frameT.targetId);
    await evaluate(fs, shot.setup);
    await sleep(1500);
    console.log(' ', shot.out, '→', await evaluate(fs, `document.getElementById('meta').textContent`));
    await shoot(s, shot.out, 1280, 800);
    await send('Target.closeTarget', { targetId });
  }

  // promo tile
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const s = await attach(targetId);
  await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false }, s);
  await send('Page.navigate', { url: pathToFileURL(join(ROOT, 'tools', 'promo-tile.html')).href }, s);
  await sleep(1500);
  await shoot(s, 'promo-small-440x280.png', 440, 280);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
  await sleep(800);
  rmSync(profile, { recursive: true, force: true });
  rmSync(ext, { recursive: true, force: true });
}
