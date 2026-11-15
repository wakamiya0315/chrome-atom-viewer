# Privacy Policy — Atom Viewer

_Last updated: 2026-11-15_

Atom Viewer is a Chrome extension that displays atomic structure files (such as `.xyz`, `.extxyz`, `.pdb`, `.cif` and `POSCAR`) in a 3D viewer on the page you are looking at.

## Summary

Atom Viewer does **not** collect, store on any server, sell, or share any personal or sensitive data. It has no analytics, no tracking, no advertising and no account. It does not send anything to the developer or to any third party.

## What the extension accesses, and why

- **The structure file you ask it to show.** When you choose *View in Atom Viewer* (from the right-click menu, the toolbar button or the keyboard shortcut), the extension downloads that one file from the address you chose, using your browser's existing session for that site (so files in private GitHub repositories you can already see will work). It does the same with text you have selected when you choose *View selected text in Atom Viewer*. The file is parsed and drawn entirely inside your browser and is discarded when you close the panel or the tab.
- **The current page, only when you invoke the extension.** The extension adds its viewer panel to the tab you invoked it on, using Chrome's `activeTab` permission. It does not read or change pages you have not invoked it on, and it does not run in the background on the sites you visit.
- **Local settings.** Your display preferences (such as atom size, background colour and panel position) are saved with `chrome.storage.local` on your own device. They are never transmitted.

## Data sharing

None. No data leaves your device except the request to download the structure file you selected, which goes directly from your browser to the website that hosts that file.

## Remote code

The extension contains all of its code. It does not load or execute code from the internet.

## Changes

If this policy changes, the new version will be published at this address with an updated date.

## Contact

Questions or issues: <https://github.com/wakamiya0315/chrome-atom-viewer/issues>
