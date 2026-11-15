// End-to-end check: load the unpacked extension into a throwaway headless Chrome profile,
// open a public GitHub blob page, run the same openPanel() the context menu uses, and
// inspect the injected panel + viewer iframe.
//
// The extension itself has no host permissions: it relies on activeTab, which Chrome grants
// only on a real user gesture (context-menu click, toolbar button, shortcut). DevTools cannot
// produce that gesture, so the test loads a temporary copy whose manifest also has
// host_permissions <all_urls>. Everything else is the shipped code.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SRC_EXT = resolve(process.argv[2]);
const EXT = mkdtempSync(join(tmpdir(), 'av-ext-'));
cpSync(SRC_EXT, EXT, { recursive: true });
{
  const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
const OUT = resolve(process.argv[3] || '.');
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'sv-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging',
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const toChrome = proc.stdio[3];
const fromChrome = proc.stdio[4];

let ws, id = 0;
const pending = new Map();
const events = [];
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    toChrome.write(JSON.stringify({ id: msgId, method, params, sessionId }) + '\0');
  });
}
async function evaluate(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
async function attach(targetId) {
  return (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
}
async function targets() {
  return (await send('Target.getTargets')).targetInfos;
}

try {
  let buf = '';
  fromChrome.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let k;
    while ((k = buf.indexOf('\0')) >= 0) {
      const d = JSON.parse(buf.slice(0, k));
      buf = buf.slice(k + 1);
      if (d.id && pending.has(d.id)) {
        const p = pending.get(d.id); pending.delete(d.id);
        d.error ? p.rej(new Error(d.error.message)) : p.res(d.result);
      } else events.push(d);
    }
  });
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  console.log('loaded unpacked extension id', extId);
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(1500);
  let swSession = null;
  const sws = (await targets()).filter((t) => t.type === 'service_worker');
  console.log('service workers:', sws.map((t) => t.url).join(' | '));
  for (const t of sws) {
    const sid = await attach(t.targetId);
    const name = await evaluate(sid, `chrome.runtime.getManifest().name`).catch(() => null);
    if (name === 'Atom Viewer') { swSession = sid; console.log('extension loaded:', t.url); break; }
  }
  if (!swSession) throw new Error('Atom Viewer service worker not found (extension did not load)');

  // context menu items registered? (update() rejects for an id that failed to be created)
  console.log('context menus:', await evaluate(swSession, `Promise.all(['sv-link','sv-page','sv-selection'].map(id =>
    chrome.contextMenus.update(id, {}).then(() => id + ':ok', e => id + ':MISSING ' + e.message))).then(r => r.join(' '))`));
  const scenarios = [
    { name: 'blob-page', page: 'https://github.com/wakamiya0315/chrome-atom-viewer/blob/main/tests/rutile.cif', open: 'tab.url' },
    { name: 'link-raw', page: 'https://github.com/wakamiya0315/chrome-atom-viewer/tree/main/tests',
      open: JSON.stringify('https://raw.githubusercontent.com/wakamiya0315/chrome-atom-viewer/main/tests/traj.xyz') },
    { name: 'link-blob-pdb', page: 'https://github.com/wakamiya0315/chrome-atom-viewer/tree/main/tests',
      open: JSON.stringify('https://github.com/wakamiya0315/chrome-atom-viewer/blob/main/tests/water.pdb') },
  ];
  for (const sc of scenarios) {
    const { targetId } = await send('Target.createTarget', { url: sc.page });
    const s = await attach(targetId);
    await send('Page.enable', {}, s);
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false }, s);
    await sleep(5000);
    const res = await evaluate(swSession, `(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.startsWith(${JSON.stringify(sc.page)}));
      if (!tab) return "tab not found: " + JSON.stringify(tabs.map(t => ({id: t.id, url: t.url, pending: t.pendingUrl, title: t.title}))) + " perms=" + JSON.stringify(await chrome.permissions.getAll());
      await openPanel(tab, { url: ${sc.open} });
      return 'opened on ' + tab.url;
    })()`);
    console.log(`\n[${sc.name}]`, res);
    await sleep(4000);
    console.log('  panel in page:', await evaluate(s, `!!document.querySelector('atom-viewer-panel')`));
    const frameT = (await targets()).find((t) => t.type === 'iframe' && t.url.startsWith('chrome-extension://') && t.url.includes('viewer.html'));
    if (frameT) {
      const fs = await attach(frameT.targetId);
      const info = await evaluate(fs, `({ name: document.getElementById('name').textContent, meta: document.getElementById('meta').textContent,
        legend: [...document.querySelectorAll('#legend .chip')].map(c => c.textContent).join(' '),
        status: document.getElementById('status').textContent.slice(0, 300) })`);
      console.log('  viewer:', JSON.stringify(info));
      if (sc.name === 'blob-page') {
        await evaluate(fs, `document.getElementById('btn-dock').click()`);
        await sleep(500);
        console.log('  after dock click:', await evaluate(s, `(() => { const h = document.querySelector('atom-viewer-panel').style; return h.width + ' x ' + h.height + ' bottom=' + h.bottom; })()`));
        const shot2 = await send('Page.captureScreenshot', { format: 'png' }, s);
        writeFileSync(join(OUT, 'e2e-dock-bottom.png'), Buffer.from(shot2.data, 'base64'));
        await evaluate(fs, `document.getElementById('btn-dock').click()`);
        await sleep(300);
        await evaluate(fs, `document.getElementById('btn-close').click()`);
        await sleep(500);
        console.log('  panel after close:', await evaluate(s, `!!document.querySelector('atom-viewer-panel')`));
        // selection: select an XYZ block typed into the page, then open via the selection path
        await evaluate(s, `(() => { const pre = document.createElement('pre'); pre.id = 'svsel'; pre.textContent = '3\\nwater\\nO 0 0 0\\nH 0.96 0 0\\nH -0.24 0.93 0\\n'; document.body.prepend(pre);
          const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return getSelection().toString().length; })()`);
        await evaluate(swSession, `(async () => { const [tab] = (await chrome.tabs.query({})).filter(t => t.url && t.url.startsWith(${JSON.stringify(sc.page)})); await openPanel(tab, { selection: true }); })()`);
        await sleep(2500);
        const ft2 = (await targets()).find((t) => t.type === 'iframe' && t.url.includes('viewer.html'));
        const fs2 = await attach(ft2.targetId);
        console.log('  selection viewer:', await evaluate(fs2, `document.getElementById('name').textContent + ' | ' + document.getElementById('meta').textContent + ' | ' + document.getElementById('status').textContent`));
      }
      await send('Target.detachFromTarget', { sessionId: fs }).catch(() => {});
    } else {
      console.log('  viewer iframe target not found');
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
    writeFileSync(join(OUT, `e2e-${sc.name}.png`), Buffer.from(shot.data, 'base64'));
    await send('Target.closeTarget', { targetId });
  }

  // ---- PNG button inside the docked iframe, then extension reload with the tab left open
  {
    const page = 'https://github.com/wakamiya0315/chrome-atom-viewer/blob/main/tests/rutile.cif';
    const dl = mkdtempSync(join(tmpdir(), 'sv-dl-'));
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
    const { targetId } = await send('Target.createTarget', { url: page });
    const s = await attach(targetId);
    await sleep(5000);
    await evaluate(swSession, `(async () => { const tab = (await chrome.tabs.query({})).find(t => t.url && t.url.startsWith(${JSON.stringify(page)})); await openPanel(tab, { url: tab.url }); return tab.id; })()`);
    await sleep(3000);
    let ft = (await targets()).find((t) => t.type === 'iframe' && t.url.includes('viewer.html'));
    let fsn = await attach(ft.targetId);
    await evaluate(fsn, `document.getElementById('btn-shot').click()`);
    await sleep(2500);
    const { readdirSync } = await import('node:fs');
    console.log('\n[png] downloaded files:', readdirSync(dl).join(', ') || '(none)');
    // reload the extension; the page (with the old panel and old content script) stays open
    const re = await send('Extensions.loadUnpacked', { path: EXT });
    console.log('[reload] reloaded extension id', re.id);
    let newSw = null;
    for (let tries = 0; tries < 20 && !newSw; tries++) {
      await sleep(500);
      for (const t of (await targets()).filter((t) => t.type === 'service_worker' && t.url.includes(re.id))) {
        const sid = await attach(t.targetId).catch(() => null);
        if (sid && (await evaluate(sid, `chrome.runtime.getManifest().name`).catch(() => null)) === 'Atom Viewer') { newSw = sid; break; }
      }
    }
    console.log('[reload] new service worker attached:', !!newSw);
    const r = await evaluate(newSw, `(async () => { try { const tab = (await chrome.tabs.query({})).find(t => t.url && t.url.startsWith(${JSON.stringify(page)}));
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'sv:open', url: tab.url }); return 'sent ok'; } catch (e) { return 'ERROR ' + e.message; } })()`);
    console.log('[reload] open after reload:', r);
    await sleep(3000);
    ft = (await targets()).filter((t) => t.type === 'iframe' && t.url.includes('viewer.html'));
    console.log('[reload] viewer iframes:', ft.length);
    for (const t of ft) {
      const sid = await attach(t.targetId);
      console.log('   ', await evaluate(sid, `document.getElementById('meta').textContent + ' | ' + document.getElementById('status').textContent`).catch((e) => 'eval error ' + e.message));
    }
    console.log('[reload] panels in page:', await evaluate(s, `document.querySelectorAll('atom-viewer-panel').length`));
    rmSync(dl, { recursive: true, force: true });
  }
} catch (e) {
  console.error('E2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
  await sleep(800);
  rmSync(profile, { recursive: true, force: true });
  rmSync(EXT, { recursive: true, force: true });
}
