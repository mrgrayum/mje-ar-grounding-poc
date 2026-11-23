// Entry point of the exported viewer: shows a 3D model with tappable markers and a guided tour.
import {createStage, MarkerTour, injectStyles, glbInfo, needsDraco, isPhoneOrTablet, lockZoom} from './core.js'
import {createTourUI} from './tour-ui.js'
import {createSplash} from './splash.js'
import {libContext, addLibraryChrome} from './libchrome.js'
import {createGrounding, createGroundUI} from './grounding.js'

const b64ToBuffer = (b64) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

const fetchBuffer = async (url, onProgress) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress(got / total)
  }
  const out = new Uint8Array(got)
  let off = 0
  chunks.forEach((c) => { out.set(c, off); off += c.length })
  return out.buffer
}

async function main() {
  lockZoom()
  injectStyles()
  const root = document.getElementById('app')
  root.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#000'
  // Brand details are inlined in the page (hosted) or in the data blob (single file) so the splash
  // can show the title and logo from the very first paint.
  const brand = window.__MJE_BRAND__ || window.__VIEWER_DATA__ || {}
  const splash = createSplash(document.body, {title: brand.title, logo: brand.logo})
  splash.setStatus('Loading…')
  const lib = window.__VIEWER_DATA__ ? null : libContext() // opened from the model library (?m=<name>)
  const base = lib ? lib.base : ''

  try {
    const res = window.__VIEWER_DATA__ ? null : await fetch(`${base}markers.json`)
    if (res && !res.ok) throw new Error(lib ? 'That model is not in the library.' : `Could not load markers.json (HTTP ${res.status})`)
    const data = window.__VIEWER_DATA__ || await res.json()
    document.title = data.title || 'Model viewer'
    splash.setTitle(data.title || '')
    splash.setStatus('Loading model…')
    splash.setProgress(null)
    const buffer = window.__MODEL_B64__
      ? b64ToBuffer(window.__MODEL_B64__)
      : await fetchBuffer(`${base}${data.model || 'model.glb'}`, (p) => {
        splash.setProgress(p)
        splash.setStatus(`Loading model… ${Math.round(p * 100)}%`)
      })
    window.__MODEL_B64__ = null
    splash.setStatus('Preparing…')
    splash.setProgress(null)

    const stage = createStage(root, {dracoPath: 'draco/'})
    if (needsDraco(glbInfo(buffer)) && window.__VIEWER_DATA__ && !window.__DRACO_OK__) {
      // Single-file exports can't carry the Draco decoder; the author prevents this, but fail clearly.
      throw new Error('This model uses Draco compression and needs the hosted-folder viewer.')
    }
    await stage.loadModel(buffer)

    const tour = new MarkerTour(stage, root)
    tour.motionLabels = data.labels || {}
    tour.setMarkers((data.markers || []).filter(m => Array.isArray(m.position) && m.position.length === 3))
    createTourUI(root, tour, {title: lib ? '' : (data.title || '')})
    tour.attachPicking(root)
    if (lib) addLibraryChrome(root, lib, {title: data.title || '', page: '3d', canAR: data.mode === 'ar'})
    // Ground mode (temporary protective grounding): only for models flagged "grounding": true in markers.json
    // (or with ?ground=1 added to the address for testing), and not in embedded frames.
    if ((data.grounding === true || new URLSearchParams(location.search).get('ground') === '1') && !(lib && lib.embed)) {
      const grounding = createGrounding(stage)
      grounding.attach(root)
      createGroundUI(root, grounding, {tour, shiftForLibraryBar: !!lib && data.mode === 'ar'})
      window.__ground = grounding // handy for debugging and tests
    }
    if (!window.__VIEWER_DATA__ && !lib) {
      // Hosted folder: link the credits page that ships alongside.
      const credits = document.createElement('a')
      credits.href = 'licenses.html'
      credits.textContent = 'Credits'
      credits.style.cssText = 'position:absolute;left:10px;bottom:calc(6px + env(safe-area-inset-bottom));'
        + 'font:11px system-ui,sans-serif;color:#44505f;z-index:10'
      root.appendChild(credits)
    }
    splash.hide()
    // AR projects: a visible switch back to the camera view (phones and tablets only).
    if (data.mode === 'ar' && !window.__VIEWER_DATA__ && !lib && isPhoneOrTablet()) {
      const btn = document.createElement('button')
      btn.className = 'mk-switch'
      btn.type = 'button'
      btn.textContent = 'AR view'
      btn.style.cssText = 'right:14px;top:calc(64px + env(safe-area-inset-top))'
      btn.addEventListener('pointerdown', e => e.stopPropagation())
      btn.addEventListener('pointerup', e => e.stopPropagation())
      btn.addEventListener('click', () => { location.href = 'index.html' })
      root.appendChild(btn)
    }
    const qs = new URLSearchParams(location.search)
    if (qs.get('from') === 'ar') {
      // The AR page sent us here because it did not think this device was a phone or tablet.
      const note = document.createElement('div')
      note.style.cssText = `position:absolute;left:12px;right:12px;top:calc(${lib ? 116 : 60}px + env(safe-area-inset-top));`
        + 'z-index:30;background:#000;color:#fff;border-left:5px solid #FFEF00;padding:10px 12px;'
        + 'font:13px/1.4 system-ui,sans-serif;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35)'
      note.innerHTML = '<b>3D view.</b> AR needs a phone or tablet camera. '
        + '<span style="opacity:.7;font-size:11px;display:block;margin-top:4px;word-break:break-all"></span>'
      note.lastChild.textContent = lib ? '' : (qs.get('why') || '') // the technical detail is only for stand-alone folders
      note.addEventListener('click', () => note.remove())
      root.appendChild(note)
      setTimeout(() => note.remove(), 20000)
    }
    window.__viewer = {stage, tour} // handy for debugging and tests
  } catch (err) {
    const file = location.protocol === 'file:'
    splash.error(
      file && !window.__VIEWER_DATA__
        ? 'This folder must be served from a web server (it cannot load files straight from disk). '
          + 'Use the single-file export for double-click viewing.'
        : `Could not open this viewer: ${String(err && err.message ? err.message : err)}`
    )
  }
}

main()
