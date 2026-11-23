// Tiny local web server for testing the site on this computer: node serve.mjs [port]
// (Phones need HTTPS for the camera, so real AR tests use the GitHub Pages address.)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = import.meta.dirname
const port = Number(process.argv[2]) || 8080
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain',
}

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.resolve(root, '.' + rel)
  if (!file.startsWith(root + path.sep) || /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(root, file))) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'})
    res.end(data)
  })
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/`))
