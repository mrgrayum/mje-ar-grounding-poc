// Lists the parts (nodes) inside a .glb, including optimized/compressed files, and checks the required names.
//   node tools/check-nodes.mjs <file.glb> [--json]
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {REQUIRED_NODES} from './make-structure.mjs'

export async function readGlb(file) {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder})
  return {io, doc: await io.readBinary(new Uint8Array(readFileSync(file)))}
}

const mul = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

// One row per node: name, local transform, mesh, vertex count and world-space bounding box (true positions,
// after any quantization is undone).
export function describe(doc) {
  const rows = []
  const walk = (node, depth) => {
    const m = node.getWorldMatrix()
    let verts = 0
    let min = null
    let max = null
    const mesh = node.getMesh()
    if (mesh) {
      mesh.listPrimitives().forEach((prim) => {
        const acc = prim.getAttribute('POSITION')
        if (!acc) return
        verts += acc.getCount()
        const el = [0, 0, 0]
        for (let i = 0; i < acc.getCount(); i++) {
          acc.getElement(i, el)
          const w = mul(m, el)
          min = min ? min.map((v, k) => Math.min(v, w[k])) : w.slice()
          max = max ? max.map((v, k) => Math.max(v, w[k])) : w.slice()
        }
      })
    }
    rows.push({
      name: node.getName(), depth, mesh: mesh ? mesh.getName() : null, verts,
      t: node.getTranslation(), r: node.getRotation(), s: node.getScale(), min, max,
      parent: node.getParentNode() ? node.getParentNode().getName() : null,
    })
    node.listChildren().forEach(c => walk(c, depth + 1))
  }
  doc.getRoot().listScenes().forEach(sc => sc.listChildren().forEach(n => walk(n, 0)))
  return rows
}

const f3 = a => (a ? `[${a.map(v => v.toFixed(3)).join(', ')}]` : '-')

export function printReport(rows, title) {
  console.log(`\n=== ${title} ===`)
  rows.forEach((r) => {
    console.log(`${'  '.repeat(r.depth)}${r.name.padEnd(18 - r.depth * 2)} mesh:${r.mesh ? 'yes' : 'NO '} verts:${String(r.verts).padStart(5)}  T${f3(r.t)} S${f3(r.s)}  world ${f3(r.min)}..${f3(r.max)}`)
  })
  const names = new Set(rows.map(r => r.name))
  const missing = REQUIRED_NODES.filter(n => !names.has(n))
  console.log(missing.length ? `MISSING required names: ${missing.join(', ')}` : `All ${REQUIRED_NODES.length} required node names are present.`)
  return missing
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain && process.argv[2]) {
  const {doc} = await readGlb(process.argv[2])
  const rows = describe(doc)
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows.map(r => r.name)))
  else printReport(rows, process.argv[2])
}
