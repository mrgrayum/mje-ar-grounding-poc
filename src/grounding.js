// Temporary protective grounding, shared by the 3D viewer (Stage 2/3) and, later, the AR page (Stage 4).
//
// A student taps a part to place the first clamp, taps a second point to place the other clamp, and a sagging
// ground cable is drawn between the pair. Each ground is recorded as the named part tapped at each end.
// A session can be exported as a file, loaded back (read-only) and survives a page refresh on the same device.
//
// This module only needs from the "stage": camera, renderer, modelGroup, radius and onTick(fn). It knows nothing
// about the AR engine, so it keeps working if the engine is ever removed.
//
// Training visual only. Sizes and sag are nominal, not engineering data.
import * as THREE from 'three'
import {buildRecord, parseRecord, shareOrDownloadRecord} from './grounding-record.js'

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
  TOUCH_RADIUS_PX: 24, // a finger also "reaches" this far around the tap point (a mouse does not)
  THIN_PX: 14, // a part thinner than this on screen counts as a thin wire-like part that fingers snap to
}

const round4 = a => a.map(n => Math.round(n * 10000) / 10000)
const round3 = a => a.map(n => Math.round(n * 1000) / 1000)

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
// options.model = {slug, title, bytes, fingerprint (a string or a Promise of one)}: which model file this is.
export function createGrounding(stage, {model: modelInfo = {slug: 'model', title: '', bytes: 0, fingerprint: ''}} = {}) {
  const cfg = GROUND_CONFIG
  const listeners = new Set()
  const clampKit = makeClampBuilder()
  const cableMat = new THREE.MeshStandardMaterial({color: cfg.CABLE_COLOR, roughness: 0.5, metalness: 0.05, emissive: 0x0a5a24, emissiveIntensity: 0.35})
  const raycaster = new THREE.Raycaster()
  const tmp = {a: new THREE.Vector3(), b: new THREE.Vector3()}
  const storageKey = `mje-grounding:${modelInfo.slug}`

  const grounds = [] // what is drawn now: {id, a, b, placedAt, cable, cableKey}; a and b are {part, clamp}
  let pending = null // the first clamp of a pair that is waiting for its second tap: {part, clamp}
  let enabled = false
  let time = 0
  let detach = null
  let student = ''
  let scenario = ''
  let sessionStart = null
  let viewing = null // while a saved record is on screen (read-only): {record, stash}

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

  // Raycast the model under one screen point. Skips our own clamps and cables, and marker sprites.
  const castAt = (clientX, clientY) => {
    const rect = stage.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    return raycaster.intersectObject(stage.modelGroup, true).find(h => h.object.isMesh && !h.object.userData.noPick) || null
  }

  // How thick a part looks on screen, in pixels: its thinnest dimension, seen from the given distance.
  const thicknessPx = (obj, dist) => {
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    const size = obj.geometry.boundingBox.getSize(tmp.a)
    const s = obj.getWorldScale(tmp.b)
    const thin = Math.min(size.x * s.x, size.y * s.y, size.z * s.z)
    const rect = stage.renderer.domElement.getBoundingClientRect()
    return thin * ((rect.height / 2) * stage.camera.projectionMatrix.elements[5]) / Math.max(dist, 1e-6)
  }

  // Distance on screen from point p to a triangle (0 if p is inside it), plus the closest point and the triangle's middle.
  const triDist = (px, py, a, b, c) => {
    const inside = (() => {
      const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
      const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1])
      const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
    })()
    if (inside) return {d: 0, x: px, y: py}
    let best = {d: Infinity, x: 0, y: 0}
    ;[[a, b], [b, c], [c, a]].forEach(([u, v]) => {
      const ex = v[0] - u[0]
      const ey = v[1] - u[1]
      const t = Math.max(0, Math.min(1, ((px - u[0]) * ex + (py - u[1]) * ey) / (ex * ex + ey * ey || 1)))
      const x = u[0] + ex * t
      const y = u[1] + ey * t
      const d = Math.hypot(px - x, py - y)
      if (d < best.d) best = {d, x, y}
    })
    return best
  }

  // Thin, wire-like parts near the tap, nearest and thinnest first, each with the screen point of the part closest to
  // the finger. Works on the actual shape of every part, so a 2 px wide conductor 15 px away is still found.
  const thinPartsNear = (clientX, clientY) => {
    const rect = stage.renderer.domElement.getBoundingClientRect()
    const cam = stage.camera
    cam.updateMatrixWorld()
    const camPos = cam.getWorldPosition(new THREE.Vector3())
    const px = clientX - rect.left
    const py = clientY - rect.top
    const v = new THREE.Vector3()
    const found = []
    stage.modelGroup.traverse((o) => {
      if (!o.isMesh || o.userData.noPick || !o.geometry.attributes.position) return
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere()
      const center = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld)
      const thick = thicknessPx(o, camPos.distanceTo(center))
      if (thick >= cfg.THIN_PX) return
      const pos = o.geometry.attributes.position
      const screen = new Array(pos.count)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(cam.matrixWorldInverse)
        if (v.z >= 0) { screen[i] = null; continue } // behind the camera
        v.applyMatrix4(cam.projectionMatrix)
        screen[i] = [(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height]
      }
      const idx = o.geometry.index
      const n = idx ? idx.count : pos.count
      let best = null
      for (let t = 0; t < n; t += 3) {
        const a = screen[idx ? idx.getX(t) : t]
        const b = screen[idx ? idx.getX(t + 1) : t + 1]
        const c = screen[idx ? idx.getX(t + 2) : t + 2]
        if (!a || !b || !c) continue
        const r = triDist(px, py, a, b, c)
        if (r.d <= cfg.TOUCH_RADIUS_PX && (!best || r.d < best.d)) best = {d: r.d, x: r.x, y: r.y, mid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]}
      }
      if (best) found.push({object: o, thick, ...best, score: thick * (1 + best.d / 8)})
    })
    return found.sort((x, y) => x.score - y.score).map(f => ({...f, x: f.x + rect.left, y: f.y + rect.top, mid: [f.mid[0] + rect.left, f.mid[1] + rect.top]}))
  }

  // The part under a tap. A mouse must hit the part exactly. A finger is a fat pointer and the wires are thin (at AR
  // size a conductor can be only a couple of pixels wide), so a touch also looks for thin parts within reach: it takes
  // the thinner part when it is close, but a thin part right under the finger beats a thinner one 20 px away.
  const hitPart = (clientX, clientY, pointerType = 'mouse') => {
    stage.modelGroup.updateWorldMatrix(true, true)
    const center = castAt(clientX, clientY)
    if (pointerType === 'mouse') return center
    for (const f of thinPartsNear(clientX, clientY)) {
      // aim at the closest point of that part, nudged a little toward its inside so the ray lands on it
      const dx = f.mid[0] - f.x
      const dy = f.mid[1] - f.y
      const len = Math.hypot(dx, dy) || 1
      const h = castAt(f.x + (dx / len) * 0.75, f.y + (dy / len) * 0.75) || castAt(f.x, f.y)
      if (h && h.object === f.object) return h // skip a part that something else is in front of
    }
    return center
  }

  // Builds a clamp on a part at a point (in the part's own coordinates) facing a direction (also part-local).
  const buildClampOn = (node, local, normalLocal) => {
    const clamp = clampKit.build()
    clamp.position.copy(local)
    clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalLocal.clone().normalize())
    clamp.scale.setScalar(clampScaleFor(node))
    clamp.userData.baseScale = clamp.scale.x
    node.add(clamp)
    return {part: partName(node), clamp}
  }

  const placeClamp = (hit) => {
    const node = hit.object
    const normalLocal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0)
    return buildClampOn(node, node.worldToLocal(hit.point.clone()), normalLocal)
  }

  // Rebuilds a clamp from a saved end {node, model, normal}. Uses the model-space numbers, which do not change when
  // a model is re-optimized, and attaches the clamp to the part of that name. Returns null if the part is missing.
  const placeClampFromData = (e) => {
    const node = stage.modelGroup.getObjectByName(e.node)
    if (!node) return null
    stage.modelGroup.updateWorldMatrix(true, true)
    const world = stage.modelGroup.localToWorld(new THREE.Vector3(...e.model))
    const nWorld = new THREE.Vector3(...(e.normal || [0, 0, 1])).transformDirection(stage.modelGroup.matrixWorld)
    const nLocal = nWorld.transformDirection(node.matrixWorld.clone().invert())
    return buildClampOn(node, node.worldToLocal(world), nLocal)
  }

  // What gets recorded for one end of a ground, read back from the clamp itself.
  const endData = (end) => {
    stage.modelGroup.updateWorldMatrix(true, true)
    end.clamp.updateWorldMatrix(true, false)
    const model = stage.modelGroup.worldToLocal(end.clamp.getWorldPosition(new THREE.Vector3()))
    const inv = stage.modelGroup.matrixWorld.clone().invert()
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(end.clamp.matrixWorld).transformDirection(inv)
    return {
      node: end.part,
      local: round4(end.clamp.position.toArray()),
      model: round4(model.toArray()),
      normal: round3(normal.toArray()),
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
    const A = model.worldToLocal(g.a.clamp.userData.tip.getWorldPosition(new THREE.Vector3()))
    const B = model.worldToLocal(g.b.clamp.userData.tip.getWorldPosition(new THREE.Vector3()))
    const key = `${A.toArray().map(v => v.toFixed(4))}|${B.toArray().map(v => v.toFixed(4))}`
    if (key === g.cableKey) return
    g.cableKey = key
    // Each clamp's outward direction, expressed in model space.
    const inv = model.matrixWorld.clone().invert()
    const nA = new THREE.Vector3(0, 0, 1).transformDirection(g.a.clamp.matrixWorld).transformDirection(inv)
    const nB = new THREE.Vector3(0, 0, 1).transformDirection(g.b.clamp.matrixWorld).transformDirection(inv)
    const geo = new THREE.TubeGeometry(cableCurve(A, B, nA, nB), 56, cfg.CABLE_RADIUS * stage.radius, 8, false)
    if (g.cable.geometry) g.cable.geometry.dispose()
    g.cable.geometry = geo
  }

  // ---- adding and removing ----------------------------------------------------------------------
  const nextId = () => `G${grounds.reduce((m, g) => Math.max(m, Number(g.id.slice(1)) || 0), 0) + 1}`

  const removeClamp = (clamp) => { if (clamp && clamp.parent) clamp.parent.remove(clamp) }

  const makeGround = (id, a, b, placedAt) => {
    const cable = new THREE.Mesh(new THREE.BufferGeometry(), cableMat)
    cable.userData.noPick = true
    cable.frustumCulled = false
    stage.modelGroup.add(cable)
    const g = {id, a, b, placedAt, cable, cableKey: ''}
    stage.modelGroup.updateWorldMatrix(true, true)
    rebuildCable(g)
    grounds.push(g)
    return g
  }

  const removeGround = (g) => {
    removeClamp(g.a.clamp); removeClamp(g.b.clamp)
    stage.modelGroup.remove(g.cable)
    if (g.cable.geometry) g.cable.geometry.dispose()
    grounds.splice(grounds.indexOf(g), 1)
  }

  const dropPending = () => { if (pending) { removeClamp(pending.clamp); pending = null } }
  const removeAll = () => { dropPending(); while (grounds.length) removeGround(grounds[0]) }

  const snapshot = () => grounds.map(g => ({id: g.id, a: endData(g.a), b: endData(g.b), placedAt: g.placedAt}))

  // ---- saving on this device (so a page refresh does not lose the session) -----------------------------
  const save = () => {
    if (viewing) return // never overwrite the live session with a record that is only being looked at
    try {
      if (!grounds.length && !student && !scenario) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify({student, scenario, sessionStart, savedAt: new Date().toISOString(), grounds: snapshot()}))
    } catch (e) { /* storage unavailable (private window, blocked): the session simply is not kept */ }
  }

  const addPoint = (hit) => {
    const p = placeClamp(hit)
    if (!pending) {
      pending = p
      clampKit.setPending(p.clamp, true)
      if (!sessionStart) sessionStart = new Date().toISOString()
      emit()
      return
    }
    const first = pending
    pending = null
    clampKit.setPending(first.clamp, false)
    makeGround(nextId(), first, p, new Date().toISOString())
    save()
    emit()
  }

  // Draws a ground from saved data. Returns false if one of its parts is not in this model.
  const addGroundFromData = (d) => {
    const a = placeClampFromData(d.a)
    if (!a) return false
    const b = placeClampFromData(d.b)
    if (!b) { removeClamp(a.clamp); return false }
    makeGround(d.id, a, b, d.placedAt)
    return true
  }

  // ---- tap detection (a tap places a clamp; a drag rotates/zooms and places nothing) -------------------
  // el: where to listen; options.target: the element taps must land on (default: the stage's canvas).
  const attach = (el, {target = null} = {}) => {
    const canvas = target || stage.renderer.domElement
    const active = new Set()
    let down = null
    const onDown = (e) => {
      active.add(e.pointerId)
      if (!enabled || viewing || e.button !== 0 || !e.isPrimary || active.size > 1 || e.target !== canvas) { down = null; return }
      down = {x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId}
    }
    const onUp = (e) => {
      active.delete(e.pointerId)
      const d = down
      down = null
      if (!d || !enabled || viewing || d.id !== e.pointerId) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > cfg.TAP_MAX_MOVE_PX || performance.now() - d.t > cfg.TAP_MAX_MS) return
      const hit = hitPart(e.clientX, e.clientY, e.pointerType)
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

  const closeRecord = () => {
    if (!viewing) return
    const {stash} = viewing
    removeAll()
    viewing = null
    student = stash.student; scenario = stash.scenario; sessionStart = stash.sessionStart
    stash.grounds.forEach(addGroundFromData)
    emit()
  }

  const api = {
    get enabled() { return enabled },
    setEnabled(on) {
      enabled = !!on
      if (!enabled) { closeRecord(); dropPending() }
      emit()
    },
    attach,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    // What the panel shows.
    get pending() { return pending ? {part: pending.part} : null },
    get viewing() { return viewing ? {record: viewing.record} : null },
    get student() { return student },
    get scenario() { return scenario },
    setSession(v) {
      if (viewing) return
      if (v.student !== undefined) student = String(v.student).slice(0, 60)
      if (v.scenario !== undefined) scenario = String(v.scenario).slice(0, 80)
      save()
    },
    list() { return grounds.map(g => ({id: g.id, a: g.a.part, b: g.b.part})) },
    // The record entries: one per completed ground.
    snapshot,
    // Remove the pending first clamp if there is one, otherwise the last completed ground.
    undo() {
      if (viewing) return
      if (pending) dropPending(); else if (grounds.length) removeGround(grounds[grounds.length - 1])
      if (!grounds.length && !pending) sessionStart = null
      save(); emit()
    },
    clear() {
      if (viewing) return
      removeAll(); sessionStart = null
      save(); emit()
    },
    remove(id) {
      if (viewing) return
      const g = grounds.find(x => x.id === id)
      if (g) { removeGround(g); if (!grounds.length && !pending) sessionStart = null; save(); emit() }
    },
    // A new session: clears the grounds, the student name and the saved copy on this device.
    startFresh() {
      viewing = null
      removeAll()
      student = ''; scenario = ''; sessionStart = null
      try { localStorage.removeItem(storageKey) } catch (e) { /* ignore */ }
      emit()
    },
    // Redraws a session saved on this device. Returns {count, savedAt, student} or null if there is none.
    restoreSession() {
      try {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        const s = JSON.parse(raw)
        if (!Array.isArray(s.grounds)) return null
        student = String(s.student || ''); scenario = String(s.scenario || ''); sessionStart = s.sessionStart || null
        let count = 0
        s.grounds.forEach((d) => { try { if (addGroundFromData(d)) count++ } catch (e) { /* skip a damaged entry */ } })
        emit()
        return {count, savedAt: s.savedAt || null, student}
      } catch (e) {
        return null
      }
    },
    // The full session record, ready to save as a file. {ok: false, error} if it is not ready yet.
    async exportRecord() {
      if (viewing) return {ok: false, error: 'You are viewing a saved record. Close it first.'}
      if (!student.trim()) return {ok: false, error: 'Enter the student name first.', field: 'student'}
      if (!grounds.length) return {ok: false, error: 'Place at least one ground first.'}
      const fingerprint = await Promise.resolve(modelInfo.fingerprint)
      return {
        ok: true,
        record: buildRecord({
          model: {slug: modelInfo.slug, title: modelInfo.title, bytes: modelInfo.bytes, fingerprint},
          student, scenario, sessionStart, sessionEnd: new Date().toISOString(), grounds: snapshot(),
        }),
      }
    },
    // Shows a saved record on the model, read-only. The live session is set aside and comes back on closeRecord().
    async loadRecord(record) {
      if (record.model.slug !== modelInfo.slug) {
        return {ok: false, error: `This record is for a different model ("${record.model.title || record.model.slug}"). Open that model to view it.`}
      }
      const fingerprint = await Promise.resolve(modelInfo.fingerprint)
      const changed = !!(record.model.fingerprint && fingerprint && record.model.fingerprint !== fingerprint)
      const stash = viewing ? viewing.stash : {grounds: snapshot(), student, scenario, sessionStart}
      removeAll()
      viewing = {record, stash}
      let skipped = 0
      record.grounds.forEach((d) => { if (!addGroundFromData(d)) skipped++ })
      emit()
      return {ok: true, drawn: record.grounds.length - skipped, skipped, modelChanged: changed}
    },
    closeRecord,
    destroy() {
      removeAll()
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
.gd-toggle[hidden]{display:none}
.gd-panel{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));z-index:27;width:min(540px,calc(100% - 20px));
  max-height:calc(100% - 130px);overflow:auto;
  background:rgba(0,0,0,.92);color:#fff;border-radius:16px;border-top:4px solid #FFEF00;padding:12px 14px 14px;pointer-events:auto;
  font:14px/1.35 'Segoe UI',system-ui,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.gd-panel[hidden]{display:none}
@media(min-width:700px){.gd-panel:not(.gd-compact){left:auto;right:14px;transform:none;width:370px;max-height:calc(100% - 140px);display:flex;flex-direction:column}.gd-panel:not(.gd-compact) .gd-list{max-height:none;flex:1;min-height:60px}}
.gd-panel *{box-sizing:border-box}
/* Phone / AR layout: a slim bar so the camera view stays visible; the rest opens with "More". */
.gd-panel.gd-compact{left:50%;transform:translateX(-50%);width:calc(100% - 16px);max-height:46vh;padding:8px 10px 10px;bottom:calc(8px + env(safe-area-inset-bottom))}
.gd-compact .gd-msg{font-size:14px;min-height:0}
.gd-compact .gd-session,.gd-compact .gd-list,.gd-compact .gd-btns.small{display:none}
.gd-compact.gd-open .gd-session{display:flex}
.gd-compact.gd-open .gd-list{display:block}
.gd-compact.gd-open .gd-btns.small{display:flex}
.gd-compact .gd-btns{margin-top:8px;gap:8px}
.gd-compact .gd-btns button{height:46px;font-size:14px}
.gd-morebtn{display:none;background:#2a2a2a;color:#fff}
.gd-compact .gd-morebtn{display:block;flex:0 0 76px}
.gd-banner{display:flex;align-items:center;gap:10px;margin:-2px 0 10px;padding:8px 10px;border-radius:10px;background:#FFEF00;color:#000;font-weight:600}
.gd-banner[hidden]{display:none}
.gd-banner span{flex:1;min-width:0;overflow-wrap:anywhere}
.gd-banner button{flex:none;height:36px;padding:0 12px;border:0;border-radius:8px;background:#000;color:#FFEF00;font:700 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.gd-session{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.gd-session[hidden]{display:none}
.gd-session input{flex:1 1 140px;min-width:0;height:40px;border:2px solid #444;border-radius:10px;background:#111;color:#fff;padding:0 10px;font:inherit;font-size:16px}
.gd-session input:focus{outline:none;border-color:#FFEF00}
.gd-session input.bad{border-color:#ff6b5e}
.gd-msg{font-weight:600;font-size:15px;min-height:22px;overflow-wrap:anywhere}
.gd-msg b{color:#FFEF00}
.gd-note{margin-top:6px;padding:6px 10px;border-radius:8px;background:#222;color:#d8d8d8;font-size:13px;overflow-wrap:anywhere}
.gd-note.err{background:#5a1a14;color:#fff}
.gd-note[hidden]{display:none}
.gd-list{margin:8px 0 0;padding:0;list-style:none;max-height:min(24vh,170px);overflow:auto}
.gd-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #333}
.gd-id{flex:none;min-width:34px;font-weight:700;color:#000;background:#19d35a;border-radius:999px;text-align:center;padding:2px 8px}
.gd-parts{flex:1;min-width:0;overflow-wrap:anywhere}
.gd-x{flex:none;width:44px;height:44px;border:0;border-radius:50%;background:#2a2a2a;color:#fff;font-size:18px;cursor:pointer;touch-action:manipulation}
.gd-x:active{background:#b42318}
.gd-btns{display:flex;gap:10px;margin-top:10px}
.gd-btns button{flex:1;height:48px;border:0;border-radius:12px;font:700 15px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-btns.small button{height:44px;font-size:13px;background:#2a2a2a;color:#fff}
.gd-btns.small .gd-export{background:#19d35a;color:#000}
.gd-undo{background:#FFEF00;color:#000}
.gd-undo:active{background:#E6D700}
.gd-clear{background:#2a2a2a;color:#fff}
.gd-btns button:disabled{opacity:.4;cursor:default}
.gd-on .mk-nav,.gd-on .mk-hint,.gd-on .mk-menu-btn{display:none!important}
`

const fmtTime = (iso) => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
}

// options:
//   tour                 the marker tour, so markers are hidden (and not tappable) while Ground mode is on
//   shiftForLibraryBar   put the button below the 3D / AR switch (library pages) instead of just under the top edge
//   compact              slim phone layout with a "More" section (default: on narrow screens)
//   labels {off, on}     text on the main button ("Ground mode", or "Lock & Ground" / "Unlock" in AR)
//   lockedHint           true in AR: the instruction line says the model is locked
//   onModeChange(on)     called whenever Ground mode is switched on or off
export function createGroundUI(root, grounding, {
  tour = null, shiftForLibraryBar = true, compact = window.innerWidth < 700,
  labels = {off: 'Ground mode', on: 'Ground mode'}, lockedHint = false, onModeChange = null,
} = {}) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'gd-toggle' + (shiftForLibraryBar ? '' : ' noshift')
  toggle.textContent = labels.off
  toggle.setAttribute('aria-pressed', 'false')
  root.appendChild(toggle)

  const panel = document.createElement('div')
  panel.className = 'gd-panel' + (compact ? ' gd-compact' : '')
  panel.hidden = true
  panel.innerHTML = '<div class="gd-banner" hidden><span></span><button type="button" class="gd-closerec">Close record</button></div>'
    + '<div class="gd-session"><input class="gd-name" type="text" maxlength="60" placeholder="Student name" aria-label="Student name" autocomplete="off">'
    + '<input class="gd-scn" type="text" maxlength="80" placeholder="Class (optional)" aria-label="Class or scenario" autocomplete="off"></div>'
    + '<div class="gd-msg"></div><div class="gd-note" hidden></div><ul class="gd-list"></ul>'
    + '<div class="gd-btns"><button type="button" class="gd-undo">Undo last</button><button type="button" class="gd-clear">Clear all</button>'
    + '<button type="button" class="gd-morebtn" aria-expanded="false">More</button></div>'
    + '<div class="gd-btns small"><button type="button" class="gd-export">Export record</button><button type="button" class="gd-load">Load record</button>'
    + '<button type="button" class="gd-fresh">Start fresh</button></div>'
    + '<input class="gd-file" type="file" accept=".json,application/json" hidden>'
  root.appendChild(panel)
  const q = sel => panel.querySelector(sel)
  const banner = q('.gd-banner')
  const session = q('.gd-session')
  const nameIn = q('.gd-name')
  const scnIn = q('.gd-scn')
  const msg = q('.gd-msg')
  const note = q('.gd-note')
  const list = q('.gd-list')
  const undo = q('.gd-undo')
  const clear = q('.gd-clear')
  const moreBtn = q('.gd-morebtn')
  const exportBtn = q('.gd-export')
  const loadBtn = q('.gd-load')
  const freshBtn = q('.gd-fresh')
  const fileIn = q('.gd-file')

  // Taps on the controls must never reach the 3D view (they would count as taps on the model or close a card).
  ;[toggle, panel].forEach(el => ['pointerdown', 'pointerup'].forEach(t => el.addEventListener(t, e => e.stopPropagation())))

  const text = (parent, tag, cls, str) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = str; parent.appendChild(e); return e }
  const showNote = (str, isError = false) => { note.textContent = str; note.className = 'gd-note' + (isError ? ' err' : ''); note.hidden = !str }
  const setMore = (open) => { panel.classList.toggle('gd-open', open); moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); moreBtn.textContent = open ? 'Less' : 'More' }

  const render = () => {
    const items = grounding.list()
    const pending = grounding.pending
    const view = grounding.viewing
    // banner for a saved record that is being viewed
    banner.hidden = !view
    if (view) {
      const r = view.record
      banner.querySelector('span').textContent = `Viewing saved record: ${r.student || 'no name'}${r.scenario ? ` (${r.scenario})` : ''}, ${fmtTime(r.sessionEnd)}. Read-only.`
    }
    session.hidden = !!view
    if (document.activeElement !== nameIn) nameIn.value = grounding.student
    if (document.activeElement !== scnIn) scnIn.value = grounding.scenario
    // the instruction line
    msg.textContent = ''
    if (view) {
      msg.textContent = `${items.length} ground${items.length === 1 ? '' : 's'} in this record.`
    } else if (pending) {
      msg.append('Clamp 1 on ')
      text(msg, 'b', '', pending.part)
      msg.append('. Tap the second point.')
    } else if (items.length) {
      msg.textContent = 'Ground placed. Tap a part to start the next one.'
    } else {
      msg.textContent = `${lockedHint ? 'Model locked. ' : ''}Tap a part to place the first clamp.`
    }
    list.textContent = ''
    items.forEach((g) => {
      const li = document.createElement('li')
      li.className = 'gd-row'
      text(li, 'span', 'gd-id', g.id)
      text(li, 'span', 'gd-parts', `${g.a} → ${g.b}`)
      if (!view) {
        const x = text(li, 'button', 'gd-x', '✕')
        x.type = 'button'
        x.setAttribute('aria-label', `Delete ${g.id}`)
        x.addEventListener('click', () => grounding.remove(g.id))
      }
      list.appendChild(li)
    })
    const empty = !pending && !items.length
    undo.disabled = !!view || empty
    clear.disabled = !!view || empty
    exportBtn.disabled = !!view
    loadBtn.disabled = !!view
    freshBtn.disabled = !!view
  }

  const setOn = (on) => {
    grounding.setEnabled(on)
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    toggle.textContent = on ? labels.on : labels.off
    panel.hidden = !on
    root.classList.toggle('gd-on', on)
    if (tour) {
      tour.select(-1)
      tour.group.visible = !on
      tour.pickingEnabled = !on
    }
    if (!on) { showNote(''); setMore(false) }
    render()
    if (onModeChange) onModeChange(on)
  }

  // The main button can be hidden until it makes sense (in AR: after the model has been placed).
  const setAvailable = (yes) => {
    toggle.hidden = !yes
    if (!yes && grounding.enabled) setOn(false)
  }

  toggle.addEventListener('click', () => setOn(!grounding.enabled))
  moreBtn.addEventListener('click', () => setMore(!panel.classList.contains('gd-open')))
  undo.addEventListener('click', () => { showNote(''); grounding.undo() })
  clear.addEventListener('click', () => { showNote(''); grounding.clear() })
  nameIn.addEventListener('input', () => { nameIn.classList.remove('bad'); grounding.setSession({student: nameIn.value}) })
  scnIn.addEventListener('input', () => grounding.setSession({scenario: scnIn.value}))

  exportBtn.addEventListener('click', async () => {
    const r = await grounding.exportRecord()
    if (!r.ok) {
      showNote(r.error, true)
      if (r.field === 'student') { setMore(true); nameIn.classList.add('bad'); nameIn.focus() }
      return
    }
    const res = await shareOrDownloadRecord(r.record)
    if (res.how === 'shared') showNote(`Shared ${res.name}.`)
    else if (res.how === 'cancelled') showNote('Sharing was cancelled. Nothing was saved.')
    else showNote(`Saved ${res.name}. Look in your Downloads folder.`)
  })

  loadBtn.addEventListener('click', () => { fileIn.value = ''; fileIn.click() })
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]
    if (!f) return
    const parsed = parseRecord(await f.text())
    if (!parsed.ok) { showNote(parsed.error, true); return }
    const res = await grounding.loadRecord(parsed.record)
    if (!res.ok) { showNote(res.error, true); return }
    const bits = []
    if (res.modelChanged) bits.push('This model was updated since the record was made; positions are re-fitted from the saved model coordinates.')
    if (res.skipped) bits.push(`${res.skipped} ground${res.skipped === 1 ? '' : 's'} could not be drawn because a named part is missing from this model.`)
    showNote(bits.join(' '), res.skipped > 0)
  })
  q('.gd-closerec').addEventListener('click', () => { showNote(''); grounding.closeRecord() })

  freshBtn.addEventListener('click', () => {
    const has = grounding.list().length || grounding.pending || grounding.student || grounding.scenario
    if (has && !window.confirm('Start fresh? This clears the grounds and the student name on this device. Export the record first if you need it.')) return
    grounding.startFresh()
    showNote('Started a new session.')
  })

  grounding.on(render)
  // Bring back a session saved on this device before a refresh.
  const restored = grounding.restoreSession()
  if (restored && (restored.count || restored.student)) {
    showNote(`Restored your session${restored.savedAt ? ` from ${fmtTime(restored.savedAt)}` : ''} (${restored.count} ground${restored.count === 1 ? '' : 's'}). Press Start fresh for a new one.`)
  }
  render()
  return {setOn, setAvailable, destroy() { grounding.setEnabled(false); toggle.remove(); panel.remove(); style.remove() }}
}
