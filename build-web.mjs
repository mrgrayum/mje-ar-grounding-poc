// Rebuilds the three web bundles from ./src into the site root:
//   viewer.js (3D page), ar.js (AR page), library.js (library page).
// Same esbuild settings as the MJE AR authoring app, so unchanged source gives identical files.
//   node build-web.mjs            write the bundles into the site root
//   node build-web.mjs --check    build in memory and report whether they match the files on disk
import {build} from 'esbuild'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = import.meta.dirname
const check = process.argv.includes('--check')

const common = {
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  loader: {'.css': 'text'},
  legalComments: 'none',
  logLevel: 'warning',
}

const targets = {
  'viewer.js': 'src/viewer-main.js',
  'ar.js': 'src/ar-main.js',
  'library.js': 'src/library-main.js',
}

let allSame = true
for (const [outName, entry] of Object.entries(targets)) {
  const result = await build({...common, entryPoints: [path.join(root, entry)], write: false})
  const text = result.outputFiles[0].text
  const file = path.join(root, outName)
  if (check) {
    const disk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const same = disk === text
    allSame = allSame && same
    const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)
    console.log(`${outName}: ${same ? 'identical' : 'DIFFERENT'} (built ${h(text)}, on disk ${h(disk)})`)
  } else {
    fs.writeFileSync(file, text)
    console.log(`${outName}: ${Math.round(text.length / 1024)} KB`)
  }
}
if (check && !allSame) process.exit(1)
