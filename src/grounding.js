// Temporary protective grounding, shared by the 3D viewer (Stage 2) and, later, the AR page (Stage 4).
//
// A student taps a part to place the first clamp, taps a second point to place the other clamp, and a sagging
// ground cable is drawn between the pair. Each ground is recorded as the named part tapped at each end.
//
// This module only needs from the "stage": camera, renderer, modelGroup, radius and onTick(fn). It knows nothing
// about the AR engine, so it keeps working if the engine is ever removed.
//
// Training visual only. Sizes and sag are nominal, not engineering data.
import * as THREE from 'three'

// ---- settings you can tweak ------------------------------------------------------------------------
export const GROUND_CONFIG = {
  SAG_RATIO: 0.10, // cable droop as a fraction of the span between the clamps
  CABLE_RADIUS: 0.0045, // as a fraction of the model's radius (about 3.3 cm radius on the test pole)
  CLAMP_SIZE: 0.02, // as a fraction of the model's radius (about 15 cm wide on the test pole)
  CLAMP_COLOR: 0xFFEF00, // MJE yellow
  BOLT_COLOR: 0x111111,
  CABLE_COLOR: 0x19d35a, // bright green, easy to tell from wood, aluminum and copper
  TAP_MAX_MOVE_PX: 6, // a tap that moves more than this was a drag (rotate/zoom), not a tap
  TAP_MAX_MS: 500,
}

const round4 = a => a.map(n => Math.round(n * 10000) / 10000)

// ---- the clamp model: a yellow body with a black bolt and eye, built from simple shapes -------------
// Local frame: +Z points away from the surface it clamps onto. Unit size 1 = CLAMP_SIZE.
const makeClampBuilder = () => {
  const yellow = new THREE.MeshStandardMaterial({color: GROUND_CONFIG.CLAMP_COLOR, roughness: 0.45, metalness: 0.1})
  const glow = new THREE.MeshStandardMaterial({color: GROUND_CONFIG.CLAMP_COLOR, roughness: 0.45, metalness: 0.1, emissive: 0x887f00}) // pending clamp
  const black = new THREE.MeshStandardMaterial({color: GROUND_CONFIG.BOLT_COLOR, roughness: 0.5, metalness: 0.4})
  const gBody = new THREE.BoxGeometry(1.0, 0.8, 0.7)
  const gBolt = new THREE.CylinderGeometry(0.16, 0.16, 1.0, 12).rotateX(Math.PI / 2)
  const gEye = new THREE.TorusGeometry(0.3, 0.08, 8, 18).rotateY(Math.PI / 2)
  const build = () => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(gBody, yellow); body.position.z = 0.35
    const bolt = new THREE.Mesh(gBolt, black); bolt.position.z = 1.2
    const eye = new THREE.Mesh(gEye, black); eye.position.z = 1.85
    ;[body, bolt, eye].forEach((m) => { m.userData.noPick = true; g.add(m) })
    const tip = new THREE.Object3D(); tip.position.z = 1.85 // where the cable is fastened
    g.add(tip)
    g.userData.noPick = true
    g.userData.tip = tip
    g.userData.body = body
    return g
  }
  const setPending = (clamp, on) => {
    clamp.userData.body.material = on ? glow : yellow
    if (!on) clamp.scale.setScalar(clamp.userData.baseScale)
  }
  return {build, setPending, dispose: () => { [yellow, glow, black, gBody, gBolt, gEye].forEach(x => x.dispose()) }}
}

