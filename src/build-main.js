// The structure builder page: a toolbox of parts on the left, a live 3D structure, and a button that opens the structure in
// the grounding tool. The structure is described by a small recipe (see structure/recipe.js); every change rebuilds the 3D
// structure, saves it as a model in memory and loads that into the same viewer the library uses, so what is built here
// behaves exactly like any other model, including for grounding.
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {createStage, injectStyles, lockZoom} from './core.js'
import {createGrounding, createGroundUI} from './grounding.js'
import {fingerprintOf} from './grounding-record.js'
import {
  buildStructure, disposeStructure, normalizeRecipe, DEFAULT_RECIPE, STRUCTURES, ARM_TYPES, LAYOUTS, INSULATORS, LIMITS,
} from './structure/recipe.js'

const STORE = 'mje-structure-recipe'
const CSS = `
.sb *{box-sizing:border-box}
.sb-panel{position:absolute;z-index:20;left:0;top:0;bottom:0;width:min(360px,100%);display:flex;flex-direction:column;background:#0b0b0b;color:#fff;
  font:14px/1.35 'Segoe UI',system-ui,Arial,sans-serif;border-right:3px solid #FFEF00;pointer-events:auto}
.sb-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #2a2a2a;flex:none}
.sb-head img{height:34px}
.sb-head b{font-size:17px;flex:1}
.sb-head small{background:#FFEF00;color:#000;font-weight:700;border-radius:999px;padding:2px 9px;font-size:11px;letter-spacing:.04em}
.sb-scroll{flex:1;overflow-y:auto;padding:4px 12px 12px}
.sb-sec{padding:12px 0 6px;border-bottom:1px solid #222}
.sb-sec h3{margin:0 0 8px;font:700 12px 'Segoe UI',system-ui,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#FFEF00}
.sb-cards{display:flex;flex-wrap:wrap;gap:6px}
.sb-card{flex:1 1 calc(50% - 6px);min-width:110px;min-height:44px;padding:8px 10px;border:2px solid #333;border-radius:10px;background:#161616;color:#fff;
  font:600 13px 'Segoe UI',system-ui,Arial,sans-serif;text-align:left;cursor:pointer;touch-action:manipulation}
.sb-card.on{border-color:#FFEF00;background:#2a2800;color:#FFEF00}
.sb-card.soon{opacity:.45;cursor:default}
.sb-card small{display:block;font-weight:500;font-size:11px;color:#9a9a9a}
.sb-row{display:flex;align-items:center;gap:8px;margin:7px 0}
.sb-row label{flex:0 0 96px;font-size:13px;color:#ddd}
.sb-row input[type=range]{flex:1;min-width:0;accent-color:#FFEF00;height:28px}
.sb-row input[type=number]{width:70px;height:34px;border:2px solid #333;border-radius:8px;background:#161616;color:#fff;font:600 14px 'Segoe UI',system-ui,Arial,sans-serif;padding:0 6px;text-align:right}
.sb-row input[type=number]:focus{outline:0;border-color:#FFEF00}
.sb-row span{font-size:12px;color:#9a9a9a;width:16px}
.sb-check{display:flex;align-items:center;gap:10px;min-height:38px;font-size:14px;cursor:pointer}
.sb-check input{width:20px;height:20px;accent-color:#FFEF00}
.sb-note{margin:8px 0 0;padding:8px 10px;border-left:4px solid #FFEF00;background:#1d1b00;font-size:12.5px;color:#f1e96b}
.sb-soon{margin:6px 0 0;font-size:12px;color:#8a8a8a}
.sb-foot{flex:none;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #2a2a2a;display:flex;flex-direction:column;gap:8px}
.sb-go{height:48px;border:0;border-radius:12px;background:#FFEF00;color:#000;font:800 15px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-go:active{background:#E6D700}
.sb-small{display:flex;gap:8px}
.sb-small button{flex:1;height:38px;border:2px solid #333;border-radius:10px;background:#161616;color:#fff;font:600 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-tiny{font-size:11px;color:#8a8a8a;text-align:center}
.sb-back{position:absolute;z-index:30;right:12px;top:calc(12px + env(safe-area-inset-top));height:44px;padding:0 16px;border:0;border-radius:12px;
  background:#000;color:#FFEF00;font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;border:2px solid #FFEF00;cursor:pointer;pointer-events:auto}
.sb-panel[hidden],.sb-back[hidden]{display:none}
.sb-fold{display:none}
@media(max-width:700px){
  .sb-panel{top:auto;width:100%;height:min(54vh,520px);border-right:0;border-top:3px solid #FFEF00}
  .sb-panel.folded{height:auto}.sb-panel.folded .sb-scroll,.sb-panel.folded .sb-foot{display:none}
  .sb-fold{display:block;border:0;background:none;color:#FFEF00;font:700 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;padding:6px}
}
`

