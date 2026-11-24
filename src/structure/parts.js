// The parts library of the structure builder. Every function here makes ONE kind of part as a named 3D mesh, in meters,
// Y up, with the pole standing on the ground at the origin and the power line running along Z.
//
// The part NAMES matter: the grounding tool decides what a tap means from the name (see GROUND_CONFIG in grounding.js):
//   "Pole..."                        the pole body: a tap adds a cluster bracket
//   "...Conductor..."                a wire: a tap places a ground clamp (names like PhaseA_Conductor give "A Phase")
//   "...Crossarm..." / "Insulator..." not a place for a clamp
//   "GroundLead" / "GroundPoint"     the down ground on the pole
// Training visual only: sizes are nominal. Conductors and the down ground are deliberately thick so they can be tapped
// when the structure is shown small in AR.
import * as THREE from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
const std = (rgb, roughness, metalness) => new THREE.MeshStandardMaterial({color: lin(...rgb), roughness, metalness})

// One set of materials per built structure (so rebuilding can dispose them cleanly).
export function makeMaterials() {
  return {
    wood: std([0.42, 0.28, 0.16], 0.9, 0),
    woodArm: std([0.55, 0.40, 0.24], 0.85, 0),
    porcelain: std([0.72, 0.78, 0.84], 0.3, 0),
    glass: std([0.55, 0.78, 0.68], 0.12, 0.05),
    polymer: std([0.2, 0.21, 0.23], 0.65, 0),
    aluminum: std([0.72, 0.74, 0.77], 0.4, 0.85),
    copper: std([0.78, 0.46, 0.2], 0.35, 0.85),
    copperDark: std([0.5, 0.28, 0.12], 0.45, 0.8),
    steel: std([0.42, 0.45, 0.48], 0.5, 0.8),
    concrete: std([0.55, 0.55, 0.52], 0.95, 0),
  }
}

const named = (name, geometry, material) => {
  const m = new THREE.Mesh(geometry, material)
  m.name = name
  return m
}

// A round wire along a line of points, with flat ends closed (so nobody can see into it when looking down the line).
function cappedTube(points, radius, radial = 12, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(points)
  const tube = new THREE.TubeGeometry(curve, segments, radius, radial, false)
  const caps = [0, 1].map((u) => {
    const cap = new THREE.CircleGeometry(radius, radial)
    const tangent = curve.getTangent(u)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), u === 0 ? tangent.clone().negate() : tangent)
    cap.applyQuaternion(q)
    const p = curve.getPoint(u)
    cap.translate(p.x, p.y, p.z)
    return cap
  })
  return mergeGeometries([tube, ...caps])
}

// ---- the pole -----------------------------------------------------------------------------------------------
export const poleRadiusAt = (pole, y) => pole.rBase + (pole.rTop - pole.rBase) * (y / pole.height)

export function makePole(mats, pole) {
  const g = new THREE.CylinderGeometry(pole.rTop, pole.rBase, pole.height, 24).translate(0, pole.height / 2, 0)
  return named('Pole', g, mats.wood)
}

// ---- arms ---------------------------------------------------------------------------------------------------
// A wood arm sticking out of the pole sideways: side = +1 (right, +X) or -1 (left, -X). It starts inside the pole so it
// looks bolted on.
export function makeSideArm(mats, pole, {name, side, y, length, height = 0.16, depth = 0.12}) {
  const r = poleRadiusAt(pole, y)
  const x0 = side * r * 0.6
  const x1 = side * (r + length)
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), height, depth)
  const m = named(name, g, mats.woodArm)
  m.position.set((x0 + x1) / 2, y, 0)
  m.userData.top = y + height / 2
  m.userData.endX = x1
  return m
}

// A crossarm straddling the pole, with the length given as how far it reaches each way.
export function makeCrossarm(mats, {name, y, reach, height = 0.16, depth = 0.12}) {
  const m = named(name, new THREE.BoxGeometry(reach * 2, height, depth), mats.woodArm)
  m.position.set(0, y, 0)
  m.userData.top = y + height / 2
  return m
}

