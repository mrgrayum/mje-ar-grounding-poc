// Generates the Stage 1 test structure: a wood pole with a crossarm, three pin insulators, three conductors,
// a ground lead and a ground point, every one a SEPARATE, NAMED part (node), so a student can tap a specific part.
//
//   node tools/make-structure.mjs            writes tools/generated/test-pole.glb
//
// Units are meters, Y is up, the power line runs along Z, the crossarm runs along X, the ground lead is on the +Z face.
// Training visual only: sizes are nominal. Conductors and the ground lead are deliberately THICK (8 cm and 6 cm)
// so they can be tapped when the model is shown at about 1:6 scale in AR.
import {Document, NodeIO} from '@gltf-transform/core'
import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

// ---- the design (change numbers here, then re-run) -----------------------------------------------------
export const DESIGN = {
  poleHeight: 12.0,
  poleRadiusBase: 0.20, // 0.40 m wide at the base
  poleRadiusTop: 0.14, // 0.28 m wide at the top
  armY: 10.8, // crossarm center height
  armSize: [3.0, 0.14, 0.11], // x (length), y (height), z (depth)
  pinX: 1.2, // phase A at -pinX, phase C at +pinX
  insulatorHeight: 0.30,
  conductorRadius: 0.04, // 8 cm thick (exaggerated)
  conductorHalfSpan: 4.0, // runs 4 m each way from the insulator
  conductorDroop: 0.35, // drop at each end
  leadRadius: 0.03, // 6 cm thick (exaggerated)
  leadTopY: 10.5,
  leadBottomY: 0.5,
  pointSize: [0.12, 0.14, 0.08],
}

// The part names the grounding POC relies on. Do not rename without agreeing it with the project owner.
export const REQUIRED_NODES = [
  'Pole', 'Crossarm1', 'InsulatorA', 'InsulatorB', 'InsulatorC',
  'PhaseA_Conductor', 'PhaseB_Conductor', 'PhaseC_Conductor', 'GroundLead', 'GroundPoint',
]

const D = DESIGN
const poleRadiusAt = y => D.poleRadiusBase + (D.poleRadiusTop - D.poleRadiusBase) * (y / D.poleHeight)

// ---- small geometry kit ----------------------------------------------------------------------------------
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

class Geo {
  constructor() { this.pos = []; this.nor = []; this.idx = [] }
  vert(p, n) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); return this.pos.length / 3 - 1 }
  tri(a, b, c) { this.idx.push(a, b, c) }
  // A flat disc closing the end of a ring of points (center c, outward normal n).
  cap(center, ring, n, flip = false) {
    const ci = this.vert(center, n)
    const start = ring.map(p => this.vert(p, n))
    for (let i = 0; i < start.length; i++) {
      const a = start[i]
      const b = start[(i + 1) % start.length]
      if (flip) this.tri(ci, b, a); else this.tri(ci, a, b)
    }
  }
}

// A lathe (solid of revolution) around the Y axis. profile = [[radius, y], ...] from bottom to top.
function lathe(g, profile, seg = 20) {
  const rows = []
  profile.forEach((p, i) => {
    const prev = profile[Math.max(i - 1, 0)]
    const next = profile[Math.min(i + 1, profile.length - 1)]
    const dr = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const l = Math.hypot(dr, dy) || 1
    const nr = dy / l // outward normal in the (r, y) plane
    const ny = -dr / l
    const row = []
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      row.push(g.vert([Math.cos(a) * p[0], p[1], Math.sin(a) * p[0]], [Math.cos(a) * nr, ny, Math.sin(a) * nr]))
    }
    rows.push(row)
  })
  for (let i = 0; i < rows.length - 1; i++) {
    for (let s = 0; s < seg; s++) {
      const a = rows[i][s]; const b = rows[i][s + 1]; const c = rows[i + 1][s + 1]; const d = rows[i + 1][s]
      g.tri(a, d, c); g.tri(a, c, b)
    }
  }
  const ring = (p) => { const r = []; for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; r.push([Math.cos(a) * p[0], p[1], Math.sin(a) * p[0]]) } return r }
  const bottom = profile[0]
  const top = profile[profile.length - 1]
  if (bottom[0] > 0) g.cap([0, bottom[1], 0], ring(bottom), [0, -1, 0], true)
  if (top[0] > 0) g.cap([0, top[1], 0], ring(top), [0, 1, 0])
}

