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
  CABLE_SLACK: 0.12, // extra cable length beyond the straight distance between its two ends (more = deeper, looser hang)
  CABLE_STIFFNESS: 0.05, // how much the cable resists sharp bends (0 = string, higher = stiffer heavy cable)
  CABLE_GRAVITY: 0.02, // how hard gravity pulls each settling step (only affects how fast it settles)
  CABLE_NODES: 32, // points along the cable while it settles
  CABLE_SETTLE_STEPS: 700, // settling steps (more = calmer final shape, a little slower)
  CABLE_RADIUS: 0.0045, // as a fraction of the model's radius (about 3.3 cm radius on the test pole)
  CLAMP_SIZE: 0.02, // as a fraction of the model's radius (about 15 cm wide on the test pole)
  CLAMP_COLOR: 0xFFEF00, // MJE yellow
  BOLT_COLOR: 0x111111,
  CABLE_COLOR: 0x19d35a, // bright green, easy to tell from wood, aluminum and copper
  TAP_MAX_MOVE_PX: 6, // a tap that moves more than this was a drag (rotate/zoom), not a tap
  TAP_MAX_MS: 500,
  TOUCH_RADIUS_PX: 24, // a finger also "reaches" this far around the tap point (a mouse does not)
  THIN_PX: 14, // a part thinner than this on screen counts as a thin wire-like part that fingers snap to
  TAG_HEIGHT: 0.032, // height of a conductor's name tag on screen, as a fraction of the screen height
  NAME_CHOICES: ['A Phase', 'B Phase', 'C Phase', 'Neutral', 'Static'], // quick buttons offered when a conductor is first tapped
  PART_LABELS: {GroundLead: 'Pole ground', GroundPoint: 'Ground point', Pole: 'Pole', Crossarm1: 'Crossarm'}, // plain names for parts that are not asked about
  // Smart taps: what a tap on a part of the model does, decided by the part's name.
  POLE_PART: /pole/i, // the pole body: a tap adds a cluster bracket
  GROUND_PART: /ground|lead/i, // the vertical pole ground (and ground points): a tap places a clamp
  BLOCKED_PART: /crossarm|insulator/i, // not a place to put a clamp or a bracket
  FITTING_SIZE: 0.02, // cluster bracket and ground rod size unit, as a fraction of the model's radius (about 15 cm on the test pole)
  BRACKET_LUGS: 6, // studs on a cluster bracket (one ground cable per stud)
  ROD_REACH: 0.3, // a ground rod can be placed this far from the pole, as a fraction of the model's radius (about 2 m on the test pole)
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

// ---- the pole-mounted cluster bracket and the ground rod, built from simple shapes ------------------------
// Bracket frame: +Z points straight out from the pole, +Y is up, +X runs across. Unit size 1 = FITTING_SIZE x the model's
// radius. It is drawn after the chain-type pole clamp in the photos: a zinc CHAIN that wraps round the pole, a gray jaw on
// the front of the pole where the chain ends meet, a screw tensioner with a bronze knob, and a square gray U that lies
// level and sticks straight out from the jaw (two arms and a cross bar at the far end). The ground clamps go straight on
// the U, exactly as they go on a wire: there are no studs or terminals. Ground rod frame: +Y is up and the origin is
// where the rod goes into the ground; the cable is fastened to the eye on top.
const makeFittingBuilder = () => {
  const alum = new THREE.MeshStandardMaterial({color: 0xb4b9bd, roughness: 0.55, metalness: 0.55})
  const zinc = new THREE.MeshStandardMaterial({color: 0xaeb6bd, roughness: 0.45, metalness: 0.8}) // the chain and the screw
  const bronze = new THREE.MeshStandardMaterial({color: 0xc08a4a, roughness: 0.4, metalness: 0.75})
  const copper = new THREE.MeshStandardMaterial({color: 0xb87333, roughness: 0.4, metalness: 0.7})
  const dark = new THREE.MeshStandardMaterial({color: 0x222222, roughness: 0.6, metalness: 0.3})
  const glow = new THREE.MeshStandardMaterial({color: GROUND_CONFIG.CLAMP_COLOR, roughness: 0.45, metalness: 0.1, emissive: 0xFFEF00, emissiveIntensity: 0.6}) // waiting for its cable
  const gArm = new THREE.BoxGeometry(0.32, 0.36, 1) // a side of the U (stretched to its length)
  const gCross = new THREE.BoxGeometry(1, 0.36, 0.32) // the cross bar of the U (stretched to its width)
  const gJaw = new THREE.BoxGeometry(1, 0.55, 0.42) // the jaw the chain ends meet at (stretched to its width)
  const gBody = new THREE.CylinderGeometry(0.17, 0.17, 0.9, 10).rotateZ(Math.PI / 2) // the screw tensioner's body
  const gScrew = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8).rotateZ(Math.PI / 2)
  const gKnob = new THREE.SphereGeometry(0.28, 12, 8)
  const gLink = new THREE.TorusGeometry(0.1, 0.04, 6, 12).scale(1.5, 1, 1) // one chain link, long side along x
  const gRod = new THREE.CylinderGeometry(0.15, 0.15, 4.2, 12) // from 1.2 below the ground to 3 above it
  const gCap = new THREE.SphereGeometry(0.3, 12, 8)
  const gEye = new THREE.TorusGeometry(0.28, 0.07, 8, 16)
  const gPad = new THREE.CylinderGeometry(1.2, 1.2, 0.04, 24)
  // uPart: this piece is part of the U, the place a ground clamp can go. fitPart: this piece belongs to the hardware.
  const mesh = (geo, mat, uPart = false) => { const m = new THREE.Mesh(geo, mat); m.userData.noPick = true; m.userData.fitPart = true; m.userData.uPart = uPart; return m }

  // poleR = radius of the pole at this spot in the bracket's units, so the chain goes round it exactly.
  const buildBracket = (poleR = 1.4) => {
    const g = new THREE.Group()
    const hw = Math.min(0.75, poleR * 0.9) // half the width of the jaw
    const z0 = -(poleR - Math.sqrt(poleR * poleR - hw * hw)) // where the jaw's ends meet the pole's surface
    const zf = 2.4 // the cross bar at the far end of the U
    const zb = z0 + 0.2 // where the arms leave the jaw
    const ux = hw - 0.1 // the arms stand a little inside the jaw's ends
    const arms = [-ux, ux].map((x) => { const a = mesh(gArm, alum, true); a.scale.z = zf - zb; a.position.set(x, 0, (zf + zb) / 2); g.add(a); return a })
    const cross = mesh(gCross, alum, true); cross.scale.x = 2 * ux + 0.32; cross.position.set(0, 0, zf); g.add(cross)
    const jaw = mesh(gJaw, alum); jaw.scale.x = 2 * hw; jaw.position.set(0, 0, z0 + 0.1); g.add(jaw)
    // the screw tensioner sticks out sideways from the left end of the jaw, ending in a bronze knob
    const body = mesh(gBody, alum); body.position.set(-hw - 0.45, 0, z0 + 0.1); g.add(body)
    const screw = mesh(gScrew, zinc); screw.position.set(-hw - 1.15, 0, z0 + 0.1); g.add(screw)
    const knob = mesh(gKnob, bronze); knob.position.set(-hw - 1.6, 0, z0 + 0.1); g.add(knob)
    // the chain: an arc of interlocking links from one end of the jaw, round the back of the pole, to the other
    const rho = poleR + 0.12
    const cz = -poleR
    const phiA = Math.atan2(z0 - cz, -hw)
    let phiB = Math.atan2(z0 - cz, hw)
    while (phiB < phiA) phiB += Math.PI * 2
    const arcLen = (phiB - phiA) * rho
    const n = Math.max(8, Math.round(arcLen / 0.27))
    const chain = new THREE.InstancedMesh(gLink, zinc, n)
    chain.userData.noPick = true
    chain.userData.fitPart = true
    chain.frustumCulled = false
    const up = new THREE.Vector3(0, 1, 0)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (let k = 0; k < n; k++) {
      const ph = phiA + ((k + 0.5) / n) * (phiB - phiA)
      const pos = new THREE.Vector3(rho * Math.cos(ph), 0, cz + rho * Math.sin(ph))
      const t = new THREE.Vector3(-Math.sin(ph), 0, Math.cos(ph)) // along the chain
      const zAxis = k % 2 ? new THREE.Vector3().crossVectors(t, up).normalize() : up // every second link is turned a quarter turn
      const yAxis = new THREE.Vector3().crossVectors(zAxis, t)
      q.setFromRotationMatrix(m4.makeBasis(t, yAxis, zAxis))
      m4.compose(pos, q, new THREE.Vector3(1, 1, 1))
      chain.setMatrixAt(k, m4)
    }
    g.add(chain)
    // points along the U (bracket coordinates), used to snap a finger that lands near the bracket to the nearest place on it
    const samples = []
    for (let z = zb + 0.3; z <= zf + 0.001; z += 0.3) { samples.push(new THREE.Vector3(-ux, 0, z)); samples.push(new THREE.Vector3(ux, 0, z)) }
    for (let x = -ux; x <= ux + 0.001; x += 0.3) samples.push(new THREE.Vector3(x, 0, zf))
    g.userData = {noPick: true, glowMeshes: [...arms, cross], baseMat: alum, lugs: [], radius: 3.0, axis: [0, 0, 1], chain, bracketU: {underY: -0.18, samples}}
    return g
  }
  const buildRod = () => {
    const g = new THREE.Group()
    const rod = mesh(gRod, copper); rod.position.y = 0.9; g.add(rod)
    const cap = mesh(gCap, dark); cap.position.y = 3.05; g.add(cap)
    const eye = mesh(gEye, dark); eye.position.y = 3.5; g.add(eye)
    const pad = mesh(gPad, dark); pad.position.y = 0.02; g.add(pad)
    const tip = new THREE.Object3D(); tip.position.y = 3.65; g.add(tip)
    g.userData = {noPick: true, main: rod, baseMat: copper, lugs: [tip], radius: 2.4, axis: [0, 1, 0]}
    return g
  }
  const setPending = (f, on) => {
    const u = f.group.userData
    ;(u.glowMeshes || (u.main ? [u.main] : [])).forEach((m) => { m.material = on ? glow : u.baseMat })
  }
  return {buildBracket, buildRod, setPending, glow, disposeOne: (g) => { if (g.userData.chain) g.userData.chain.dispose() }, dispose: () => { [alum, zinc, bronze, copper, dark, glow, gArm, gCross, gJaw, gBody, gScrew, gKnob, gLink, gRod, gCap, gEye, gPad].forEach(x => x.dispose()) }}
}

