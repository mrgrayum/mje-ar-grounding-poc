// Answers: "does the optimizer merge, strip, rename or move named parts?"
// Applies the SAME steps as the MJE AR app's "Optimize for phones" (dedup, prune, meshopt compression) to a .glb,
// but always (the app skips files it could shrink by less than 3 percent), then compares every named part before
// and after: still present? same local transform? same position in space?
//   node tools/optimize-check.mjs <in.glb> [out.glb]
import {dedup, prune, meshopt} from '@gltf-transform/functions'
import {MeshoptEncoder} from 'meshoptimizer'
import {writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, printReport, readGlb} from './check-nodes.mjs'

const input = process.argv[2]
const output = process.argv[3]
if (!input) { console.error('usage: node tools/optimize-check.mjs <in.glb> [out.glb]'); process.exit(2) }

await MeshoptEncoder.ready
const {io, doc} = await readGlb(input)
io.registerDependencies({'meshopt.encoder': MeshoptEncoder})
const before = describe(doc)

// A probe: an empty node (no mesh, no children). If the optimizer removes this, empty marker nodes are unsafe.
const probe = doc.createNode('ProbeEmpty').setTranslation([0.5, 0.5, 0.5])
doc.getRoot().listScenes()[0].addChild(probe)

await doc.transform(dedup(), prune(), meshopt({encoder: MeshoptEncoder, level: 'medium'}))
const bytes = await io.writeBinary(doc)
if (output) writeFileSync(output, bytes)

// Read the optimized bytes back exactly as a viewer would, then compare.
const tmp = output || join(tmpdir(), 'mje-optimized-check.glb')
if (!output) writeFileSync(tmp, bytes)
const {doc: after} = await readGlb(tmp)
const afterRows = describe(after)

printReport(afterRows, 'AFTER optimization (read back from the optimized file)')

const byName = new Map(afterRows.map(r => [r.name, r]))
const same = (a, b, tol) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= tol)
let problems = 0
console.log('\n=== Comparison, part by part ===')
before.forEach((b) => {
  const a = byName.get(b.name)
  if (!a) { console.log(`${b.name}: GONE after optimization`); problems++; return }
  const localSame = same(b.t, a.t, 1e-5) && same(b.s, a.s, 1e-5) && same(b.r, a.r, 1e-5)
  const worldDiff = Math.max(...b.min.map((v, i) => Math.abs(v - a.min[i])), ...b.max.map((v, i) => Math.abs(v - a.max[i])))
  const note = []
  if (!localSame) note.push(`LOCAL TRANSFORM CHANGED (T ${b.t.map(v => v.toFixed(3))} -> ${a.t.map(v => v.toFixed(3))}, S ${b.s.map(v => v.toFixed(4))} -> ${a.s.map(v => v.toFixed(4))})`)
  note.push(`world position max difference ${(worldDiff * 1000).toFixed(2)} mm`)
  if (!localSame) problems++
  console.log(`${b.name}: present; ${note.join('; ')}`)
})
const probeKept = byName.has('ProbeEmpty')
console.log(`\nEmpty probe node (no mesh): ${probeKept ? 'kept' : 'REMOVED by prune()'}`)
console.log(`Before: ${before.length} parts. After: ${afterRows.filter(r => r.name !== 'ProbeEmpty').length} parts.`)
console.log(`Size: optimized file ${(bytes.byteLength / 1024).toFixed(1)} KB`)
console.log(problems ? `\nRESULT: ${problems} problem(s) found.` : '\nRESULT: every named part survived with an unchanged local transform.')
