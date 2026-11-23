// The grounding session record: what gets exported, saved on the device and loaded back.
// Plain data and plain functions, no 3D code, so it is easy to test and to hand to another system later.
//
//   {
//     "format": "mje-grounding-record", "version": 1,
//     "model": {"slug", "title", "bytes", "fingerprint"},      which model file the grounds were placed on
//     "student": "...", "scenario": "...",
//     "sessionStart": ISO time of the first clamp, "sessionEnd": ISO time of the export,
//     "grounds": [{
//       "id": "G1",
//       "a": {"node", "local": [x,y,z], "model": [x,y,z], "normal": [x,y,z]},
//       "b": {...same...},
//       "placedAt": ISO time
//     }]
//   }
//
// node   = name of the part that was tapped.
// local  = the tapped point in that part's own coordinates (changes if the model is re-optimized).
// model  = the same point in the model's overall coordinates (stable); this is what reloading draws from.
// normal = which way the surface faced there (model coordinates), so the clamp sits the right way round.

export const RECORD_FORMAT = 'mje-grounding-record'
export const RECORD_VERSION = 1

const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
const isEnd = e => e && typeof e.node === 'string' && e.node && isVec3(e.model) && isVec3(e.local) && (e.normal === undefined || isVec3(e.normal))

export function buildRecord({model, student, scenario, sessionStart, sessionEnd, grounds}) {
  return {
    format: RECORD_FORMAT,
    version: RECORD_VERSION,
    model: {slug: model.slug, title: model.title || '', bytes: model.bytes || 0, fingerprint: model.fingerprint || ''},
    student: String(student || '').trim(),
    scenario: String(scenario || '').trim(),
    sessionStart: sessionStart || null,
    sessionEnd: sessionEnd || new Date().toISOString(),
    grounds,
  }
}

// Reads and checks a record. Returns {ok: true, record} or {ok: false, error: "plain-language reason"}.
export function parseRecord(text) {
  let rec
  try { rec = JSON.parse(text) } catch (e) { return {ok: false, error: 'That file is not a grounding record (it could not be read).'} }
  if (!rec || rec.format !== RECORD_FORMAT) return {ok: false, error: 'That file is not a grounding record.'}
  if (rec.version !== RECORD_VERSION) return {ok: false, error: `This record uses format version ${rec.version}, which this page cannot read.`}
  if (!rec.model || typeof rec.model.slug !== 'string') return {ok: false, error: 'The record does not say which model it is for.'}
  if (!Array.isArray(rec.grounds)) return {ok: false, error: 'The record has no list of grounds.'}
  for (const g of rec.grounds) {
    if (!g || typeof g.id !== 'string' || !isEnd(g.a) || !isEnd(g.b)) return {ok: false, error: 'One of the grounds in the record is damaged.'}
  }
  return {ok: true, record: rec}
}

const pad = n => String(n).padStart(2, '0')

// grounding-record_<student>_<yyyymmdd-hhmm>.json
export function recordFileName(record) {
  const d = new Date(record.sessionEnd || Date.now())
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const who = (record.student || 'student').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'student'
  return `grounding-record_${who}_${stamp}.json`
}

// A short fingerprint of the model file (first 16 characters of its SHA-256), so a record can tell whether it is
// being opened against the same file it was made on. Empty if the browser cannot compute it.
export async function fingerprintOf(buffer) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch (e) {
    return ''
  }
}

// Offers the record to the user as a download (works from a normal click in desktop browsers).
export function downloadRecord(record) {
  const blob = new Blob([JSON.stringify(record, null, 2)], {type: 'application/json'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = recordFileName(record)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return a.download
}