// A round tube along a polyline, with closed ends. Uses a parallel-transported frame so it never twists.
function tube(g, pts, radius, seg = 12) {
  const T = pts.map((p, i) => norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])))
  let n0 = cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])
  n0 = norm(n0)
  const frames = []
  let N = n0
  T.forEach((t, i) => {
    if (i > 0) { // re-orthogonalize against the new tangent
      const d = dot(N, t)
      N = norm([N[0] - t[0] * d, N[1] - t[1] * d, N[2] - t[2] * d])
    }
    frames.push({t, n: N, b: cross(t, N)})
  })
  const rings = []
  pts.forEach((p, i) => {
    const {n, b} = frames[i]
    const row = []
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      const dir = [n[0] * Math.cos(a) + b[0] * Math.sin(a), n[1] * Math.cos(a) + b[1] * Math.sin(a), n[2] * Math.cos(a) + b[2] * Math.sin(a)]
      row.push(g.vert([p[0] + dir[0] * radius, p[1] + dir[1] * radius, p[2] + dir[2] * radius], dir))
    }
    rings.push(row)
  })
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < seg; s++) {
      const a = rings[i][s]; const b = rings[i][s + 1]; const c = rings[i + 1][s + 1]; const d = rings[i + 1][s]
      g.tri(a, b, c); g.tri(a, c, d)
    }
  }
  const endRing = (i) => {
    const {n, b} = frames[i]
    const r = []
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2
      r.push([pts[i][0] + (n[0] * Math.cos(a) + b[0] * Math.sin(a)) * radius, pts[i][1] + (n[1] * Math.cos(a) + b[1] * Math.sin(a)) * radius, pts[i][2] + (n[2] * Math.cos(a) + b[2] * Math.sin(a)) * radius])
    }
    return r
  }
  const last = pts.length - 1
  g.cap(pts[0], endRing(0), T[0].map(v => -v), true)
  g.cap(pts[last], endRing(last), T[last])
}

// A flat-shaded box centered on the node origin.
function box(g, [sx, sy, sz]) {
  const hx = sx / 2; const hy = sy / 2; const hz = sz / 2
  const faces = [
    {n: [1, 0, 0], v: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]},
    {n: [-1, 0, 0], v: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]},
    {n: [0, 1, 0], v: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]},
    {n: [0, -1, 0], v: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]},
    {n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]},
    {n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]},
  ]
  faces.forEach((f) => {
    const ids = f.v.map(p => g.vert(p, f.n))
    g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[3])
  })
}

