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

```
Atom Viewer shows atomic structure files from GitHub and other web pages in 3D without downloading them. Right-click a structure file page or a link to one, choose "View in Atom Viewer", and a viewer panel opens on the right or at the bottom of the page.

WORKS WITH PRIVATE REPOSITORIES
The file is fetched with your existing browser session for that site, so files in private GitHub repositories that you can already open will work. Nothing is sent to any outside service.

SUPPORTED FORMATS
• XYZ and extended XYZ (.xyz, .extxyz) — Lattice, Properties, pbc, multiple frames
• VASP: POSCAR, CONTCAR, XDATCAR (.vasp)
• CIF and mmCIF (symmetry operations expanded), PDB
• XSF, MOL/SDF, and gzip-compressed versions of all of the above

VIEWER
• Rotate, zoom and pan; orthographic (default) or perspective projection; views along a, b and c
• Click atoms to measure distances, angles and dihedrals; hover to see coordinates and per-atom extxyz properties (tags, forces, …)
• Bonds from covalent radii, unit cell, wrapping into the cell, and supercells whose cell lines follow the repetition
• Trajectories with a frame slider and playback
• Show or hide elements from the legend
• Save the view as a PNG with a transparent background
• Dock the panel right or bottom, resize it, or go full screen

HOW TO OPEN IT
• Right-click a file page → View in Atom Viewer
• Right-click a link to a structure file → View linked file in Atom Viewer
• Select pasted XYZ/POSCAR text → View selected text in Atom Viewer
• Toolbar button or Alt+Shift+V on the current page

PRIVACY
The structure file you choose is read and drawn inside your browser; nothing is sent to the developer or anyone else. No analytics, no remote code. The extension only acts on the tab where you invoke it (activeTab), and your display settings are stored locally.

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
