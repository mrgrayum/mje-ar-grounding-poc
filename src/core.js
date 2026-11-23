// Shared 3D stage + marker/guided-tour engine used by both the Marker Author and the exported viewer.
import * as THREE from 'three'
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js'
import tourCss from './tour.css'
import {lockZoom} from './zoomlock.js'

const BASE_COLOR = '#000000'
const ACTIVE_COLOR = '#FFEF00'

let stylesInjected = false
export function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const el = document.createElement('style')
  el.textContent = tourCss
  document.head.appendChild(el)
}

// ---- GLB helpers -----------------------------------------------------------------------------

export function glbInfo(buf) {
  try {
    const dv = new DataView(buf)
    if (dv.getUint32(0, true) !== 0x46546c67) return {extensionsUsed: []}
    const len = dv.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)))
    return {extensionsUsed: json.extensionsUsed || []}
  } catch (e) {
    return {extensionsUsed: []}
  }
}

export const needsDraco = info => info.extensionsUsed.includes('KHR_draco_mesh_compression')

// Stops the whole page from zooming (pinch, double-tap, ctrl+wheel) so the buttons and overlays can never
// end up scaled or misplaced. Pinching the model itself still works: it is handled by pointer events.
// Several layers because iOS Safari ignores the viewport tag's user-scalable setting.
export {lockZoom}

// Phone/tablet check shared by the AR and 3D pages. A phone or iPad asking for the "desktop site" reports
// a Mac user agent but still has a multi-touch screen, so touch counts.
export function isPhoneOrTablet() {
  const ua = navigator.userAgent || ''
  const touch = navigator.maxTouchPoints || 0
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (touch > 1 && /Macintosh|Mac OS X|iPhone|iPad/i.test(`${ua} ${navigator.platform}`))
}

export function createGltfLoader(dracoPath = 'draco/') {
  const draco = new DRACOLoader().setDecoderPath(dracoPath)
  return new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
}

export const parseGlb = (buffer, dracoPath) => new Promise((resolve, reject) => {
  createGltfLoader(dracoPath).parse(buffer, '', resolve, reject)
})

// ---- Model animation -------------------------------------------------------------------------
// Plays the animation clips that are built into the model file (e.g. "BoomUp"). Modes:
//   once   - play from the start and hold the last pose
//   toggle - first trigger plays forward, the next plays it backward, and so on
//   loop   - repeat until stopped
export class ModelAnimator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root)
    this.clips = clips || []
    this.actions = new Map()
    this.forward = new Map()
    this.targets = new Map() // clip name -> set of "node.property" it drives
    this.clips.forEach((clip) => {
      const action = this.mixer.clipAction(clip)
      action.clampWhenFinished = true
      action.setLoop(THREE.LoopOnce, 1)
      action.enabled = false
      this.actions.set(clip.name, action)
      this.targets.set(clip.name, new Set(clip.tracks.map(t => t.name)))
    })
  }

  get names() { return this.clips.map(c => c.name) }

  // Names of the model parts that some clip moves (markers on those parts follow them).
  get movingParts() {
    const set = new Set()
    this.clips.forEach(c => c.tracks.forEach((t) => { set.add(t.name.slice(0, t.name.lastIndexOf('.'))) }))
    return set
  }

  has(name) { return this.actions.has(name) }

  // Starts a clip. If another clip is moving the same parts, the old one fades out so they never fight.
  trigger(name, mode = 'once') {
    const action = this.actions.get(name)
    if (!action) return false
    const mine = this.targets.get(name)
    let fading = false
    this.actions.forEach((other, otherName) => {
      if (other === action || !other.enabled) return
      const theirs = this.targets.get(otherName)
      for (const t of mine) {
        if (theirs.has(t)) { other.fadeOut(0.25); fading = true; return }
      }
    })
    let fwd = true
    let from = 0
    if (mode === 'toggle') {
      fwd = !(this.forward.get(name) ?? false)
      this.forward.set(name, fwd)
      from = action.time
    } else {
      this.forward.set(name, true)
    }
    action.reset()
    action.setEffectiveWeight(1)
    action.setLoop(mode === 'loop' ? THREE.LoopRepeat : THREE.LoopOnce, mode === 'loop' ? Infinity : 1)
    action.clampWhenFinished = true
    action.timeScale = fwd ? 1 : -1
    action.time = mode === 'toggle' ? from : (fwd ? 0 : action.getClip().duration)
    if (fading) action.fadeIn(0.25)
    action.play()
    return true
  }

  // Pauses repeating clips (used when a marker is closed). Clips that played once keep their pose.
  stopLoops() {
    this.actions.forEach((a) => { if (a.loop === THREE.LoopRepeat && a.isRunning()) a.paused = true })
  }

  // Back to the model's original pose.
  reset() {
    this.mixer.stopAllAction()
    this.actions.forEach((a) => { a.enabled = false })
    this.forward.clear()
    this.mixer.update(0)
  }

  update(dt) { this.mixer.update(dt) }

  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.mixer.getRoot())
  }
}

