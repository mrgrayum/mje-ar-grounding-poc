MJE 3D & AR model library - made with MJE AR

Host this whole folder on any HTTPS web server (GitHub Pages, an intranet server, etc.).
index.html is the library. view.html?m=<name> opens one model in 3D, ar.html?m=<name> in AR on a phone.
models/<name>/ holds each model (model.glb), its markers (markers.json) and its preview picture.
library.json is the catalog the library page reads. external/ holds the Niantic Spatial XR Engine and XRExtras; do not modify.