// ---- main factory ---------------------------------------------------------------------------------
export function createGrounding(stage) {
  const cfg = GROUND_CONFIG
  const listeners = new Set()
  const clampKit = makeClampBuilder()
  const cableMat = new THREE.MeshStandardMaterial({color: cfg.CABLE_COLOR, roughness: 0.5, metalness: 0.05, emissive: 0x0a5a24, emissiveIntensity: 0.35})
  const raycaster = new THREE.Raycaster()
  const tmp = {a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion()}

  const grounds = [] // {id, a, b, placedAt, clampA, clampB, cable, cableKey}
  let pending = null // {part, local, model, clamp}
  let enabled = false
  let time = 0
  let detach = null

  const emit = () => listeners.forEach(fn => fn())

  const partName = (obj) => {
    for (let o = obj; o && o !== stage.modelGroup; o = o.parent) if (o.name) return o.name
    return '(unnamed part)'
  }

  // Scale that keeps a clamp the same size relative to the MODEL, whatever scale the part (or the AR anchor) has.
  const clampScaleFor = (node) => {
    const ws = node.getWorldScale(tmp.a).x || 1
    const ms = stage.modelGroup.getWorldScale(tmp.b).x || 1
    return (cfg.CLAMP_SIZE * stage.radius) / (ws / ms)
  }

  // Raycast the model under a screen point. Skips our own clamps and cables, and marker sprites.
  const hitPart = (clientX, clientY) => {
    const rect = stage.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    stage.modelGroup.updateWorldMatrix(true, true)
    const hit = raycaster.intersectObject(stage.modelGroup, true).find(h => h.object.isMesh && !h.object.userData.noPick)
    return hit || null
  }

  const placeClamp = (hit) => {
    const node = hit.object
    const normalLocal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0)
    const local = node.worldToLocal(hit.point.clone())
    const model = stage.modelGroup.worldToLocal(hit.point.clone())
    const clamp = clampKit.build()
    clamp.position.copy(local)
    clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalLocal.normalize())
    clamp.scale.setScalar(clampScaleFor(node))
    clamp.userData.baseScale = clamp.scale.x
    node.add(clamp)
    return {
      part: partName(node), local: round4(local.toArray()), model: round4(model.toArray()), clamp,
    }
  }

  // ---- the sagging cable ------------------------------------------------------------------------
  const cableCurve = (A, B, nA, nB) => {
    const chord = B.clone().sub(A)
    const len = chord.length() || 1e-6
    const sag = cfg.SAG_RATIO * len
    // Mostly level cable: it droops down. Mostly vertical cable: "down" would just lay it along the pole, so it
    // bows outward instead (away from the surfaces it is clamped to).
    const vertical = Math.abs(chord.y) / len
    const s = THREE.MathUtils.smoothstep(vertical, 0.5, 0.85)
    const out = nA.clone().add(nB)
    out.y = 0
    if (out.length() < 0.2) out.set(0, 0, 1)
    out.normalize()
    const dir = new THREE.Vector3(0, -1, 0).multiplyScalar(1 - s).add(out.multiplyScalar(s)).normalize()
    const pts = []
    for (let i = 0; i <= 28; i++) {
      const t = i / 28
      pts.push(A.clone().lerp(B, t).addScaledVector(dir, sag * 4 * t * (1 - t)))
    }
    return new THREE.CatmullRomCurve3(pts)
  }

  const rebuildCable = (g) => {
    const model = stage.modelGroup
    const A = model.worldToLocal(g.clampA.userData.tip.getWorldPosition(new THREE.Vector3()))
    const B = model.worldToLocal(g.clampB.userData.tip.getWorldPosition(new THREE.Vector3()))
    const key = `${A.toArray().map(v => v.toFixed(4))}|${B.toArray().map(v => v.toFixed(4))}`
    if (key === g.cableKey) return
    g.cableKey = key
    // Each clamp's outward direction, expressed in model space.
    const inv = model.matrixWorld.clone().invert()
    const nA = new THREE.Vector3(0, 0, 1).transformDirection(g.clampA.matrixWorld).transformDirection(inv)
    const nB = new THREE.Vector3(0, 0, 1).transformDirection(g.clampB.matrixWorld).transformDirection(inv)
    const geo = new THREE.TubeGeometry(cableCurve(A, B, nA, nB), 56, cfg.CABLE_RADIUS * stage.radius, 8, false)
    if (g.cable.geometry) g.cable.geometry.dispose()
    g.cable.geometry = geo
  }

  // ---- adding and removing ----------------------------------------------------------------------
  const nextId = () => `G${grounds.reduce((m, g) => Math.max(m, Number(g.id.slice(1))), 0) + 1}`

  const removeClamp = (clamp) => { if (clamp && clamp.parent) clamp.parent.remove(clamp) }

  const addPoint = (hit) => {
    const p = placeClamp(hit)
    if (!pending) { pending = p; clampKit.setPending(p.clamp, true); emit(); return }
    const first = pending
    pending = null
    clampKit.setPending(first.clamp, false)
    const cable = new THREE.Mesh(new THREE.BufferGeometry(), cableMat)
    cable.userData.noPick = true
    cable.frustumCulled = false
    stage.modelGroup.add(cable)
    const g = {
      id: nextId(),
      a: {node: first.part, local: first.local, model: first.model},
      b: {node: p.part, local: p.local, model: p.model},
      placedAt: new Date().toISOString(),
      clampA: first.clamp, clampB: p.clamp, cable, cableKey: '',
    }
    stage.modelGroup.updateWorldMatrix(true, true)
    rebuildCable(g)
    grounds.push(g)
    emit()
  }

  const removeGround = (g) => {
    removeClamp(g.clampA); removeClamp(g.clampB)
    stage.modelGroup.remove(g.cable)
    if (g.cable.geometry) g.cable.geometry.dispose()
    grounds.splice(grounds.indexOf(g), 1)
  }

  // ---- tap detection (a tap places a clamp; a drag rotates/zooms and places nothing) -------------------
  const attach = (el) => {
    const canvas = stage.renderer.domElement
    const active = new Set()
    let down = null
    const onDown = (e) => {
      active.add(e.pointerId)
      if (!enabled || e.button !== 0 || !e.isPrimary || active.size > 1 || e.target !== canvas) { down = null; return }
      down = {x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId}
    }
    const onUp = (e) => {
      active.delete(e.pointerId)
      const d = down
      down = null
      if (!d || !enabled || d.id !== e.pointerId) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > cfg.TAP_MAX_MOVE_PX || performance.now() - d.t > cfg.TAP_MAX_MS) return
      const hit = hitPart(e.clientX, e.clientY)
      if (hit) addPoint(hit)
    }
    const onCancel = (e) => { active.delete(e.pointerId); down = null }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onCancel, true)
    detach = () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
      el.removeEventListener('pointercancel', onCancel, true)
    }
  }

  // ---- per-frame work: pulse the pending clamp, keep cables joined to their clamps ---------------------
  const offTick = stage.onTick((dt) => {
    time += dt
    stage.modelGroup.updateWorldMatrix(true, true)
    grounds.forEach(rebuildCable)
    if (pending) pending.clamp.scale.setScalar(pending.clamp.userData.baseScale * (1 + 0.14 * Math.sin(time * 7)))
  })

  const api = {
    get enabled() { return enabled },
    setEnabled(on) {
      enabled = !!on
      if (!enabled && pending) { removeClamp(pending.clamp); pending = null }
      emit()
    },
    attach,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    // What the panel shows.
    get pending() { return pending ? {part: pending.part} : null },
    list() { return grounds.map(g => ({id: g.id, a: g.a.node, b: g.b.node})) },
    // The record shape: one entry per completed ground.
    snapshot() {
      return grounds.map(g => ({
        id: g.id,
        a: {node: g.a.node, local: g.a.local, model: g.a.model},
        b: {node: g.b.node, local: g.b.local, model: g.b.model},
        placedAt: g.placedAt,
      }))
    },
    // Remove the pending first clamp if there is one, otherwise the last completed ground.
    undo() {
      if (pending) { removeClamp(pending.clamp); pending = null } else if (grounds.length) removeGround(grounds[grounds.length - 1])
      emit()
    },
    clear() {
      if (pending) { removeClamp(pending.clamp); pending = null }
      while (grounds.length) removeGround(grounds[0])
      emit()
    },
    remove(id) {
      const g = grounds.find(x => x.id === id)
      if (g) { removeGround(g); emit() }
    },
    destroy() {
      api.clear()
      offTick()
      if (detach) detach()
      clampKit.dispose()
      cableMat.dispose()
    },
  }
  return api
}

