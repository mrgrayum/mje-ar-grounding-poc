// Exported AR experience (iPhone/Android camera): place the model on the floor, then tap its markers
// or use the guided-tour arrows. Built on the XR engine's camera pipeline + Three.js.
import * as THREE from 'three'
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js'
import {MarkerTour, ModelAnimator, injectStyles, parseGlb, glbInfo, needsDraco, isPhoneOrTablet, lockZoom} from './core.js'
import {createTourUI} from './tour-ui.js'
import {createSplash} from './splash.js'
import {libContext, addLibraryChrome} from './libchrome.js'
import {createGrounding, createGroundUI} from './grounding.js'
import {fingerprintOf} from './grounding-record.js'
import {createPoseSmoother, createShakeMeter} from './smooth.js'
import {createIntro} from './intro.js'

// The engine's Three.js module reads THREE from the window.
window.THREE = THREE

const params = new URLSearchParams(location.search)
const lib = libContext() // opened from the model library (?m=<name>)
const base = lib ? lib.base : ''

// AR needs a phone/tablet camera and motion sensors. On a desktop browser, show the 3D view instead.
// Only a clear desktop is sent to the 3D view. A phone or iPad that asks sites for the "desktop version"
// reports a Mac user agent but still has a multi-touch screen, so touch counts as a tablet/phone.
if (!isPhoneOrTablet() && !params.get('force') && !window.__AR_TEST__) {
  const ua = navigator.userAgent || ''
  const why = encodeURIComponent(`${ua.slice(0, 110)} | touch=${navigator.maxTouchPoints || 0} | platform=${navigator.platform}`)
  location.replace(lib ? `${lib.viewUrl}&from=ar&why=${why}` : `3d.html?from=ar&why=${why}`)
  throw new Error('Not a phone or tablet: opening the 3D view.')
}

lockZoom()

// ---- optional on-screen console (no Mac = no Safari inspector): add ?debug=1 to the URL ------------
if (params.get('debug')) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:0;right:0;top:0;max-height:34%;overflow:auto;z-index:99999;'
    + 'background:rgba(0,0,0,.78);color:#9f9;font:11px/1.35 monospace;padding:6px;pointer-events:none;white-space:pre-wrap'
  document.body.appendChild(box)
  const add = (kind, args) => {
    box.textContent += `${kind}: ${args.map(a => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`
    box.scrollTop = box.scrollHeight
  }
  ;['log', 'warn', 'error'].forEach((k) => {
    const orig = console[k].bind(console)
    console[k] = (...a) => { orig(...a); add(k, a) }
  })
  window.addEventListener('error', e => add('error', [e.message]))
  window.addEventListener('unhandledrejection', e => add('promise', [e.reason]))
}

// Branded splash from first paint until the camera is running and the model is ready.
const brand = window.__MJE_BRAND__ || {}
const splash = createSplash(document.body, {title: brand.title, logo: brand.logo})
splash.setStatus('Starting AR…')

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

const dataPromise = fetch(`${base}markers.json`).then((r) => {
  if (!r.ok) throw new Error(lib ? 'That model is not in the library.' : `Could not load markers.json (HTTP ${r.status})`)
  return r.json()
})
const modelPromise = dataPromise.then((d) => {
  if (d.title) splash.setTitle(d.title)
  splash.setProgress(null)
  return fetchBuffer(`${base}${d.model || 'model.glb'}`, (p) => {
    splash.setProgress(p)
    splash.setStatus(`Loading model… ${Math.round(p * 100)}%`)
  })
})

const ui = document.createElement('div')
ui.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;overflow:hidden;'
  + 'font-family:system-ui,-apple-system,"Segoe UI",sans-serif'
document.body.appendChild(ui)
injectStyles()

const hint = document.createElement('div')
hint.className = 'mk-hint'
hint.style.cssText = 'position:absolute;left:50%;bottom:calc(104px + env(safe-area-inset-bottom));transform:translateX(-50%);'
  + 'opacity:0;white-space:normal;text-align:center;max-width:calc(100% - 32px)'
ui.appendChild(hint)
let hintTimer = 0
const showHint = (text, ms = 0) => {
  clearTimeout(hintTimer)
  hint.textContent = text
  hint.style.opacity = text ? '1' : '0'
  if (ms) hintTimer = setTimeout(() => { hint.style.opacity = '0' }, ms)
}

const footer = document.createElement('div')
footer.style.cssText = 'position:absolute;left:10px;bottom:calc(6px + env(safe-area-inset-bottom));'
  + 'font:10px system-ui,sans-serif;color:rgba(255,255,255,.75);pointer-events:auto;text-shadow:0 1px 2px #000'
