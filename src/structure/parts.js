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
// A wood arm sticking out of the pole sideways: side = +1 (right, +X) or -1 (left, -X). rootX is how far the pole's surface is
// from the middle at that height. The arm starts inside the pole so it looks bolted on.
export function makeSideArm(mats, {name, side, y, rootX, length, height = 0.16, depth = 0.12}) {
  const x0 = side * rootX * 0.6
  const x1 = side * (rootX + length)
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), height, depth)
  const m = named(name, g, mats.woodArm)
  m.position.set((x0 + x1) / 2, y, 0)
  m.userData.top = y + height / 2
  m.userData.endX = x1
  return m
}

// A very short arm (a "standoff"): a small steel bracket that holds a hanging insulator right beside the pole or tower.
export function makeStandoffBracket(mats, {name, side, y, rootX, reach = 0.3}) {
  const x0 = side * rootX * 0.9
  const x1 = side * (rootX + reach)
  const m = named(name, new THREE.BoxGeometry(Math.abs(x1 - x0), 0.1, 0.1), mats.steel)
  m.position.set((x0 + x1) / 2, y, 0)
  m.userData.top = y + 0.05
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
// side: 0 stands upright; +1 or -1 lies on its side pointing out of the pole to the right or left (a standoff insulator).
export function makePinInsulator(mats, {name, x, y, z = 0, kind = 'porcelain', side = 0}) {
  const prof = [[0.03, 0], [0.03, 0.06], [0.065, 0.06], [0.065, 0.1], [0.04, 0.12], [0.04, 0.17], [0.06, 0.17], [0.06, 0.21],
    [0.035, 0.23], [0.035, 0.27], [0.045, 0.28], [0.045, 0.3]].map(([r, h]) => new THREE.Vector2(r, h))
  const m = named(name, new THREE.LatheGeometry(prof, 16), kind === 'polymer' ? mats.polymer : mats.porcelain)
  m.position.set(x, y, z)
  if (side) m.rotation.z = -side * Math.PI / 2
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

// ---- dead end -------------------------------------------------------------------------------------------------
// Where the line stops on the structure: a strain insulator string lies along the line on each side of the arm tip, each
// holds the end of a wire, and a jumper hangs down between the two string ends to join them. The two spans and the jumper are
// ONE mesh (one conductor, one phase), so a ground clamp anywhere on it is on that phase.
const DE_START = 0.1 // m from the arm center to where each string starts
export const deadEndReach = bells => DE_START + stringLength(bells)
export const deadEndDip = bells => Math.min(1.1, 0.5 + 0.2 * deadEndReach(bells)) // how far the jumper hangs below the arm
export const DEADEND_DROP = 1.1 // how far each wire span has fallen below the arm tip at its far end

// side: +1 string out toward +Z, -1 toward -Z. (x, y) is the arm tip, y at the middle of the arm.
export function makeDeadEndString(mats, {name, x, y, side, bells = 4, kind = 'glass'}) {
  const g = makeInsulatorString(mats, {name, x, y, z: side * DE_START, bells, kind})
  g.rotation.x = side > 0 ? -Math.PI / 2 : Math.PI / 2 // the string lies along the line instead of hanging down
  return g
}

// ends: 'both' (the line goes on both sides and a jumper joins them) or 'front' / 'back' (a terminal dead end: the line comes in
// from that side only, and the wire is left as a tail hanging down on the structure side, ready to be taken to equipment).
export function makeDeadEndConductor(mats, {name, x, y, bells = 4, halfSpan, radius = CONDUCTOR_RADIUS, ends = 'both'}) {
  const E = deadEndReach(bells)
  const far = halfSpan || E + 3.2
  const dip = deadEndDip(bells)
  const span = (dir) => {
    const pts = []
    for (let i = 0; i <= 14; i++) {
      const t = i / 14
      pts.push(new THREE.Vector3(0, -DEADEND_DROP * (0.18 * t + 0.82 * t * t), dir * (E + t * (far - E))))
    }
    return cappedTube(pts, radius, 12, 28)
  }
  if (ends !== 'both') {
    const dir = ends === 'front' ? 1 : -1
    const tail = []
    for (let i = 0; i <= 20; i++) {
      const u = i / 20
      tail.push(new THREE.Vector3(0, -dip * 1.3 * Math.pow(u, 1.2), dir * E * (1 - 0.3 * u)))
    }
    const m1 = named(name, mergeGeometries([span(dir), cappedTube(tail, radius, 12, 30)]), mats.aluminum)
    m1.position.set(x, y, 0)
    return m1
  }
  const jumper = []
  for (let i = 0; i <= 24; i++) {
    const u = -1 + (2 * i) / 24
    jumper.push(new THREE.Vector3(0, -dip * (1 - u * u), E * u))
  }
  const m = named(name, mergeGeometries([span(-1), cappedTube(jumper, radius, 12, 40), span(1)]), mats.aluminum)
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

// A guy wire from the pole to an anchor in the ground. angle: the direction it leans, in degrees around the pole
// (0 = along the line toward +Z, 90 = toward +X, 180 = toward -Z, 270 = toward -X). The down ground is on the +Z side.
export function makeGuy(mats, pole, {index, angle, attachY, reach}) {
  const r = poleRadiusAt(pole, attachY)
  const dir = new THREE.Vector3(Math.sin((angle * Math.PI) / 180), 0, Math.cos((angle * Math.PI) / 180))
  const a = dir.clone().multiplyScalar(r).setY(attachY)
  const b = dir.clone().multiplyScalar(reach).setY(0.25)
  const wire = named(`GuyWire_${index}`, cappedTube([a, b], 0.025, 8, 8), mats.steel)
  const anchor = named(`GuyAnchor_${index}`, new THREE.BoxGeometry(0.5, 0.3, 0.5).rotateY((angle * Math.PI) / 180).translate(b.x, 0, b.z), mats.concrete)
  const clamp = named(`GuyAttachment_${index}`, new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.08, 20).translate(0, attachY, 0), mats.steel)
  return [wire, anchor, clamp]
}

// ---- steel lattice ----------------------------------------------------------------------------------------------
// A thin steel member between two points (a plain round bar stands in for an angle iron).
const AXIS = new THREE.Vector3(0, 1, 0)
function strut(a, b, radius) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const g = new THREE.CylinderGeometry(radius, radius, dir.length(), 6, 1)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(AXIS, dir.clone().normalize()))
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  return g.translate(mid.x, mid.y, mid.z)
}
const V = (x, y, z) => new THREE.Vector3(x, y, z)

