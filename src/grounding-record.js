// The grounding session record: what gets exported, saved on the device and loaded back.
// Plain data and plain functions, no 3D code, so it is easy to test and to hand to another system later.
//
//   {
//     "format": "mje-grounding-record", "version": 2,
//     "model": {"slug", "title", "bytes", "fingerprint"},      which model file the grounds were placed on
//     "structure": {"number", "line", "job",                    which structure and job this plan is for
//                   "conductors": {"PhaseA_Conductor": "A Phase", ...}},   the name given to each conductor
//     "student": "...", "scenario": "...",
//     "sessionStart": ISO time of the first clamp, "sessionEnd": ISO time of the export,
//     "fittings": [],                                           reserved: cluster brackets and ground rods (a later step)
//     "grounds": [{
//       "id": "G1",
//       "a": {"kind": "clamp", "node", "label", "local": [x,y,z], "model": [x,y,z], "normal": [x,y,z]},
//       "b": {...same...},
//       "placedAt": ISO time
//     }]
//   }
//
// node   = name of the part that was tapped (the part's name in the 3D model).
// label  = the name the user gave that connection point (for example "B Phase"): the name used for tracking.
// local  = the tapped point in that part's own coordinates (changes if the model is re-optimized).
// model  = the same point in the model's overall coordinates (stable); this is what reloading draws from.
// normal = which way the surface faced there (model coordinates), so the clamp sits the right way round.
//
// Version 1 records (no structure, labels or fittings) are still read; they are filled in with empty values.

export const RECORD_FORMAT = 'mje-grounding-record'
export const RECORD_VERSION = 2

const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
const isEnd = e => e && typeof e.node === 'string' && e.node && isVec3(e.model) && isVec3(e.local)
  && (e.normal === undefined || isVec3(e.normal)) && (e.label === undefined || typeof e.label === 'string')
const text = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max)

export const emptyStructure = () => ({number: '', line: '', job: '', conductors: {}})

export function buildRecord({model, student, scenario, structure, sessionStart, sessionEnd, grounds, fittings = []}) {
  const st = structure || {}
  return {
    format: RECORD_FORMAT,
    version: RECORD_VERSION,
    model: {slug: model.slug, title: model.title || '', bytes: model.bytes || 0, fingerprint: model.fingerprint || ''},
    structure: {number: text(st.number, 60), line: text(st.line, 80), job: text(st.job, 60), conductors: {...(st.conductors || {})}},
    student: String(student || '').trim(),
    scenario: String(scenario || '').trim(),
    sessionStart: sessionStart || null,
    sessionEnd: sessionEnd || new Date().toISOString(),
    fittings,
    grounds,
  }
}

// Reads and checks a record (version 1 or 2). Returns {ok: true, record} with every field present, or
// {ok: false, error: "plain-language reason"}.
export function parseRecord(text0) {
  let rec
  try { rec = JSON.parse(text0) } catch (e) { return {ok: false, error: 'That file is not a grounding record (it could not be read).'} }
  if (!rec || rec.format !== RECORD_FORMAT) return {ok: false, error: 'That file is not a grounding record.'}
  if (rec.version !== 1 && rec.version !== RECORD_VERSION) return {ok: false, error: `This record uses format version ${rec.version}, which this page cannot read.`}
  if (!rec.model || typeof rec.model.slug !== 'string') return {ok: false, error: 'The record does not say which model it is for.'}
  if (!Array.isArray(rec.grounds)) return {ok: false, error: 'The record has no list of grounds.'}
  for (const g of rec.grounds) {
    if (!g || typeof g.id !== 'string' || !isEnd(g.a) || !isEnd(g.b)) return {ok: false, error: 'One of the grounds in the record is damaged.'}
  }
  const st = rec.structure && typeof rec.structure === 'object' ? rec.structure : {}
  const conductors = st.conductors && typeof st.conductors === 'object' ? st.conductors : {}
  const record = {
    ...rec,
    version: RECORD_VERSION, // read as the current shape
    sourceVersion: rec.version,
    structure: {number: text(st.number, 60), line: text(st.line, 80), job: text(st.job, 60), conductors},
    fittings: Array.isArray(rec.fittings) ? rec.fittings : [],
    student: text(rec.student, 60),
    scenario: text(rec.scenario, 80),
    grounds: rec.grounds.map(g => ({...g, a: {kind: 'clamp', ...g.a}, b: {kind: 'clamp', ...g.b}})),
  }
  return {ok: true, record}
}

const pad = n => String(n).padStart(2, '0')
const slugOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// grounding-record_<structure>_<student>_<yyyymmdd-hhmm>.json  (the structure part only when a number was entered)
export function recordFileName(record) {
  const d = new Date(record.sessionEnd || Date.now())
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const who = [slugOf(record.structure && record.structure.number), slugOf(record.student) || 'student'].filter(Boolean).join('_')
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

// On a phone or tablet, hands the record to the system share sheet (Files, Mail, AirDrop...) as an attached file,
// which is far more reliable than a browser download on iPhone. Falls back to a normal download when sharing a file
// is not available (desktop, older browsers). Returns {how: 'shared' | 'downloaded' | 'cancelled', name}.
export async function shareOrDownloadRecord(record) {
  const name = recordFileName(record)
  try {
    const file = new File([JSON.stringify(record, null, 2)], name, {type: 'application/json'})
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    if (touch && navigator.canShare && navigator.canShare({files: [file]})) {
      await navigator.share({files: [file], title: 'Grounding record', text: `Grounding record: ${record.student}`})
      return {how: 'shared', name}
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return {how: 'cancelled', name}
    // any other problem: fall through to a normal download
  }
  downloadRecord(record)
  return {how: 'downloaded', name}
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