// ---- main factory ---------------------------------------------------------------------------------
// options.model = {slug, title, bytes, fingerprint (a string or a Promise of one)}: which model file this is.
export function createGrounding(stage, {model: modelInfo = {slug: 'model', title: '', bytes: 0, fingerprint: ''}} = {}) {
  const cfg = GROUND_CONFIG
  const listeners = new Set()
  const clampKit = makeClampBuilder()
  const fittingKit = makeFittingBuilder()
  const cableMat = new THREE.MeshStandardMaterial({color: cfg.CABLE_COLOR, roughness: 0.5, metalness: 0.05, emissive: 0x0a5a24, emissiveIntensity: 0.35})
  const raycaster = new THREE.Raycaster()
  const tmp = {a: new THREE.Vector3(), b: new THREE.Vector3()}
  const storageKey = `mje-grounding:${modelInfo.slug}`

  // An END of a ground is either a clamp on a part, {kind:'clamp', part, clamp}, or a piece of hardware,
  // {kind:'fitting', fitting, slot} (a ground rod's eye; a bracket is not an end: clamps sit on its U like on a wire).
  const grounds = [] // what is drawn now: {id, a, b, placedAt, cable, cableKey}
  const fittings = [] // cluster brackets and ground rods: {id, type, label, node, group, lugs, lugCount, used: Set, placedAt}
  let pending = null // the first end of a pair that is waiting for its second tap
  const history = [] // grounds and hardware in the order they were made, so Undo takes back the last thing made
  let tapNote = '' // a short hint after a tap that could not be used (for example on the crossarm)
  let enabled = false
  let time = 0
  let detach = null
  let student = ''
  let scenario = ''
  let sessionStart = null
  let viewing = null // while a saved record is on screen (read-only): {record, stash}
  let structure = {number: '', line: '', job: ''} // which structure and job this plan is for
  let labels = {} // part name -> the name the user gave it (for example PhaseB_Conductor -> "B Phase")
  let nameRequest = null // a conductor is being named: {part, suggestion, current}
  let nameMode = false // "Name conductors by tapping": taps name conductors instead of placing clamps
  let modeNote = '' // a short hint shown in name mode (for example when a tap was not on a conductor)
  let anchors = {} // part name -> where on the model its name tag sits (model coordinates)
  let showTags = false // name tags on the wires are off unless switched on in Structure setup

  const emit = () => listeners.forEach(fn => fn())

  // ---- names ------------------------------------------------------------------------------------
  // Every connection point has a name used in the list and in the record. Conductors are asked about (the utility's
  // own terms differ: A Phase, Red, X1...); other parts get a plain default name.
  const prettify = n => String(n).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
  const isConductor = part => /conductor/i.test(part)
  const suggestFor = (part) => {
    const m = /phase[ _-]?([A-Za-z0-9])(?![a-z])/i.exec(part)
    if (m) return `${m[1].toUpperCase()} Phase`
    if (/neutral/i.test(part)) return 'Neutral'
    if (/static|shield/i.test(part)) return 'Static'
    return prettify(part)
  }
  const defaultLabel = part => cfg.PART_LABELS[part] || (fittings.find(f => f.id === part) || {}).label || (isConductor(part) ? suggestFor(part) : prettify(part))
  const labelFor = part => labels[part] || defaultLabel(part)
  const endLabel = end => (end.kind === 'fitting' ? end.fitting.label : (end.label !== undefined ? end.label : labelFor(end.part)))
  const needsName = part => isConductor(part) && !labels[part]
  // The conductor parts of the model, so they can all be named in advance.
  const conductorParts = () => {
    const found = new Set()
    stage.modelGroup.traverse((o) => { if (o.isMesh && !o.userData.noPick && o.name && isConductor(o.name)) found.add(o.name) })
    return [...found].sort()
  }

  // ---- naming by tapping the model ----------------------------------------------------------------------
  // The conductor being named lights up, and every named conductor wears a small name tag, so nobody needs to know
  // the part names inside the 3D model.
  const hiMat = new THREE.MeshStandardMaterial({color: 0xFFEF00, emissive: 0xFFEF00, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0})
  let highlighted = null
  const setHighlight = (part) => {
    if (highlighted) { highlighted.mesh.material = highlighted.original; highlighted = null }
    if (!part) return
    stage.modelGroup.traverse((o) => { if (!highlighted && o.isMesh && !o.userData.noPick && o.name === part) highlighted = {mesh: o, original: o.material} })
    if (highlighted) highlighted.mesh.material = hiMat
  }
  const askName = (part) => {
    nameRequest = {part, suggestion: defaultLabel(part), current: labels[part] || ''}
    setHighlight(part)
  }
  const clearRequest = () => { nameRequest = null; setHighlight(null) }

  const tagGroup = new THREE.Group()
  tagGroup.userData.noPick = true
  stage.modelGroup.add(tagGroup)
  const tagSprites = []
  const makeTag = (text) => {
    const c = document.createElement('canvas')
    const g = c.getContext('2d')
    const font = 'bold 40px "Segoe UI", system-ui, Arial, sans-serif'
    g.font = font
    const w = Math.ceil(g.measureText(text).width) + 44
    const h = 68
    c.width = w
    c.height = h
    g.font = font
    g.fillStyle = '#FFEF00'
    g.strokeStyle = '#000000'
    g.lineWidth = 6
    g.beginPath()
    if (g.roundRect) g.roundRect(4, 4, w - 8, h - 8, 18); else g.rect(4, 4, w - 8, h - 8)
    g.fill()
    g.stroke()
    g.fillStyle = '#000000'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, w / 2, h / 2 + 2)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, depthTest: false, transparent: true, sizeAttenuation: false}))
    sprite.userData = {aspect: w / h, noPick: true}
    sprite.center.set(0.5, -0.3) // sits just above the point that was tapped
    sprite.renderOrder = 997
    return sprite
  }
  const scaleTags = () => {
    if (!tagSprites.length) return
    const ws = stage.modelGroup.getWorldScale(tmp.b).x || 1 // constant size on screen, whatever the model's scale
    tagSprites.forEach((t) => { const h = cfg.TAG_HEIGHT / ws; t.scale.set(h * t.userData.aspect, h, 1) })
  }
  const syncTags = () => {
    while (tagSprites.length) { const t = tagSprites.pop(); tagGroup.remove(t); t.material.map.dispose(); t.material.dispose() }
    tagGroup.visible = enabled && !viewing && showTags // tags are optional, part of Ground mode, and not drawn on a record that is being viewed
    Object.entries(labels).forEach(([part, name]) => {
      const a = anchors[part]
      if (!a) return
      const t = makeTag(name)
      t.position.set(a[0], a[1], a[2])
      tagGroup.add(t)
      tagSprites.push(t)
    })
    scaleTags()
  }

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
    const onPole = !!center && tapKind(partName(center.object)) === 'pole'
    for (const f of thinPartsNear(clientX, clientY)) {
      // a finger that is right on the pole means the pole (to add a bracket): only wires snap away from it, not the pole ground beside it
      if (onPole && tapKind(partName(f.object)) !== 'wire' && f.object !== center.object) continue
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
    return {kind: 'clamp', part: partName(node), clamp}
  }

  // Where a clamp sits and which way it points. A clamp on a wire always HANGS DOWN from it, whichever side of the
  // wire was tapped (top, side or underneath): the body goes on the underside of the wire right below the tapped spot
  // and the cable eye points straight down, which is how a worker installs it and how the cable then hangs. Tapping
  // the underside gives the same result, so the rule gives the same pose when a saved record is loaded again. On any
  // other part the clamp keeps the direction of the surface but never points upward.
  const clampPose = (node, pointWorld, normalWorld) => {
    const n = normalWorld.clone().normalize()
    const down = new THREE.Vector3(0, -1, 0)
    if (node.userData && node.userData.bracketU) {
      // on the bracket's U a clamp hangs down from the underside, right under the tapped spot, just like on a wire
      node.updateWorldMatrix(true, false)
      const under = node.localToWorld(new THREE.Vector3(0, node.userData.bracketU.underY, 0))
      return {point: new THREE.Vector3(pointWorld.x, under.y, pointWorld.z), dir: down}
    }
    if (node.isMesh && isConductor(node.name)) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox()
      const size = node.geometry.boundingBox.getSize(tmp.a)
      const sc = node.getWorldScale(tmp.b)
      const radius = Math.min(size.x * sc.x, size.y * sc.y, size.z * sc.z) / 2 // a wire is as thick as its thinnest side
      const axis = pointWorld.clone().addScaledVector(n, -radius) // the middle of the wire under the tapped spot
      return {point: axis.addScaledVector(down, radius), dir: down}
    }
    const d = n.clone()
    if (d.y > 0) d.y = 0
    if (d.lengthSq() < 1e-6) d.copy(down); else d.normalize()
    return {point: pointWorld.clone(), dir: d}
  }
  const dirToLocal = (node, dirWorld) => dirWorld.clone().transformDirection(node.matrixWorld.clone().invert())

  const placeClamp = (hit) => {
    const node = hit.object
    node.updateWorldMatrix(true, false)
    const nWorld = (hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0)).transformDirection(node.matrixWorld)
    const pose = clampPose(node, hit.point, nWorld)
    return buildClampOn(node, node.worldToLocal(pose.point.clone()), dirToLocal(node, pose.dir))
  }

  // Rebuilds a clamp from a saved end {node, model, normal}. Uses the model-space numbers, which do not change when
  // a model is re-optimized, and attaches the clamp to the part of that name. Returns null if the part is missing.
  const placeClampFromData = (e, {fixedLabel = false} = {}) => {
    const node = stage.modelGroup.getObjectByName(e.node)
    if (!node) return null
    stage.modelGroup.updateWorldMatrix(true, true)
    const world = stage.modelGroup.localToWorld(new THREE.Vector3(...e.model))
    const nWorld = new THREE.Vector3(...(e.normal || [0, 0, 1])).transformDirection(stage.modelGroup.matrixWorld)
    const pose = clampPose(node, world, nWorld)
    const end = buildClampOn(node, node.worldToLocal(pose.point.clone()), dirToLocal(node, pose.dir))
    if (fixedLabel) end.label = e.label || defaultLabel(e.node) // a record being viewed keeps its own names
    return end
  }

  // What gets recorded for one end of a ground, read back from the clamp itself.
  const endData = (end) => {
    if (end.kind === 'fitting') return {kind: 'fitting', fitting: end.fitting.id, label: end.fitting.label, slot: end.slot}
    stage.modelGroup.updateWorldMatrix(true, true)
    end.clamp.updateWorldMatrix(true, false)
    const model = stage.modelGroup.worldToLocal(end.clamp.getWorldPosition(new THREE.Vector3()))
    const inv = stage.modelGroup.matrixWorld.clone().invert()
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(end.clamp.matrixWorld).transformDirection(inv)
    return {
      kind: 'clamp',
      node: end.part,
      label: endLabel(end),
      local: round4(end.clamp.position.toArray()),
      model: round4(model.toArray()),
      normal: round3(normal.toArray()),
    }
  }

  // ---- the hanging cable ------------------------------------------------------------------------
  // A ground cable is longer than the distance between its two ends and hangs under its own weight. Its shape is found
  // by letting a chain of points settle under gravity (a small physics relaxation): the cable keeps its length, sags
  // as low as the slack allows, resists sharp bends a little (it is heavy copper cable, not string), stays above the
  // floor and is kept out of tall, thick parts such as the pole. A near-vertical run can only use up its slack by
  // bowing out, so it swings away from the surfaces it is clamped to in a gentle loop.
  let colliders = null // tall thick parts, in model space: {cx, cz, minY, maxY, samples: [[y, radius], ...]}
  let floorY = 0

  const buildColliders = () => {
    colliders = []
    const model = stage.modelGroup
    model.updateWorldMatrix(true, true)
    const inv = model.matrixWorld.clone().invert()
    const v = new THREE.Vector3()
    let lowest = Infinity
    model.traverse((o) => {
      if (!o.isMesh || o.userData.noPick || !o.geometry.attributes.position) return
      const pos = o.geometry.attributes.position
      const m = o.matrixWorld.clone().premultiply(inv) // part -> model space
      const xs = []
      const ys = []
      const zs = []
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m)
        xs.push(v.x); ys.push(v.y); zs.push(v.z)
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z)
      }
      lowest = Math.min(lowest, y0)
      const width = Math.max(x1 - x0, z1 - z0)
      const height = y1 - y0
      if (height < 3 * width || width < 0.03 * stage.radius) return // only tall, thick parts (a pole, a leg) are keep-out zones
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      const slices = 10
      const rad = new Array(slices).fill(-1)
      for (let i = 0; i < xs.length; i++) {
        const s = Math.min(slices - 1, Math.floor(((ys[i] - y0) / height) * slices))
        rad[s] = Math.max(rad[s], Math.hypot(xs[i] - cx, zs[i] - cz))
      }
      // slices without vertices (a pole is just a bottom ring and a top ring) are filled in by straight-line steps between the others
      const samples = rad.map((r, s) => [y0 + ((s + 0.5) / slices) * height, r]).filter(sm => sm[1] >= 0)
      colliders.push({cx, cz, minY: y0, maxY: y1, samples})
    })
    floorY = Number.isFinite(lowest) ? lowest : 0
  }

  const radiusAt = (c, y) => {
    const s = c.samples
    if (y <= s[0][0]) return s[0][1]
    for (let i = 1; i < s.length; i++) {
      if (y <= s[i][0]) { const t = (y - s[i - 1][0]) / ((s[i][0] - s[i - 1][0]) || 1); return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t }
    }
    return s[s.length - 1][1]
  }

  // Returns a smooth curve through the settled chain. A, B: the two ends in model space. nA, nB: the direction each
  // clamp points away from its surface (used to decide which way a near-vertical cable bows out).
  const hangingCable = (A, B, nA, nB) => {
    if (!colliders) buildColliders()
    const N = cfg.CABLE_NODES
    const chord = B.clone().sub(A)
    const D = Math.max(chord.length(), 1e-6)
    const L = D * (1 + cfg.CABLE_SLACK)
    const seg = L / N
    const down = new THREE.Vector3(0, -1, 0).transformDirection(stage.modelGroup.matrixWorld.clone().invert()).normalize()
    // which way to bow when the cable is nearly vertical: away from the surfaces it is clamped to
    const out = nA.clone().add(nB)
    out.addScaledVector(down, -out.dot(down)) // sideways only
    if (out.length() < 0.2) out.set(0, 0, 1).addScaledVector(down, -down.z)
    out.normalize()
    const vertical = Math.abs(chord.dot(down)) / D
    const bowDir = down.clone().multiplyScalar(1 - vertical).addScaledVector(out, vertical).normalize()
    const bulge = Math.sqrt(Math.max((3 * D * (L - D)) / 8, 0)) // how far a smooth arc of this length bows out
    const margin = cfg.CABLE_RADIUS * stage.radius * 1.2 + 0.002 * stage.radius

    const px = new Float64Array(N + 1)
    const py = new Float64Array(N + 1)
    const pz = new Float64Array(N + 1)
    const qx = new Float64Array(N + 1)
    const qy = new Float64Array(N + 1)
    const qz = new Float64Array(N + 1)
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const k = bulge * 4 * t * (1 - t)
      px[i] = A.x + chord.x * t + bowDir.x * k
      py[i] = A.y + chord.y * t + bowDir.y * k
      pz[i] = A.z + chord.z * t + bowDir.z * k
      qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i]
    }
    const grav = cfg.CABLE_GRAVITY * seg
    const stiff = cfg.CABLE_STIFFNESS
    const damp = 0.9
    let calm = 0
    for (let step = 0; step < cfg.CABLE_SETTLE_STEPS; step++) {
      for (let i = 1; i < N; i++) { // move each free point: carry on, then gravity pulls it down
        const vx = (px[i] - qx[i]) * damp
        const vy = (py[i] - qy[i]) * damp
        const vz = (pz[i] - qz[i]) * damp
        qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i]
        px[i] += vx + down.x * grav
        py[i] += vy + down.y * grav
        pz[i] += vz + down.z * grav
      }
      for (let pass = 0; pass < 8; pass++) { // the cable cannot stretch or shrink: pull neighbours back to one segment apart
        for (let i = 0; i < N; i++) {
          const dx = px[i + 1] - px[i]
          const dy = py[i + 1] - py[i]
          const dz = pz[i + 1] - pz[i]
          const d = Math.hypot(dx, dy, dz) || 1e-9
          const f = (d - seg) / d
          const wa = i === 0 ? 0 : (i + 1 === N ? 1 : 0.5) // the two ends are fixed to the clamps
          const wb = i + 1 === N ? 0 : (i === 0 ? 1 : 0.5)
          px[i] += dx * f * wa; py[i] += dy * f * wa; pz[i] += dz * f * wa
          px[i + 1] -= dx * f * wb; py[i + 1] -= dy * f * wb; pz[i + 1] -= dz * f * wb
        }
      }
      for (let i = 1; i < N; i++) { // stiffness: a heavy cable does not fold into a sharp kink
        px[i] += ((px[i - 1] + px[i + 1]) / 2 - px[i]) * stiff
        py[i] += ((py[i - 1] + py[i + 1]) / 2 - py[i]) * stiff
        pz[i] += ((pz[i - 1] + pz[i + 1]) / 2 - pz[i]) * stiff
      }
      for (let i = 1; i < N; i++) { // keep it above the floor and out of the pole
        let moved = false
        if (py[i] < floorY + margin) { py[i] = floorY + margin; moved = true }
        for (const c of colliders) {
          if (py[i] < c.minY || py[i] > c.maxY) continue
          const need = radiusAt(c, py[i]) + margin
          let dx = px[i] - c.cx
          let dz = pz[i] - c.cz
          const d = Math.hypot(dx, dz)
          if (d < need) {
            if (d < 1e-6) { dx = out.x; dz = out.z } else { dx /= d; dz /= d }
            px[i] = c.cx + dx * need; pz[i] = c.cz + dz * need; moved = true
          }
        }
        if (moved) { qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i] } // a part that was pushed does not keep its speed
      }
      // stop as soon as the cable has stopped moving (usually well before the step limit)
      let still = 0
      for (let i = 1; i < N; i++) still = Math.max(still, Math.abs(px[i] - qx[i]), Math.abs(py[i] - qy[i]), Math.abs(pz[i] - qz[i]))
      calm = still < seg * 1e-4 ? calm + 1 : 0
      if (calm >= 12) break
    }
    const pts = []
    for (let i = 0; i <= N; i++) pts.push(new THREE.Vector3(px[i], py[i], pz[i]))
    pts[0].copy(A)
    pts[N].copy(B)
    return new THREE.CatmullRomCurve3(pts)
  }

  // Where a cable is fastened at one end, and which way that end points away from what it is on (model space).
  const endTip = end => (end.kind === 'fitting' ? end.fitting.lugs[end.slot || 0] : end.clamp.userData.tip)
  const endNormal = (end, inv) => {
    const obj = end.kind === 'fitting' ? end.fitting.group : end.clamp
    const axis = end.kind === 'fitting' ? end.fitting.group.userData.axis : [0, 0, 1]
    return new THREE.Vector3(...axis).transformDirection(obj.matrixWorld).transformDirection(inv)
  }

  const rebuildCable = (g) => {
    const model = stage.modelGroup
    const A = model.worldToLocal(endTip(g.a).getWorldPosition(new THREE.Vector3()))
    const B = model.worldToLocal(endTip(g.b).getWorldPosition(new THREE.Vector3()))
    const key = `${A.toArray().map(v => v.toFixed(4))}|${B.toArray().map(v => v.toFixed(4))}`
    if (key === g.cableKey) return
    g.cableKey = key
    // Each clamp's outward direction, expressed in model space.
    const inv = model.matrixWorld.clone().invert()
    const nA = endNormal(g.a, inv)
    const nB = endNormal(g.b, inv)
    const geo = new THREE.TubeGeometry(hangingCable(A, B, nA, nB), 64, cfg.CABLE_RADIUS * stage.radius, 8, false)
    if (g.cable.geometry) g.cable.geometry.dispose()
    g.cable.geometry = geo
  }

  // ---- hardware: cluster brackets and ground rods -------------------------------------------------------
  const labelOfId = id => `${id[0] === 'R' ? 'Rod' : 'Bracket'} ${id.slice(1)}`
  const nextFittingId = prefix => `${prefix}${fittings.reduce((m, f) => (f.id[0] === prefix ? Math.max(m, Number(f.id.slice(1)) || 0) : m), 0) + 1}`
  // An end of a ground is "on" a piece of hardware when it is the hardware itself (a rod) or a clamp sitting on it (a bracket's U).
  const endOn = (e, f) => (e.kind === 'fitting' ? e.fitting === f : hasAncestor(e.clamp, f.group))
  const usesOf = f => grounds.filter(g => endOn(g.a, f) || endOn(g.b, f)).length
  const allocLug = (f, want) => {
    if (f.type === 'ground_rod') return 0
    if (Number.isInteger(want) && want >= 0 && want < f.lugCount && !f.used.has(want)) { f.used.add(want); return want }
    for (let i = 0; i < f.lugCount; i++) if (!f.used.has(i)) { f.used.add(i); return i }
    return 0 // more cables than studs (only possible from a damaged record): share the first stud
  }
  const freeLug = (f, slot) => { if (f.type !== 'ground_rod') f.used.delete(slot) }

  const registerFitting = (type, id, group, node, placedAt, label) => {
    const f = {id, type, label: label || labelOfId(id), node, group, lugs: group.userData.lugs, lugCount: group.userData.lugs.length, used: new Set(), placedAt: placedAt || new Date().toISOString()}
    group.name = id // clamps placed on a bracket are recorded as sitting on the part with this name
    fittings.push(f)
    history.push(f)
    return f
  }

  // How wide the pole is at a spot (its radius, in the units the bracket is built in), so the chain fits round it.
  const poleRadiusUnits = (pointWorld) => {
    if (!colliders) buildColliders()
    const p = stage.modelGroup.worldToLocal(pointWorld.clone())
    let best = null
    for (const c of colliders) {
      if (p.y < c.minY || p.y > c.maxY) continue
      const d = Math.hypot(p.x - c.cx, p.z - c.cz)
      const err = Math.abs(d - radiusAt(c, p.y))
      if (!best || err < best.err) best = {d, err}
    }
    return best ? Math.min(Math.max(best.d / (cfg.FITTING_SIZE * stage.radius), 0.6), 8) : 1.4
  }

  // A cluster bracket on a part (the pole) at a world point: the chain goes round the pole and the U sticks straight out
  // from the pole, level. normalWorld is only used for its sideways direction.
  const makeBracket = (node, pointWorld, normalWorld, {id, placedAt, label} = {}) => {
    const up = new THREE.Vector3(0, 1, 0)
    const n = normalWorld.clone()
    n.y = 0
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1)
    n.normalize()
    node.updateWorldMatrix(true, false)
    const zL = dirToLocal(node, n).normalize()
    const yL = dirToLocal(node, up)
    yL.addScaledVector(zL, -yL.dot(zL)).normalize()
    const xL = yL.clone().cross(zL)
    const group = fittingKit.buildBracket(poleRadiusUnits(pointWorld))
    group.position.copy(node.worldToLocal(pointWorld.clone()))
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xL, yL, zL))
    group.scale.setScalar(clampScaleFor(node) * (cfg.FITTING_SIZE / cfg.CLAMP_SIZE))
    node.add(group)
    return registerFitting('cluster_bracket', id || nextFittingId('B'), group, partName(node), placedAt, label)
  }

  // A ground rod standing in the ground at a point (model coordinates).
  const makeRod = (modelPoint, {id, placedAt, label} = {}) => {
    const group = fittingKit.buildRod()
    group.position.copy(modelPoint)
    group.scale.setScalar(clampScaleFor(stage.modelGroup) * (cfg.FITTING_SIZE / cfg.CLAMP_SIZE))
    stage.modelGroup.add(group)
    return registerFitting('ground_rod', id || nextFittingId('R'), group, '', placedAt, label)
  }

  const fittingData = (f) => {
    stage.modelGroup.updateWorldMatrix(true, true)
    f.group.updateWorldMatrix(true, false)
    const inv = stage.modelGroup.matrixWorld.clone().invert()
    const model = stage.modelGroup.worldToLocal(f.group.getWorldPosition(new THREE.Vector3()))
    const normal = new THREE.Vector3(...f.group.userData.axis).transformDirection(f.group.matrixWorld).transformDirection(inv)
    return {id: f.id, type: f.type, label: f.label, node: f.node, local: round4(f.group.position.toArray()), model: round4(model.toArray()), normal: round3(normal.toArray()), placedAt: f.placedAt}
  }
  // Every bracket (clamps on it are recorded as sitting on it), and every rod that has a cable. (A rod just placed and still
  // waiting for its cable is not recorded.)
  const fittingsSnapshot = () => fittings.filter(f => f.type === 'cluster_bracket' || usesOf(f) > 0).map(fittingData)

  // Rebuilds a piece of hardware from saved data. Returns null if the part it sat on is missing from this model.
  const addFittingFromData = (d, {fixedLabel = false} = {}) => {
    stage.modelGroup.updateWorldMatrix(true, true)
    const opts = {id: d.id, placedAt: d.placedAt, label: fixedLabel ? d.label : undefined}
    if (d.type === 'ground_rod') return makeRod(new THREE.Vector3(...d.model), opts)
    if (d.type === 'cluster_bracket') {
      const node = stage.modelGroup.getObjectByName(d.node)
      if (!node) return null
      const world = stage.modelGroup.localToWorld(new THREE.Vector3(...d.model))
      const nWorld = new THREE.Vector3(...(d.normal || [0, 0, 1])).transformDirection(stage.modelGroup.matrixWorld)
      return makeBracket(node, world, nWorld, opts)
    }
    return null
  }

  const removeFitting = (f) => {
    const i = fittings.indexOf(f)
    if (i < 0) return
    fittings.splice(i, 1) // first, so the cables below do not try to remove it again
    grounds.filter(g => endOn(g.a, f) || endOn(g.b, f)).forEach(g => removeGround(g))
    if (pending && (pending.kind === 'fitting' ? pending.fitting === f : hasAncestor(pending.clamp, f.group))) pending = null
    if (f.group.parent) f.group.parent.remove(f.group)
    fittingKit.disposeOne(f.group)
  }

  // ---- adding and removing ----------------------------------------------------------------------
  const nextId = () => `G${grounds.reduce((m, g) => Math.max(m, Number(g.id.slice(1)) || 0), 0) + 1}`

  const removeClamp = (clamp) => { if (clamp && clamp.parent) clamp.parent.remove(clamp) }

  const makeGround = (id, a, b, placedAt) => {
    const cable = new THREE.Mesh(new THREE.BufferGeometry(), cableMat)
    cable.userData.noPick = true
    cable.frustumCulled = false
    stage.modelGroup.add(cable)
    ;[a, b].forEach((e) => { if (e.kind === 'fitting') e.slot = allocLug(e.fitting, e.slot) })
    const g = {id, a, b, placedAt, cable, cableKey: ''}
    stage.modelGroup.updateWorldMatrix(true, true)
    rebuildCable(g)
    grounds.push(g)
    history.push(g)
    return g
  }

  // Removes a ground. A piece of hardware that has no cable left on it goes too (unless it is waiting for its first cable).
  const removeGround = (g) => {
    ;[g.a, g.b].forEach((e) => { if (e.kind === 'fitting') freeLug(e.fitting, e.slot); else removeClamp(e.clamp) })
    stage.modelGroup.remove(g.cable)
    if (g.cable.geometry) g.cable.geometry.dispose()
    grounds.splice(grounds.indexOf(g), 1)
    ;[g.a, g.b].forEach((e) => {
      if (e.kind === 'fitting' && !usesOf(e.fitting) && !(pending && pending.kind === 'fitting' && pending.fitting === e.fitting)) removeFitting(e.fitting)
    })
  }

  const dropPending = () => {
    if (!pending) return
    const p = pending
    pending = null
    if (p.kind === 'fitting') { fittingKit.setPending(p.fitting, false); if (!usesOf(p.fitting)) removeFitting(p.fitting) } else removeClamp(p.clamp)
  }
  const removeAll = () => {
    dropPending(); clearRequest(); tapNote = ''
    history.length = 0
    while (grounds.length) removeGround(grounds[0])
    while (fittings.length) removeFitting(fittings[0])
  }

  const snapshot = () => grounds.map(g => ({id: g.id, a: endData(g.a), b: endData(g.b), placedAt: g.placedAt}))

  // ---- saving on this device (so a page refresh does not lose the session) -----------------------------
  const save = () => {
    if (viewing) return // never overwrite the live session with a record that is only being looked at
    try {
      const empty = !grounds.length && !fittings.length && !student && !scenario && !structure.number && !structure.line && !structure.job && !Object.keys(labels).length
      if (empty) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify({student, scenario, structure, labels, anchors, showTags, sessionStart, savedAt: new Date().toISOString(), fittings: fittingsSnapshot(), grounds: snapshot()}))
    } catch (e) { /* storage unavailable (private window, blocked): the session simply is not kept */ }
  }

  // ---- what a tap does ---------------------------------------------------------------------------
  // A wire or the pole ground: a clamp. The pole: a cluster bracket. The ground beside the pole: a ground rod. A bracket
  // or rod that is already there: fasten a cable to it. The first tap starts a ground, the second one finishes it.
  const tapKind = part => (isConductor(part) ? 'wire' : cfg.BLOCKED_PART.test(part) ? 'blocked' : cfg.GROUND_PART.test(part) ? 'lead' : cfg.POLE_PART.test(part) ? 'pole' : 'other')
  let poleFound = null
  const hasPole = () => {
    if (poleFound === null) {
      poleFound = false
      stage.modelGroup.traverse((o) => { if (o.isMesh && !o.userData.noPick && o.name && tapKind(o.name) === 'pole') poleFound = true })
    }
    return poleFound
  }
  const hasAncestor = (obj, top) => { for (let o = obj; o; o = o.parent) if (o === top) return true; return false }

  const markPending = (end, on) => { if (end.kind === 'fitting') fittingKit.setPending(end.fitting, on); else clampKit.setPending(end.clamp, on) }
  const startGround = (end) => {
    pending = end
    markPending(end, true)
    if (!sessionStart) sessionStart = new Date().toISOString()
    emit()
  }
  const finishGround = (second) => {
    const first = pending
    pending = null
    markPending(first, false)
    makeGround(nextId(), first, second, new Date().toISOString())
    save()
    emit()
  }
  const placeEnd = end => (pending ? finishGround(end) : startGround(end))
  const note = (str) => { tapNote = str; emit() }

  // A piece of hardware under the tap: {f, hit}. A ray must hit it exactly; a finger also counts when it lands right beside it
  // (but a wire close to the finger wins, and next to the pole ground the finger must be well on the bracket).
  const fittingAt = (clientX, clientY, pointerType, mHit) => {
    if (!fittings.length) return null
    const rect = stage.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    const hits = raycaster.intersectObjects(fittings.map(f => f.group), true).filter(h => h.object.userData.fitPart) // not the clamps on it
    if (hits.length) {
      const f = fittings.find(x => hasAncestor(hits[0].object, x.group))
      if (f && (!mHit || hits[0].distance <= mHit.distance + 1e-4)) return {f, hit: hits[0]}
    }
    if (pointerType === 'mouse') return null
    const kind = mHit ? tapKind(partName(mHit.object)) : 'none'
    if (kind === 'wire') return null
    stage.camera.updateMatrixWorld()
    const camPos = stage.camera.getWorldPosition(new THREE.Vector3())
    let best = null
    fittings.forEach((f) => {
      const p = f.group.getWorldPosition(new THREE.Vector3())
      const d = camPos.distanceTo(p)
      const v = p.clone().project(stage.camera)
      if (v.z > 1) return
      const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top
      const rWorld = f.group.userData.radius * f.group.getWorldScale(tmp.a).x
      const rPx = (rWorld * (rect.height / 2) * stage.camera.projectionMatrix.elements[5]) / Math.max(d, 1e-6)
      const dist = Math.hypot(sx - clientX, sy - clientY)
      const reach = kind === 'lead' ? rPx * 0.8 : rPx + 20 // right beside the pole ground, only a finger really on the bracket counts
      if (dist <= reach && (!best || dist < best.dist)) best = {f, hit: null, dist}
    })
    return best
  }

  // The place on a bracket's U nearest to a fingertip (world position).
  const nearestUPoint = (f, clientX, clientY) => {
    const rect = stage.renderer.domElement.getBoundingClientRect()
    f.group.updateWorldMatrix(true, false)
    let best = null
    f.group.userData.bracketU.samples.forEach((smp) => {
      const w = f.group.localToWorld(smp.clone())
      const v = w.clone().project(stage.camera)
      const d = Math.hypot((v.x * 0.5 + 0.5) * rect.width + rect.left - clientX, (-v.y * 0.5 + 0.5) * rect.height + rect.top - clientY)
      if (!best || d < best.d) best = {d, w}
    })
    return best.w
  }

  // A ground clamp on a bracket's U at a world point.
  const placeClampOnBracket = (f, pointWorld) => {
    const node = f.group
    node.updateWorldMatrix(true, false)
    const pose = clampPose(node, pointWorld, new THREE.Vector3(0, 1, 0))
    return buildClampOn(node, node.worldToLocal(pose.point.clone()), dirToLocal(node, pose.dir))
  }

  // The point on the ground (the floor level of the model) under a tap, in model coordinates, or null.
  const floorPoint = (clientX, clientY) => {
    if (!colliders) buildColliders()
    const rect = stage.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    stage.modelGroup.updateWorldMatrix(true, false)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY).applyMatrix4(stage.modelGroup.matrixWorld)
    const out = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, out)) return null
    return stage.modelGroup.worldToLocal(out)
  }
  const nearPole = (pt) => {
    for (const c of colliders || []) {
      const r = radiusAt(c, Math.max(c.minY, Math.min(c.maxY, floorY)))
      const d = Math.hypot(pt.x - c.cx, pt.z - c.cz)
      if (d >= r && d <= r + cfg.ROD_REACH * stage.radius) return true
    }
    return false
  }

  const tapClamp = (hit) => {
    const p = placeClamp(hit)
    if (isConductor(p.part) && !anchors[p.part]) anchors[p.part] = round4(stage.modelGroup.worldToLocal(hit.point.clone()).toArray())
    if (needsName(p.part)) askName(p.part) // ask once per conductor
    placeEnd(p)
  }
  const tapFitting = ({f, hit}, clientX, clientY) => {
    if (f.type === 'ground_rod') {
      if (pending && pending.kind === 'fitting' && pending.fitting === f) return note(`Tap a different point to connect ${f.label} to.`)
      return placeEnd({kind: 'fitting', fitting: f})
    }
    // a bracket: a clamp goes on its U, the same as on a wire
    let point
    if (hit && hit.object.userData.uPart) point = hit.point.clone()
    else if (hit) return note('Tap the square U on the bracket to attach a ground clamp.')
    else point = nearestUPoint(f, clientX, clientY)
    placeEnd(placeClampOnBracket(f, point))
  }
  // The pole: add a cluster bracket. It is only a place for clamps, so nothing is connected yet.
  const tapPole = (hit) => {
    const node = hit.object
    node.updateWorldMatrix(true, false)
    const nWorld = (hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1)).transformDirection(node.matrixWorld)
    const f = makeBracket(node, hit.point.clone(), nWorld)
    if (!sessionStart) sessionStart = new Date().toISOString()
    save()
    note(`${f.label} placed. Tap its square U to attach a ground clamp, the same as on a wire.`)
  }
  const tapGround = (clientX, clientY) => {
    if (!hasPole()) return
    const pt = floorPoint(clientX, clientY)
    if (!pt || !nearPole(pt)) return note('Tap a wire, the pole ground, the pole (cluster bracket) or the ground right beside the pole (ground rod).')
    if (pending && pending.kind === 'fitting' && pending.fitting.type === 'ground_rod') {
      return note(`${pending.fitting.label} is placed. Tap the pole ground, a wire or the U bracket to connect it.`)
    }
    placeEnd({kind: 'fitting', fitting: makeRod(pt)})
  }

  const handleTap = (clientX, clientY, pointerType) => {
    if (tapNote) { tapNote = ''; emit() }
    stage.modelGroup.updateWorldMatrix(true, true)
    const mHit = hitPart(clientX, clientY, pointerType)
    if (nameMode) { if (mHit) nameTap(mHit); return }
    const found = fittingAt(clientX, clientY, pointerType, mHit)
    if (found) return tapFitting(found, clientX, clientY)
    if (!mHit) return tapGround(clientX, clientY)
    const kind = tapKind(partName(mHit.object))
    if (kind === 'blocked') return note('Clamps go on a wire, the pole ground or the pole. The crossarm and insulators are not used for grounding.')
    if (kind === 'pole') return tapPole(mHit)
    return tapClamp(mHit)
  }

  // In name mode a tap on any conductor opens its name box (and moves its tag to where it was tapped).
  const nameTap = (hit) => {
    const part = partName(hit.object)
    if (!isConductor(part)) { modeNote = 'That is not a conductor. Tap one of the wires.'; emit(); return }
    modeNote = ''
    anchors[part] = round4(stage.modelGroup.worldToLocal(hit.point.clone()).toArray())
    askName(part)
    emit()
  }

  // Draws a ground from saved data. Returns false if one of its parts is not in this model.
  const addGroundFromData = (d, opts) => {
    const a = endFromData(d.a, opts)
    if (!a) return false
    const b = endFromData(d.b, opts)
    if (!b) { if (a.kind === 'clamp') removeClamp(a.clamp); return false }
    makeGround(d.id, a, b, d.placedAt)
    return true
  }
  const endFromData = (e, opts) => {
    if (e.kind === 'fitting') {
      const f = fittings.find(x => x.id === e.fitting)
      return f && f.type === 'ground_rod' ? {kind: 'fitting', fitting: f, slot: Number.isInteger(e.slot) ? e.slot : undefined} : null // (a bracket is no longer a cable end: clamps go on its U)
    }
    return placeClampFromData(e, opts)
  }

  // ---- tap detection (a tap places a clamp; a drag rotates/zooms and places nothing) -------------------
  // el: where to listen; options.target: the element taps must land on (default: the stage's canvas).
  const attach = (el, {target = null} = {}) => {
    const canvas = target || stage.renderer.domElement
    const active = new Set()
    let down = null
    const onDown = (e) => {
      active.add(e.pointerId)
      if (!enabled || viewing || nameRequest || e.button !== 0 || !e.isPrimary || active.size > 1 || e.target !== canvas) { down = null; return }
      down = {x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId}
    }
    const onUp = (e) => {
      active.delete(e.pointerId)
      const d = down
      down = null
      if (!d || !enabled || viewing || nameRequest || d.id !== e.pointerId) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > cfg.TAP_MAX_MOVE_PX || performance.now() - d.t > cfg.TAP_MAX_MS) return
      handleTap(e.clientX, e.clientY, e.pointerType)
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
    scaleTags()
    if (pending && pending.kind === 'fitting') fittingKit.glow.emissiveIntensity = 0.45 + 0.35 * Math.sin(time * 7)
    else if (pending) pending.clamp.scale.setScalar(pending.clamp.userData.baseScale * (1 + 0.14 * Math.sin(time * 7)))
  })

  const closeRecord = () => {
    if (!viewing) return
    const {stash} = viewing
    removeAll()
    viewing = null
    student = stash.student; scenario = stash.scenario; sessionStart = stash.sessionStart
    structure = stash.structure; labels = stash.labels; anchors = stash.anchors
    stash.fittings.forEach(d => addFittingFromData(d))
    stash.grounds.forEach(d => addGroundFromData(d))
    syncTags()
    emit()
  }

  const api = {
    get enabled() { return enabled },
    setEnabled(on) {
      enabled = !!on
      if (!enabled) { closeRecord(); dropPending(); clearRequest(); nameMode = false; modeNote = '' }
      syncTags()
      emit()
    },
    attach,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    // What the panel shows.
    get pending() {
      if (!pending) return null
      return pending.kind === 'fitting'
        ? {part: pending.fitting.id, label: pending.fitting.label, kind: 'fitting', type: pending.fitting.type}
        : {part: pending.part, label: endLabel(pending), kind: 'clamp', type: 'clamp'}
    },
    // A short hint after a tap that could not be used, or ''.
    get tapNote() { return tapNote },
    // True when the model has a pole, so a tap on the pole adds a cluster bracket and a tap beside it adds a ground rod.
    get hardwareReady() { return hasPole() },
    // The hardware placed so far: {id, type, label, cables}.
    hardware() { return fittings.map(f => ({id: f.id, type: f.type, label: f.label, cables: usesOf(f)})) },
    // Removes a bracket or rod together with every cable fastened to it.
    removeFitting(id) {
      if (viewing) return
      const f = fittings.find(x => x.id === id)
      if (f) { removeFitting(f); if (!grounds.length && !pending && !fittings.length) sessionStart = null; save(); emit() }
    },
    // A conductor that was just tapped and needs a name: {part, suggestion}, or null.
    get nameRequest() { return nameRequest ? {...nameRequest, choices: cfg.NAME_CHOICES} : null },
    get nameMode() { return nameMode },
    get showTags() { return showTags },
    setShowTags(on) { showTags = !!on; syncTags(); save(); emit() },
    get modeNote() { return modeNote },
    // Name mode: taps name conductors instead of placing clamps.
    setNameMode(on) {
      if (viewing) return
      nameMode = !!on
      modeNote = ''
      if (nameMode) { dropPending(); clearRequest() }
      else clearRequest()
      emit()
    },
    // Open the name box for a conductor that already has a name (to change it).
    askName(part) { if (!viewing) { askName(part); emit() } },
    // Skip / cancel: keep the current name, or take the suggested one if there is none yet.
    skipName() { if (nameRequest) api.setLabel(nameRequest.part, nameRequest.current || nameRequest.suggestion) },
    // How many conductors the model has, and the ones named so far (by their given names, not part names).
    conductorStatus() {
      const parts = conductorParts()
      const items = parts.filter(part => labels[part]).map(part => ({part, label: labels[part]}))
      return {total: parts.length, named: items.length, items}
    },
    get structure() { return {...structure} },
    // The conductors in this model with the name given to each so far ('' if none) and the suggested name.
    conductors() { return conductorParts().map(part => ({part, label: labels[part] || '', suggestion: defaultLabel(part)})) },
    // Give a conductor its name (an empty name goes back to the suggested one).
    setLabel(part, label) {
      if (viewing) return
      const v = String(label || '').trim().slice(0, 40)
      if (v) labels[part] = v; else delete labels[part]
      if (nameRequest && nameRequest.part === part) clearRequest()
      if (nameMode && v) modeNote = `Named "${v}". Tap another wire, or press Done.`
      syncTags()
      save(); emit()
    },
    setStructure(v) {
      if (viewing) return
      if (v.number !== undefined) structure.number = String(v.number).slice(0, 60)
      if (v.line !== undefined) structure.line = String(v.line).slice(0, 80)
      if (v.job !== undefined) structure.job = String(v.job).slice(0, 60)
      save()
    },
    get viewing() { return viewing ? {record: viewing.record} : null },
    get student() { return student },
    get scenario() { return scenario },
    setSession(v) {
      if (viewing) return
      if (v.student !== undefined) student = String(v.student).slice(0, 60)
      if (v.scenario !== undefined) scenario = String(v.scenario).slice(0, 80)
      save()
    },
    list() { return grounds.map(g => ({id: g.id, a: endLabel(g.a), b: endLabel(g.b)})) },
    // The record entries: one per completed ground.
    snapshot,
    // Remove the pending first clamp if there is one, otherwise the last completed ground.
    undo() {
      if (viewing) return
      clearRequest()
      tapNote = ''
      if (pending) dropPending()
      else {
        let last = null
        while (history.length && !last) { const c = history.pop(); if (grounds.includes(c) || fittings.includes(c)) last = c }
        if (!last) last = grounds[grounds.length - 1] || fittings[fittings.length - 1]
        if (grounds.includes(last)) removeGround(last) // takes its rod with it if nothing else uses it
        else if (last) removeFitting(last)
      }
      if (!grounds.length && !pending && !fittings.length) sessionStart = null
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
      if (g) { removeGround(g); if (!grounds.length && !pending && !fittings.length) sessionStart = null; save(); emit() }
    },
    // A new session: clears the grounds, the student name and the saved copy on this device.
    startFresh() {
      viewing = null
      removeAll()
      student = ''; scenario = ''; sessionStart = null
      structure = {number: '', line: '', job: ''}; labels = {}; anchors = {}; showTags = false; nameMode = false; modeNote = ''
      syncTags()
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
        const st = s.structure || {}
        structure = {number: String(st.number || ''), line: String(st.line || ''), job: String(st.job || '')}
        labels = {}
        Object.entries(s.labels || {}).forEach(([k, v]) => { if (typeof v === 'string' && v.trim()) labels[k] = v.trim().slice(0, 40) })
        anchors = {}
        Object.entries(s.anchors || {}).forEach(([k, a]) => { if (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) anchors[k] = a })
        showTags = !!s.showTags
        syncTags()
        let count = 0
        ;(Array.isArray(s.fittings) ? s.fittings : []).forEach((d) => { try { addFittingFromData(d) } catch (e) { /* skip a damaged entry */ } })
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
          student, scenario, sessionStart, sessionEnd: new Date().toISOString(), grounds: snapshot(), fittings: fittingsSnapshot(),
          structure: {...structure, conductors: Object.fromEntries(conductorParts().map(part => [part, labelFor(part)]))},
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
      const stash = viewing ? viewing.stash : {grounds: snapshot(), fittings: fittingsSnapshot(), student, scenario, sessionStart, structure: {...structure}, labels: {...labels}, anchors: {...anchors}}
      removeAll()
      viewing = {record, stash}
      let skipped = 0
      let skippedFittings = 0
      record.fittings.forEach((d) => { if (!addFittingFromData(d, {fixedLabel: true})) skippedFittings++ })
      record.grounds.forEach((d) => { if (!addGroundFromData(d, {fixedLabel: true})) skipped++ })
      nameMode = false; modeNote = ''
      syncTags()
      emit()
      return {ok: true, drawn: record.grounds.length - skipped, skipped, skippedFittings, modelChanged: changed}
    },
    closeRecord,
    destroy() {
      removeAll()
      while (tagSprites.length) { const t = tagSprites.pop(); tagGroup.remove(t); t.material.map.dispose(); t.material.dispose() }
      stage.modelGroup.remove(tagGroup)
      hiMat.dispose()
      offTick()
      if (detach) detach()
      clampKit.dispose()
      fittingKit.dispose()
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
.gd-compact .gd-session,.gd-compact .gd-setup,.gd-compact .gd-list,.gd-compact .gd-btns.small{display:none}
.gd-compact.gd-open .gd-session{display:flex}
.gd-compact.gd-open .gd-setup{display:block}
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
.gd-namebox{margin:0 0 10px;padding:10px;border-radius:12px;background:#FFEF00;color:#000}
.gd-namebox[hidden]{display:none}
.gd-nametitle{font-weight:700;font-size:15px}
.gd-nametitle small{font-weight:500;opacity:.7;margin-left:6px}
.gd-namechoices{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.gd-namechoices button{height:44px;padding:0 14px;border:0;border-radius:10px;background:#000;color:#FFEF00;font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-namerow{display:flex;gap:8px}
.gd-nameinput{flex:1;min-width:0;height:44px;border:2px solid #000;border-radius:10px;padding:0 10px;font:inherit;font-size:16px;background:#fff;color:#000}
.gd-nameok,.gd-nameskip{flex:none;height:44px;padding:0 14px;border:0;border-radius:10px;font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-nameok{background:#000;color:#FFEF00}
.gd-nameskip{background:rgba(0,0,0,.14);color:#000}
.gd-session{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.gd-session[hidden]{display:none}
.gd-session input{flex:1 1 140px;min-width:0;height:40px;border:2px solid #444;border-radius:10px;background:#111;color:#fff;padding:0 10px;font:inherit;font-size:16px}
.gd-session input:focus{outline:none;border-color:#FFEF00}
.gd-session input.bad{border-color:#ff6b5e}
.gd-setup{margin:0 0 10px;border:1px solid #333;border-radius:10px;padding:0 10px}
.gd-setup[hidden]{display:none}
.gd-setup summary{cursor:pointer;padding:10px 0;font-weight:700;color:#FFEF00}
.gd-setup label{display:block;font-size:12px;color:#bdbdbd;margin:8px 0 2px}
.gd-setup input{width:100%;height:40px;border:2px solid #444;border-radius:10px;background:#111;color:#fff;padding:0 10px;font:inherit;font-size:16px}
.gd-setup input:focus{outline:none;border-color:#FFEF00}
.gd-setup h4{margin:12px 0 0;font-size:13px;color:#fff}
.gd-setup .gd-hint{font-size:12px;color:#bdbdbd;margin:2px 0 4px}
.gd-cond{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:8px;align-items:center;margin-top:6px}
.gd-cond span{font-size:12px;color:#bdbdbd;overflow-wrap:anywhere}
.gd-setup .gd-end{height:10px}
.gd-modebar{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:8px 10px;border-radius:10px;background:#FFEF00;color:#000;font-weight:600}
.gd-modebar[hidden]{display:none}
.gd-modebar span{flex:1;min-width:0}
.gd-modedone{flex:none;height:40px;padding:0 16px;border:0;border-radius:10px;background:#000;color:#FFEF00;font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-namemode{width:100%;height:44px;margin:8px 0 4px;border:0;border-radius:10px;background:#FFEF00;color:#000;font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-cstatus{font-size:12px;color:#bdbdbd}
.gd-setup label.gd-check{display:flex;align-items:center;gap:10px;font-size:14px;color:#fff;margin:10px 0 4px}
.gd-setup .gd-check input{width:22px;height:22px;flex:none;accent-color:#FFEF00}
.gd-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.gd-chip{height:40px;padding:0 14px;border:0;border-radius:999px;background:#2a2a2a;color:#fff;font:600 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.gd-chip:active{background:#444}
.gd-msg{font-weight:600;font-size:15px;min-height:22px;overflow-wrap:anywhere}
.gd-msg b{color:#FFEF00}
.gd-note{margin-top:6px;padding:6px 10px;border-radius:8px;background:#222;color:#d8d8d8;font-size:13px;overflow-wrap:anywhere}
.gd-note.err{background:#5a1a14;color:#fff}
.gd-note[hidden]{display:none}
.gd-list{margin:8px 0 0;padding:0;list-style:none;max-height:min(24vh,170px);overflow:auto}
.gd-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #333}
.gd-id{flex:none;min-width:34px;font-weight:700;color:#000;background:#19d35a;border-radius:999px;text-align:center;padding:2px 8px}
.gd-parts{flex:1;min-width:0;overflow-wrap:anywhere}
.gd-sub{padding:8px 0 2px;border-top:1px solid #333;font-size:12px;color:#bdbdbd;text-transform:uppercase;letter-spacing:.04em}
.gd-hw .gd-id{background:#d9a066}
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
    + '<div class="gd-modebar" hidden><span>Tap a wire on the model to name it.</span><button type="button" class="gd-modedone">Done</button></div>'
    + '<div class="gd-namebox" hidden><div class="gd-nametitle"><b>Name this conductor</b><small></small></div><div class="gd-namechoices"></div>'
    + '<div class="gd-namerow"><input class="gd-nameinput" type="text" maxlength="40" placeholder="Or type the name used on this line" aria-label="Conductor name" autocomplete="off">'
    + '<button type="button" class="gd-nameok">OK</button><button type="button" class="gd-nameskip">Skip</button></div></div>'
    + '<div class="gd-session"><input class="gd-name" type="text" maxlength="60" placeholder="Student name" aria-label="Student name" autocomplete="off">'
    + '<input class="gd-scn" type="text" maxlength="80" placeholder="Class (optional)" aria-label="Class or scenario" autocomplete="off"></div>'
    + '<details class="gd-setup"><summary>Structure setup</summary>'
    + '<label>Structure / pole number<input class="gd-st-number" type="text" maxlength="60" autocomplete="off"></label>'
    + '<label>Line or circuit name<input class="gd-st-line" type="text" maxlength="80" autocomplete="off"></label>'
    + '<label>Job / work order number<input class="gd-st-job" type="text" maxlength="60" autocomplete="off"></label>'
    + '<h4>Conductor names</h4><div class="gd-hint">Tap a wire on the model to name it. You can also name a wire the first time you ground to it.</div>'
    + '<button type="button" class="gd-namemode">Name conductors by tapping</button><div class="gd-cstatus"></div><div class="gd-chips"></div>'
    + '<label class="gd-check"><input type="checkbox" class="gd-showtags">Show conductor name tags on the model</label><div class="gd-end"></div></details>'
    + '<div class="gd-msg"></div><div class="gd-note" hidden></div><ul class="gd-list"></ul>'
    + '<div class="gd-btns"><button type="button" class="gd-undo">Undo last</button><button type="button" class="gd-clear">Clear all</button>'
    + '<button type="button" class="gd-morebtn" aria-expanded="false">More</button></div>'
    + '<div class="gd-btns small"><button type="button" class="gd-export">Export record</button><button type="button" class="gd-load">Load record</button>'
    + '<button type="button" class="gd-fresh">Start fresh</button></div>'
    + '<input class="gd-file" type="file" accept=".json,application/json" hidden>'
  root.appendChild(panel)
  const q = sel => panel.querySelector(sel)
  const banner = q('.gd-banner')
  const modeBar = q('.gd-modebar')
  const nameBox = q('.gd-namebox')
  const nameHead = q('.gd-nametitle b')
  const nameTitle = q('.gd-nametitle small')
  const nameChoices = q('.gd-namechoices')
  const nameInput = q('.gd-nameinput')
  const session = q('.gd-session')
  const nameIn = q('.gd-name')
  const scnIn = q('.gd-scn')
  const setup = q('.gd-setup')
  const stNumber = q('.gd-st-number')
  const stLine = q('.gd-st-line')
  const stJob = q('.gd-st-job')
  const nameModeBtn = q('.gd-namemode')
  const cstatus = q('.gd-cstatus')
  const chips = q('.gd-chips')
  const showTagsBox = q('.gd-showtags')
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
  const touchScreen = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

  let shownRequest = '' // which conductor the name box is currently built for

  const renderNameBox = (req) => {
    nameBox.hidden = !req
    if (!req) { shownRequest = ''; return }
    const key = `${req.part}|${req.current}`
    if (shownRequest === key) return // already built (keep what the user is typing)
    shownRequest = key
    nameHead.textContent = req.current ? 'Rename this conductor' : 'Name this conductor'
    nameTitle.textContent = req.current ? `(now "${req.current}")` : ''
    q('.gd-nameskip').textContent = req.current ? 'Cancel' : 'Skip'
    nameChoices.textContent = ''
    const choices = req.choices.includes(req.suggestion) ? req.choices : [req.suggestion, ...req.choices]
    choices.forEach((c) => {
      const b = text(nameChoices, 'button', '', c)
      b.type = 'button'
      b.addEventListener('click', () => grounding.setLabel(req.part, c))
    })
    nameInput.value = req.current
    if (!touchScreen) { nameInput.focus(); nameInput.select() } // a phone keyboard would cover the model; the quick buttons come first there
  }

  const renderSetup = (view) => {
    setup.hidden = !!view
    const st = grounding.structure
    if (document.activeElement !== stNumber) stNumber.value = st.number
    if (document.activeElement !== stLine) stLine.value = st.line
    if (document.activeElement !== stJob) stJob.value = st.job
    const status = grounding.conductorStatus()
    showTagsBox.checked = grounding.showTags
    cstatus.textContent = status.total ? `${status.named} of ${status.total} conductors named` : ''
    nameModeBtn.textContent = grounding.nameMode ? 'Done naming' : (status.named ? 'Name or rename conductors by tapping' : 'Name conductors by tapping')
    chips.textContent = ''
    status.items.forEach((c) => {
      const b = text(chips, 'button', 'gd-chip', `${c.label}  ✎`)
      b.type = 'button'
      b.setAttribute('aria-label', `Rename ${c.label}`)
      b.addEventListener('click', () => grounding.askName(c.part))
    })
  }

  const render = () => {
    const items = grounding.list()
    const hardware = grounding.hardware()
    const hw = grounding.hardwareReady
    const pending = grounding.pending
    const view = grounding.viewing
    const req = grounding.nameRequest
    // banner for a saved record that is being viewed
    banner.hidden = !view
    if (view) {
      const r = view.record
      const st = r.structure || {}
      const where = [st.number && `structure ${st.number}`, st.line].filter(Boolean).join(', ')
      banner.querySelector('span').textContent = `Viewing saved record: ${r.student || 'no name'}${where ? `, ${where}` : ''}${r.scenario ? ` (${r.scenario})` : ''}, ${fmtTime(r.sessionEnd)}. Read-only.`
    }
    session.hidden = !!view
    if (document.activeElement !== nameIn) nameIn.value = grounding.student
    if (document.activeElement !== scnIn) scnIn.value = grounding.scenario
    renderNameBox(req)
    renderSetup(view)
    modeBar.hidden = !(grounding.nameMode && !view)
    // the instruction line
    msg.textContent = ''
    if (view) {
      msg.textContent = `${items.length} ground${items.length === 1 ? '' : 's'} in this record.`
    } else if (req) {
      msg.textContent = 'Name the highlighted conductor, then carry on.'
    } else if (grounding.nameMode) {
      msg.textContent = grounding.modeNote || 'Tap any conductor (a wire) on the model.'
    } else if (grounding.tapNote) {
      msg.textContent = grounding.tapNote
    } else if (pending && pending.kind === 'fitting') {
      text(msg, 'b', '', pending.label)
      msg.append(pending.type === 'ground_rod'
        ? ' placed. Tap the pole ground, a wire or the square U of a bracket.'
        : ' placed. Tap a wire or the pole ground, or the ground beside the pole for a rod.')
    } else if (pending) {
      msg.append('Clamp 1 on ')
      text(msg, 'b', '', pending.label)
      msg.append(hw ? '. Tap the second point: another wire, the pole ground, the square U of a bracket, or the ground beside the pole (rod).' : '. Tap the second point.')
    } else if (items.length) {
      msg.textContent = hw ? 'Ground placed. Tap a wire, the pole or the ground beside it to start the next one.' : 'Ground placed. Tap a part to start the next one.'
    } else {
      msg.textContent = `${lockedHint ? 'Model locked. ' : ''}${hw ? 'Tap a wire for a clamp, the pole for a cluster bracket, or the ground beside the pole for a rod.' : 'Tap a part to place the first clamp.'}`
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
    if (hardware.length) {
      text(list, 'li', 'gd-sub', 'Hardware')
      hardware.forEach((h) => {
        const li = document.createElement('li')
        li.className = 'gd-row gd-hw'
        text(li, 'span', 'gd-id', h.id)
        text(li, 'span', 'gd-parts', `${h.label}${h.cables ? ` \u00b7 ${h.cables} cable${h.cables === 1 ? '' : 's'}` : ''}`)
        if (!view) {
          const x = text(li, 'button', 'gd-x', '\u2715')
          x.type = 'button'
          x.setAttribute('aria-label', `Delete ${h.label}`)
          x.addEventListener('click', () => {
            if (h.cables && !window.confirm(`Delete ${h.label} and the ${h.cables} cable${h.cables === 1 ? '' : 's'} on it?`)) return
            grounding.removeFitting(h.id)
          })
        }
        list.appendChild(li)
      })
    }
    const empty = !pending && !items.length && !hardware.length
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
  stNumber.addEventListener('input', () => grounding.setStructure({number: stNumber.value}))
  stLine.addEventListener('input', () => grounding.setStructure({line: stLine.value}))
  stJob.addEventListener('input', () => grounding.setStructure({job: stJob.value}))

  // naming a conductor: a quick button, or type a name and press OK / Enter; Skip keeps the suggested name
  const confirmName = () => {
    const req = grounding.nameRequest
    if (req) grounding.setLabel(req.part, nameInput.value.trim() || req.suggestion)
  }
  q('.gd-nameok').addEventListener('click', confirmName)
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmName() } })
  q('.gd-nameskip').addEventListener('click', () => grounding.skipName())
  const toggleNameMode = () => {
    const on = !grounding.nameMode
    grounding.setNameMode(on)
    if (on) { setup.open = false; setMore(false); showNote('') } // clear the way so the model can be tapped
  }
  nameModeBtn.addEventListener('click', toggleNameMode)
  showTagsBox.addEventListener('change', () => grounding.setShowTags(showTagsBox.checked))
  q('.gd-modedone').addEventListener('click', () => grounding.setNameMode(false))

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
    if (parsed.record.sourceVersion === 1) bits.push('This is an older record (version 1): it has no conductor names, so suggested names (A Phase, B Phase...) are shown.')
    if (res.modelChanged) bits.push('This model was updated since the record was made; positions are re-fitted from the saved model coordinates.')
    if (res.skipped) bits.push(`${res.skipped} ground${res.skipped === 1 ? '' : 's'} could not be drawn because a named part is missing from this model.`)
    if (res.skippedFittings) bits.push(`${res.skippedFittings} bracket${res.skippedFittings === 1 ? '' : 's'} or rod${res.skippedFittings === 1 ? '' : 's'} could not be placed because the part is missing from this model.`)
    showNote(bits.join(' '), res.skipped > 0 || res.skippedFittings > 0)
  })
  q('.gd-closerec').addEventListener('click', () => { showNote(''); grounding.closeRecord() })

  freshBtn.addEventListener('click', () => {
    const st = grounding.structure
    const has = grounding.list().length || grounding.hardware().length || grounding.pending || grounding.student || grounding.scenario
      || st.number || st.line || st.job || grounding.conductorStatus().named
    if (has && !window.confirm('Start fresh? This clears the grounds, the student name, the structure details and the conductor names on this device. Export the record first if you need it.')) return
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
