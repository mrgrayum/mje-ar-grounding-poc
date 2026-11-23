# MJE AR Grounding POC

Proof of concept: **temporary protective grounding in AR and 3D**, built on the MJE 3D and AR model library. A student views a utility structure, taps a conductor phase to place a ground clamp, taps a second point to place the other clamp, and a sagging ground cable is drawn between them. Every placement is recorded so the session can be exported as a JSON record.

Training visuals only. Nothing here is engineering data, and no structural or loading calculations are made.

- **Live site (GitHub Pages):** https://mrgrayum.github.io/mje-ar-grounding-poc/
- **Original library (untouched):** https://mrgrayum.github.io/mje-ar/
- **Demo content only.** This repository is public. Do not add real customer or equipment models.

## How the site is built

It is plain static files: no server, no database, no accounts.

| Path | What it is |
|---|---|
| `index.html`, `view.html`, `ar.html` | Library page, 3D model page (`view.html?m=<name>`), AR model page (`ar.html?m=<name>`) |
| `viewer.js`, `ar.js`, `library.js` | The three bundles. **Built from `src/`. Do not edit by hand.** |
| `library.json`, `models/<name>/` | Catalog, and per model: `model.glb`, `markers.json`, `preview.jpg` |
| `external/` | Niantic Spatial XR Engine and XRExtras, **copied unmodified** (license requirement). Never edit. |
| `src/` | Source of the web bundles (3D stage, markers, tour, AR page, library page) |
| `build-web.mjs` | Rebuilds the bundles. `npm run build` writes them; `node build-web.mjs --check` compares a fresh build with the files on disk |
| `serve.mjs` | Small local web server for desktop testing: `npm run serve`, then open http://localhost:8080/ |

To work on it: install Node 22 or newer, run `npm install`, edit `src/`, run `npm run build`, test, commit.

Rules for this project:

1. Grounding code lives in our own Three.js layer (`src/`), never inside engine files. If the engine license is ever withdrawn, 3D mode and grounding must still work.
2. The engine files in `external/` stay byte-for-byte as received.
3. No backend. Records are downloaded as a JSON file.
4. Page pinch-zoom stays blocked; pinch affects the 3D model only.

### Warning about the MJE AR Windows app

The Windows authoring app's **Publish to library** rewrites `viewer.js`, `ar.js`, `library.js` and the HTML pages with its own (older) copies. Once grounding code is added, publishing from the app into this folder would overwrite it. Until that is solved, publish models from the app only into a scratch folder and copy just `models/<name>/` and the `library.json` entry here.

## Progress log

| Stage | Date | What changed | Verified by the project owner |
|---|---|---|---|
| 0. New repo and verified baseline | 2026-11-23 | Repository created from the live library `mje-ar` at commit `bedfd17`. Copy matches the original file for file (54 files, same hashes). Added the web source (`src/`), `build-web.mjs` (rebuilt bundles are byte-identical to the published ones), `serve.mjs`, this README. No behaviour changes. | Pending |
| 1. Test structure with named parts | | | |
| 2. Ground mode in the 3D viewer | | | |
| 3. Session record: save, export, reload | | | |
| 4. Ground mode in AR (iPhone) | | | |
| 5. Minimal recipe builder | | | |