const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }

const exportGlb = group => new Promise((resolve, reject) => {
  new GLTFExporter().parse(group, resolve, reject, {binary: true})
})

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') } catch (e) { return null }
}

async function main() {
  lockZoom()
  injectStyles()
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style)
  const root = document.getElementById('app')
  root.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#000'
  root.classList.add('sb')
  const stage = createStage(root, {dracoPath: 'draco/'})

  let recipe = normalizeRecipe(loadSaved() || DEFAULT_RECIPE)
  let buffer = null
  let info = {conductors: [], notes: []}
  let seq = 0
  let first = true
  let timer = 0
  let grounding = null
  let groundUI = null

  // ---- the panel ------------------------------------------------------------------------------------------
  const panel = el('div', 'sb-panel')
  panel.innerHTML = `<div class="sb-head"><img src="logo.png" alt=""><b>Structure Builder</b><small>TEST</small><button class="sb-fold" type="button">Hide</button></div>
    <div class="sb-scroll"></div>
    <div class="sb-foot"><button class="sb-go" type="button">Ground this structure &rarr;</button>
      <div class="sb-small"><button class="sb-dl" type="button">Download .glb</button><button class="sb-rj" type="button">Save recipe</button><button class="sb-reset" type="button">Reset</button></div>
      <div class="sb-tiny">Training visual. Sizes are nominal, not an engineering drawing.</div></div>`
  root.appendChild(panel)
  const scroll = panel.querySelector('.sb-scroll')

  const section = (title) => { const s = el('div', 'sb-sec', `<h3>${title}</h3>`); scroll.appendChild(s); return s }
  const cards = (sec, group, list, current, onPick) => {
    const wrap = el('div', 'sb-cards')
    list.forEach((it) => {
      const b = el('button', `sb-card${it.id === current ? ' on' : ''}${it.ready === false ? ' soon' : ''}`, `${it.label}${it.ready === false ? '<small>coming soon</small>' : ''}`)
      b.type = 'button'
      if (it.ready !== false) b.addEventListener('click', () => onPick(it.id))
      wrap.appendChild(b)
    })
    sec.appendChild(wrap)
    return wrap
  }
  const numberRow = (sec, label, key, unit, get, set, [min, max, step]) => {
    const row = el('div', 'sb-row', `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step}"><span>${unit}</span>`)
    const [range, num] = row.querySelectorAll('input')
    range.value = num.value = get()
    range.addEventListener('input', () => { num.value = range.value; set(+range.value) })
    num.addEventListener('change', () => { set(+num.value); range.value = num.value = get() })
    sec.appendChild(row)
  }

  const render = () => {
    const keepScroll = scroll.scrollTop
    scroll.innerHTML = ''
    let s = section('1 &middot; Structure type')
    cards(s, 'structure', STRUCTURES, recipe.structure, () => {})
    s = section('2 &middot; Arm type')
    cards(s, 'arm', ARM_TYPES, recipe.armType, () => {})
    s = section('3 &middot; Phase layout')
    cards(s, 'layout', LAYOUTS, recipe.layout, id => update({layout: id, armLength: LAYOUTS.find(l => l.id === id).armLength}))
    s = section('4 &middot; Size')
    numberRow(s, 'Pole height', 'height', 'm', () => recipe.height, v => update({height: v}, true), LIMITS.height)
    numberRow(s, recipe.layout === 'crossarm' ? 'Crossarm reach' : 'Arm length', 'armLength', 'm', () => recipe.armLength, v => update({armLength: v}, true), LIMITS.armLength)
    if (recipe.layout !== 'crossarm') numberRow(s, 'Arm spacing', 'armSpacing', 'm', () => recipe.armSpacing, v => update({armSpacing: v}, true), LIMITS.armSpacing)
    s = section('5 &middot; Insulators')
    cards(s, 'ins', INSULATORS, recipe.insulator.type, id => update({insulator: {...recipe.insulator, type: id}}))
    const type = INSULATORS.find(t => t.id === recipe.insulator.type)
    cards(s, 'mat', type.materials.map(m => ({id: m, label: cap(m)})), recipe.insulator.material, m => update({insulator: {...recipe.insulator, material: m}})).style.marginTop = '8px'
    if (type.bells) numberRow(s, 'Bells', 'bells', '', () => recipe.insulator.bells, v => update({insulator: {...recipe.insulator, bells: v}}, true), LIMITS.bells)
    s = section('6 &middot; Details')
    ;[['downGround', 'Down ground (pole ground)'], ['staticWire', 'Static (shield) wire'], ['guyWire', 'Guy wire and anchor']].forEach(([k, label]) => {
      const row = el('label', 'sb-check', `<input type="checkbox"><span>${label}</span>`)
      const box = row.firstChild
      box.checked = !!recipe.details[k]
      box.addEventListener('change', () => update({details: {...recipe.details, [k]: box.checked}}))
      s.appendChild(row)
    })
    s.appendChild(el('div', 'sb-soon', 'More on the way: dead-end hardware, arrestors, switches, transformers, anchors and more.'))
    const notes = el('div'); notes.className = 'sb-notes'; scroll.appendChild(notes)
    showNotes()
    scroll.scrollTop = keepScroll
  }
  const showNotes = () => {
    const box = scroll.querySelector('.sb-notes')
    if (box) box.innerHTML = info.notes.map(n => `<div class="sb-note">${n}</div>`).join('')
  }

  // ---- rebuilding -------------------------------------------------------------------------------------------
  const rebuild = async () => {
    const mine = ++seq
    const built = buildStructure(recipe)
    const buf = await exportGlb(built.group)
    info = built.info
    disposeStructure(built)
    if (mine !== seq) return
    const pos = stage.camera.position.clone()
    const target = stage.controls.target.clone()
    buffer = buf
    await stage.loadModel(buf)
    if (!first) { stage.camera.position.copy(pos); stage.controls.target.copy(target); stage.controls.update() }
    first = false
    showNotes()
  }
  const update = (patch, soon = false) => {
    recipe = normalizeRecipe({...recipe, ...patch})
    try { localStorage.setItem(STORE, JSON.stringify(recipe)) } catch (e) { /* not saved, still works */ }
    clearTimeout(timer)
    timer = setTimeout(rebuild, soon ? 90 : 0)
    if (!soon) render()
  }

  // ---- ground mode ------------------------------------------------------------------------------------------
  const back = el('button', 'sb-back', '&larr; Back to builder')
  back.type = 'button'
  back.hidden = true
  root.appendChild(back)
  const enterGround = () => {
    if (grounding || !buffer) return
    panel.hidden = true
    back.hidden = false
    grounding = createGrounding(stage, {model: {slug: 'built-structure', title: 'Built structure', bytes: buffer.byteLength, fingerprint: fingerprintOf(buffer)}})
    grounding.attach(root)
    groundUI = createGroundUI(root, grounding, {tour: null, shiftForLibraryBar: false})
    groundUI.setOn(true)
  }
  const leaveGround = () => {
    if (!grounding) return
    groundUI.destroy()
    grounding.destroy()
    grounding = null
    groundUI = null
    panel.hidden = false
    back.hidden = true
  }
  back.addEventListener('click', leaveGround)
  panel.querySelector('.sb-go').addEventListener('click', enterGround)

  const download = (name, blob) => {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  panel.querySelector('.sb-dl').addEventListener('click', () => buffer && download('built-structure.glb', new Blob([buffer], {type: 'model/gltf-binary'})))
  panel.querySelector('.sb-rj').addEventListener('click', () => download('structure-recipe.json', new Blob([JSON.stringify(recipe, null, 2)], {type: 'application/json'})))
  panel.querySelector('.sb-reset').addEventListener('click', () => update(DEFAULT_RECIPE))
  panel.querySelector('.sb-fold').addEventListener('click', (e) => {
    panel.classList.toggle('folded')
    e.target.textContent = panel.classList.contains('folded') ? 'Show' : 'Hide'
  })

  render()
  await rebuild()
  window.__sb = {stage, update, enterGround, leaveGround, get recipe() { return recipe }, get info() { return info }, get grounding() { return grounding }, rebuild}
}

main()
