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

## The test structure (Stage 1)

`tools/make-structure.mjs` generates a wood pole with a crossarm, three pin insulators, three conductors, a ground lead and a ground point. Re-run it (`node tools/make-structure.mjs`) after changing the numbers in `DESIGN` at the top of the file. Units are meters, Y is up, the power line runs along Z, the crossarm along X, the ground lead is on the +Z face of the pole. Phase B is carried on the pole top, A and C on the crossarm ends. Conductors (8 cm) and the ground lead (6 cm) are deliberately **exaggerated in thickness** so they can be tapped when the pole is shown about 2 m tall in AR. This is a training visual, not engineering data.

Required part (node) names, which the grounding code will rely on: `Pole`, `Crossarm1`, `InsulatorA`, `InsulatorB`, `InsulatorC`, `PhaseA_Conductor`, `PhaseB_Conductor`, `PhaseC_Conductor`, `GroundLead`, `GroundPoint`. Every part must have real geometry (see below). The three phases are the same color on purpose: students must identify them.

Tools: `node tools/check-nodes.mjs <file.glb>` lists the parts of any model; `node tools/optimize-check.mjs <file.glb>` runs the same steps as the app's "Optimize for phones" and compares every part before and after.

### Stage 1 findings: what the optimizer does to named parts

Tested on the generated structure, with optimization forced on (the app normally skips a file that would shrink by less than 3 percent; this one shrinks about 78 percent, so the real publish flow does optimize it).

1. **Names survive.** All 10 named parts are present, with the same hierarchy, after optimization. Identical shapes (for example the three insulators) are shared internally, but each keeps its own named part.
2. **Empty parts are deleted.** A part with no geometry (an empty marker node) is removed by the cleanup step. Every part that must survive needs real, visible geometry, which is why `GroundPoint` is a small copper block.
3. **Each part's own coordinate system is rewritten.** The compression stores every part's vertices in a small normalized range and moves the scale and offset into the part's own transform. Example: `Pole` goes from scale 1 to scale 6 and origin height 0 to 6, `PhaseB_Conductor` from scale 1 to 4.007. **Where the part sits in space does not change** (all parts match within 0.2 mm), but a point stored as `{node, local: [x, y, z]}` has different numbers before and after optimization.
4. **Consequence:** a record that stores `local` coordinates is only valid against the exact published `model.glb` it was made on. Re-publishing the model (re-optimizing) could shift stored positions. Options for the record format and the optimizer are written up with the Stage 2 plan.

## Ground mode (Stage 2, 3D viewer)

Available only on models whose `markers.json` has `"grounding": true` (add `?ground=1` to a model address to try it on any model), and not in embedded frames. The **Ground mode** button sits under the 3D / AR switch. While it is on, marker badges and tour arrows are hidden and a panel shows what to do next, the list of grounds, **Undo last** and **Clear all**; each row has a ✕ to delete just that pair.

- **Tap = place.** A tap must move less than 6 px and last under 0.5 s; anything else is a drag (rotate/zoom) and places nothing. Tapping empty space does nothing.
- **First tap** places a pulsing clamp on the part under the finger. **Second tap** places the other clamp and draws a green cable between them. The next tap starts the next pair (G1, G2, G3...).
- **Clamps belong to the part.** Each clamp is a child of the tapped part's node, at the tapped point on its surface, so it moves with that part. Its size is corrected for the part's own scale (see Stage 1 findings).
- **Cable sag.** A parabola with a droop of 10 percent of the span (`SAG_RATIO` in `src/grounding.js`). A mostly level cable droops down; a mostly vertical one (phase to ground lead) bows outward, away from the surfaces it is clamped to, because "down" would only lay it along the pole.
- **Settings** (sag, sizes, colors, tap limits) are in `GROUND_CONFIG` at the top of `src/grounding.js`. Sizes are fractions of the model's radius, so they scale with any model.
## Session record (Stage 3): export, load, refresh protection

Format and code: `src/grounding-record.js`. Session panel fields: **Student name** (required to export) and **Class** (optional).

```json
{ "format": "mje-grounding-record", "version": 1,
  "model": { "slug": "test-pole-structure", "title": "Test Pole Structure", "bytes": 19628, "fingerprint": "c3dc2e6173879dbe" },
  "student": "...", "scenario": "...",
  "sessionStart": "time of the first clamp", "sessionEnd": "time of the export",
  "grounds": [ { "id": "G1",
                 "a": { "node": "PhaseB_Conductor", "local": [x,y,z], "model": [x,y,z], "normal": [x,y,z] },
                 "b": { "node": "GroundLead",       "local": [x,y,z], "model": [x,y,z], "normal": [x,y,z] },
                 "placedAt": "time" } ] }
```

