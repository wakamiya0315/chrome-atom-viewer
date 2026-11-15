// Atom Viewer — content script (injected on demand by background.js).
// Draws a docked panel (right or bottom) that hosts viewer/viewer.html in an iframe,
// fetches the structure file with the page's own session (so private GitHub repos work)
// and hands the bytes to the viewer.
(() => {
  if (globalThis.__structureViewerLoaded) return;
  globalThis.__structureViewerLoaded = true;
  // A panel left behind by a previous version of the extension (before an update/reload)
  // belongs to a dead content-script world: remove it so panels never stack.
  document.querySelectorAll('atom-viewer-panel').forEach((el) => el.remove());

  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');
  const prefs = { dock: 'right', right: 42, bottom: 45 }; // sizes in vw / vh
  const prefsLoaded = chrome.storage.local
    .get('svPanel')
    .then((r) => Object.assign(prefs, r.svPanel || {}))
    .catch(() => {});

  let host = null;
  let grip = null;
  let frame = null;
  let shield = null;
  let frameReady = false;
  let queue = [];
  let fullscreen = false;

  const savePrefs = () =>
    chrome.storage.local.set({ svPanel: { dock: prefs.dock, right: prefs.right, bottom: prefs.bottom } }).catch(() => {});

  // ---------- panel ----------
  // Styles go through the CSSOM (element.style) rather than <style> or innerHTML,
  // which a strict page CSP / Trusted Types policy could block.
  function ensurePanel() {
    if (host && host.isConnected) return;
    host = document.createElement('atom-viewer-panel');
    const root = host.attachShadow({ mode: 'closed' });

    frame = document.createElement('iframe');
    frame.src = `${VIEWER_URL}#origin=${encodeURIComponent(location.origin)}`;
    frame.allow = 'clipboard-write; fullscreen';
    frame.title = 'Atom Viewer';
    Object.assign(frame.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      border: '0', margin: '0', padding: '0', background: '#16181d', display: 'block',
    });

    shield = document.createElement('div');
    Object.assign(shield.style, { position: 'absolute', inset: '0', display: 'none', zIndex: '2' });

    grip = document.createElement('div');
    grip.title = 'Drag to resize';
    Object.assign(grip.style, { position: 'absolute', zIndex: '3', background: 'transparent' });
    grip.addEventListener('pointerdown', startResize);
    grip.addEventListener('mouseenter', () => (grip.style.background = 'rgba(80,140,255,.55)'));
    grip.addEventListener('mouseleave', () => (grip.style.background = 'transparent'));

    root.append(frame, shield, grip);
    frameReady = false;
    document.documentElement.appendChild(host);
    layout();
  }

  function layout() {
    if (!host) return;
    const hs = host.style;
    const reset = { all: 'initial', position: 'fixed', zIndex: '2147483647', display: 'block',
      top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
      boxShadow: '0 0 24px rgba(0,0,0,.35)', background: '#16181d' };
    Object.assign(hs, reset);
    const gs = grip.style;
    Object.assign(gs, { top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', width: 'auto', height: 'auto' });
    if (fullscreen) {
      Object.assign(hs, { top: '0', left: '0', width: '100vw', height: '100vh' });
      gs.display = 'none';
    } else if (prefs.dock === 'bottom') {
      Object.assign(hs, { left: '0', bottom: '0', width: '100vw', height: `${prefs.bottom}vh` });
      Object.assign(gs, { display: 'block', left: '0', right: '0', top: '-3px', height: '7px', cursor: 'ns-resize' });
    } else {
      Object.assign(hs, { top: '0', right: '0', width: `${prefs.right}vw`, height: '100vh' });
      Object.assign(gs, { display: 'block', top: '0', bottom: '0', left: '-3px', width: '7px', cursor: 'ew-resize' });
    }
  }

  function startResize(ev) {
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    shield.style.display = 'block';
    const move = (e) => {
      if (prefs.dock === 'bottom') {
        prefs.bottom = clamp(((innerHeight - e.clientY) / innerHeight) * 100, 15, 95);
      } else {
        prefs.right = clamp(((innerWidth - e.clientX) / innerWidth) * 100, 15, 95);
      }
      layout();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      shield.style.display = 'none';
      savePrefs();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  function closePanel() {
    host?.remove();
    host = frame = grip = shield = null;
    frameReady = false;
    queue = [];
    fullscreen = false;
  }

  function post(msg, transfer = []) {
    if (frameReady && frame?.contentWindow) frame.contentWindow.postMessage(msg, EXT_ORIGIN, transfer);
    else queue.push([msg, transfer]);
  }

  function panelState() {
    return { type: 'sv:state', dock: prefs.dock, fullscreen };
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN || !frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.type === 'sv:ready') {
      frameReady = true;
      post(panelState());
      const q = queue;
      queue = [];
      for (const [msg, transfer] of q) post(msg, transfer);
    } else if (m.type === 'sv:close') {
      closePanel();
    } else if (m.type === 'sv:dock') {
      prefs.dock = m.dock === 'bottom' ? 'bottom' : 'right';
      fullscreen = false;
      layout();
      savePrefs();
      post(panelState());
    } else if (m.type === 'sv:fullscreen') {
      fullscreen = !fullscreen;
      layout();
      post(panelState());
    }
  });

  // ---------- fetching ----------
  function fileNameFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const last = u.pathname.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(last) || u.hostname || 'structure';
    } catch {
      return 'structure';
    }
  }

  // Candidate URLs that return the raw file, most likely first.
  function candidates(url) {
    const out = [];
    let u;
    try {
      u = new URL(url, location.href);
    } catch {
      return [url];
    }
    u.hash = '';
    if (u.hostname === 'github.com') {
      u.searchParams.delete('plain');
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|blame)\/(.+)$/);
      // github.com/<o>/<r>/raw/<ref>/<path> is same-origin on github.com and carries the
      // session cookie, then redirects to a tokenised raw URL for private repos.
      if (m) out.push(`https://github.com/${m[1]}/${m[2]}/raw/${m[3]}${u.search}`);
    }
    if (u.hostname === 'raw.githubusercontent.com') {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(.+)$/);
      out.push(u.href);
      if (m) out.push(`https://github.com/${m[1]}/${m[2]}/raw/${m[3]}`);
    }
    if (u.pathname.includes('/-/blob/')) out.push(u.href.replace('/-/blob/', '/-/raw/')); // GitLab
    if (u.hostname === 'huggingface.co' && u.pathname.includes('/blob/')) out.push(u.href.replace('/blob/', '/resolve/'));
    if (u.hostname === 'bitbucket.org' && u.pathname.includes('/src/')) out.push(u.href.replace('/src/', '/raw/'));
    out.push(u.href);
    return [...new Set(out)];
  }

  const decoder = new TextDecoder();
  function sniff(buffer) {
    const head = decoder.decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512))).trimStart();
    if (/^<!doctype html|^<html|^<head|^<body/i.test(head)) return 'html';
    if (head.startsWith('version https://git-lfs.github.com/spec/')) return 'lfs';
    return 'ok';
  }

  function shortUrl(u) {
    try {
      const x = new URL(u);
      return x.host + x.pathname;
    } catch {
      return u;
    }
  }

  function base64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  // The GitHub blob page embeds small files in its React payload: last resort.
  function githubEmbedded(url) {
    try {
      const target = new URL(url, location.href);
      if (target.origin !== location.origin || target.pathname !== location.pathname) return null;
      const el = document.querySelector('script[data-target="react-app.embeddedData"]');
      const lines = el && JSON.parse(el.textContent)?.payload?.blob?.rawLines;
      return Array.isArray(lines) && lines.length ? lines.join('\n') + '\n' : null;
    } catch {
      return null;
    }
  }

  async function fetchStructure(url) {
    const errors = [];
    const urls = candidates(url);
    const accept = (buffer, from) => {
      const kind = sniff(buffer);
      if (kind === 'ok') return true;
      errors.push(`${shortUrl(from)}: ${kind === 'lfs' ? 'Git LFS pointer file' : 'HTML page, not the raw file'}`);
      return false;
    };
    // 1) from the page itself (page origin + cookies)
    for (const c of urls) {
      try {
        const res = await fetch(c);
        if (!res.ok) {
          errors.push(`${shortUrl(c)}: HTTP ${res.status}`);
          continue;
        }
        const buffer = await res.arrayBuffer();
        if (accept(buffer, c)) return buffer;
      } catch (e) {
        errors.push(`${shortUrl(c)}: ${e.message || e}`);
      }
    }
    // 2) from the extension's service worker (activeTab origin)
    for (const c of urls) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'sv:bgfetch', url: c });
        if (r?.ok) {
          const buffer = base64ToBuffer(r.b64);
          if (accept(buffer, c)) return buffer;
        } else {
          errors.push(`${shortUrl(c)} (extension): ${r?.error || 'failed'}`);
        }
      } catch (e) {
        errors.push(`${shortUrl(c)} (extension): ${e.message || e}`);
      }
    }
    // 3) GitHub page payload
    const text = githubEmbedded(url);
    if (text) return new TextEncoder().encode(text).buffer;
    throw new Error(`Could not fetch the file.\n${[...new Set(errors)].join('\n')}`);
  }

  function selectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.selectionStart === 'number') {
      const t = el.value.slice(el.selectionStart, el.selectionEnd);
      if (t.trim()) return t;
    }
    return String(window.getSelection() || '');
  }

  async function open(req) {
    await prefsLoaded;
    ensurePanel();
    if (req.selection) {
      const text = selectedText();
      if (!text.trim()) {
        post({ type: 'sv:error', name: 'selection', message: 'No text is selected.' });
        return;
      }
      const buffer = new TextEncoder().encode(text).buffer;
      post({ type: 'sv:load', name: 'selection', source: location.href, buffer }, [buffer]);
      return;
    }
    const url = req.url || location.href;
    const name = fileNameFromUrl(url);
    post({ type: 'sv:loading', name, source: url });
    try {
      const buffer = await fetchStructure(url);
      post({ type: 'sv:load', name, source: url, buffer }, [buffer]);
    } catch (e) {
      post({ type: 'sv:error', name, source: url, message: String(e.message || e) });
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'sv:open') open(msg);
  });

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }
})();