// ---- the on-screen controls ---------------------------------------------------------------------------
const CSS = `
.gd-toggle{position:absolute;left:14px;top:calc(116px + env(safe-area-inset-top));z-index:26;height:42px;padding:0 16px;border:0;border-radius:12px;
  background:rgba(0,0,0,.84);color:#fff;font:600 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;pointer-events:auto;
  box-shadow:0 4px 14px rgba(0,0,0,.3);touch-action:manipulation}
.gd-toggle.noshift{top:calc(64px + env(safe-area-inset-top))}
.gd-toggle[aria-pressed="true"]{background:#FFEF00;color:#000}
.gd-panel{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));z-index:27;width:min(540px,calc(100% - 20px));
  background:rgba(0,0,0,.92);color:#fff;border-radius:16px;border-top:4px solid #FFEF00;padding:12px 14px 14px;pointer-events:auto;
  font:14px/1.35 'Segoe UI',system-ui,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.gd-panel[hidden]{display:none}
@media(min-width:700px){.gd-panel{left:auto;right:14px;transform:none;width:360px;max-height:calc(100% - 140px);display:flex;flex-direction:column}.gd-panel .gd-list{max-height:none;flex:1;min-height:0}}
.gd-panel *{box-sizing:border-box}
.gd-msg{font-weight:600;font-size:15px;min-height:22px;overflow-wrap:anywhere}
.gd-msg b{color:#FFEF00}
.gd-list{margin:8px 0 0;padding:0;list-style:none;max-height:min(30vh,200px);overflow:auto}
.gd-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #333}
.gd-id{flex:none;min-width:34px;font-weight:700;color:#000;background:#19d35a;border-radius:999px;text-align:center;padding:2px 8px}
.gd-parts{flex:1;min-width:0;overflow-wrap:anywhere}
.gd-x{flex:none;width:40px;height:40px;border:0;border-radius:50%;background:#2a2a2a;color:#fff;font-size:18px;cursor:pointer;touch-action:manipulation}
.gd-x:active{background:#b42318}
.gd-btns{display:flex;gap:10px;margin-top:10px}
.gd-btns button{flex:1;height:48px;border:0;border-radius:12px;font:700 15px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-undo{background:#FFEF00;color:#000}
.gd-undo:active{background:#E6D700}
.gd-clear{background:#2a2a2a;color:#fff}
.gd-btns button:disabled{opacity:.4;cursor:default}
.gd-on .mk-nav,.gd-on .mk-hint,.gd-on .mk-menu-btn{display:none!important}
`