// ---- insulator string -------------------------------------------------------------------------------------------
// A suspension string hanging straight down from (x, y): a hook at the top, then the insulator, then the conductor clamp.
// The insulator is chosen by how many bells it has and what it is made of:
//   glass    a stack of dome-shaped bells (discs), one per bell
//   polymer  one grey rod with thin fins; made as long as the same number of glass bells would be
export const BELL_SPACING = 0.146 // m between bells (5.75 in)
export const BELL_RADIUS = 0.127 // m (10 in discs)
const STRING_TOP = 0.12 // hook and eye above the first bell
const STRING_BOTTOM = 0.15 // clamp below the last bell
export const MAX_BELLS = 24
export const stringLength = bells => STRING_TOP + bells * BELL_SPACING + STRING_BOTTOM

function glassBells(bells) {
  const prof = [[0.02, 0.0], [0.02, 0.03], [0.045, 0.045], [BELL_RADIUS * 0.7, 0.05], [BELL_RADIUS, 0.015], [BELL_RADIUS, -0.01],
    [BELL_RADIUS * 0.55, -0.02], [0.05, -0.05], [0.05, -0.085], [0.02, -0.09]].map(([r, h]) => new THREE.Vector2(r, h))
  const bell = new THREE.LatheGeometry(prof, 20)
  const parts = []
  for (let i = 0; i < bells; i++) parts.push(bell.clone().translate(0, -(STRING_TOP + (i + 0.55) * BELL_SPACING), 0))
  return parts
}

function polymerRod(bells) {
  const len = bells * BELL_SPACING
  const parts = [new THREE.CylinderGeometry(0.02, 0.02, len, 10).translate(0, -(STRING_TOP + len / 2), 0)]
  const fins = Math.max(2, Math.round(len / 0.07))
  const fin = new THREE.CylinderGeometry(0.058, 0.026, 0.02, 14)
  for (let i = 0; i < fins; i++) {
    const big = i % 2 === 0
    parts.push(fin.clone().scale(big ? 1 : 0.78, 1, big ? 1 : 0.78).translate(0, -(STRING_TOP + ((i + 0.5) * len) / fins), 0))
  }
  return parts
}

// ---- pin insulator ------------------------------------------------------------------------------------------------
// Stands on top of an arm (or the pole top), with the wire resting in its top groove. Base at (x, y, z), 0.30 m tall.
export const PIN_HEIGHT = 0.3
export function makePinInsulator(mats, {name, x, y, z = 0, kind = 'porcelain'}) {
  const prof = [[0.03, 0], [0.03, 0.06], [0.065, 0.06], [0.065, 0.1], [0.04, 0.12], [0.04, 0.17], [0.06, 0.17], [0.06, 0.21],
    [0.035, 0.23], [0.035, 0.27], [0.045, 0.28], [0.045, 0.3]].map(([r, h]) => new THREE.Vector2(r, h))
  const m = named(name, new THREE.LatheGeometry(prof, 16), kind === 'polymer' ? mats.polymer : mats.porcelain)
  m.position.set(x, y, z)
  return m
}