// ---- Stage -----------------------------------------------------------------------------------

export function createStage(container, {dracoPath = 'draco/'} = {}) {
  injectStyles()
  container.style.position = container.style.position || 'relative'
  container.style.overflow = 'hidden'

  const renderer = new THREE.WebGLRenderer({antialias: true})
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
  container.insertBefore(renderer.domElement, container.firstChild)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xe8ecf1)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  const sun = new THREE.DirectionalLight(0xffffff, 1.1)
  sun.position.set(3, 6, 4)
  scene.add(sun)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  camera.position.set(2, 1.5, 3)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = true

  const modelGroup = new THREE.Group()
  scene.add(modelGroup)

  const gltfLoader = createGltfLoader(dracoPath)

  let radius = 1
  let animator = null
  let home = {pos: new THREE.Vector3(2, 1.5, 3), target: new THREE.Vector3()}
  const tickers = new Set()
  const lateTickers = new Set() // run after the camera has finished moving for this frame, just before drawing

  const resize = () => {
    const w = Math.max(container.clientWidth, 1)
    const h = Math.max(container.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  const disposeModel = () => {
    modelGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => {
          Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose() })
          m.dispose()
        })
      }
    })
    modelGroup.clear()
  }

  const resetView = () => {
    camera.position.copy(home.pos)
    controls.target.copy(home.target)
    controls.update()
  }

  const loadModel = async (buffer) => {
    const gltf = await new Promise((resolve, reject) => gltfLoader.parse(buffer, '', resolve, reject))
    disposeModel()
    modelGroup.add(gltf.scene)
    // Animated parts can leave their original bounds, so never cull them.
    gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false })
    if (animator) { animator.dispose(); animator = null }
    if (gltf.animations && gltf.animations.length) animator = new ModelAnimator(gltf.scene, gltf.animations)
    modelGroup.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(modelGroup)
    if (box.isEmpty()) throw new Error('The model has no visible geometry.')
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    radius = Math.max(size.length() / 2, 1e-3)
    camera.near = radius / 200
    camera.far = radius * 200
    camera.updateProjectionMatrix()
    controls.minDistance = radius * 0.05
    controls.maxDistance = radius * 12
    home = {
      pos: center.clone().add(new THREE.Vector3(0.6, 0.45, 1).normalize().multiplyScalar(radius * 2.6)),
      target: center,
    }
    resetView()
    return {radius, center, longest: Math.max(size.x, size.y, size.z)}
  }

  let last = performance.now()
  let raf = 0
  const loop = (now) => {
    raf = requestAnimationFrame(loop)
    const raw = (now - last) / 1000
    const dt = Math.min(raw, 0.1)
    last = now
    // Motion follows the real clock (a slow device must not make it crawl); only huge gaps are capped.
    if (animator) animator.update(Math.min(raw, 0.5))
    tickers.forEach(fn => fn(dt))
    controls.update()
    camera.updateMatrixWorld() // the camera's final position for this frame (rotating, coasting, flying)
    lateTickers.forEach(fn => fn(dt))
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(loop)

  return {
    renderer,
    scene,
    camera,
    controls,
    container,
    modelGroup,
    get radius() { return radius },
    get animator() { return animator },
    get homeDir() { return home.pos.clone().sub(home.target).normalize() },
    loadModel,
    resetView,
    onTick(fn) { tickers.add(fn); return () => tickers.delete(fn) },
    onLateTick(fn) { lateTickers.add(fn); return () => lateTickers.delete(fn) },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      disposeModel()
      renderer.dispose()
    },
  }
}