export function createGroundUI(root, grounding, {tour = null, shiftForLibraryBar = true} = {}) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'gd-toggle' + (shiftForLibraryBar ? '' : ' noshift')
  toggle.textContent = 'Ground mode'
  toggle.setAttribute('aria-pressed', 'false')
  root.appendChild(toggle)

  const panel = document.createElement('div')
  panel.className = 'gd-panel'
  panel.hidden = true
  panel.innerHTML = '<div class="gd-msg"></div><ul class="gd-list"></ul>'
    + '<div class="gd-btns"><button type="button" class="gd-undo">Undo last</button><button type="button" class="gd-clear">Clear all</button></div>'
  root.appendChild(panel)
  const msg = panel.querySelector('.gd-msg')
  const list = panel.querySelector('.gd-list')
  const undo = panel.querySelector('.gd-undo')
  const clear = panel.querySelector('.gd-clear')

  // Taps on the controls must never reach the 3D view (they would count as taps on the model or close a card).
  ;[toggle, panel].forEach(el => ['pointerdown', 'pointerup'].forEach(t => el.addEventListener(t, e => e.stopPropagation())))

  const text = (parent, tag, cls, str) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = str; parent.appendChild(e); return e }

  const render = () => {
    const items = grounding.list()
    const pending = grounding.pending
    msg.textContent = ''
    if (pending) {
      msg.append('Clamp 1 on ')
      text(msg, 'b', '', pending.part)
      msg.append('. Tap the second point.')
    } else if (items.length) {
      msg.textContent = 'Ground placed. Tap a part to start the next one.'
    } else {
      msg.textContent = 'Tap a part to place the first clamp.'
    }
    list.textContent = ''
    items.forEach((g) => {
      const li = document.createElement('li')
      li.className = 'gd-row'
      text(li, 'span', 'gd-id', g.id)
      text(li, 'span', 'gd-parts', `${g.a} → ${g.b}`)
      const x = text(li, 'button', 'gd-x', '✕')
      x.type = 'button'
      x.setAttribute('aria-label', `Delete ${g.id}`)
      x.addEventListener('click', () => grounding.remove(g.id))
      list.appendChild(li)
    })
    undo.disabled = !pending && !items.length
    clear.disabled = !pending && !items.length
  }

  const setOn = (on) => {
    grounding.setEnabled(on)
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    panel.hidden = !on
    root.classList.toggle('gd-on', on)
    if (tour) {
      tour.select(-1)
      tour.group.visible = !on
      tour.pickingEnabled = !on
    }
    render()
  }
  toggle.addEventListener('click', () => setOn(!grounding.enabled))
  undo.addEventListener('click', () => grounding.undo())
  clear.addEventListener('click', () => grounding.clear())
  grounding.on(render)
  render()
  return {setOn, destroy() { grounding.setEnabled(false); toggle.remove(); panel.remove(); style.remove() }}
}