- `node` is the name of the part tapped; `local` is the point in that part's own coordinates; `model` is the same point in the model's overall coordinates; `normal` is which way the surface faced (model coordinates).
- **Why `model` and `normal` are in the file.** Stage 1 showed `local` changes whenever a model is re-optimized. Reloading therefore draws from `model` (stable), attached to the part of that name, and uses `normal` to turn the clamp the right way. `local` stays in the file for the record and for auditing.
- `model.bytes` and `model.fingerprint` (first 16 characters of the model file's SHA-256) identify the exact file. If they differ on loading, the record still loads, with a note that the model was updated. A record for a different model (`slug`) is refused. A record that names a part missing from the model draws the other grounds and says how many it skipped.
- **Export record** downloads `grounding-record_<student>_<yyyymmdd-hhmm>.json`. **Load record** shows a saved file on the model read-only (add, undo, clear, delete and export are off); **Close record** returns to the live session, which is set aside untouched.
- **Refresh protection.** After every change the placed grounds, student name and class are saved in the browser's local storage, one slot per model (`mje-grounding:<slug>`). On page load a saved session is redrawn with a note and **Start fresh** clears everything, including the saved copy. It never clears by itself. It lives only in that browser on that device (not shared, not backed up; lost by private windows or clearing site data). A first clamp that is still waiting for its partner is not saved. While a record is being viewed, nothing is saved.

## Progress log

| Stage | Date | What changed | Verified by the project owner |
|---|---|---|---|
| 0. New repo and verified baseline | 2026-11-23 | Repository created from the live library `mje-ar` at commit `bedfd17`. Copy matches the original file for file (54 files, same hashes). Added the web source (`src/`), `build-web.mjs` (rebuilt bundles are byte-identical to the published ones), `serve.mjs`, this README. No behaviour changes. | 2026-11-23: all four checks passed (library and demo models, 3D page with markers and tour, iPhone AR placement, original site unchanged). |
| 1. Test structure with named parts | 2026-11-23 | Added `tools/make-structure.mjs` (generates the structure), `tools/check-nodes.mjs` (lists the parts in any .glb), `tools/optimize-check.mjs` (tests what the optimizer does to named parts), the generated `tools/generated/test-pole.glb`, and the published model `models/test-pole-structure/` with two sample markers. New dev-only tools: glTF Transform and meshoptimizer (same versions as the MJE AR app). No change to the viewer, AR code or engine. See "Stage 1 findings" below. | 2026-11-23: all four checks passed (structure in library with distinct parts, markers on the correct parts, part listing complete, iPhone AR placement). |
| 2. Ground mode in the 3D viewer | 2026-11-23 | New `src/grounding.js` (shared by the 3D viewer now and the AR page in Stage 4; needs only the camera, the model and a per-frame tick). `src/viewer-main.js` switches it on for models with `"grounding": true` in `markers.json`; `src/core.js` gets a two-line switch (`pickingEnabled`) so marker taps are off in Ground mode. `models/test-pole-structure/markers.json` flagged. See "Ground mode" below. No change to the AR page logic, engine files or other models. | 2026-11-23: all five desktop checks passed (Phase B to ground lead, three grounds with correct names, no accidental clamps, undo/clear/delete, empty-space taps). |
| 3. Session record: save, export, reload | 2026-11-23 | New `src/grounding-record.js` (format, checks, file name, fingerprint, download). `src/grounding.js` gets a session (student, class), saving on the device, restore after refresh, Start fresh, Export record, Load record (read-only) and Close record. `src/viewer-main.js` passes the model's size and fingerprint. Format additions agreed in the plan: model identification and `normal`; reload draws from `model` coordinates. No change to AR logic, engine files, other models or dependencies. | 2026-11-23: all three checks passed (export file contents, clear then load record redraws the same grounds, refresh restores and Start fresh clears). |
| Fix (between stages) | 2026-11-23 | Message card shook while the model was rotated, flown to with the arrows, or coasting to a stop. Cause: the card was positioned before the camera finished moving each frame, so it trailed its marker by one frame (up to 14 px during the arrow fly-to, 6 px during a fast rotation). `src/core.js`: the render loop gets a late step (`stage.onLateTick`) that runs after the camera's final move and before drawing; the card is placed there. While moving, including the slow tail as the model coasts to a stop, the card follows to a fraction of a pixel; it snaps to whole pixels only after it has been completely still for a quarter of a second, so the text stays sharp. Measured over 5 s of coasting: worst card hop 0.39 px (the final settle), against 5.8 px before. Follow-up: after an arrow move the marker sits at the exact middle of the screen, which in a window with an odd width or height puts the card on a half pixel, and floating-point noise flipped the whole-pixel rounding between two values every frame (a 1 px shake that lasted as long as the model kept drifting; tapping a marker directly never hit this). The snapped spot is now sticky (it changes only if the card really moves more than 0.75 px). Tested with the real loop in four window sizes, odd and even: no hops, one steady position over the last 5 s. Measured with the real render loop stepped frame by frame: lag 0.01 px. The AR page keeps its old order (its camera is already final when its code runs). The same fix was applied to the original library (`mrgrayum/mje-ar`, commit c20742f) and the Windows app (build `out-v7`). | 2026-11-23: confirmed smooth by the project owner. |
| 4. Ground mode in AR (iPhone) | | | |
| 5. Minimal recipe builder | | | |