footer.innerHTML = '<a href="licenses.html" style="color:#fff">Credits</a>'
ui.appendChild(footer)

// Always-available switch to the on-screen 3D view (same markers, no camera).
if (lib) {
  // Library mode: MJE top bar (back, title, Share) and the 3D / AR switch.
  dataPromise.then(d => addLibraryChrome(ui, lib, {title: d.title || '', page: 'ar', canAR: true})).catch(() => {})
} else {
  const switchBtn = document.createElement('button')
  switchBtn.className = 'mk-switch'
  switchBtn.type = 'button'
  switchBtn.textContent = '3D view'
  switchBtn.style.cssText = 'left:14px;top:calc(12px + env(safe-area-inset-top))'
  switchBtn.addEventListener('click', () => { location.href = '3d.html' })
  ui.appendChild(switchBtn)
}

// The engine asks for permission to use the motion sensors with its own purple and grey popup. We cannot change the engine's files,
// but its popup is plain page elements, so this restyles them (and only them) to match the rest of our screens: black panel,
// yellow top edge, white text, a grey Cancel button and a yellow Continue button. The wording is the engine's own.
const promptStyle = document.createElement('style')
promptStyle.textContent = `
.prompt-box-8w{font-family:'Segoe UI',system-ui,Arial,sans-serif!important;background:rgba(0,0,0,.94)!important;color:#fff!important;
  border-top:4px solid #FFEF00!important;border-radius:16px!important;filter:none!important;box-shadow:0 8px 24px rgba(0,0,0,.45)!important;
  padding:16px 14px 14px!important;width:min(20em,calc(100% - 32px))!important;font-size:17px!important}
.prompt-box-8w p{margin:2px 4px 16px!important;font-weight:600!important;line-height:1.35!important}
.prompt-button-8w{height:48px!important;border-radius:12px!important;background:#2a2a2a!important;color:#fff!important;
  font-weight:700!important;font-size:15px!important;padding:0 12px!important;cursor:pointer;touch-action:manipulation}
.prompt-button-8w.button-primary-8w{background:#FFEF00!important;color:#000!important}
`
document.head.appendChild(promptStyle)

