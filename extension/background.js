// Atom Viewer — service worker
// Registers the right-click menu items and injects the panel (content.js) into the tab on demand.

const EXTENSIONS = ['xyz', 'extxyz', 'exyz', 'pdb', 'ent', 'cif', 'mcif', 'mmcif', 'vasp', 'poscar', 'contcar', 'xsf', 'mol', 'sdf'];
const VASP_NAMES = ['POSCAR', 'CONTCAR', 'XDATCAR'];

function urlPatterns() {
  const out = [];
  for (const ext of EXTENSIONS) {
    for (const e of new Set([ext, ext.toUpperCase()])) {
      for (const gz of ['', '.gz']) {
        out.push(`*://*/*.${e}${gz}`, `*://*/*.${e}${gz}?*`, `*://*/*.${e}${gz}#*`);
      }
    }
  }
  for (const name of VASP_NAMES) out.push(`*://*/*${name}*`);
  return out;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const patterns = urlPatterns();
    chrome.contextMenus.create({
      id: 'sv-link',
      title: 'View linked file in Atom Viewer',
      contexts: ['link'],
      targetUrlPatterns: patterns,
    });
    chrome.contextMenus.create({
      id: 'sv-page',
      title: 'View in Atom Viewer',
      contexts: ['page', 'frame', 'editable'],
      documentUrlPatterns: patterns,
    });
    chrome.contextMenus.create({
      id: 'sv-selection',
      title: 'View selected text in Atom Viewer',
      contexts: ['selection'],
    });
  });
});

async function openPanel(tab, request) {
  if (!tab || tab.id === undefined || tab.id < 0) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'sv:open', ...request });
  } catch (err) {
    // chrome://, the Web Store and some built-in pages cannot be scripted.
    console.warn('Atom Viewer: cannot open the panel on this page:', err);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sv-link') openPanel(tab, { url: info.linkUrl });
  else if (info.menuItemId === 'sv-page') openPanel(tab, { url: info.frameUrl || info.pageUrl });
  else if (info.menuItemId === 'sv-selection') openPanel(tab, { selection: true });
});

// Toolbar button and Alt+Shift+V: try the current page whatever its URL looks like.
chrome.action.onClicked.addListener((tab) => openPanel(tab, { url: tab.url }));

// Fallback fetch for content.js. The extension has no standing host permissions; this works
// for the tab's own origin (granted temporarily by activeTab when the user invokes the
// extension) and for hosts that allow CORS.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'sv:bgfetch' || sender.id !== chrome.runtime.id || !sender.tab) return;
  (async () => {
    try {
      const res = await fetch(msg.url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      }
      sendResponse({ ok: true, b64: btoa(bin), contentType: res.headers.get('content-type') || '' });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});