// A four-legged, self-supporting lattice tower: legs that lean in toward the top, level belts and X bracing on all four faces.
// Returns {meshes, sideAt(y)}: sideAt = how far the outside of the legs is from the middle at height y.
export function makeLatticeTower(mats, {height}) {
  const baseW = Math.max(2.2, height * 0.17)
  const topW = Math.max(1.1, height * 0.05)
  const half = y => (baseW + (topW - baseW) * (y / height)) / 2
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const at = (k, y) => V(corners[k][0] * half(y), y, corners[k][1] * half(y))
  const meshes = []
  for (let k = 0; k < 4; k++) meshes.push(named(`TowerLeg_${k + 1}`, strut(at(k, 0), at(k, height), 0.08), mats.steel))
  const panels = Math.max(3, Math.round(height / 2.8))
  const bars = []
  for (let i = 0; i <= panels; i++) {
    const y = (i * height) / panels
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4
      bars.push(strut(at(k, y), at(n, y), 0.035)) // level belt
      if (i < panels) {
        const y2 = ((i + 1) * height) / panels
        bars.push(strut(at(k, y), at(n, y2), 0.03), strut(at(n, y), at(k, y2), 0.03)) // X bracing
      }
    }
  }
  meshes.push(named('TowerBracing', mergeGeometries(bars), mats.steel))
  return {meshes, sideAt: y => half(y) + 0.08}
}

// A lattice arm: two flat trusses side by side (a bottom chord, a sloping top chord, uprights and diagonals) with cross bars.
export function makeTrussArm(mats, {name, side, y, rootX, length}) {
  const x0 = rootX - 0.1
  const x1 = rootX + length
  const d0 = 0.55 // depth at the tower
  const d1 = 0.14 // depth at the tip
  const topAt = x => y + d0 + (d1 - d0) * ((x - x0) / Math.max(x1 - x0, 1e-6))
  const n = Math.max(1, Math.round((x1 - x0) / 0.6))
  const bars = []
  const r = 0.028
  const zs = [-0.11, 0.11]
  zs.forEach((z) => {
    bars.push(strut(V(side * x0, y, z), V(side * x1, y, z), r), strut(V(side * x0, topAt(x0), z), V(side * x1, topAt(x1), z), r))
    for (let i = 0; i <= n; i++) {
      const xi = x0 + ((x1 - x0) * i) / n
      bars.push(strut(V(side * xi, y, z), V(side * xi, topAt(xi), z), r * 0.8))
      if (i < n) {
        const xn = x0 + ((x1 - x0) * (i + 1)) / n
        bars.push(strut(V(side * xi, y, z), V(side * xn, topAt(xn), z), r * 0.8))
      }
    }
  })
  for (let i = 0; i <= n; i++) {
    const xi = x0 + ((x1 - x0) * i) / n
    bars.push(strut(V(side * xi, y, zs[0]), V(side * xi, y, zs[1]), r * 0.8), strut(V(side * xi, topAt(xi), zs[0]), V(side * xi, topAt(xi), zs[1]), r * 0.8))
  }
  const m = named(name, mergeGeometries(bars), mats.steel)
  m.userData.top = topAt(x1) + r
  m.userData.endX = side * x1
  return m
}
