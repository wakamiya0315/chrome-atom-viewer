# Chrome Web Store listing — Atom Viewer

Item ID: `ldbcmecdchmhcjgboaagbiofojnjemhn` · Store page (after approval): https://chromewebstore.google.com/detail/ldbcmecdchmhcjgboaagbiofojnjemhn

Text and answers used in the Chrome Web Store developer dashboard. Images are in this folder; regenerate them with `node tools/store_assets.mjs`. Build the upload with `tools/package.sh`.

## Store listing

**Name:** Atom Viewer (from the manifest)

**Summary** (from the manifest `description`, ≤132 characters):

> View .xyz, .extxyz, .pdb, .cif and POSCAR files from GitHub or any web page as 3D atomic structures, right in the page.

**Category:** Developer Tools

**Language:** English

**Description:**

> **2026-11-15:** the first submission was rejected for "keyword spam" (Yellow Argon). The reviewer flagged the bulleted list of file formats in the description, so the description now names the formats once, in prose. Avoid keyword-style lists of formats or extensions in store text.


```
Atom Viewer lets you look at atomic structure files in 3D directly on GitHub and other web pages, without downloading them. Right-click a file page or a link to a file, choose "View in Atom Viewer", and an interactive viewer opens in a panel on the right or at the bottom of the page.

It is made for computational chemistry and materials science and reads the structure formats common in those fields, such as extended XYZ, VASP structure files, CIF and PDB, including trajectories and gzip-compressed files.

It also works with private repositories: the file is fetched with your existing browser session for that site, so files in private GitHub repositories that you can already open will work.

In the viewer you can:
• rotate, zoom and pan, in orthographic or perspective projection, or look along each lattice vector
• click atoms to measure distances, angles and dihedrals, and hover to see coordinates and per-atom properties
• show bonds, the unit cell and supercells, and wrap atoms into the cell
• play back trajectories frame by frame
• hide or show individual elements
• save the current view as a PNG with a transparent background
• dock the panel on the right or at the bottom, resize it, or switch to full screen

You can open the viewer from the right-click menu on a page, a link or selected text, from the toolbar button, or with Alt+Shift+V.

Privacy: the file you choose is read and drawn inside your browser and is never sent to the developer or anyone else. There are no analytics and no remote code, and the extension only acts on the tab where you use it.

Open source (MIT): https://github.com/wakamiya0315/chrome-atom-viewer
```

**Images:**

| Field | File |
|---|---|
| Store icon (128×128) | `extension/icons/icon128.png` |
| Screenshots (1280×800) | `screenshot-1-right-panel.png`, `screenshot-2-measure.png`, `screenshot-3-trajectory.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |

**Homepage URL:** https://github.com/wakamiya0315/chrome-atom-viewer
**Support URL:** https://github.com/wakamiya0315/chrome-atom-viewer/issues

## Privacy practices

**Single purpose:**

> Display atomic structure files (such as .xyz, .extxyz, .pdb, .cif and POSCAR) that the user selects on a web page as an interactive 3D model in a panel on that page.

**Permission justifications:**

- **activeTab:** Gives temporary access to the tab where the user chooses "View in Atom Viewer" (context menu, toolbar button or keyboard shortcut), so the extension can add its viewer panel to that page and read the structure file the user selected. No access to other tabs or to pages the user has not invoked it on.
- **scripting:** Injects the viewer panel (content script) into the active tab, only after the user invokes the extension.
- **contextMenus:** Adds the "View in Atom Viewer", "View linked file in Atom Viewer" and "View selected text in Atom Viewer" items to the right-click menu.
- **storage:** Saves the user's display preferences (atom size, background, panel position and size) locally with chrome.storage.local.

**Remote code:** No, I am not using remote code. All JavaScript, including three.js, is packaged in the extension.

**Data usage:** Tick only **Website content**. Google's user-data FAQ asks for disclosure even when data is only processed locally, and the extension reads the structure file or selected text that the user asks it to show. It is processed in the browser and never transmitted. Tick all three certifications (no selling or transfer, no unrelated use, no creditworthiness or lending use).

**Privacy policy URL:** https://github.com/wakamiya0315/chrome-atom-viewer/blob/main/PRIVACY.md

## Distribution

- **Payment:** Free (no in-app purchases)
- **Visibility:** Public
- **Regions:** All regions

## Test instructions

- **Username / password:** leave empty (no account needed)
- **Additional instructions:**

```
No account or login is needed.
1. Open https://github.com/wakamiya0315/chrome-atom-viewer/blob/main/tests/rutile.cif
2. Right-click on the page and choose "View in Atom Viewer". A 3D viewer opens on the right.
3. Open https://github.com/wakamiya0315/chrome-atom-viewer/tree/main/tests/samples, right-click the md_au_pt111.extxyz link and choose "View linked file in Atom Viewer" to see a trajectory.
The toolbar button or Alt+Shift+V also opens the current page.
```