// ---- Markers + guided tour -------------------------------------------------------------------

const badgeTexture = (label, active) => {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  g.beginPath()
  g.arc(64, 64, 56, 0, Math.PI * 2)
  g.fillStyle = active ? ACTIVE_COLOR : BASE_COLOR
  g.fill()
  g.lineWidth = 9
  g.strokeStyle = active ? '#000000' : '#FFEF00'
  g.stroke()
  g.fillStyle = active ? '#000000' : '#FFEF00'
  const text = String(label)
  g.font = `bold ${text.length > 2 ? 44 : 60}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 64, 68)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// "BoomUp" / "boom_up" -> "Boom Up" for button text.
export const prettyClip = name => String(name || '').replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2)

export class MarkerTour {
  // root: object the markers live under (markers move with it). allowFly: orbit-style camera
  // fly-to (off in AR, where the camera is the phone). offscreenArrow: in AR, point toward the
  // selected marker when it is outside the view.
  constructor(stage, container, {
    showCard = true, markerScale = 0.05, root = null, allowFly = true, offscreenArrow = false, autoAction = true,
  } = {}) {
    this.stage = stage
    this.autoAction = autoAction // play a marker's motion as soon as it opens (off while authoring)
    this.motionLabels = {} // clip name -> friendly name chosen by the author
    this.container = container
    this.showCard = showCard
    this.markerScale = markerScale
    this.allowFly = allowFly
    this.offscreenArrow = offscreenArrow
    this.markers = []
    this.sprites = []
    this.selected = -1
    this._fly = null
    this._listeners = new Set()
    this.group = new THREE.Group()
    ;(root || stage.scene).add(this.group)
    this._buildCard()
    this._offTick = stage.onTick(dt => this.update(dt))
    // Where the message card goes depends on the camera, which only reaches its final position for the frame AFTER
    // the normal per-frame work. Placing the card in that late step keeps it glued to its marker while the model is
    // rotated, flown or coasting to a stop (placed earlier it trailed the marker by one frame and appeared to shake).
    // The AR page has no such late step (its camera is already final when it runs), so it keeps the old order.
    this._late = typeof stage.onLateTick === 'function'
    this._offLate = this._late
      ? stage.onLateTick(() => {
        stage.camera.matrixWorldInverse.copy(stage.camera.matrixWorld).invert()
        this._positionCard()
      })
      : null
    this._cancelFly = () => { this._fly = null }
    stage.controls.addEventListener('start', this._cancelFly)
  }

  on(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _emit() {
    this._listeners.forEach(fn => fn(this.selected))
  }

  _buildCard() {
    const card = document.createElement('div')
    card.className = 'mk-card'
    card.hidden = true
    card.innerHTML = '<div class="mk-card-head"><span class="mk-card-num"></span>'
      + '<span class="mk-card-title"></span>'
      + '<button class="mk-card-close" aria-label="Close">&times;</button></div>'
      + '<div class="mk-card-body"></div>'
      + '<button class="mk-card-act" type="button" hidden></button>'
    this.container.appendChild(card)
    const arrow = document.createElement('div')
    arrow.className = 'mk-offscreen'
    arrow.hidden = true
    arrow.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l8 14-8-4-8 4z"/></svg><span></span>'
    this.container.appendChild(arrow)
    this.arrow = arrow
    this.card = card
    this.cardNum = card.querySelector('.mk-card-num')
    this.cardTitle = card.querySelector('.mk-card-title')
    this.cardBody = card.querySelector('.mk-card-body')
    this.cardAct = card.querySelector('.mk-card-act')
    this.cardAct.addEventListener('click', () => this.playAction(this.selected))
    card.querySelector('.mk-card-close').addEventListener('click', () => this.select(-1))
    // Taps on the card must not reach the 3D view underneath.
    card.addEventListener('pointerdown', e => e.stopPropagation())
  }

  setMarkers(markers) {
    this.markers = markers
    this.refresh()
  }

  // A marker can be attached to a moving part of an animated model (so it travels with that part). The part is
  // found by name inside the loaded model; when it is missing the marker simply stays where it was placed.
  _attachment(m) {
    const a = m.attach
    const model = this.stage.modelGroup
    if (!a || !a.node || !Array.isArray(a.local) || a.local.length !== 3 || !model || !this.stage.animator) return null
    const node = model.getObjectByName(a.node)
    return node ? {node, local: a.local} : null
  }

  _placeSprite(s, m) {
    const att = this._attachment(m)
    const parent = att ? att.node : this.group
    if (s.parent !== parent) parent.add(s)
    s.position.fromArray(att ? att.local : m.position)
  }

  refresh() {
    this.sprites.forEach((s) => {
      s.userData.normal.dispose()
      s.userData.active.dispose()
      s.material.dispose()
      s.removeFromParent()
    })
    this.sprites = this.markers.map((m, i) => {
      const normal = badgeTexture(i + 1, false)
      const active = badgeTexture(i + 1, true)
      const mat = new THREE.SpriteMaterial({
        map: normal, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false,
      })
      const s = new THREE.Sprite(mat)
      s.renderOrder = 999
      s.userData = {normal, active}
      this._placeSprite(s, m)
      return s
    })
    if (this.selected >= this.markers.length) this.selected = -1
    this._applySelection()
  }

  updateMarker(i) {
    const s = this.sprites[i]
    if (s) this._placeSprite(s, this.markers[i])
  }

  _applySelection() {
    this.sprites.forEach((s, i) => {
      const active = i === this.selected
      s.material.map = active ? s.userData.active : s.userData.normal
      s.material.needsUpdate = true
      const k = this.markerScale * (active ? 1.3 : 1)
      s.userData.k = k
      s.scale.set(k, k, 1)
    })
    const i = this.selected
    if (this.showCard && i >= 0 && this.markers[i]) {
      const m = this.markers[i]
      this.cardNum.textContent = String(i + 1)
      this.cardTitle.textContent = m.title || `Marker ${i + 1}`
      const msg = (m.message || '').trim()
      this.cardBody.textContent = msg || 'No message for this marker.'
      this.cardBody.classList.toggle('empty', !msg)
      const act = this.actionFor(i)
      this.cardAct.hidden = !act
      if (act) this.cardAct.textContent = `▶ ${this.motionText(act)}`
      this.card.hidden = false
      this.cardBody.scrollTop = 0
    } else {
      this.card.hidden = true
    }
  }

  // Text for a motion button: the marker's own button text, else the project's friendly name for the clip,
  // else the clip's file name made readable ("BoomUp" -> "Boom Up").
  motionText(act) {
    const own = act.label && String(act.label).trim()
    return own || (this.motionLabels[act.clip] && String(this.motionLabels[act.clip]).trim()) || prettyClip(act.clip)
  }

  // The marker's motion (a clip built into the model), if it has one and the model really contains it.
  actionFor(i) {
    const m = this.markers[i]
    const anim = this.stage.animator
    if (!m || !m.action || !m.action.clip || !anim || !anim.has(m.action.clip)) return null
    return m.action
  }

  playAction(i) {
    const act = this.actionFor(i)
    if (!act) return false
    return this.stage.animator.trigger(act.clip, act.mode || 'once')
  }

  select(i, {fly = false} = {}) {
    const before = this.selected
    this.selected = (i >= 0 && i < this.markers.length) ? i : -1
    this._applySelection()
    if (fly && this.selected >= 0) this.flyToMarker(this.selected)
    if (this.selected !== before) {
      const anim = this.stage.animator
      if (anim) anim.stopLoops() // a repeating motion stops when its marker closes
      const act = this.autoAction && this.selected >= 0 ? this.actionFor(this.selected) : null
      if (act && act.auto !== false) this.playAction(this.selected)
    }
    this._emit()
  }

  next() {
    const n = this.markers.length
    if (!n) return
    this.select(this.selected < 0 ? 0 : (this.selected + 1) % n, {fly: true})
  }

  prev() {
    const n = this.markers.length
    if (!n) return
    this.select(this.selected <= 0 ? n - 1 : this.selected - 1, {fly: true})
  }

  _viewFor(m) {
    const THREEV = THREE.Vector3
    if (m.view && m.view.position && m.view.target) {
      return {pos: new THREEV().fromArray(m.view.position), target: new THREEV().fromArray(m.view.target)}
    }
    const target = new THREEV().fromArray(m.position)
    const {camera, controls} = this.stage
    const overview = this.stage.homeDir
    let dir
    if (m.normal) {
      const n = new THREEV().fromArray(m.normal).normalize()
      // Keep the familiar overview angle when the marker faces roughly toward it; otherwise look
      // straight at the marker's surface (e.g. markers on the far side of the model).
      dir = n.dot(overview) > 0.1 ? n.clone().multiplyScalar(0.4).addScaledVector(overview, 0.6) : n
      dir.y += 0.2 // look slightly down onto the marker
    } else {
      dir = camera.position.clone().sub(controls.target)
    }
    if (dir.lengthSq() < 1e-9) dir.copy(overview)
    dir.normalize()
    return {pos: target.clone().addScaledVector(dir, this.stage.radius * 1.15), target}
  }

  flyToMarker(i, ms = 750) {
    const m = this.markers[i]
    if (!m || !this.allowFly) return
    const {camera, controls} = this.stage
    const {pos, target} = this._viewFor(m)
    this._fly = {
      t: 0,
      ms,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: pos,
      toTarget: target,
    }
  }

  // Screen-space picking: generous tap radius so markers are easy to hit on a phone.
  pickAt(clientX, clientY, radiusPx = 28) {
    const rect = this.stage.renderer.domElement.getBoundingClientRect()
    const v = new THREE.Vector3()
    let best = -1
    let bestD = radiusPx
    this.markers.forEach((m, i) => {
      if (!this.sprites[i]) return
      this.sprites[i].getWorldPosition(v)
      v.project(this.stage.camera)
      if (v.z > 1 || v.z < -1) return
      const px = rect.left + (v.x * 0.5 + 0.5) * rect.width
      const py = rect.top + (-v.y * 0.5 + 0.5) * rect.height
      const d = Math.hypot(px - clientX, py - clientY)
      if (d <= bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  // Which marker (if any) owns the model part under this screen point? Only markers that have a motion, are
  // attached to a part, and have "tap the part" switched on take part. The closest matching part wins.
  pickPart(clientX, clientY) {
    const model = this.stage.modelGroup
    if (!model || !this.stage.animator || !this.markers.some((m, i) => m.action && m.action.tap && this.actionFor(i))) return -1
    const rect = this.stage.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const ray = this._ray || (this._ray = new THREE.Raycaster())
    ray.setFromCamera(ndc, this.stage.camera)
    model.updateWorldMatrix(true, true)
    const hit = ray.intersectObject(model, true).find(h => h.object.isMesh && !h.object.userData.noPick)
    if (!hit) return -1
    for (let o = hit.object; o && o !== model; o = o.parent) {
      if (!o.name) continue
      const i = this.markers.findIndex((m, k) => m.action && m.action.tap && m.attach && m.attach.node === o.name && this.actionFor(k))
      if (i >= 0) return i
    }
    return -1
  }

  // Tapping a part opens its marker and plays the motion; tapping it again just plays the motion again.
  _tapPart(i) {
    const changed = this.selected !== i
    this.select(i)
    const act = this.actionFor(i)
    if (act && (!changed || act.auto === false || !this.autoAction)) this.playAction(i)
  }

  // Tap a marker to open its message, tap it again (or empty space) to close.
  attachPicking(el) {
    let down = null
    const onDown = (e) => {
      if (!e.isPrimary) { down = null; return }
      down = {x: e.clientX, y: e.clientY, t: performance.now()}
    }
    const onUp = (e) => {
      if (!down) return
      const d = down
      down = null
      if (this.pickingEnabled === false) return // e.g. Ground mode: taps place clamps instead of opening markers
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 700) return
      const idx = this.pickAt(e.clientX, e.clientY, e.pointerType === 'mouse' ? 24 : 34)
      if (idx < 0) {
        // Not on a badge: maybe on a moving part whose marker is set to react to taps on the part itself.
        const part = this.pickPart(e.clientX, e.clientY)
        if (part >= 0) { this._tapPart(part); return }
      }
      this.select(idx >= 0 && idx !== this.selected ? idx : -1)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }

  update(dt) {
    const {camera, controls} = this.stage
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    // Badges keep a constant on-screen size even when the model they sit on is scaled (AR).
    // Badges attached to a moving part sit inside that part, so use their own parent's scale.
    const v = this._v || (this._v = new THREE.Vector3())
    const seen = new Map()
    this.sprites.forEach((s) => {
      const p = s.parent || this.group
      let ws = seen.get(p)
      if (ws === undefined) { ws = p.getWorldScale(v).x || 1; seen.set(p, ws) }
      const k = (s.userData.k || this.markerScale) / ws
      s.scale.set(k, k, 1)
    })
    if (this._fly) {
      const f = this._fly
      f.t += dt * 1000
      const k = easeInOut(Math.min(f.t / f.ms, 1))
      camera.position.lerpVectors(f.fromPos, f.toPos, k)
      controls.target.lerpVectors(f.fromTarget, f.toTarget, k)
      if (f.t >= f.ms) this._fly = null
    }
    if (!this._late) this._positionCard()
  }

  _positionCard() {
    const sprite = this.selected >= 0 ? this.sprites[this.selected] : null
    this.arrow.hidden = true
    if (!sprite || this.card.hidden) return
    const W = this.container.clientWidth
    const H = this.container.clientHeight
    const cam = this.stage.camera
    const world = sprite.getWorldPosition(new THREE.Vector3())
    const inCam = world.clone().applyMatrix4(cam.matrixWorldInverse)
    const v = world.clone().project(cam)
    const behind = inCam.z > 0
    const inView = !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1

    if (this.offscreenArrow && !inView) {
      // AR: the marker is out of view. Hide the card and point toward it instead.
      this.card.style.visibility = 'hidden'
      let dx = inCam.x
      let dy = -inCam.y
      if (Math.hypot(dx, dy) < 1e-6) dx = 1
      const len = Math.hypot(dx, dy)
      dx /= len
      dy /= len
      const t = Math.min((W / 2 - 56) / (Math.abs(dx) || 1e-6), (H / 2 - 150) / (Math.abs(dy) || 1e-6))
      const ax = W / 2 + dx * t
      const ay = H / 2 + dy * t
      const angle = Math.atan2(dx, -dy)
      this.arrow.hidden = false
      this.arrow.style.transform = `translate(${Math.round(ax)}px, ${Math.round(ay)}px) translate(-50%, -50%)`
      this.arrow.firstChild.style.transform = `rotate(${angle}rad)`
      const m = this.markers[this.selected]
      this.arrow.lastChild.textContent = (m && m.title) || `Marker ${this.selected + 1}`
      return
    }

    this.card.style.visibility = 'visible'
    const mx = (v.x * 0.5 + 0.5) * W
    const my = (-v.y * 0.5 + 0.5) * H
    const cw = this.card.offsetWidth
    const ch = this.card.offsetHeight
    const gap = 34
    let x = mx - cw / 2
    let y = my - gap - ch
    if (y < 8) y = my + gap // not enough room above: show below the marker
    x = Math.min(Math.max(x, 8), Math.max(W - cw - 8, 8))
    y = Math.min(Math.max(y, 8), Math.max(H - ch - 8, 8))
    // While the card is moving it follows the marker to a fraction of a pixel (whole-pixel steps look like shimmer);
    // once it settles it snaps to whole pixels so the text stays sharp.
    const last = this._lastXY
    const moving = !last || Math.abs(x - last[0]) > 0.02 || Math.abs(y - last[1]) > 0.02
    this._lastXY = [x, y]
    this.card.style.transform = moving
      ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
      : `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  dispose() {
    this._offTick()
    if (this._offLate) this._offLate()
    this.stage.controls.removeEventListener('start', this._cancelFly)
    this.card.remove()
    this.arrow.remove()
    this.sprites.forEach(s => s.removeFromParent())
    this.group.clear()
  }
}
