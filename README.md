# MJE 3D & AR model library

Proof-of-concept model library for M. J. Electric, LLC, made with MJE AR. Static files only: host this folder on any HTTPS web server.

- `index.html` is the library (search, filters, preview pictures).
- `view.html?m=<name>` opens a model in 3D; `ar.html?m=<name>` opens it in AR on a phone.
- `view.html?m=<name>&embed=1` is the embeddable version for other websites.
- `models/<name>/` holds each model (`model.glb`, `markers.json`, `preview.jpg`); `library.json` is the catalog.
- `external/` holds the Niantic Spatial XR Engine and XRExtras, unmodified. See `licenses.html`.

Demo models only. Do not add real customer or equipment models to this public repository.