// ---- assemble the glTF -------------------------------------------------------------------------------------
export function buildStructure() {
  const doc = new Document()
  doc.getRoot().getAsset().generator = 'MJE AR grounding POC: tools/make-structure.mjs'
  const buffer = doc.createBuffer()
  const scene = doc.createScene('TestPole')
  doc.getRoot().setDefaultScene(scene)

  const mat = (name, rgb, rough, metal) => doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setRoughnessFactor(rough).setMetallicFactor(metal)
  const wood = mat('Wood', [0.42, 0.28, 0.16], 0.9, 0)
  const woodArm = mat('WoodArm', [0.55, 0.40, 0.24], 0.85, 0)
  const porcelain = mat('Porcelain', [0.72, 0.78, 0.84], 0.3, 0)
  const aluminum = mat('Aluminum', [0.72, 0.74, 0.77], 0.4, 0.85)
  const copper = mat('Copper', [0.78, 0.46, 0.2], 0.35, 0.85)
  const copperDark = mat('CopperDark', [0.5, 0.28, 0.12], 0.45, 0.8)

  const part = (name, material, translation, fill) => {
    const g = new Geo()
    fill(g)
    const acc = (type, arr, Ctor) => doc.createAccessor().setType(type).setArray(new Ctor(arr)).setBuffer(buffer)
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', g.pos, Float32Array))
      .setAttribute('NORMAL', acc('VEC3', g.nor, Float32Array))
      .setIndices(acc('SCALAR', g.idx, Uint16Array))
      .setMaterial(material)
    const mesh = doc.createMesh(`${name}_Mesh`).addPrimitive(prim)
    const node = doc.createNode(name).setTranslation(translation).setMesh(mesh)
    scene.addChild(node)
    return node
  }

  part('Pole', wood, [0, 0, 0], g => lathe(g, [[D.poleRadiusBase, 0], [D.poleRadiusTop, D.poleHeight]], 24))
  const armTop = D.armY + D.armSize[1] / 2
  part('Crossarm1', woodArm, [0, D.armY, 0], g => box(g, D.armSize))

  // Porcelain pin insulator profile, base at y = 0, 0.30 m tall.
  const h = D.insulatorHeight / 0.30
  const insulator = (g) => lathe(g, [[0.03, 0], [0.03, 0.06 * h], [0.065, 0.06 * h], [0.065, 0.1 * h], [0.04, 0.12 * h], [0.04, 0.17 * h],
    [0.06, 0.17 * h], [0.06, 0.21 * h], [0.035, 0.23 * h], [0.035, 0.27 * h], [0.045, 0.28 * h], [0.045, 0.3 * h]], 16)
  part('InsulatorA', porcelain, [-D.pinX, armTop, 0], insulator)
  part('InsulatorB', porcelain, [0, D.poleHeight, 0], insulator)
  part('InsulatorC', porcelain, [D.pinX, armTop, 0], insulator)

  // Conductors run along Z and droop away from the insulator.
  const span = []
  const N = 32
  for (let i = 0; i <= N; i++) {
    const z = -D.conductorHalfSpan + (2 * D.conductorHalfSpan * i) / N
    span.push([0, -D.conductorDroop * (z / D.conductorHalfSpan) ** 2, z])
  }
  const sit = D.insulatorHeight + D.conductorRadius * 0.75 // rests in the top of the insulator
  part('PhaseA_Conductor', aluminum, [-D.pinX, armTop + sit, 0], g => tube(g, span, D.conductorRadius, 12))
  part('PhaseB_Conductor', aluminum, [0, D.poleHeight + sit, 0], g => tube(g, span, D.conductorRadius, 12))
  part('PhaseC_Conductor', aluminum, [D.pinX, armTop + sit, 0], g => tube(g, span, D.conductorRadius, 12))

  // Ground lead: runs down the +Z face of the pole, following its taper.
  const lead = []
  for (let y = D.leadTopY; y >= D.leadBottomY - 1e-9; y -= 0.5) lead.push([0, y, poleRadiusAt(y) + D.leadRadius])
  part('GroundLead', copper, [0, 0, 0], g => tube(g, lead, D.leadRadius, 10))
  const pointY = D.leadBottomY - D.pointSize[1] / 2 + 0.07
  part('GroundPoint', copperDark, [0, pointY, poleRadiusAt(pointY) + D.leadRadius], g => box(g, D.pointSize))

  return doc
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url))
  const out = join(here, 'generated', 'test-pole.glb')
  mkdirSync(dirname(out), {recursive: true})
  const bytes = await new NodeIO().writeBinary(buildStructure())
  writeFileSync(out, bytes)
  console.log(`Wrote ${out} (${(bytes.byteLength / 1024).toFixed(1)} KB)`)
}