// kind: 'glass' or 'polymer'. Returns one mesh named `name` (for example "InsulatorA"), whose origin is the hook.
export function makeInsulatorString(mats, {name, x, y, z = 0, bells = 4, kind = 'glass'}) {
  bells = Math.min(Math.max(Math.round(bells) || 1, 1), MAX_BELLS)
  const hook = new THREE.TorusGeometry(0.035, 0.012, 6, 14).translate(0, -0.035, 0)
  const stem = new THREE.CylinderGeometry(0.014, 0.014, STRING_TOP, 8).translate(0, -STRING_TOP / 2 - 0.02, 0)
  const bottomY = -(STRING_TOP + bells * BELL_SPACING)
  const clamp = new THREE.CylinderGeometry(0.05, 0.06, STRING_BOTTOM, 10).translate(0, bottomY - STRING_BOTTOM / 2, 0)
  const body = kind === 'polymer' ? polymerRod(bells) : glassBells(bells)
  // the hardware (hook, stem, clamp) is steel and the insulator body has its own material: two meshes in one group
  const group = new THREE.Group()
  group.name = `${name}_String`
  const hw = new THREE.Mesh(mergeGeometries([hook, stem, clamp]), mats.steel)
  hw.name = `${name}_Hardware`
  const bodyMesh = new THREE.Mesh(mergeGeometries(body), kind === 'polymer' ? mats.polymer : mats.glass)
  bodyMesh.name = name
  group.add(bodyMesh, hw)
  group.position.set(x, y, z)
  group.userData.length = stringLength(bells)
  return group
}

// ---- conductor ----------------------------------------------------------------------------------------------
// A phase wire running along Z, resting in the top of the insulator at (x, y), drooping toward its ends.
export const CONDUCTOR_RADIUS = 0.04
export function makeConductor(mats, {name, x, y, halfSpan = 4, droop = 0.35, radius = CONDUCTOR_RADIUS}) {
  const pts = []
  const N = 24
  for (let i = 0; i <= N; i++) {
    const z = -halfSpan + (2 * halfSpan * i) / N
    pts.push(new THREE.Vector3(0, -droop * (z / halfSpan) ** 2, z))
  }
  const m = named(name, cappedTube(pts, radius, 12, 48), mats.aluminum)
  m.position.set(x, y, 0)
  return m
}

// ---- details --------------------------------------------------------------------------------------------------
// The down ground (pole ground): a copper lead down the +Z face of the pole and the ground point near its foot.
export function makeDownGround(mats, pole, {topY, leadRadius = 0.03, bottomY = 0.5}) {
  const pts = []
  for (let y = topY; y >= bottomY - 1e-9; y -= 0.5) pts.push(new THREE.Vector3(0, y, poleRadiusAt(pole, y) + leadRadius))
  const lead = named('GroundLead', cappedTube(pts, leadRadius, 10, Math.max(8, pts.length * 2)), mats.copper)
  const point = named('GroundPoint', new THREE.BoxGeometry(0.12, 0.14, 0.08), mats.copperDark)
  point.position.set(0, bottomY, poleRadiusAt(pole, bottomY) + leadRadius)
  return [lead, point]
}

// A static (shield) wire above the phases: a short steel mast on the pole top and a wire along the line.
export function makeStaticWire(mats, pole, {mastHeight = 0.9, halfSpan = 4, droop = 0.3}) {
  const mast = named('StaticMast', new THREE.CylinderGeometry(0.03, 0.045, mastHeight, 10).translate(0, pole.height + mastHeight / 2, 0), mats.steel)
  const wire = makeConductor(mats, {name: 'Static_Conductor', x: 0, y: pole.height + mastHeight + 0.04, halfSpan, droop, radius: 0.025})
  return [mast, wire]
}

// A guy wire from the pole to an anchor in the ground, leaning out the -Z side (the down ground is on +Z).
export function makeGuy(mats, pole, {attachY, reach}) {
  const r = poleRadiusAt(pole, attachY)
  const a = new THREE.Vector3(0, attachY, -r)
  const b = new THREE.Vector3(0, 0.25, -reach)
  const wire = named('GuyWire', cappedTube([a, b], 0.025, 8, 8), mats.steel)
  const anchor = named('GuyAnchor', new THREE.BoxGeometry(0.5, 0.3, 0.5).translate(0, 0.0, -reach), mats.concrete)
  const clamp = named('GuyAttachment', new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.08, 20).translate(0, attachY, 0), mats.steel)
  return [wire, anchor, clamp]
}