const onxrloaded = () => {
  const tickers = new Set()
  let tour = null
  let tourUI = null
  let detachPicking = null
  let placed = false
  let ready = false
  let grounding = null // temporary protective grounding (only for models flagged "grounding": true)
  let groundUI = null

  const anchor = new THREE.Group() // position / yaw / scale chosen by the user
  const frame = new THREE.Group() // model-space origin (markers live in here)
  const introGroup = new THREE.Group() // between the anchor and the model: the placement animation moves this, so it never fights the user's turning and resizing
  anchor.add(introGroup)
  introGroup.add(frame)
  anchor.visible = false
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.22, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({color: 0xFFEF00, transparent: true, opacity: 0.95, depthTest: false})
  )
  reticle.visible = false
  reticle.renderOrder = 998

  let baseScale = 1
  let radius = 1
  let lastTick = performance.now()
  const camera = {ref: null}
  // Calms the small shake of the model when the phone is held still (see smooth.js). Add &smooth=off|light|normal|strong|max to
  // the address to compare; &meter=1 shows frames per second and how much the camera shakes.
  const smoother = createPoseSmoother(params.get('smooth') || 'max')
  const meter = params.get('meter') ? createShakeMeter(document.body, smoother) : null
  window.__smoother = smoother // handy for debugging and tests
  // How the model appears when it is placed: &intro=grow|drop|scan|assemble|off (see intro.js)
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches
  const intro = createIntro({
    anchor,
    group: introGroup,
    frame,
    kind: reduceMotion && !params.get('intro') ? 'off' : (params.get('intro') || 'grow'),
    setHidden: on => { if (grounding && grounding.setHidden) grounding.setHidden(on) },
  })
  window.__intro = intro // handy for debugging and tests

  const moveBtn = document.createElement('button')
  moveBtn.className = 'mk-menu-btn'
  moveBtn.textContent = 'Move model'
  // pointer-events: the AR overlay ignores touches (so the camera view underneath gets them), and buttons directly in
  // it must opt back in. Without this the button was drawn but touches passed straight through it.
  moveBtn.style.cssText = `top:calc(${lib ? 112 : 64}px + env(safe-area-inset-top));display:none;pointer-events:auto;touch-action:manipulation`
  ui.appendChild(moveBtn)

  const setPlaced = (value) => {
    placed = value
    anchor.visible = value
    reticle.visible = !value
    moveBtn.style.display = value ? '' : 'none'
    if (value) {
      showHint(grounding ? 'Drag to turn · pinch to enlarge · then press Lock & Ground' : (tour.markers.length ? 'Drag to turn · pinch to resize · tap a numbered marker' : 'Drag to turn · pinch to resize'), 6000)
      tourUI = tour.markers.length ? createTourUI(ui, tour, {title: '', showHint: false}) : null // no markers: no marker menu or arrows
      detachPicking = tour.attachPicking(camera.canvas)
    } else {
      if (tourUI) tourUI.destroy()
      if (detachPicking) detachPicking()
      tourUI = null
      detachPicking = null
      tour.select(-1)
      showHint(ready ? 'Point the camera at the floor, then tap to place the model' : 'Loading model…')
    }
    if (groundUI) groundUI.setAvailable(value) // Lock & Ground only makes sense once the model is placed
  }

  moveBtn.addEventListener('click', () => {
    if (window.XR8 && XR8.XrController && XR8.XrController.recenter) XR8.XrController.recenter()
    smoother.reset()
    intro.cancel()
    setPlaced(false)
  })
  moveBtn.addEventListener('pointerdown', e => e.stopPropagation())

  const sceneModule = {
    name: 'mje-ar-scene',
    onStart: ({canvas}) => {
      const {scene, camera: cam, renderer} = XR8.Threejs.xrScene()
      camera.ref = cam
      camera.canvas = canvas
      scene.add(anchor)
      scene.add(reticle)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.1))
      const sun = new THREE.DirectionalLight(0xffffff, 1.4)
      sun.position.set(3, 8, 5)
      scene.add(sun)
      try {
        scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
      } catch (e) {
        console.warn('Environment lighting unavailable', e)
      }

      const stage = {
        scene,
        camera: cam,
        renderer,
        controls: {target: new THREE.Vector3(), addEventListener() {}, removeEventListener() {}},
        get radius() { return radius },
        modelGroup: frame, // markers attached to moving parts look their part up in here
        animator: null, // set once the model has loaded and has built-in animation clips
        homeDir: new THREE.Vector3(0, 0, 1),
        onTick(fn) { tickers.add(fn); return () => tickers.delete(fn) },
      }
      tour = new MarkerTour(stage, ui, {root: frame, allowFly: false, offscreenArrow: true})
      window.__ar = {stage, tour} // handy for debugging and tests

      // Camera starts ~1.4 m above the floor; the floor is the y = 0 plane.
      renderer.localClippingEnabled = true // the scan animation hides the part of the model above the glowing ring
      cam.position.set(0, 1.4, 0)
      XR8.XrController.updateCameraProjectionMatrix({origin: cam.position.clone(), facing: cam.quaternion.clone()})

      canvas.addEventListener('touchmove', e => e.preventDefault(), {passive: false})
      showHint('Loading model…')

      Promise.all([dataPromise, modelPromise]).then(async ([data, buf]) => {
        splash.setStatus('Preparing…')
        splash.setProgress(null)
        const gltf = await parseGlb(buf, 'draco/')
        if (needsDraco(glbInfo(buf))) console.log('Draco-compressed model')
        gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false })
        frame.add(gltf.scene)
        if (gltf.animations && gltf.animations.length) {
          stage.animator = new ModelAnimator(gltf.scene, gltf.animations)
          tickers.add(dt => stage.animator.update(dt))
        }
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const longest = Math.max(size.x, size.y, size.z) || 1
        radius = size.length() / 2
        frame.position.set(-center.x, -box.min.y, -center.z) // stand the model on the floor, centered
        // Soft contact shadow so the model looks grounded.
        const sc = document.createElement('canvas')
        sc.width = 128
        sc.height = 128
        const sg = sc.getContext('2d')
        const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 64)
        grad.addColorStop(0, 'rgba(0,0,0,0.5)')
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        sg.fillStyle = grad
        sg.fillRect(0, 0, 128, 128)
        const shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false})
        )
        const span = Math.max(size.x, size.z) * 1.5
        shadow.scale.set(span, 1, span)
        shadow.position.set(center.x, box.min.y + longest * 0.002, center.z)
        shadow.renderOrder = -1
        shadow.userData.noPick = true // taps on the ground shadow are not taps on the model
        frame.add(shadow)
        intro.setModel({root: gltf.scene, box, size, longest})
        baseScale = data.arSize && data.arSize > 0 ? data.arSize / longest : 1
        anchor.scale.setScalar(baseScale)
        tour.motionLabels = data.labels || {}
        tour.setMarkers((data.markers || []).filter(m => Array.isArray(m.position) && m.position.length === 3))
        // Ground mode: Lock & Ground freezes the model (no turning or resizing) so taps can place clamps on its parts.
        // All of the grounding logic is shared with the 3D page (src/grounding.js) and knows nothing about the engine.
        if (data.grounding === true || params.get('ground') === '1') {
          grounding = createGrounding(stage, {
            model: {slug: lib ? lib.slug : 'model', title: data.title || '', bytes: buf.byteLength, fingerprint: fingerprintOf(buf)},
          })
          grounding.attach(document.body, {target: canvas})
          groundUI = createGroundUI(ui, grounding, {
            tour,
            shiftForLibraryBar: !!lib,
            compact: true,
            labels: {off: 'Lock & Ground', on: 'Unlock'},
            lockedHint: true,
            onModeChange: (on) => {
              moveBtn.style.display = placed && !on ? '' : 'none'
              if (on) showHint('')
            },
          })
          groundUI.setAvailable(placed)
          window.__ground = grounding // handy for debugging and tests
        }
        ready = true
        splash.hide()
        if (!placed) showHint('Point the camera at the floor, then tap to place the model')
        console.log('model ready', {longest, baseScale, markers: tour.markers.length})
      }).catch((err) => {
        console.error(err)
        splash.error(`Could not load the model: ${err.message || err}`)
      })

      // ---- touch: tap to place, drag to turn, pinch to resize ------------------------------------------
      const pts = new Map()
      let pinchStart = null
      let moved = false
      let downAt = 0
      canvas.addEventListener('pointerdown', (e) => {
        pts.set(e.pointerId, {x: e.clientX, y: e.clientY})
        if (pts.size === 1) { moved = false; downAt = performance.now() }
        if (pts.size === 2) {
          const [a, b] = [...pts.values()]
          pinchStart = {d: Math.hypot(a.x - b.x, a.y - b.y), s: anchor.scale.x}
          moved = true
        }
      })
      canvas.addEventListener('pointermove', (e) => {
        const p = pts.get(e.pointerId)
        if (!p || !placed || (grounding && grounding.enabled)) return // locked for grounding: no turning or resizing
        if (pts.size === 1) {
          const dx = e.clientX - p.x
          if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 3) moved = true
          anchor.rotation.y += dx * 0.01
        } else if (pts.size === 2 && pinchStart) {
          p.x = e.clientX
          p.y = e.clientY
          const [a, b] = [...pts.values()]
          const k = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinchStart.d, 1)
          anchor.scale.setScalar(Math.min(Math.max(pinchStart.s * k, baseScale * 0.1), baseScale * 12))
          return
        }
        p.x = e.clientX
        p.y = e.clientY
      })
      const end = (e) => {
        const wasSingle = pts.size === 1
        pts.delete(e.pointerId)
        if (pts.size < 2) pinchStart = null
        if (!placed && wasSingle && !moved && performance.now() - downAt < 600 && ready && reticle.userData.hit) {
          anchor.position.copy(reticle.position)
          // face the model toward the viewer
          anchor.rotation.y = Math.atan2(cam.position.x - anchor.position.x, cam.position.z - anchor.position.z)
          setPlaced(true)
          intro.play()
        }
      }
      canvas.addEventListener('pointerup', end)
      canvas.addEventListener('pointercancel', end)
    },

    onUpdate: () => {
      const cam = camera.ref
      if (!cam) return
      const now = performance.now()
      const dt = Math.min(Math.max((now - lastTick) / 1000, 0), 0.5) // real frame time so motion speed is steady
      lastTick = now
      // Smooth the camera pose the engine just set, before anything below uses it (reticle, cards, taps, drawing).
      const pose = smoother.apply(cam, dt)
      if (meter) meter.sample(pose, cam, now)
      if (!placed) {
        // Reticle: where the center of the screen meets the floor.
        const ray = new THREE.Raycaster()
        ray.setFromCamera(new THREE.Vector2(0, 0), cam)
        const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
        const ok = !!hit && hit.distanceTo(cam.position) < 15 && ray.ray.direction.y < -0.02
        reticle.userData.hit = ok
        reticle.visible = ok && ready
        if (ok) reticle.position.copy(hit)
      }
      tickers.forEach(fn => fn(dt))
      intro.update(dt)
    },
  }

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(), // draws the camera feed
    XR8.Threejs.pipelineModule(), // creates the Three.js AR scene
    XR8.XrController.pipelineModule(), // world tracking
    XRExtras.FullWindowCanvas.pipelineModule(), // canvas fills the screen
    XRExtras.Loading.pipelineModule(), // loading screen + camera/motion permission prompts
    XRExtras.RuntimeError.pipelineModule(), // friendly error screen
    sceneModule,
  ])
  XR8.run({canvas: document.getElementById('camerafeed')})
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
